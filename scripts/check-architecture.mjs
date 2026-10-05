/**
 * 架构守卫：import 分层方向 / 模块循环依赖 / 角色字面量 / import 期副作用。
 * 仅 node 标准库，无第三方依赖；`--json [file]` 输出机器可读基线，`--strict` 有违规时退出非零。
 * 分层（自上而下只准依赖更低层）：L4 组合根(main/branch/console/config) > L3 功能层(prototype/modules 其余)
 *   > L2 框架(framework/modules/infra) > L1 共享(modules/shared、modules/utils.ts) > L0 常量与接口(constant/interface)。
 * 范围：src 下全部 ts 文件；branch/race/racebot(JS) 暂不入图（TS 转换批次 12.4 后纳入环检查）。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const SRC = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../src');
const EXCLUDE_DIRS = new Set(['wasm']);

const ROLE_SEEDS = [
    'harvester', 'carrier', 'transporter', 'manager', 'miner', 'upgrader', 'worker', 'universal',
    'logistic', 'scout', 'up-upgrade', 'up-repair', 'dismantle',
    'claim', 'attack-claimer', 'aid-build', 'aid-carry', 'aid-upgrade',
    'out-harvest', 'out-carry', 'out-build', 'out-mineral', 'out-duo', 'reserver',
    'out-attack', 'out-defend', 'out-invader', 'out-ranged', 'out-2attack', 'out-2heal',
    'power-carry', 'power-combat', 'deposit-harvest', 'deposit-transfer', 'deposit-attack', 'deposit-heal',
    'aio', 'one-ranged', 'combatHeal', 'double-attack', 'double-dismantle', 'defend-single', 'defend-duo',
    'defend-2attack', 'defend2-attack', 'pc-heal',
    'team-attack', 'team-dismantle', 'team-heal', 'team-ranged', 'rush-courier',
    'porter', 'courier', 'mineralHauler', 'distributor', 'repairer', 'rampartRepairer', 'nukeRepairer', 'idler',
];

/** 分层判定：返回 0-4，-1 表示不入层（如 racebot 下的 .ts 兜底） */
const layerOf = (relPosix) => {
    if (relPosix === 'main.ts' || relPosix === 'config.ts') return 4;
    if (relPosix.startsWith('branch/') || relPosix.startsWith('console/')) return 4;
    if (relPosix.startsWith('constant/') || relPosix.startsWith('interface/')) return 0;
    if (relPosix === 'modules/utils.ts') return 1;
    if (relPosix.startsWith('modules/shared/')) return 1;
    if (relPosix.startsWith('framework/') || relPosix.startsWith('modules/infra/')) return 2;
    return 3;
};

const walkTs = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!EXCLUDE_DIRS.has(entry.name)) walkTs(path.join(dir, entry.name), out);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
};

const SOURCE_RE = /(?:\bimport\b|\bexport\b)[\s\S]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

/** 解析一个 import 说明符为 src 内绝对路径；无法落到 src 内文件时返回 undefined */
const resolveSpecifier = (fromFile, spec) => {
    let base;
    if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith('./') || spec.startsWith('../')) base = path.resolve(path.dirname(fromFile), spec);
    else return undefined;
    const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')];
    if (base.endsWith('.js')) candidates.unshift(base.replace(/\.js$/, '.ts'));
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return undefined;
};

