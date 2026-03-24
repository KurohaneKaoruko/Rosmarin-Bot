import fs from 'node:fs';
import path from 'node:path';
import screeps from './plugins/plugin-screeps.js';
import { defineConfig } from 'rolldown';
import { minify as terserMinify } from 'terser';

const filePath = {
	wasmDir: 'src/wasm'
};

const formatDisplayPath = (targetPath) => {
	const relativePath = path.relative(process.cwd(), targetPath);
	return relativePath ? relativePath.split(path.sep).join('/') : '.';
};

const collectFiles = (dir) => {
	if (!fs.existsSync(dir)) return [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...collectFiles(fullPath));
		else files.push(fullPath);
	}
	return files;
};

const copyFiles = ({ fromDir, toDir }) => {
	const sourceDir = path.resolve(process.cwd(), fromDir);
	const files = collectFiles(sourceDir);
	for (const file of files) {
		const relative = path.relative(sourceDir, file);
		const target = path.join(toDir, relative);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(file, target);
	}
};

const loadSecret = () => {
	const secretPath = path.resolve(process.cwd(), '.secret.json');
	if (!fs.existsSync(secretPath)) return undefined;
	const raw = fs.readFileSync(secretPath, 'utf-8');
	return JSON.parse(raw);
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
		copyFiles({ fromDir: filePath.wasmDir, toDir: distDir });
	}
});

const copyToLocalClientPlugin = ({ outputFile, copyPath }) => ({
	name: 'copy-to-local-client',
	writeBundle() {
		const distMain = path.resolve(process.cwd(), outputFile);
		const distMap = `${distMain}.map`;
		const displayCopyPath = formatDisplayPath(copyPath);

		console.log(`[submit] 阶段 2/2: 开始复制到本地客户端 -> ${displayCopyPath}`);

		fs.mkdirSync(copyPath, { recursive: true });
		fs.copyFileSync(distMain, path.join(copyPath, path.basename(distMain)));
		copyFiles({ fromDir: filePath.wasmDir, toDir: copyPath });

		if (fs.existsSync(distMap)) {
			const mapContent = fs.readFileSync(distMap, 'utf8');
			const prefix = 'module.exports = ';
			const outMapContent = mapContent.trim().startsWith(prefix) ? mapContent : `${prefix}${mapContent};`;
			const outMapFile = path.join(copyPath, `${path.basename(distMain)}.map.js`);
			fs.writeFileSync(outMapFile, outMapContent);
		}

		console.log(`[submit] 阶段 2/2: 复制完成 -> ${displayCopyPath}`);
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
			: false;

		const result = await terserMinify(code, {
			compress: compressOptions,
			mangle: {
				toplevel: true,
				eval: true,
				nth_identifier: createFastIdentifierStrategy(seed)
			},
			format: {
				comments: false,
				ascii_only: true
			},
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

		console.log(`[obfuscate] seed=0x${seed.toString(16)}`);
	}
});

export default defineConfig(() => {
	const secret = loadSecret();
	const dest = process.env.DEST;
	if (dest && !secret) throw new Error('配置文件未找到: .secret.json');
	const config = dest ? secret?.[dest] : undefined;

	if (!dest) console.log('未指定目标, 代码将被编译但不会上传');
	else if (!config) throw new Error('无效目标，请检查 .secret.json 中是否包含对应配置');

	const outputFile = 'dist/main.js';
	const distDir = path.dirname(path.resolve(process.cwd(), outputFile));
	const enableSourceMap = process.env.SOURCE_MAP !== '0';
	const enableObfuscation = process.env.OBFUSCATE !== '0';
	const obfuscateMode = process.env.OBFUSCATE_LEVEL === 'balanced' ? 'balanced' : 'fast';
	const pluginObfuscate = obfuscateBundlePlugin({
		outputFile,
		sourcemap: enableSourceMap,
		enabled: enableObfuscation,
		mode: obfuscateMode
	});

	const pluginDeploy = config?.copyPath
		? copyToLocalClientPlugin({ outputFile, copyPath: config.copyPath })
		: config
			? screeps({ config })
			: undefined;

	return {
		input: 'src/main.ts',
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
			pluginDeploy
		].filter(Boolean),
		external: (id) => {
			const wasmDirAbs = path.resolve(process.cwd(), filePath.wasmDir);
			return id.startsWith(filePath.wasmDir) || id.startsWith(wasmDirAbs);
		}
	};
});
