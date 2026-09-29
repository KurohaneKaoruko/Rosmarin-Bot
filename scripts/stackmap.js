// 把控制台里 minified 堆栈（如 main:1:427330）还原成源码位置。
//
// 用法:
//   node scripts/stackmap.js -t "at selectTargetStats (main:13109:9)"
//   type trace.txt | node scripts/stackmap.js          (整段粘贴, 管道输入)
//   node scripts/stackmap.js dist/main.js.map -t "..." (指定其他 map)
//
// 注意: map 只对应「最近一次构建」; push 时 plugin-screeps 会先构建再上传,
// 且会把 dist/main.js.map 重命名为 main.js.map.js (默认不上传, 本地保留),
// 所以 push 之后本地 map 依然和线上代码一致。
import fs from 'node:fs';
import path from 'node:path';
import pkg from 'source-map';

const { SourceMapConsumer } = pkg;

const args = process.argv.slice(2);
// push 时 plugin-screeps 会把 dist/main.js.map 重命名为 main.js.map.js，两个位置都试。
const defaultMapPaths = ['dist/main.js.map', 'dist/main.js.map.js']
    .map((p) => path.resolve(process.cwd(), p));
let mapPath = defaultMapPaths.find((p) => fs.existsSync(p)) ?? defaultMapPaths[0];
let inlineText;

const textIndex = args.indexOf('-t');
if (textIndex !== -1) {
    inlineText = args[textIndex + 1];
    const otherMap = args.find((arg, index) => index !== textIndex && index !== textIndex + 1 && arg.endsWith('.map'));
    if (otherMap) mapPath = path.resolve(otherMap);
} else if (args.length > 0 && args[0].endsWith('.map')) {
    mapPath = path.resolve(args[0]);
}

const readStdin = () => {
    try {
        return fs.readFileSync(0, 'utf8');
    } catch {
        return '';
    }
};

const input = inlineText ?? (process.stdin.isTTY ? '' : readStdin());
if (!input.trim()) {
    console.error('没有输入。用 -t "..." 传入堆栈, 或通过管道粘贴控制台输出。');
    process.exit(1);
}
if (!fs.existsSync(mapPath)) {
    console.error(`找不到 sourcemap: ${mapPath} (先 pnpm build 生成)`);
    process.exit(1);
}

let rawMapText = fs.readFileSync(mapPath, 'utf8');
// plugin-screeps 重命名后的 map 带 "module.exports = ...;" 包装，剥掉再解析
if (rawMapText.trimStart().startsWith('module.exports')) {
    rawMapText = rawMapText.trimStart().replace(/^module\.exports\s*=\s*/, '').replace(/;\s*$/, '');
}
const consumer = new SourceMapConsumer(JSON.parse(rawMapText));

// 匹配 main:1:427330 / main.js:1:427330 两种形式
const FRAME_RE = /\bmain(?:\.js)?\s*\((?:line )?(\d+):(\d+)\)|\bmain(?:\.js)?:(\d+):(\d+)/g;

const resolve = (line, column) => {
    const pos = consumer.originalPositionFor({ line, column });
    if (!pos || (!pos.source && pos.line == null)) return null;
    const file = pos.source ? pos.source.replace(/^\.\.?\//, '') : '?';
    const name = pos.name ? ` (${pos.name})` : '';
    return `${file}:${pos.line ?? '?'}:${pos.column ?? '?'}${name}`;
};

let unresolved = 0;
const output = input.replace(FRAME_RE, (match, ...rest) => {
    const nums = [rest[0], rest[1], rest[2], rest[3]].filter((v) => v !== undefined).map(Number);
    const line = nums[0];
    const column = nums[1];
    const mapped = Number.isFinite(line) && Number.isFinite(column) ? resolve(line, column) : null;
    if (!mapped) {
        unresolved++;
        return match;
    }
    return `${match}  =>  ${mapped}`;
});

console.log(output);
if (unresolved > 0) console.error(`[stackmap] ${unresolved} 处未能解析 (map 与线上代码可能不一致, 重新 push 后再试)`);
