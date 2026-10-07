import { BASE_CONFIG } from '@/constant/BaseConstant';
import { getBotMemory, getWhitelistIds } from '@/modules/shared/memory';
import { MinHeap } from '@/modules/shared/minHeap';

/** 白名单缓存（按 tick 失效） */
let cachedWhitelistTick = -1
let cachedWhitelistSet: Set<string> = new Set()

export const getWhitelistSet = (): Set<string> => {
    if (cachedWhitelistTick === Game.time) return cachedWhitelistSet
    cachedWhitelistTick = Game.time
    cachedWhitelistSet = new Set<string>(getWhitelistIds())
    return cachedWhitelistSet
}

export const inWhitelist = (username?: string): boolean => {
    if (!username) return false
    return getWhitelistSet().has(username)
}

/** 日志输出
 * 输出日志到控制台, 统一格式
 * @param typeOrText 只有一个参数时表示文本；两个参数且第二个是 string 时第一个表示前缀类型
 * @param textOrArg 两个参数且为 string 时表示文本；否则会作为 console 参数输出
 * @param args 日志参数
 */
export function log(text: string, ...args: any[]): void;
export function log(type: string, text: string, ...args: any[]): void;
export function log(typeOrText: string, textOrArg?: any, ...args: any[]) {
    const write = (message: string, rest: any[]) => {
        if (typeof console['logUnsafe'] === 'function') {
            console['logUnsafe'](message, ...rest);
        } else {
            console.log(message, ...rest);
        }
    };

    if (typeof textOrArg === 'string') {
        const type = typeOrText || `${BASE_CONFIG.BOT_NAME}`;
        const text = textOrArg;
        const str = `<span style="color: #D0CAE0;"><b>[${type}]</b></span> ${text}`;
        write(str, args);
        return;
    }

    const text = typeOrText;
    const rest = textOrArg === undefined ? args : [textOrArg, ...args];
    write(text, rest);
}

/**
 * 检查房间名是否是高速公路（末位为0或N/S前一位为0）
 * 只支持1000以内的房间号
 * @param roomName 房间名
 * @returns 是否是高速公路
 */
export const isHighWay = (roomName: string) => {
    // 1. 检查末位 (Y坐标个位)
    if (roomName.charCodeAt(roomName.length - 1) === 48) return true;

    // 2. 探测 N(78) 或 S(83) 的位置并检查前一位
    // Index 2 (例如 E1N1)
    let code = roomName.charCodeAt(2);
    if (code === 78 || code === 83) return roomName.charCodeAt(1) === 48;
    
    // Index 3 (例如 E10N1)
    code = roomName.charCodeAt(3);
    if (code === 78 || code === 83) return roomName.charCodeAt(2) === 48;
    
    // Index 4 (例如 E100N1)
    code = roomName.charCodeAt(4);
    if (code === 78 || code === 83) return roomName.charCodeAt(3) === 48;
    
    return false;
};

import { FlowerNames } from '@/constant/NameConstant';

/** 生成一个短编码
 * 用于生成唯一的 creep 名称
 * @returns 短编码字符串
 */
export function GenShortNumber(len = 4) {
    return (Game.time*1296 + Math.floor(Math.random()*1296))
            .toString(36)
            .slice(-len)
            .toUpperCase();
}
/** 生成一个 creep 名称
 * @param code creep 类型代码
 * @returns 唯一的 creep 名称
 */
export function GenCreepName(code: string) {
    const number = GenShortNumber();
    const index = Math.floor(Game.time * Math.random() * 1000) % FlowerNames.length;
    let name: string;
    if (FlowerNames && FlowerNames.length) {
        name = `${FlowerNames[index]} ${code}#${number}`;
    } else {
        name = `${code}#${number}`;
    }
    if (Game.creeps[name]) {
        return GenCreepName(code);
    } else {
        return name;
    }
}

/** 生成结构布局签名（用于缓存失效）
 * - 目的：在不排序的前提下，快速得到“结构集合是否发生变化”的稳定签名
 * - 特性：使用 sum/xor/count 的可交换聚合，避免结构遍历顺序变化导致签名抖动
 * - 注意：sig 是 32-bit 近似签名（可能存在极小概率碰撞）；必要时可同时比对 sum/xor/count
 * - Rampart/Wall：可选加入“是否跨阈值”的 bucket（默认 rampart 开启、wall 关闭），避免 hits 每 tick 微变导致频繁失效
 * @param structures 任意可迭代结构集合（支持数组、生成器、Set 等），元素需包含 { pos: {x,y}, structureType }
 * @param options rampartMinHits: >0 时将 rampart “是否跨阈值”纳入签名；<=0 时不纳入。wallMinHits: >0 时将 wall “是否跨阈值”纳入签名；<=0 时不纳入
 */
