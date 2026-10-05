/**
 * racebot CJS→ESM/TS 机械转换（pass 1：默认导出 + 顶层 require 提升）。
 * 规则见 docs/racebot-ts-conversion.md；函数体内 require 保留不动（循环依赖惰性语义）。
 * 用法: node scripts/convert-racebot.mjs <file.js|.ts>
 * 输出: 同名 .ts（原 .js 由调用方删除；对已转换的 .ts 重跑安全）。
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) { console.error('用法: node scripts/convert-racebot.mjs <file.js|.ts>'); process.exit(2); }
const src = path.resolve(file);
const text = fs.readFileSync(src, 'utf8');
const lines = text.split(/\r?\n/);

const out = [];
const imports = [];
let nsCounter = 0;
let convertedTopRequire = 0;
let convertedExports = 0;
let bodyRequire = 0;

const nsName = (base) => `__ns_${base.replace(/[^a-zA-Z0-9]/g, '_')}_${nsCounter++}`;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 顶层 require（缩进为 0；分号可选）：整对象 / 解构两种形态
    const full = line.match(/^const ([A-Za-z_$][\w$]*) = require\(['"]\.\/([^'"]+)['"]\)?;?\s*$/);
    const destructure = line.match(/^const \{([^}]+)\} = require\(['"]\.\/([^'"]+)['"]\)?;?\s*$/);
    if (full) {
        const name = full[1];
        const mod = full[2].endsWith('.js') ? full[2].slice(0, -3) : full[2];
        imports.push(`import ${name} from './${mod}';`);
        convertedTopRequire++;
        continue;
    }
    if (destructure) {
        const names = destructure[1].trim();
        const mod = destructure[2].endsWith('.js') ? destructure[2].slice(0, -3) : destructure[2];
        const ns = nsName(mod.replace(/[./]/g, '_'));
        imports.push(`import * as ${ns} from './${mod}';`);
        out.push(`const { ${names} } = ${ns};`);
        convertedTopRequire++;
        continue;
    }
    // 非顶层 require 原样保留（循环依赖惰性加载语义）
    if (/require\(/.test(line)) bodyRequire++;
    // module.exports = X → export default X；跨行对象（值为 '{'）不加尾分号
    const mex = line.match(/^module\.exports\s*=\s*(.+?)\s*;?\s*$/);
    if (mex) {
        const expr = mex[1];
        out.push(expr === '{' ? 'export default {' : `export default ${expr};`);
        convertedExports++;
        continue;
    }
    out.push(line);
}

// import 提到文件最前（保持顺序）
const result = [...imports, ...out].join('\n');
const tsPath = src.replace(/\.js$/, '.ts');
fs.writeFileSync(tsPath, result);
if (src !== tsPath) fs.unlinkSync(src);

console.log(`${path.basename(src)} → ${path.basename(tsPath)}: 顶层require ${convertedTopRequire}（体内保留 ${bodyRequire}）、export default ${convertedExports}`);
if (convertedExports === 0) console.log(`  ⚠ 无 module.exports = 形态（可能为部分导出/无导出），需人工检查`);
