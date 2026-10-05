import { ROLES } from '@/constant/CreepConstant';
import { getRoomMode } from "@/modules/shared/roomMode";
import { getOutMineData } from "@/modules/shared/memory";
import { isRacePanelEnabled } from "@/modules/shared/gameCapabilities";
import { RoleData } from "@/constant/CreepConstant";
import {
    RUSH_SEGMENT_LEVELS,
    applySegmentVerdicts,
    buildFailSnapshot,
    evaluateRaceSegments,
    SegmentStatus,
} from "@/modules/shared/rushProgress";
import { THRESHOLDS } from "@/constant/Thresholds";

/** 各等级 → 下一级所需进度点兜底表（实测条优先，缺采样时使用） */
const RCL_BAR_FALLBACK: Record<number, number> = {
    1: 200, 2: 45000, 3: 135000, 4: 405000, 5: 1215000, 6: 3645000, 7: 10935000,
};

type RaceSample = { t: number; p: number };
type RaceMemory = {
    /** 基线 tick（lv1 达成时刻），显示均取相对值 */
    baseline?: number;
    /** 各等级达成 tick（绝对值） */
    levels: Record<number, number>;
    /** 各等级达成时的段速（点/tick） */
    levelRates: Record<number, number>;
    /** 各等级进度条实测值（progressMax 采样） */
    bars: Record<number, number>;
    /** 速率采样环 {tick, 累计进度点} */
    samples: RaceSample[];
    /** 接力成交累计计数 */
    relayAccum: number;
    /** 接力速率采样环 {tick, 累计接力数} */
    relaySamples: RaceSample[];
    /** 各分段评估状态（逐 tick 刷新） */
    segments?: SegmentStatus[];
    /** 该轮 attempt 已判废 */
    failed?: boolean;
    /** 首个判废段的目标等级 */
    failedSegment?: number;
    /** 判废归因快照 */
    failSnapshot?: Record<string, unknown>;
};

const SAMPLE_STEP = 10;
const SAMPLE_KEEP = 51;

const C = {
    header: '#FFE66D',
    good: '#7CFC00',
    info: '#4CC9F0',
    warn: '#FFC300',
    bad: '#FF5555',
    muted: '#7A7A85',
    section: '#5A5E66',
    text: '#E8E8E8',
} as const;

const getRaceMem = (room: Room): RaceMemory => {
    const mem = ((room.memory as any).race ??= {
        levels: {}, levelRates: {}, bars: {}, samples: [], relayAccum: 0, relaySamples: [],
    }) as RaceMemory;
    mem.levels ??= {};
    mem.levelRates ??= {};
    mem.bars ??= {};
    mem.samples ??= [];
    mem.relayAccum ??= 0;
    mem.relaySamples ??= [];
    return mem;
};