export function getStructureSignature(
    structures: Iterable<any>,
    options?: { rampartMinHits?: number; wallMinHits?: number }
): { sig: number; sum: number; xor: number; count: number } {
    const rampartMinHits = options?.rampartMinHits ?? 1e6;
    const wallMinHits = options?.wallMinHits ?? 0;

    let sum = 0 >>> 0;
    let xor = 0 >>> 0;
    let count = 0;

    // 将常见 structureType 映射为小整数，便于压缩进 token
    const typeCode = (structureType: any) => {
        switch (structureType) {
            case 'spawn':
                return 1;
            case 'extension':
                return 2;
            case 'tower':
                return 3;
            case 'link':
                return 4;
            case 'lab':
                return 5;
            case 'rampart':
                return 6;
            case 'constructedWall':
                return 7;
            case 'terminal':
                return 8;
            case 'storage':
                return 9;
            case 'nuker':
                return 10;
            case 'factory':
                return 11;
            case 'extractor':
                return 12;
            case 'observer':
                return 13;
            case 'powerSpawn':
                return 14;
            default:
                return 0;
        }
    };

    for (const s of structures) {
        if (!s?.pos) continue;
        const x = s.pos.x;
        const y = s.pos.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        // Screeps 房间坐标 0-49，可压缩成 12-bit：xy = (x<<6)|y
        const xy = ((x << 6) | y) >>> 0;
        const t = typeCode(s.structureType) >>> 0;
        // token: [typeCode(<=14)] + [xy(<=3199)]
        let token = ((t << 12) | xy) >>> 0;
        if (rampartMinHits > 0 && s.structureType === 'rampart') {
            const bucket = (s.my && s.hits >= rampartMinHits) ? 1 : 0;
            token = (token ^ (bucket << 20)) >>> 0;
        } else if (wallMinHits > 0 && s.structureType === 'constructedWall') {
            const bucket = (s.hits >= wallMinHits) ? 1 : 0;
            token = (token ^ (bucket << 20)) >>> 0;
        }
        sum = (sum + token) >>> 0;
        xor = (xor ^ token) >>> 0;
        count++;
    }

    // 用 sum/xor/count 做一次混合，得到最终 32-bit 签名
    const sig = (((sum ^ (Math.imul(xor, 2654435761) >>> 0)) + (Math.imul(count, 1013904223) >>> 0)) >>> 0);
    return { sig, sum, xor, count };
}

// ============================================================
// 数学 / 统计
// ============================================================

/** 区间截断：value 限制在 [min, max] */
export function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/** 数组求和，可选回调取值 */
export function getSum<T>(array: T[], callback?: (element: T) => number): number {
    let result = 0;
    for (const element of array) {
        if (callback) {
            result += callback(element);
        } else {
            result += element as unknown as number;
        }
    }
    return result;
}

/** 平均值，可选回调取值 */
export function getMean<T>(arr: T[], fn: (e: T) => number = (e) => e as unknown as number): number {
    const sum = arr.reduce((prev, curr) => prev + fn(curr), 0);
    return sum / arr.length;
}

/** 标准差，可选回调取值 */
export function getStd<T>(arr: T[], fn?: (e: T) => number): number {
    const values: number[] = fn ? arr.map(fn) : (arr as unknown as number[]);
    const mean = getMean(values);
    const variation = getMean(values, (e) => (e - mean) ** 2);
    return Math.sqrt(variation);
}

/** [start, end] 闭区间随机整数 */
export function getRandomInteger(start: number, end: number): number {
    if (start > end) {
        throw new Error(`start ${start} is bigger than end ${end}`);
    }
    return Math.floor(start + Math.random() * (end - start + 1));
}

/** [start, end) 随机浮点，默认 [0, 1) */
export function random(start = 0, end = 1): number {
    return start + (end - start) * Math.random();
}

/** 向下保留 digit 位小数 */
export function adjustDecimal(number: number, digit: number): number {
    const multiplier = 10 ** digit;
    return Math.floor(number * multiplier) / multiplier;
}

// 位技巧共享缓冲：模块级复用，避免每次调用分配 TypedArray
const F32_BUF = new Float32Array(1);
const I32_BUF = new Int32Array(F32_BUF.buffer);

/** 快速平方根近似（Quake III 逆平方根技巧，两次牛顿迭代）
 * 口径：与精确开方误差 <0.1%；仅需精确值时直接用 Math.sqrt 更快
 */
