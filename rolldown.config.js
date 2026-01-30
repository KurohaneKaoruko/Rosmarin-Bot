import fs from 'node:fs';
import path from 'node:path';
import screeps from './plugins/plugin-screeps.js';
import { defineConfig } from 'rolldown';

const filePath = {
	wasmDir: 'src/modules/wasm'
};

const collectFiles = (dir) => {
	if (!fs.existsSync(dir)) return [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectFiles(fullPath));
		} else {
			files.push(fullPath);
		}
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

const cleanDistPlugin = ({ distDir }) => {
	return {
		name: 'clean-dist',
		buildStart() {
			fs.rmSync(distDir, { recursive: true, force: true });
			fs.mkdirSync(distDir, { recursive: true });
		}
	};
};

const copyWasmToDistPlugin = ({ distDir }) => {
	return {
		name: 'copy-wasm-to-dist',
		writeBundle() {
			copyFiles({ fromDir: filePath.wasmDir, toDir: distDir });
		}
	};
};

const copyToLocalClientPlugin = ({ outputFile, copyPath }) => {
	return {
		name: 'copy-to-local-client',
		writeBundle() {
			const distMain = path.resolve(process.cwd(), outputFile);
			const distMap = `${distMain}.map`;

			fs.mkdirSync(copyPath, { recursive: true });
			fs.copyFileSync(distMain, path.join(copyPath, path.basename(distMain)));
			copyFiles({ fromDir: filePath.wasmDir, toDir: copyPath });

			const mapContent = fs.readFileSync(distMap, 'utf8');
			const prefix = 'module.exports = ';
			const outMapContent = mapContent.trim().startsWith(prefix) ? mapContent : `${prefix}${mapContent};`;
			const outMapFile = path.join(copyPath, `${path.basename(distMain)}.map.js`);
			fs.writeFileSync(outMapFile, outMapContent);
		}
	};
};

export default defineConfig(() => {
	const secret = loadSecret();
	const dest = process.env.DEST;
	if (dest && !secret) throw new Error('配置文件未找到: .secret.json');
	const config = dest ? secret?.[dest] : undefined;

	if (!dest) console.log('未指定目标, 代码将被编译但不会上传');
	else if (!config) throw new Error('无效目标，请检查 .secret.json 中是否包含对应配置');

	const outputFile = 'dist/main.js';
	const distDir = path.dirname(path.resolve(process.cwd(), outputFile));

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
			sourcemap: true,
			minify: true
		},
		plugins: [
			cleanDistPlugin({ distDir }),
			copyWasmToDistPlugin({ distDir }),
			pluginDeploy
		].filter(Boolean),
		external: (id) => {
			const wasmDirAbs = path.resolve(process.cwd(), filePath.wasmDir);
			return id.startsWith(filePath.wasmDir) || id.startsWith(wasmDirAbs);
		}
	};
});