const SIDE_EFFECT_RES = [
    /^(?:Creep|Room|RoomPosition|RoomVisual|Flag|PowerCreep|StructureSpawn|ConstructionSite|Resource)\.prototype\.\w+\s*=/,
    /^global\s*\.\s*\w+\s*=/,
    /^global\s*\[/,
    /^_.\s*assign\s*\(\s*global/,
    /^Object\s*\.\s*assign\s*\(\s*global/,
];

// [4] import 期副作用：顶层（零缩进）原型补丁/全局挂载/注册表写入。
// 白名单 = 显式安装点（结构缓存/移动包装/Room 原型扩展/控制台挂载/引擎互交），其余位置一律违规。
const SIDE_EFFECT_ALLOWLIST = (relPosix) =>
    relPosix.startsWith('modules/infra/BetterMove/') ||
    relPosix.startsWith('modules/infra/structureCache') ||
    relPosix === 'prototype/Room/index.ts' ||
    relPosix === 'console/index.ts' ||
    relPosix === 'framework/createApp.ts';

// [5] Memory 直访规则：自建根键只允许 memory 管理域（memory/ 目录）读写；
// 引擎通道（rooms/creeps/flags/spawns/powerCreeps）由引擎语义支配，直访放行。
const MEMORY_SCAN_ALLOWLIST = (relPosix) =>
    relPosix.startsWith('modules/shared/memory/');
const MEMORY_ROOT_KEY_RE = /(?:^|[^a-zA-Z_])Memory\s*(?:\.\s*(?:stats|dd|lastinit|whitelist|warmode|funnelCooldown)\b|\[\s*['"](?:stats|dd|lastinit|whitelist|warmode|GenPixel|mode|funnelCooldown)['"]\s*\])/;

// [6] Global 直访规则：运行时代码使用 global.* 视为违规（应从属主模块 import）；
// 放行：控制台人机层、infra 安装点自身、createApp 引擎互交（global.Memory/RawMemory）、DDModule 控制台挂载。
const GLOBAL_ACCESS_RE = /\bglobal\s*\.\s*[a-zA-Z_]\w*|\bglobal\s*\[/;
const GLOBAL_ACCESS_ALLOWLIST = (relPosix) =>
    relPosix.startsWith('console/') ||
    relPosix.startsWith('modules/infra/') ||
    relPosix === 'framework/createApp.ts' ||
    relPosix === 'modules/DDModule.ts' ||
    relPosix.startsWith('branch/race/racebot/') ||
    relPosix.startsWith('types/') ||
    relPosix.endsWith('.d.ts');

const files = walkTs(SRC);
const rel = (file) => path.relative(SRC, file).split(path.sep).join('/');

const graph = new Map();
const runtimeGraph = new Map();
const layerViolations = [];
const sideEffects = [];
const prototypeViolations = [];
const globalViolations = [];
const installPoints = [];
const memoryViolations = [];
const roleHits = [];

const roleRes = ROLE_SEEDS.map((role) => ({ role, re: new RegExp(`['"]${role.replace(/[-]/g, '\\-')}['"]`) }));
const ROLE_SCAN_EXEMPT = (relPosix) =>
    relPosix.startsWith('constant/') || relPosix.includes('modules/rush/') || relPosix.startsWith('branch/race/racebot/');
// 非 RoleData 词表的既有标识（squad 配对标签 / 任务代号），不属孵化角色词表
const ROLE_SCAN_EXEMPT_ROLES = new Set(['defend2-attack', 'claim']);
const TEAM_FROZEN = (relPosix) => relPosix.includes('features/Team/');

for (const file of files) {
    const relPosix = rel(file);
    const text = fs.readFileSync(file, 'utf8');
    const layer = layerOf(relPosix);

    // import 图（分层检查用全量边；运行时图剔除 type-only 边——类型边编译期擦除，不构成运行时环）
    const targets = new Set();
    const runtimeTargets = new Set();
    for (const match of text.matchAll(SOURCE_RE)) {
        const spec = match[1] || match[2] || match[3] || match[4];
        if (!spec) continue;
        const resolved = resolveSpecifier(file, spec);
        if (resolved && resolved.endsWith('.ts')) {
            targets.add(resolved);
            if (!/^import\s+type/.test(match[0].trimStart()) && !/^export\s+type/.test(match[0].trimStart())) {
                runtimeTargets.add(resolved);
            }
        }
    }
    graph.set(file, targets);
    runtimeGraph.set(file, runtimeTargets);

    // 分层方向：导入层不得高于自身层
    if (layer >= 0) {
        for (const target of targets) {
            const targetLayer = layerOf(rel(target));
            if (targetLayer > layer) {
                layerViolations.push({ from: relPosix, to: rel(target), fromLayer: layer, toLayer: targetLayer });
            }
        }
    }

    // import 期副作用：顶层（零缩进）原型补丁/全局挂载/注册表写入；白名单外即违规
    for (const line of text.split('\n')) {
        if (/^\s/.test(line) || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
        if (SIDE_EFFECT_RES.some((re) => re.test(line))) {
            if (SIDE_EFFECT_ALLOWLIST(relPosix)) installPoints.push({ file: relPosix, line: line.trim().slice(0, 100) });
            else sideEffects.push({ file: relPosix, line: line.trim().slice(0, 100) });
        }
    }

    // [5] Memory 直访：自建根键与 rooms 通道只允许 memory 管理域触达
    // [6] Global 直访：运行时代码应从属主模块 import（控制台/infra 安装点/引擎互交放行）
    if (!GLOBAL_ACCESS_ALLOWLIST(relPosix)) {
        const globalLines = text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
        for (const line of globalLines) {
            const m = line.match(GLOBAL_ACCESS_RE);
            if (m) globalViolations.push({ file: relPosix, line: line.trim().slice(0, 100), name: m[0].replace(/\s+/g, '') });
        }
    }

    if (!MEMORY_SCAN_ALLOWLIST(relPosix) && !TEAM_FROZEN(relPosix)) {
        const codeText = text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        if (MEMORY_ROOT_KEY_RE.test(codeText)) memoryViolations.push({ file: relPosix, kind: 'root-key' });
    }

    // 角色字面量：常量定义域与待删 rush 域豁免；EXECUTORS['x']/ROLES['x'] 属常量锚定访问，不计；注释行不计
    if (!ROLE_SCAN_EXEMPT(relPosix) && !TEAM_FROZEN(relPosix)) {
        const scannedText = text
            .replace(/\b(?:EXECUTORS|ROLES)\s*\[\s*['"][^'"]+['"]\s*\]/g, "''")
            .split('\n')
            .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
            .join('\n');
        for (const { role, re } of roleRes) {
            if (ROLE_SCAN_EXEMPT_ROLES.has(role)) continue;
            if (re.test(scannedText)) roleHits.push({ file: relPosix, role });
        }
    }
}

// Tarjan SCC 找模块环
const index = new Map();
const low = new Map();
const onStack = new Set();
const stack = [];
const cycles = [];
let counter = 0;

const strongconnect = (file) => {
    index.set(file, counter);
    low.set(file, counter);
    counter += 1;
    stack.push(file);
    onStack.add(file);
    for (const target of runtimeGraph.get(file) ?? []) {
        if (!runtimeGraph.has(target)) continue;
        if (!index.has(target)) {
            strongconnect(target);
            low.set(file, Math.min(low.get(file), low.get(target)));
        } else if (onStack.has(target)) {
            low.set(file, Math.min(low.get(file), index.get(target)));
        }
    }
    if (low.get(file) === index.get(file)) {
        const component = [];
        let popped;
        do {
            popped = stack.pop();
            onStack.delete(popped);
            component.push(popped);
        } while (popped !== file);
        if (component.length > 1) {
            cycles.push(component.map(rel).sort());
        }
    }
};
for (const file of runtimeGraph.keys()) if (!index.has(file)) strongconnect(file);

const report = {
    generatedAt: new Date().toISOString(),
    scannedFiles: files.length,
    layerViolations: layerViolations.sort((a, b) => a.from.localeCompare(b.from)),
    cycles: cycles.sort((a, b) => a[0].localeCompare(b[0])),
    roleHits: roleHits.sort((a, b) => a.file.localeCompare(b.file) || a.role.localeCompare(b.role)),
    sideEffects: sideEffects.sort((a, b) => a.file.localeCompare(b.file)),
    prototypeViolations: prototypeViolations.sort((a, b) => a.file.localeCompare(b.file)),
    globalViolations: globalViolations.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name)),
    installPoints: installPoints.sort((a, b) => a.file.localeCompare(b.file)),
    memoryViolations: memoryViolations.sort((a, b) => a.file.localeCompare(b.file)),
    summary: {
        layerViolations: layerViolations.length,
        cycles: cycles.length,
        roleHits: roleHits.length,
        sideEffects: sideEffects.length,
        prototypeViolations: prototypeViolations.length,
        installPoints: installPoints.length,
        globalViolations: globalViolations.length,
        memoryViolations: memoryViolations.length,
    },
};

const pretty = () => {
    console.log(`架构守卫报告（扫描 ${report.scannedFiles} 个 ts 文件）`);
    console.log(`\n[1] 分层方向违规 ${report.summary.layerViolations} 处（下层引用上层）`);
    for (const v of report.layerViolations) console.log(`  L${v.fromLayer}->L${v.toLayer}  ${v.from}  =>  ${v.to}`);
    console.log(`\n[2] 模块循环依赖 ${report.summary.cycles} 组`);
    for (const cycle of report.cycles) console.log(`  ${cycle.join('  <->  ')}`);
    console.log(`\n[3] 角色字面量命中 ${report.summary.roleHits} 处（豁免：constant/、modules/rush/、racebot）`);
    const byFile = new Map();
    for (const hit of report.roleHits) {
        byFile.set(hit.file, (byFile.get(hit.file) ?? 0) + 1);
    }
    for (const [file, count] of [...byFile].sort()) console.log(`  ${count}  ${file}`);
    console.log(`\n[4] import 期副作用（白名单外违规 ${report.summary.prototypeViolations} 处 / 安装点 ${report.summary.installPoints} 处）`);
    for (const s of report.prototypeViolations) console.log(`  [违规] ${s.file}  ::  ${s.line}`);
    for (const s of report.sideEffects) console.log(`  ${s.file}  ::  ${s.line}`);
    console.log(`\\n[5] Memory 直访违规 ` + report.summary.memoryViolations + ` 处（自建根键只允许 memory 管理域触达）`);
    for (const v of report.memoryViolations) console.log(`  ` + v.kind + `  ` + v.file);
    console.log(`\\n[6] Global 直访违规 ` + report.summary.globalViolations + ` 处（运行时 global.* 应改为属主模块 import）`);
    const byGlobal = new Map();
    for (const v of report.globalViolations) byGlobal.set(v.file + ' ' + v.name, (byGlobal.get(v.file + ' ' + v.name) ?? 0) + 1);
    for (const [key, count] of [...byGlobal].sort()) console.log(`  ` + count + `  ` + key);
    for (const v of report.memoryViolations) console.log(`  ${v.kind}  ${v.file}`);
};

const jsonIndex = process.argv.indexOf('--json');
if (jsonIndex !== -1) {
    const outPath = process.argv[jsonIndex + 1];
    if (outPath) fs.writeFileSync(path.resolve(outPath), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report.summary, scannedFiles: report.scannedFiles }));
} else {
    pretty();
}

if (process.argv.includes('--strict')) {
    const total = report.summary.layerViolations + report.summary.cycles + report.summary.roleHits + report.summary.sideEffects + report.summary.memoryViolations + report.summary.prototypeViolations + report.summary.globalViolations;
    if (total > 0) {
        console.error(`strict 模式：${total} 项违规`);
        process.exit(1);
    }
}