export function fastSquareRoot(x: number): number {
    const x2 = x * 0.5;

    F32_BUF[0] = x;
    I32_BUF[0] = 0x5f3759df - (I32_BUF[0] >> 1);
    let y = F32_BUF[0];
    y = y * (1.5 - x2 * y * y);
    y = y * (1.5 - x2 * y * y);

    return x * y;
}

/** 取回调值最大的单个元素，可带过滤；空集返回 undefined */
export function getMaxObject<T>(
    array: T[],
    callback: (element: T) => number,
    filter?: (element: T) => boolean,
): T | undefined {
    if (!array.length) return undefined;

    let maximumElement: T | undefined;
    let maximumValue = -Infinity;

    for (let i = 0; i < array.length; i++) {
        const element = array[i];

        if (filter && !filter(element)) continue;

        const value = callback(element);

        if (value > maximumValue) {
            maximumElement = element;
            maximumValue = value;
        }
    }

    return maximumElement;
}

/** 取回调值最大的 count 个元素（堆筛选） */
export function getMaxObjects<T>(
    array: T[],
    callback: (element: T) => number,
    count: number,
    filter?: (element: T) => boolean,
): T[] {
    const heap = new MinHeap(callback);
    let criteria = -Infinity;
    for (const element of array) {
        if (filter && !filter(element)) continue;

        if (heap.getSize() < count || callback(element) > criteria) {
            if (heap.getSize() >= count) {
                heap.remove();
            }
            heap.insert(element);
            criteria = callback(heap.getMin()!);
        }
    }
    return heap.toArray();
}

/** 取回调值最小的单个元素 */
export function getMinObject<T>(
    array: T[],
    callback: (element: T) => number,
    filter?: (element: T) => boolean,
): T | undefined {
    return getMaxObject(array, (element) => -1 * callback(element), filter);
}

/** 取回调值最小的 count 个元素 */
export function getMinObjects<T>(
    array: T[],
    callback: (element: T) => number,
    count: number,
    filter?: (element: T) => boolean,
): T[] {
    return getMaxObjects(array, (element) => -1 * callback(element), count, filter);
}

// ============================================================
// 位置序列化
// ============================================================

/** 序列化为 "x_y_roomName" 字符串 */
export function packPos(pos: { x: number; y: number; roomName: string }): string {
    return `${pos.x}_${pos.y}_${pos.roomName}`;
}

/** 解析 packPos 生成的字符串 */
export function unpackPos(packed: string): RoomPosition {
    const [x, y, roomName] = packed.split('_');
    return new RoomPosition(Number(x), Number(y), roomName);
}

// ============================================================
// 游戏工具
// ============================================================

/** 查找对象身上的指定效果（PWR/EFFECT），无则返回 null */
export function getEffectObject<T extends { effect: number }>(
    roomObject: RoomObject | null | undefined,
    effectId: number,
): T | null {
    if (!roomObject || !(roomObject as unknown as { effects?: T[] }).effects) {
        return null;
    }
    return (roomObject as unknown as { effects: T[] }).effects.find((obj) => obj.effect === effectId) ?? null;
}

/** 查询 boost 资源信息；effect 缺省取该资源第一个效果 */
export function getBoostInfo(
    resourceType: ResourceConstant,
    effect?: string,
): { type: string | undefined; effect: string | undefined; strength: number | undefined } {
    let type: string | undefined;
    let strength: number | undefined;

    const table = BOOSTS as Record<string, Record<string, Record<string, number>>>;
    for (const key of Object.keys(table)) {
        if (!table[key][resourceType]) {
            continue;
        }

        type = key;
        effect = effect || Object.keys(table[key][resourceType])[0];
        strength = getBoostStrength(resourceType, key, effect as string);
        break;
    }

    return { type, effect, strength };
}

/** boost 效果强度；damage 为伤害削减口径（1 - 值） */
export function getBoostStrength(resourceType: ResourceConstant, type: string, effect: string): number {
    const table = BOOSTS as Record<string, Record<string, Record<string, number>>>;
    return effect === 'damage' ? 1 - table[type][resourceType][effect] : table[type][resourceType][effect];
}

/** 是否官方 MMO 服（按 shard 名缓存进 BotMemory） */
export function getIsMMO(): boolean {
    const mem = getBotMemory();
    if (mem.isMMO !== undefined) {
        return mem.isMMO;
    }
    return (mem.isMMO = ['shard0', 'shard1', 'shard2', 'shard3'].includes(Game.shard.name));
}