const fmtTick = (n: number): string => {
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 1e5 || n % 1000 === 0 ? 0 : 1)}k`;
    return `${Math.round(n)}`;
};
const bar = (ratio: number, width = 10): string => {
    const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
    return '█'.repeat(filled) + '░'.repeat(width - filled);
};
const rateColor = (rate: number): string => (rate >= 10 ? C.good : rate >= 5 ? C.info : rate >= 1 ? C.warn : C.bad);

export default class RaceVisual extends Room {
    /** 冲级面板：左下角逐 tick 渲染（仅 rush）。管线各环节数据 + 分段达成速率，用于段速排查 */
    raceVisual() {
        if (!isRacePanelEnabled()) return;
        if (getRoomMode(this) !== 'rush') return;
        const controller = this.controller;
        if (!controller?.my) return;

        const mem = getRaceMem(this);
        const level = controller.level;
        const now = Game.time;

        // ── 达成记录：本级首观测即达成时刻。中途接入（部署晚于落地）时历史等级
        // 无法回溯，不补盖假戳——缺的就地隐藏；段速只对「上一级达成时刻已知」的段结算
        // 清号检测：等级低于历史最高＝账号被清重开，旧里程碑整体作废重记
        const maxSeen = Object.keys(mem.levels).map(Number).reduce((m, v) => Math.max(m, v), 0);
        if (level < maxSeen) {
            mem.levels = {};
            mem.levelRates = {};
            mem.bars = {};
            mem.samples = [];
            mem.segments = undefined;
            mem.failed = false;
            mem.failedSegment = undefined;
            mem.failSnapshot = undefined;
            mem.baseline = now;
        }
        if (!mem.levels[level]) {
            mem.levels[level] = now;
            const prev = level - 1;
            if (prev >= 1 && mem.levels[prev]) {
                const span = mem.levels[level] - mem.levels[prev];
                const barPrev = mem.bars[prev] || RCL_BAR_FALLBACK[prev] || 0;
                mem.levelRates[level] = span > 0 ? barPrev / span : 0;
            }
            mem.baseline ??= now;
        }
        mem.baseline ??= now;
        // xxscreeps 未实现 progressMax：运行时缺失时走静态条表兜底
        const progressMax = (controller as any).progressMax as number | undefined;
        if (progressMax) mem.bars[level] = progressMax;

        const progress = controller.progress || 0;
        const barPts = mem.bars[level] || RCL_BAR_FALLBACK[level] || progressMax || 1;

        // ── 升级速率采样 ──
        let cumulative = 0;
        for (let l = 1; l < level; l++) cumulative += mem.bars[l] || RCL_BAR_FALLBACK[l] || 0;
        cumulative += progress;

        const samples = mem.samples;
        if (samples.length === 0 || now - samples[samples.length - 1].t >= SAMPLE_STEP) {
            samples.push({ t: now, p: cumulative });
            while (samples.length > SAMPLE_KEEP) samples.shift();
        }
        let winRate = 0;
        if (samples.length >= 2) {
            const s0 = samples[0];
            const s1 = samples[samples.length - 1];
            winRate = (s1.p - s0.p) / Math.max(1, s1.t - s0.t);
        }
        const totalRate = cumulative / Math.max(1, now - mem.baseline);
        const rate = winRate > 0 ? winRate : totalRate;

        const remaining = Math.max(0, barPts - progress);
        const etaTicks = rate > 0 ? Math.ceil(remaining / rate) : Infinity;

        // ── 分段评估：状态逐 tick 刷新；判废快照只在首次判废时落账 ──
        const pointsToReach: Record<number, number> = {};
        for (const segLevel of RUSH_SEGMENT_LEVELS) {
            if (segLevel <= level) continue;
            let pts = Math.max(0, barPts - progress);
            for (let l = level + 1; l < segLevel; l++) pts += mem.bars[l] || RCL_BAR_FALLBACK[l] || 0;
            pointsToReach[segLevel] = pts;
        }
        mem.segments = evaluateRaceSegments({
            baseline: mem.baseline,
            now,
            level,
            progress,
            rate,
            levels: mem.levels,
            pointsToReach,
        });
        applySegmentVerdicts(mem, mem.segments, seg => buildFailSnapshot(this, seg));

        // ── 管线/车队数据（只读轻量采集） ──
        let ocTotal = 0;
        let relayThisTick = 0;
        let uWork = 0;
        let ohTotal = 0;
        let ohOnSite = 0;
        const memAny = this.memory as any;
        for (const creep of Object.values(Game.creeps)) {
            const role = creep.memory?.role;
            if (role === ROLES['out-carry']) {
                ocTotal++;
                if ((creep.memory as any).relayedTick === now) relayThisTick++;
            } else if (role === ROLES['out-harvest']) {
                ohTotal++;
                if (creep.pos.roomName === (creep.memory as any).targetRoom) ohOnSite++;
            } else if (role === ROLES.upgrader) {
                uWork += creep.getActiveBodyparts(WORK);
            }
        }
        mem.relayAccum += relayThisTick;

        const relaySamples = mem.relaySamples;
        if (relaySamples.length === 0 || now - relaySamples[relaySamples.length - 1].t >= SAMPLE_STEP) {
            relaySamples.push({ t: now, p: mem.relayAccum });
            while (relaySamples.length > SAMPLE_KEEP) relaySamples.shift();
        }
        let relayRate = 0;
        if (relaySamples.length >= 2) {
            const r0 = relaySamples[0];
            const r1 = relaySamples[relaySamples.length - 1];
            relayRate = (r1.p - r0.p) / Math.max(1, r1.t - r0.t);
        }

        // 控制器容器 + 丢落堆
        const cc = (this.container || []).find(c => controller.pos.inRangeTo(c.pos, 3));
        const ccEnergy = cc ? cc.store[RESOURCE_ENERGY] || 0 : -1;
        const ccHitRatio = cc ? cc.hits / cc.hitsMax : -1;
        const dropPile = controller.pos.findInRange(FIND_DROPPED_RESOURCES, 2)
            .reduce((sum, d) => sum + d.amount, 0);

        // 远矿积压（有视野的托管房容器存量）
        let backlog = 0;
        const targets = getOutMineData()[this.name]?.energy || [];
        for (const roomName of targets) {
            const targetRoom = Game.rooms[roomName];
            if (!targetRoom) continue;
            const containers = targetRoom.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER,
            });
            for (const container of containers) backlog += container.store[RESOURCE_ENERGY] || 0;
        }

        // 孵化队列角色摘要（角色代号大写：OH/OC/RSV…，按数量取前 4）
        const pool = (this.getAllMissionFromPool?.('spawn') || []) as Array<{ data?: { memory?: { role?: string } } }>;
        const poolCount: Record<string, number> = {};
        for (const task of pool) {
            const role = task.data?.memory?.role || '?';
            const code = (RoleData as any)[role]?.code || role.toUpperCase();
            poolCount[code] = (poolCount[code] || 0) + 1;
        }
        const poolText = Object.entries(poolCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([code, count]) => `${code}×${count}`)
            .join(' ') || '空';

        // ── 渲染：显式行结构，里程碑双列 ──
        type Line = { text: string; color: string; x: number };
        const rows: Line[][] = [];
        const push = (text: string, color: string) => rows.push([{ text, color, x: 0.5 }]);

        const maxed = level >= 8;
        push(maxed ? `冲级 RCL8 满级` : `冲级 RCL${level} → RCL${level + 1}`, C.header);
        if (maxed) {
            push(`${bar(1)} 满级`, C.good);
        } else {
            push(`${bar(progress / barPts)} ${(progress / barPts * 100).toFixed(0)}% ${fmtTick(progress)}/${fmtTick(barPts)}`, C.info);
            push(`速率 ${winRate.toFixed(1)}/t (全程均 ${totalRate.toFixed(1)})`, rateColor(winRate));
            push(`预计 RCL${level + 1} 还需 ${isFinite(etaTicks) ? fmtTick(etaTicks) + 't' : '?'}`, C.warn);
        }
        push(`── 分段目标 ─────────`, C.section);
        for (const seg of mem.segments ?? []) {
            // 双线段显示「≤达成线/合格线」（顺序即含义），单线段只显示达成线
            const limit = seg.pass !== seg.target
                ? `≤${fmtTick(seg.target)}/${fmtTick(seg.pass)}`
                : `≤${fmtTick(seg.target)}`;
            if (seg.achievedAt !== undefined) {
                const grade = seg.failed ? '判废' : (seg.behind ? '合格' : '达成');
                push(`RCL${seg.level} ${limit} ${grade} ${fmtTick(seg.achievedAt)}`, seg.failed ? C.bad : seg.behind ? C.warn : C.good);
            } else if (seg.failed) {
                push(`RCL${seg.level} ${limit} 已超时${fmtTick(seg.elapsed || 0)} 判废`, C.bad);
            } else {
                const etaText = seg.eta !== undefined ? fmtTick(seg.eta) : '?';
                push(`RCL${seg.level} ${limit} 已${fmtTick(seg.elapsed || 0)} ETA ${etaText}${seg.behind ? ' 落后' : ''}`, seg.behind ? C.warn : C.info);
            }
        }
        if (mem.failed) push(`attempt 判废 RCL${mem.failedSegment} 超段`, C.bad);
        push(`── 能量管线 ─────────`, C.section);
        push(`孵化能量 ${bar(this.energyAvailable / Math.max(1, this.energyCapacityAvailable), 6)} ${this.energyAvailable}/${this.energyCapacityAvailable}`, C.text);
        push(
            cc
                ? `控制容器 ${fmtTick(ccEnergy)}  耐久 ${(ccHitRatio * 100).toFixed(0)}%`
                : `控制容器 缺位 → 丢落堆 ${fmtTick(dropPile)}`,
            cc ? (ccEnergy > 500 ? C.good : C.warn) : C.bad,
        );
        push(`升级火力 ${uWork}W  搬运工 ${ocTotal}`, C.text);
        push(`接力成交 ${relayRate.toFixed(2)}/t${relayRate < 0.2 ? ' ⚠' : ''}`, relayRate < 0.2 ? C.bad : C.good);
        push(`外矿采集 ${ohTotal} 只(在场${ohOnSite})`, ohOnSite < targets.length ? C.warn : C.good);
        push(`远矿积压 ${fmtTick(backlog)}${backlog > 5000 ? ' ⚠运力不足' : ''}`, backlog > 5000 ? C.warn : C.text);
        push(`── 孵化/达成 ────────`, C.section);
        // 孵化状态直读 spawn 结构体：room.spawning 是孵化流程填充的临时属性，
        // 面板渲染先于 SpawnWork 执行，读它会恒为空（显示「空闲」的假象）
        const spawnStructures = this.find(FIND_MY_SPAWNS) as StructureSpawn[];
        const spawningInfo = spawnStructures.map(s => s.spawning).find(Boolean) || null;
        push(spawningInfo
            ? `孵化中 ${spawningInfo.name} 剩${spawningInfo.remainingTime}t`
            : `孵化空闲 | 队列: ${poolText}`,
        spawningInfo ? C.info : C.warn);

        // 里程碑双列：只记达成 tick（段速看顶部速率行，避免行宽溢出重叠）
        const milestones: Line[] = [];
        for (let l = level; l >= 1; l--) {
            if (!mem.levels[l]) continue;
            const at = Math.max(0, mem.levels[l] - mem.baseline);
            // 段耗时(累计总耗时)：该级升级所花时间(达到该级总用时)
            // 上一级缺失（跳级/记录丢失）时段耗时记 0，避免 undefined 相减出 NaN
            const prev = mem.levels[l - 1];
            const seg = l > 1 && prev ? mem.levels[l] - prev : 0;
            milestones.push({
                text: `RCL${l} ${fmtTick(Math.max(0, seg))}(${fmtTick(at)})`,
                color: l === level ? C.good : C.muted,
                x: milestones.length % 2 === 0 ? 0.5 : 7.5,
            });
        }
        for (let i = 0; i < milestones.length; i += 2) {
            const row: Line[] = [milestones[i]];
            if (milestones[i + 1]) row.push(milestones[i + 1]);
            rows.push(row);
        }

        const visual = this.visual;
        const rowH = 0.78;
        const top = 49.7 - rows.length * rowH;
        rows.forEach((row, i) => {
            for (const cell of row) {
                visual.text(cell.text, cell.x, top + i * rowH, { color: cell.color, font: '0.68 Consolas', align: 'left' });
            }
        });

        // carrier 状态标注（诊断：送/取 态 + 载量 + 匹配到的请求类型 / 取货源）
        for (const creep of Object.values(Game.creeps)) {
            if (creep.room.name !== this.name) continue;
            const mem = creep.memory as any;
            if (mem.role !== ROLES.carrier) continue;
            const load = creep.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
            const phase = load > 0 ? '送' : '取';
            const assign = mem._assign ?? (load > 0 ? '满' : '等');
            const src = mem._fetchSrc ?? (load > 0 ? '' : '等');
            visual.text(`${phase}${load} ${load > 0 ? assign : (src || '等')}`, creep.pos.x, creep.pos.y - 0.7, { color: '#7fdfff', font: '0.5 Consolas' });
        }
    }
}
