// 提交代码到游戏
// 两种模式:
//   1. 常规模式: node ./scripts/submit.js [服务器[@账号]] [--branch 分支]
//      构建 src/ 后上传; 目标取自 .secret.json 的 servers (账号挂在各服务器下)
//      交互时依次选择: 服务器 → 账号 → 分支; 参数支持缩写, 如 服务器名 / 服务器名@账号名
//      分支取自 .secret.json 根级 branches: 同一项既决定构建入口, 也作为上传目标 branch
//   2. 自定义模式: node ./scripts/submit.js --dir <代码目录> [服务器/认证选项]
//      跳过构建, 把目录内的 .js/.wasm 文件逐个作为模块直接上传, 适合上传现成的多文件源码
import shelljs from 'shelljs';
import { select, confirm } from '@inquirer/prompts';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { uploadCode, collectDir } from '../plugins/upload.js';
import { getSecretPath, loadSecret, getServers, getServerAccounts, getBranches, resolveTarget, matchName } from './secret.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const logSubmit = (message) => {
	console.log(`[submit] ${message}`);
};

const usage = () => {
	console.log([
		'用法:',
		'  node ./scripts/submit.js [服务器[@账号]]        构建 src/ 并上传 (目标取自 .secret.json, 可缩写)',
		'  node ./scripts/submit.js --dir <目录> [选项]    跳过构建, 直接上传目录内的 .js/.wasm 文件',
		'常规模式选项:',
		'  --branch <分支>         选择 .secret.json 根级 branches 中的分支（决定构建入口与上传目标 branch）',
		'自定义上传选项:',
		'  --dir, -d <路径>       代码目录 (每个文件作为一个模块, main.js 为入口)',
		'  --host <主机>          服务器地址, 如私服 IP 或 screeps.com',
		'  --port <端口>          端口 (默认: 官网 443, 其他 21025)',
		'  --protocol <协议>      http/https (默认: 官网 https, 其他 http)',
		'  --path <路径>          API 路径前缀 (默认 /)',
		'  --branch <分支>        目标分支 (默认 main, 支持 auto 取当前 git 分支)',
		'  --email <账号>         登录账号 (私服), 与 --password 搭配',
		'  --password <密码>      登录密码, 与 --email 搭配',
		'  --token <令牌>         API token, 与 --email/--password 二选一',
		'  --insecure             跳过 TLS 证书校验 (自签证书的私服)',
		'  --dry-run              只列出将上传的模块, 不实际上传'
	].join('\n'));
};

// ── 命令行参数解析: --key value / --flag / 位置参数 ──
const FLAG_KEYS = new Set(['insecure', 'dry-run', 'help', 'h']);
const OPTION_ALIASES = { hostname: 'host', d: 'dir', b: 'branch' };
const parseArgs = (argv) => {
	const options = { _: [] };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith('-')) {
			options._.push(arg);
			continue;
		}
		const key = (OPTION_ALIASES[arg.replace(/^--?/, '')] ?? arg.replace(/^--?/, ''));
		if (FLAG_KEYS.has(key)) {
			options[key] = true;
			continue;
		}
		const value = argv[i + 1];
		if (value === undefined || value.startsWith('-')) {
			logSubmit(`失败: 参数 ${arg} 缺少取值`);
			usage();
			process.exit(1);
		}
		options[key] = value;
		i += 1;
	}
	return options;
};

// 名字选择: 参数精确命中直接用, 唯一模糊命中需确认, 否则 (或多命中/无参数) 交互选择
const pickName = async (message, names, input) => {
	const candidates = matchName(names, input);
	if (candidates.length === 1 && input) {
		if (candidates[0] === input || await confirm({ message: `确定${message} ${candidates[0]} 吗？` })) {
			return candidates[0];
		}
		return '';
	}
	if (candidates.length > 1) {
		names = candidates;
	}
	try {
		return await select({
			message,
			choices: names.map((name) => ({ name, value: name }))
		});
	} catch (error) {
		return '';
	}
};

// ── 目标解析: 服务器 → 账号 ──

// 选服务器; 参数只命中账号名时, 直接定位到它所在的服务器。返回 '' 表示取消
const resolveServer = async (servers, input) => {
	if (input && !matchName(Object.keys(servers), input).length) {
		const owners = Object.entries(servers)
			.filter(([, cfg]) => Object.keys(getServerAccounts(cfg)).includes(input))
			.map(([name]) => name);
		if (owners.length === 1) return owners[0];
		if (owners.length > 1) return pickName('提交至服务器', owners, '');
	}
	return pickName('提交至服务器', Object.keys(servers), input);
};

// 选该服务器下的账号; local 等纯复制目标没有账号, 返回 null 表示无需账号。返回 '' 表示取消
const resolveAccount = async (serverName, serverConfig, input) => {
	const accountNames = Object.keys(getServerAccounts(serverConfig));
	if (accountNames.length === 0) return null;
	if (input) {
		if (!accountNames.includes(input)) {
			logSubmit(`失败: 服务器 ${serverName} 下没有账号 ${input}`);
			process.exit(1);
		}
		return input;
	}
	if (accountNames.length === 1) return accountNames[0];
	return pickName('提交至账号', accountNames, '');
};

