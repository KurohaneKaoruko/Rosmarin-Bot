import fs from 'node:fs';
import path from 'node:path';
import screeps from './plugins/plugin-screeps.js';
import { loadSecret, resolveTarget } from './scripts/secret.js';
import { copyDirInto, deployToLocalClient, prepareSourceMap } from './plugins/upload.js';
import { defineConfig } from 'rolldown';
import { minify as terserMinify } from 'terser';

const filePath = {
	wasmDir: 'src/modules/wasm'
};

const formatDisplayPath = (targetPath) => {
	const relativePath = path.relative(process.cwd(), targetPath);
	return relativePath ? relativePath.split(path.sep).join('/') : '.';
};

const cleanDistPlugin = ({ distDir }) => ({
	name: 'clean-dist',
	buildStart() {
		fs.rmSync(distDir, { recursive: true, force: true });
		fs.mkdirSync(distDir, { recursive: true });
	}
});

const copyWasmToDistPlugin = ({ distDir }) => ({
	name: 'copy-wasm-to-dist',
	writeBundle() {
		copyDirInto(path.resolve(process.cwd(), filePath.wasmDir), distDir);
	}
});

// 放在 obfuscate 之后: terser 会把 map 重新写成「压缩后 → 源码」的复合映射, 整理要在那之后做
const prepareSourceMapPlugin = ({ outputFile }) => ({
	name: 'prepare-sourcemap',
	writeBundle() {
		const mapJs = prepareSourceMap({
			distDir: path.dirname(path.resolve(process.cwd(), outputFile)),
			outputFile: path.basename(outputFile)
		});
		if (!mapJs) return;
		const mapSizeMb = (fs.statSync(mapJs).size / 1024 / 1024).toFixed(2);
		console.log(`[build] sourcemap: ${formatDisplayPath(mapJs)} (${mapSizeMb}MB)`);
	}
});

const copyToLocalClientPlugin = ({ outputFile, copyPath }) => ({
	name: 'copy-to-local-client',
	writeBundle() {
		console.log(`[submit] 阶段 2/2: 复制到本地客户端 -> ${formatDisplayPath(copyPath)}`);

		deployToLocalClient({
			distDir: path.dirname(path.resolve(process.cwd(), outputFile)),
			outputFile: path.basename(outputFile),
			wasmDir: path.resolve(process.cwd(), filePath.wasmDir),
			copyPath
		});
	}
});

const createFastIdentifierStrategy = (seed) => {
	const prefix = `${(seed >>> 0).toString(36)}x`.slice(0, 2);
	return {
		get(index) {
			return `_${prefix}${index.toString(36)}`;
		},
		reset() {},
		sort() {},
		consider() {},
	};
};

