import { compress } from '@/modules/utils/compress';

/**
 * Lab 预留/解析工具
 * @description
 * - 统一处理 Lab A/B 底物选择：使用坐标化存储（compress(x,y)）；在 Lab 数量为 10 且未配置时自动推导并写回
 * - 统一处理 Boost Lab 预留：用单一的 boostLabs 表描述临时征用(task)与长期固定(fixed)
 *
 * 注意：
 * - `get*` 函数只读（不写 Memory），用于多数业务读取场景
 * - `ensure*` 函数可能写 Memory（清理/推导/初始化），应作为“单点副作用入口”调用
 */

/**
 * 压缩坐标：compress(x,y) 的 number 表示
 */
export type LabPos = number;

/**
 * A/B 底物 Lab 的解析结果
 * @description
 * - labA/labB: 当前 tick 中可用的对象引用（依赖房间视野）
 * - labAId/labBId: 对应的 Lab id（用于过滤/比较）
 * - labAPos/labBPos: 对应的压缩坐标（用于 Memory 存储）
 */
export type LabABResult = {
    labA: StructureLab | null;
    labB: StructureLab | null;
    labAId: Id<StructureLab> | null;
    labBId: Id<StructureLab> | null;
    labAPos: LabPos | null;
    labBPos: LabPos | null;
};

const emptyLabABResult: LabABResult = {
    labA: null,
    labB: null,
    labAId: null,
    labBId: null,
    labAPos: null,
    labBPos: null
};

/**
 * 从 Memory 值解析目标 Lab
 * @description
 * - 支持 number：按 compress(x,y) 在 `room.lab` 中匹配
 * - 支持 string：按 Structure id 获取对象后再转为坐标，并尽量回落到 `room.lab` 中的引用
 */
export function resolveLabFromMem(room: Room, value: unknown): { lab: StructureLab | null; pos: LabPos | null } {
    if (!room.lab || room.lab.length === 0) return { lab: null, pos: null };
    if (typeof value === 'number' && Number.isFinite(value)) {
        const target = room.lab.find(l => l && compress(l.pos.x, l.pos.y) === value) || null;
        return { lab: target, pos: target ? value : null };
    }
    if (typeof value === 'string' && value) {
        const lab = Game.getObjectById(value as Id<StructureLab>) as StructureLab | null;
        if (lab && lab.pos && lab.structureType === STRUCTURE_LAB) {
            const pos = compress(lab.pos.x, lab.pos.y);
            const target = room.lab.find(l => l && compress(l.pos.x, l.pos.y) === pos) || lab;
            return { lab: target, pos };
        }
    }
    return { lab: null, pos: null };
}

/**
 * 在 10 Lab 布局中推导底物 A/B
 * @description
 * 选择满足“其余 8 个 lab 到 A 与 B 的距离都 <= 2”的一对 (A,B)。
 * 排序优先级：
 * 1. (如果有 centerPos) A/B 到中心的距离之和最小
 * 2. 内部距离和（其他 Lab 到 A/B 距离之和）最小
 * 3. 坐标排序（确定性兜底）
 */
function pickLabAB(labs: StructureLab[], centerPos?: RoomPosition): { a: StructureLab; b: StructureLab } | null {
    if (!labs || labs.length !== 10) return null;

    const candidates: {
        a: StructureLab;
        b: StructureLab;
        internalScore: number;
        centerScore: number;
        ax: number; ay: number; bx: number; by: number;
    }[] = [];

    const ordered = labs.slice().sort((l1, l2) => (l1.pos.x - l2.pos.x) || (l1.pos.y - l2.pos.y));
    
    for (let i = 0; i < ordered.length; i++) {
        for (let j = i + 1; j < ordered.length; j++) {
            const a = ordered[i];
            const b = ordered[j];
            let ok = true;
            let internalScore = 0;

            for (const c of ordered) {
                if (c.id === a.id || c.id === b.id) continue;
                const ra = c.pos.getRangeTo(a);
                const rb = c.pos.getRangeTo(b);
                if (ra > 2 || rb > 2) {
                    ok = false;
                    break;
                }
                internalScore += ra + rb;
            }

            if (ok) {
                let centerScore = 0;
                if (centerPos) {
                    centerScore = a.pos.getRangeTo(centerPos) + b.pos.getRangeTo(centerPos);
                }
                candidates.push({
                    a, b,
                    internalScore,
                    centerScore,
                    ax: a.pos.x, ay: a.pos.y,
                    bx: b.pos.x, by: b.pos.y
                });
            }
        }
    }

    if (candidates.length === 0) return null;

    candidates.sort((c1, c2) => {
        // 1. Center Score (Ascending) - 优先选离中心近的
        if (c1.centerScore !== c2.centerScore) {
            return c1.centerScore - c2.centerScore;
        }
        // 2. Internal Score (Ascending) - 次选内部紧凑的
        if (c1.internalScore !== c2.internalScore) {
            return c1.internalScore - c2.internalScore;
        }
        // 3. Coordinate determinism
        return (c1.ax - c2.ax) || (c1.ay - c2.ay) || (c1.bx - c2.bx) || (c1.by - c2.by);
    });

    return { a: candidates[0].a, b: candidates[0].b };
}

/**
 * Lab A/B 的按 tick 缓存
 * @description
 * - 同一 tick 内同一房间避免重复扫描/解析
 * - 区分 get/ensure：防止先 get 造成缓存命中而跳过 ensure 的写回
 */
