/**
 * racebot 目录重组后自动修正 require 路径。
 * 扫描所有 .js，将 require('./xxx') 的相对路径重算为新位置到目标文件的正确相对路径。
 */
import fs from 'node:fs';
import path from 'node:path';

const RB = path.resolve(process.argv[2] ?? 'src/branch/race/racebot');

// 递归收集所有 .js
const walk = (dir) => {
    let out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
};

const files = walk(RB);
const rel = (f) => path.relative(RB, f).split(path.sep).join('/');

// 旧扁平布局: 文件名 → 旧 require 路径 './name'
// 新布局: 文件在 racebot/<domain>/name.js
// 构建 旧路径→新物理位置 映射
const oldToNew = new Map(); // 'utils.js' → absolute new path
for (const f of files) {
    oldToNew.set(path.basename(f), f);
}

let fixed = 0;
for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const dir = path.dirname(file);
    let changed = false;
    const newText = text.replace(/require\((['"])(\.[^'"]+)\1\)/g, (match, quote, spec) => {
        // 解析旧扁平路径 → 目标文件名
        const baseName = spec.replace(/^\.\//, '').replace(/\.js$/, '') + '.js';
        if (!oldToNew.has(baseName)) return match; // 不在映射内（可能是目录引入或外部）
        const targetAbs = oldToNew.get(baseName);
        let relPath = path.relative(dir, targetAbs).split(path.sep).join('/');
        if (!relPath.startsWith('.')) relPath = './' + relPath;
        // 去掉 .js 后缀（CJS 惯例）
        relPath = relPath.replace(/\.js$/, '');
        const newSpec = quote + relPath + quote;
        if (newSpec !== spec) { fixed++; return `require(${newSpec})`; }
        return match;
    });
    if (newText !== text) {
        fs.writeFileSync(file, newText);
    }
}

console.log(`require 路径修正: ${fixed} 处`);
