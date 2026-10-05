// .secret.json 的读取与上传目标解析, 供 rolldown.config.js / scripts/submit.js / scripts/console.js 共用
// 格式: 服务器在下、账号挂在各自服务器下面, 避免搞混账号属于哪台服务器
// {
//   "servers": {
//     "screeps.com": { "protocol": "...", "hostname": "...", "port": 443, "path": "/",
//       "accounts": { "账号名": { "token": "...", "branch": "..." } } },
//     "local": { "copyPath": "..." }   // 纯本地复制目标, 无连接信息也无账号
//   },
//   "branches": { "main": { "path": "./src/main.ts" }, "local": { "path": "./src/branch/local/main.ts" } }
// }
// branches 在根级: 分支名 → 构建入口路径; 选分支即决定「打包哪个入口」+「上传到服务器哪个 branch」
// 账号上也可挂 branch (accounts.<账号名>.branch), 供直接跑 rolldown 时兜底; 走 submit 时由 branches 的键覆盖
// 上传目标 = 服务器连接信息 + 账号凭据 合并; 命令行参数用 server@account 指定
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const secretPath = path.resolve(__dirname, '../.secret.json');

export const getSecretPath = () => secretPath;

export const loadSecret = () => {
	if (!fs.existsSync(secretPath)) return undefined;
	return JSON.parse(fs.readFileSync(secretPath, 'utf-8'));
};

export const getServers = (secret) => secret?.servers ?? {};

/** 根级分支表: 分支名 → { path: 构建入口 } */
export const getBranches = (secret) => secret?.branches ?? {};

// 某台服务器下的账号列表 (local 等纯复制目标没有 accounts)
export const getServerAccounts = (server) => server?.accounts ?? {};

// 合并服务器与账号为一份完整部署配置; accountName 缺省时只返回服务器信息 (copyPath 目标或后续交互补选)
export const resolveTarget = (secret, serverName, accountName) => {
	const server = getServers(secret)[serverName];
	if (!server) return undefined;
	const { accounts, ...serverConfig } = server;
	if (serverConfig.copyPath || !accountName) return { ...serverConfig };
	const account = accounts[accountName];
	if (!account) return undefined;
	return { ...serverConfig, ...account };
};

// 按名字在候选列表里匹配: 精确命中 > 模糊命中(子串) ; 返回候选数组, 由调用方处理交互确认
export const matchName = (names, input) => {
	if (!input) return [];
	if (names.includes(input)) return [input];
	return names.filter((name) => name.includes(input));
};