const resolveObfuscationSeed = () => {
	const fromEnv = process.env.OBFUSCATE_SEED?.trim();
	if (!fromEnv) return Math.floor(Math.random() * 0xffffffff) >>> 0;
	const asNumber = Number(fromEnv);
	if (Number.isFinite(asNumber)) return asNumber >>> 0;
	let hash = 2166136261;
	for (let i = 0; i < fromEnv.length; i++) {
		hash ^= fromEnv.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
};

/**
 * 快速混淆（单次 terser）：
 * - 保留较强的结构压缩与重命名；
 * - 不做额外复杂处理，控制构建耗时。
 */
const obfuscateBundlePlugin = ({ outputFile, sourcemap, enabled, mode }) => ({
	name: 'obfuscate-bundle',
	async writeBundle() {
		if (!enabled) return;

		const bundlePath = path.resolve(process.cwd(), outputFile);
		if (!fs.existsSync(bundlePath)) return;
		const code = fs.readFileSync(bundlePath, 'utf8');
		if (!code.trim()) return;

		const seed = resolveObfuscationSeed();
		const mapPath = `${bundlePath}.map`;
		const hasMap = sourcemap && fs.existsSync(mapPath);

		const compressOptions = mode === 'balanced'
			? {
				defaults: true,
				passes: 1,
				toplevel: true,
				drop_debugger: true,
				keep_fargs: false,
				// 避免旧运行时把 `typeof globalThis` 优化成直接访问导致崩溃。
				typeofs: false
			}
			: mode === 'fast' || mode === 'readable'
				? {
					defaults: true,
					passes: 1,
					toplevel: true,
					drop_debugger: true,
					keep_fargs: false,
					typeofs: false
				}
				: false;

		// readable: 压缩但保留标识符并格式化为多行，控制台报错可直接看到函数名与行号；
		// fast: 旧的单行混淆模式（随机 seed 重命名，仅靠 sourcemap 还原）。
		const isReadable = mode === 'readable';
		const mangleOptions = isReadable
			? false
			: {
				toplevel: true,
				eval: true,
				nth_identifier: createFastIdentifierStrategy(seed)
			};
		const formatOptions = isReadable
			? {
				comments: false,
				ascii_only: true,
				beautify: true,
				indent_level: 1
			}
			: {
				comments: false,
				ascii_only: true
			};

		const result = await terserMinify(code, {
			compress: compressOptions,
			mangle: mangleOptions,
			format: formatOptions,
			sourceMap: hasMap ? {
				content: fs.readFileSync(mapPath, 'utf8'),
				filename: path.basename(outputFile),
				url: `${path.basename(outputFile)}.map`
			} : false
		});

		if (!result.code) {
			throw new Error('混淆失败: terser 未返回代码');
		}

		fs.writeFileSync(bundlePath, result.code);
		if (hasMap && result.map) {
			const mapOutput = typeof result.map === 'string' ? result.map : JSON.stringify(result.map);
			fs.writeFileSync(mapPath, mapOutput);
		}

		if (isReadable) {
			const lineCount = result.code.split('\n').length;
			console.log(`[obfuscate] readable mode: ${lineCount} 行, 保留函数名便于报错定位`);
		} else {
			console.log(`[obfuscate] seed=0x${seed.toString(16)}`);
		}
	}
});

export default defineConfig(() => {
	const secret = loadSecret();
	const dest = process.env.DEST;
	if (dest && !secret) throw new Error('配置文件未找到: .secret.json');
	// 目标格式: server 或 server@account
	const at = dest ? dest.indexOf('@') : -1;
	const config = dest
		? resolveTarget(secret, at === -1 ? dest : dest.slice(0, at), at === -1 ? undefined : dest.slice(at + 1))
		: undefined;

	if (!dest) console.log('未指定目标, 代码将被编译但不会上传');
	else if (!config) throw new Error('无效目标，请检查 .secret.json 中的 servers 配置');

	// NO_UPLOAD=1: 仅打包指定入口，不上传/不复制（构建基线与本地验证用）
	const noUpload = process.env.NO_UPLOAD === '1';
	if (noUpload) console.log('[build] NO_UPLOAD=1: 仅打包，不上传/不复制');

	// 入口按分支解析：VARIANT/服务器 entry 命中的分支名 → .secret.json 根级 branches[分支].path
	// 缺省 main；branches 未配置时回退旧约定 src/main.ts / src/branch/<variant>/main.ts
	const variant = process.env.VARIANT ?? config?.entry ?? 'main';
	const branchPath = secret?.branches?.[variant]?.path;
	const input = branchPath
		?? (variant === 'main' ? 'src/main.ts' : `src/branch/${variant}/main.ts`);
	if (branchPath && !fs.existsSync(path.resolve(process.cwd(), branchPath))) {
		throw new Error(`分支 ${variant} 的入口不存在: ${branchPath}`);
	}
	console.log(`[build] 入口: ${input} (分支: ${variant})`);

	const outputFile = 'dist/main.js';
	const distDir = path.dirname(path.resolve(process.cwd(), outputFile));
	const enableSourceMap = process.env.SOURCE_MAP !== '0';
	const enableObfuscation = process.env.OBFUSCATE !== '0';
	// 默认 readable：压缩但保留函数名、多行输出，报错堆栈可直接定位；
	// 需要旧的极限混淆时设 OBFUSCATE_LEVEL=fast。
	const obfuscateMode = ['fast', 'balanced', 'readable'].find((m) => process.env.OBFUSCATE_LEVEL === m) ?? 'readable';
	const pluginObfuscate = obfuscateBundlePlugin({
		outputFile,
		sourcemap: enableSourceMap,
		enabled: enableObfuscation,
		mode: obfuscateMode
	});

	// 上传目标 branch: submit 选定的分支经 BRANCH 传入, 覆盖账号级 branch; 缺省用分支名(与入口同名)
	const deployBranch = process.env.BRANCH ?? config?.branch ?? variant;
	const pluginDeploy = !config || noUpload
		? undefined
		: config.copyPath
			? copyToLocalClientPlugin({ outputFile, copyPath: config.copyPath })
			: screeps({ config: { ...config, branch: deployBranch } });

	return {
		input,
		tsconfig: './tsconfig.json',
		checks: {
			pluginTimings: false
		},
		transform: {
			target: 'node8.9.3'
		},
		output: {
			file: outputFile,
			format: 'cjs',
			sourcemap: enableSourceMap,
			// 统一交给 terser 插件处理，避免双重压缩带来的额外开销。
			minify: false
		},
		plugins: [
			cleanDistPlugin({ distDir }),
			copyWasmToDistPlugin({ distDir }),
			pluginObfuscate,
			prepareSourceMapPlugin({ outputFile }),
			pluginDeploy
		].filter(Boolean),
		external: (id) => {
			const wasmDirAbs = path.resolve(process.cwd(), filePath.wasmDir);
			return id.startsWith(filePath.wasmDir) || id.startsWith(wasmDirAbs);
		}
	};
});