const getLabABCache = (() => {
    let cachedTick = -1;
    let cachedByRoom: Record<string, { mode: 'get' | 'ensure'; value: LabABResult }> = {};
    return {
        get(roomName: string, mode: 'get' | 'ensure'): LabABResult | undefined {
            if (cachedTick !== Game.time) {
                cachedTick = Game.time;
                cachedByRoom = {};
            }
            const hit = cachedByRoom[roomName];
            if (!hit) return undefined;
            if (mode === 'get') return hit.value;
            if (hit.mode === 'ensure') return hit.value;
            return undefined;
        },
        set(roomName: string, mode: 'get' | 'ensure', value: LabABResult): void {
            if (cachedTick !== Game.time) {
                cachedTick = Game.time;
                cachedByRoom = {};
            }
            cachedByRoom[roomName] = { mode, value };
        }
    };
})();

/**
 * 计算 Lab A/B（内部实现）
 * @param mode ensure: 允许写 Memory（迁移/清理/推导）；get: 只读
 */
function computeLabAB(roomName: string, room: Room, mode: 'ensure' | 'get'): LabABResult {
    if (!room.lab || room.lab.length === 0) return emptyLabABResult;

    const root = (Memory as any)['StructControlData'];
    const botmem = mode === 'ensure'
        ? (root || ((Memory as any)['StructControlData'] = {}))[roomName] || (((Memory as any)['StructControlData'])[roomName] = {})
        : root?.[roomName];

    if (!botmem) return emptyLabABResult;

    const ra = resolveLabFromMem(room, botmem.labA);
    const rb = resolveLabFromMem(room, botmem.labB);

    if (mode === 'ensure') {
        // 修正：将无效坐标清理；将已解析出的坐标回写到 Memory（便于后续快速定位）
        if (ra.lab && ra.pos != null && botmem.labA !== ra.pos) botmem.labA = ra.pos;
        if (rb.lab && rb.pos != null && botmem.labB !== rb.pos) botmem.labB = rb.pos;
        if (!ra.lab) delete botmem.labA;
        if (!rb.lab) delete botmem.labB;
    }

    let labA = ra.lab;
    let labB = rb.lab;
    let labAPos = ra.pos;
    let labBPos = rb.pos;

    if (mode === 'ensure' && (!labA || !labB) && room.lab.length === 10) {
        // 仅在满 10 Lab 且未正确配置时自动推导，并写回 Memory
        
        // 尝试获取布局中心，以便 pickLabAB 优先选择靠近中心的 Lab
        let centerPos: RoomPosition | undefined;
        const rcd = (Memory as any)['RoomControlData']?.[roomName];
        if (rcd?.center) {
            centerPos = new RoomPosition(rcd.center.x, rcd.center.y, roomName);
        }
        if (!centerPos && room.storage) centerPos = room.storage.pos;
        if (!centerPos && room.terminal) centerPos = room.terminal.pos;

        const pair = pickLabAB(room.lab, centerPos);
        if (pair) {
            labA = pair.a;
            labB = pair.b;
            labAPos = compress(labA.pos.x, labA.pos.y);
            labBPos = compress(labB.pos.x, labB.pos.y);
            botmem.labA = labAPos;
            botmem.labB = labBPos;
        }
    }

    return {
        labA,
        labB,
        labAId: labA ? labA.id : null,
        labBId: labB ? labB.id : null,
        labAPos: labAPos ?? null,
        labBPos: labBPos ?? null
    };
}

/**
 * 读取 Lab A/B（只读）
 * @description 不会写 Memory，也不会触发自动推导；适合大多数逻辑判断/过滤场景。
 */
export function getLabAB(roomName: string, room?: Room): LabABResult {
    const cached = getLabABCache.get(roomName, 'get');
    if (cached) return cached;
    const r = room || Game.rooms[roomName];
    if (!r) return emptyLabABResult;
    const value = computeLabAB(roomName, r, 'get');
    getLabABCache.set(roomName, 'get', value);
    return value;
}

/**
 * 确保 Lab A/B（可能写 Memory）
 * @description
 * - 可能执行旧数据迁移（id -> 坐标）
 * - 可能清理无效配置
 * - 当 lab==10 且缺失时可能自动推导并写回
 */
export function ensureLabAB(roomName: string, room?: Room): LabABResult {
    const cached = getLabABCache.get(roomName, 'ensure');
    if (cached) return cached;
    const r = room || Game.rooms[roomName];
    if (!r) return emptyLabABResult;

    const value = computeLabAB(roomName, r, 'ensure');
    getLabABCache.set(roomName, 'ensure', value);
    return value;
}

/**
 * Boost Lab 预留模式
 * @description
 * - task: 由 boost 任务动态征用（可被清理）
 * - fixed: 手动长期固定（持续填充/补能量，不会被清空）
 */
export type BoostLabMode = 'task' | 'fixed';

/**
 * Boost Lab 预留表（单表）
 * @description key 为 labId，value 为该 lab 的用途预留信息
 */
export type BoostLabsMemory = Record<string, { mineral: ResourceConstant; mode: BoostLabMode }>;

/**
 * 读取 boostLabs（只读）
 */
export function getBoostLabs(roomName: string): BoostLabsMemory | undefined {
    return (Memory as any)?.StructControlData?.[roomName]?.boostLabs as BoostLabsMemory | undefined;
}

/**
 * 确保 boostLabs 存在（可能写 Memory）
 */
export function ensureBoostLabs(roomName: string): BoostLabsMemory {
    const root = (Memory as any).StructControlData || (((Memory as any).StructControlData) = {});
    const mem = root[roomName] || (root[roomName] = {});

    if (!mem.boostLabs) mem.boostLabs = {};
    const boostLabs = mem.boostLabs as BoostLabsMemory;

    return boostLabs;
}

/**
 * 判断某个 lab 是否被 boostLabs 预留
 */
export function isBoostLab(roomName: string, labId: string): boolean {
    const boostLabs = getBoostLabs(roomName);
    return !!boostLabs?.[labId];
}