/** 当前 tick 是否为重开后的首个 tick（0 creep + 单房 + RCL1 进度 0 + safeMode 满） */
export function hasRespawned(): boolean {
    for (const _name in Game.creeps) {
        return false;
    }

    const roomNames = Object.keys(Game.rooms);
    if (roomNames.length !== 1) {
        return false;
    }

    const room = Game.rooms[roomNames[0]];
    if (
        !room.controller ||
        !room.controller.my ||
        room.controller.level !== 1 ||
        room.controller.progress ||
        !room.controller.safeMode ||
        room.controller.safeMode < SAFE_MODE_DURATION
    ) {
        return false;
    }

    if (Game.spawns && Object.keys(Game.spawns).length > 1) {
        return false;
    }

    return true;
}

/** 归一化寻路目标为 {pos, range} 数组；非法项跳过 */
export function normalizeGoals(
    goals:
        | RoomPosition
        | { pos: RoomPosition; range?: number }
        | (RoomPosition | { pos: RoomPosition; range?: number })[]
        | null
        | undefined,
): { pos: RoomPosition; range: number }[] {
    const list = Array.isArray(goals) ? goals : [goals];
    const result: { pos: RoomPosition; range: number }[] = [];

    for (const goal of list) {
        if (!goal) continue;

        const pos = (goal as { pos?: RoomPosition }).pos || (goal as RoomPosition);
        if (!(pos instanceof RoomPosition)) continue;

        const range = (goal as { range?: number }).range !== undefined ? (goal as { range: number }).range : 1;
        if (Number.isNaN(range)) {
            throw new Error(`goal range is NaN: ${JSON.stringify(goal)}`);
        }

        result.push({ pos, range });
    }

    return result;
}

// ============================================================
// 可视化
// ============================================================

const DIRECTION_SYMBOLS: Record<number, string> = {
    [TOP]: '↑',
    [TOP_RIGHT]: '↗',
    [RIGHT]: '→',
    [BOTTOM_RIGHT]: '↘',
    [BOTTOM]: '↓',
    [BOTTOM_LEFT]: '↙',
    [LEFT]: '←',
    [TOP_LEFT]: '↖',
};

/** 逐格矩形标出区域 */
export function visualizeArea(area: RoomPosition[], color: string): void {
    for (const pos of area) {
        new RoomVisual(pos.roomName).rect(pos.x - 0.5, pos.y - 0.5, 1, 1, {
            strokeWidth: 0.1,
            stroke: color,
            fill: 'transparent',
        });
    }
}

/** 用方向箭头标出 CostMatrix 流向（值需为 1-8 方向常量） */
export function visualizeFlowField(roomName: string, costs: CostMatrix): void {
    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            const symbol = DIRECTION_SYMBOLS[costs.get(x, y)];
            if (symbol) {
                new RoomVisual(roomName).text(symbol, x, y);
            }
        }
    }
}

/** 逐格标出 CostMatrix 非零值 */
export function visualizeCostMatrix(roomName: string, costs: CostMatrix): void {
    const visual = new RoomVisual(roomName);
    for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            const cost = costs.get(x, y);
            if (cost === 0) continue;
            visual.text(String(cost), x, y, { font: 0.3, strokeWidth: 0.15, stroke: 'black' });
        }
    }
}

/** 虚线绘制路径，opts.startPos 补首段，opts.color 定制颜色 */
export function visualizePath(path: RoomPosition[], opts: { startPos?: RoomPosition; color?: string } = {}): void {
    const startPos = opts.startPos;
    const color = opts.color || 'aqua';

    for (let i = path.length - 1; i >= 0; i--) {
        const posNow = path[i];
        const posNext = path[i - 1] || startPos;
        if (!posNext) return;
        if (posNow.roomName === posNext.roomName) {
            new RoomVisual(posNow.roomName).line(posNow, posNext, {
                color,
                width: 0.15,
                opacity: 0.2,
                lineStyle: 'dashed',
            });
        }
        if (startPos && posNext.isEqualTo(startPos)) {
            return;
        }
    }
}

/** 数值映射到 HSL 渐变色；min === max 返回 null */
export function getGradientColor(
    number: number,
    min: number,
    max: number,
    { reverse = false, startHue = 240, endHue = 0, saturation = 100, lightness = 50, alpha = 1 } = {},
): string | null {
    if (max === min) return null;

    let ratio = (number - min) / (max - min);
    ratio = Math.max(0, Math.min(1, ratio));

    if (reverse) ratio = 1 - ratio;

    const hue = startHue + (endHue - startHue) * ratio;

    if (alpha < 1) {
        return `hsla(${hue},${saturation}%,${lightness}%,${alpha})`;
    }

    return hslToHex(hue, saturation, lightness);
}

/** HSL 转 hex 颜色串 */
function hslToHex(h: number, s: number, l: number): string {
    s /= 100;
    l /= 100;

    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));

    const toHex = (x: number) => x.toString(16).padStart(2, '0');

    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