// ── 分支解析: 参数命中直接用 (支持缩写), 否则交互选择 ──
// branches 未配置时回退 main; 给了参数却不在表中则报错。返回 '' 表示取消
const resolveBranch = async (secret, input) => {
	const branchNames = Object.keys(getBranches(secret));
	if (!input) {
		if (branchNames.length === 0) return 'main';
		if (branchNames.length === 1) return branchNames[0];
		return pickName('选择分支', branchNames, '');
	}
	const candidates = matchName(branchNames, input);
	if (candidates.length === 1) return candidates[0];
	if (candidates.length > 1) return pickName('选择分支', candidates, '');
	logSubmit(`失败: 未知分支 ${input} (可选: ${branchNames.join(' / ') || '未在 .secret.json 配置'})`);
	process.exit(1);
};

// ── 打包并部署选定分支 ──
// 目标与分支经环境变量交给 rolldown: DEST=服务器[@账号] 定位部署目标,
// VARIANT=构建入口分支, BRANCH=上传目标 branch (同一分支名, 打包完即上传/复制)
const runBuild = (target, branch) => {
	logSubmit('阶段 1/2: 打包');
	const rolldownCli = path.join(ROOT, 'node_modules', 'rolldown', 'bin', 'cli.mjs');
	const result = shelljs.exec(`node "${rolldownCli}" -c`, {
		env: {
			...process.env,
			DEST: target,
			VARIANT: branch,
			BRANCH: branch
		}
	});
	if (result.code !== 0) {
		logSubmit(`失败: 打包/部署 exit code ${result.code}`);
		process.exit(result.code || 1);
	}
	logSubmit('完成');
};

const exec = (serverName, accountName, branchName, secret) => {
	const target = accountName ? `${serverName}@${accountName}` : serverName;
	if (!resolveTarget(secret, serverName, accountName)) {
		logSubmit(`失败: 无效目标 ${target}, 请检查 .secret.json 的 servers 配置`);
		process.exit(1);
	}

	logSubmit(`目标 ${target}  分支 ${branchName}`);
	runBuild(target, branchName);
};

// ── 常规模式: 依次选择 服务器 → 账号 → 分支, 再构建并部署 ──
const execInteractive = async (input, options = {}) => {
	const secret = loadSecret();
	if (!secret) {
		console.error('配置文件未找到:', getSecretPath());
		process.exit(1);
	}
	const servers = getServers(secret);
	const [inputServer, inputAccount] = (input ?? '').split('@');

	const serverName = await resolveServer(servers, inputServer);
	if (!serverName) return;

	const accountName = await resolveAccount(serverName, servers[serverName], inputAccount);
	if (accountName === '') return;

	const branchName = await resolveBranch(secret, options.branch);
	if (!branchName) return;

	exec(serverName, accountName, branchName, secret);
};

// ── 自定义上传: 不走构建, 直接上传指定目录 ──
const execCustom = async (options) => {
	const codeDir = path.resolve(process.cwd(), options.dir);
	if (!fs.existsSync(codeDir) || !fs.statSync(codeDir).isDirectory()) {
		logSubmit(`失败: 代码目录不存在: ${codeDir}`);
		process.exit(1);
	}
	if (!options.host) {
		logSubmit('失败: 自定义上传需要 --host 指定服务器地址');
		process.exit(1);
	}

	const isOfficial = options.host === 'screeps.com';
	const config = {
		protocol: options.protocol ?? (isOfficial ? 'https' : 'http'),
		hostname: options.host,
		port: options.port ? Number(options.port) : (isOfficial ? 443 : 21025),
		path: options.path ?? '/',
		branch: options.branch ?? 'main'
	};
	if (options.token) config.token = options.token;
	if (options.email) config.email = options.email;
	if (options.password) config.password = options.password;
	if (options.insecure) config.insecure = true;

	if (!config.token && !(config.email && config.password)) {
		logSubmit('失败: 需要 --token, 或 --email + --password');
		process.exit(1);
	}

	const code = collectDir(codeDir);
	const modules = Object.keys(code).sort();
	if (modules.length === 0) {
		logSubmit(`失败: 目录中没有可上传的 .js/.wasm 文件: ${codeDir}`);
		process.exit(1);
	}

	logSubmit(`自定义上传: ${options.dir} (模块 ${modules.length}: ${modules.join(', ')})`);

	if (options['dry-run']) {
		logSubmit('dry-run: 未实际上传');
		return;
	}

	try {
		await uploadCode(config, code);
		logSubmit('完成');
	} catch (error) {
		logSubmit(`失败: ${error.message}`);
		process.exit(1);
	}
};

const submit = async () => {
	const options = parseArgs(process.argv.slice(2));

	if (options.help || options.h) {
		usage();
		return;
	}

	// 自定义模式: 提供了 --dir 或显式给出了服务器/认证参数
	if (options.dir || options.host || options.token || options.email) {
		await execCustom(options);
		return;
	}

	await execInteractive(options._[0], options);
};

submit();
