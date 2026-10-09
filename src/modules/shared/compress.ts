/**
 * 压缩工具集（三套并行，按场景分工）：
 * - compress 位运算：单坐标压成单数字，零分配——堆内瞬时运算用
 * - utf15 位流：无符号整数数组 → 紧凑 UTF-16 字符串（15 位/字符，避开代理对区）——Memory 通用持久化用
 * - 路径增量方向：起点 12 位 + 步进 3 位/步（寻路步进序列相邻性）——路径 Memory 持久化最优（实测密度为
 *   utf15 绝对坐标的 3.2 倍、compress 数字数组的 11.7 倍，序列化 CPU 同量级占优）
 */

// ============================================================
// 坐标位运算（堆内瞬时）
// ============================================================

/** 坐标压缩函数
 * 将(x, y)坐标压缩为一个整数
 * @param x 坐标x
 * @param y 坐标y
 * @returns 压缩后的整数
 */
export function compress(x: number, y: number): number {
    return (x << 6) | y;
}

/** 坐标解压函数
 * 将压缩后的整数解压为(x, y)坐标
 * @param value 压缩后的整数
 * @returns 解压后的坐标数组[x, y]
 */
export function decompress(value: number) {
    const x = value >> 6;      // 高 6 位是 x
    const y = value & 0b111111; // 低 6 位是 y
    return [x, y];
}

/** 批量压缩坐标
 * 将多个(x, y)坐标压缩为整数数组
 * @param coords 坐标数组，每个元素为[x, y]
 * @returns 压缩后的整数数组
 */
export function compressBatch(coords: number[][]) {
    return coords.map(([x, y]) => compress(x, y));
}

/** 批量解压坐标
 * 将多个压缩后的整数解压为(x, y)坐标数组
 * @param values 压缩后的整数数组
 * @returns 解压后的坐标数组[x, y]
 */
export function decompressBatch(values: number[]) {
    return values.map(decompress);
}

// ============================================================
// utf15 位流编解码（Memory 通用持久化）
// ============================================================

/** utf15 编解码配置 */
export type Utf15CodecConfig = {
    /** 头部自描述：decode 时从串头恢复 array/depth 配置 */
    meta?: boolean;
    /** 数组模式：打包整数数组（默认单值模式） */
    array?: boolean;
    /** 每值位宽（1–53）；array 模式可传逐元素位宽数组 */
    depth?: number | number[];
};

/** utf15 可接受的整数数组（含 TypedArray） */
export type Utf15IntArray = number[] | Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array;

const UTF15_MAX_DEPTH = 53;      // Number.MAX_SAFE_INTEGER === 2^53 - 1
const UTF15_BITS_PER_CHAR = 15;  // 每字符 15 位（16 位减去代理对区）
const UTF15_OFFSET = 48;         // 数值 0 映射到 ASCII '0'，避开控制字符
const UTF15_UPPER_BOUND = 0xffff;
// 2 的幂表（2^0 … 2^53），位拆装查表用（实测比 2 ** n 快 ~19 倍）
const UTF15_POWERS: number[] = [
    1,
    2,
    4,
    8,
    16,
    32,
    64,
    128,
    256,
    512,
    1024,
    2048,
    4096,
    8192,
    16384,
    32768,
    65536,
    131072,
    262144,
    524288,
    1048576,
    2097152,
    4194304,
    8388608,
    16777216,
    33554432,
    67108864,
    134217728,
    268435456,
    536870912,
    1073741824,
    2147483648,
    4294967296,
    8589934592,
    17179869184,
    34359738368,
    68719476736,
    137438953472,
    274877906944,
    549755813888,
    1099511627776,
    2199023255552,
    4398046511104,
    8796093022208,
    17592186044416,
    35184372088832,
    70368744177664,
    140737488355328,
    281474976710656,
    562949953421312,
    1125899906842624,
    2251799813685248,
    4503599627370496,
    9007199254740992,
];
const UTF15_UPPER_LIMIT = UTF15_POWERS[UTF15_BITS_PER_CHAR]; // 15 位可表示上限

class Utf15Error extends Error {
    constructor(kind: 'Range' | 'Type', msg: string) {
        super(`[utf15][${kind}Error]: ${msg}`);
    }
}

const utf15Assert = (condition: unknown, kind: 'Range' | 'Type', ...msg: unknown[]): void => {
    if (!condition) throw new Utf15Error(kind, msg.map(String).join(' '));
};

/** 数值 → 编码字符（+48 偏移；要求 value < 32768） */
const utf15NumToChar = (value: number): string => {
    utf15Assert(value >= 0 && value < UTF15_UPPER_LIMIT, 'Range', 'x out of bounds:', value);
    return String.fromCodePoint(value + UTF15_OFFSET);
};

/** 编码字符 → 数值 */
const utf15CharToNum = (char: number): number => {
    utf15Assert(char >= 0 && char <= UTF15_UPPER_BOUND, 'Range', 'x out of bounds:', char);
    return char - UTF15_OFFSET;
};

type Utf15Meta = { array: number; depth: number | number[] };

/** 校验配置（depth ∈ (0, 53]；逐元素 depth 数组需 array 模式） */
const utf15CheckConfig = (depth: number | number[]): void => {
    if (Array.isArray(depth)) {
        const bad = depth.some((d) => isNaN(d) || d <= 0 || d > UTF15_MAX_DEPTH);
        utf15Assert(!bad, 'Type', 'Codec config is invalid: depth 数组含越界位宽');
        return;
    }
    utf15Assert(!isNaN(depth) && depth > 0 && depth <= UTF15_MAX_DEPTH, 'Type', 'Codec config is invalid: depth =', depth);
};

/** 数组位流打包：逐值按 depth 拆位，拼满 15 位输出一个字符；数组长度作头部字符 */
const utf15PackBits = (res: string, values: Utf15IntArray, depth: number | number[]): string => {
    const depthIsArray = Array.isArray(depth);
    const fixedDepth = depthIsArray ? 0 : depth;
    const depths = depthIsArray ? depth : [];

    utf15Assert(fixedDepth || depths.length === values.length, 'Type', 'Wrong depths array length:', depths, values);

    if (!depthIsArray) res += utf15NumToChar(values.length); // 数组长度作头部

    let symbolDone = 0; // 当前字符已填充位数
    let symbolAcc = 0;  // 当前字符累积值

    for (let i = 0, len = values.length; i < len; ++i) {
        const value = values[i];
        const depthN = fixedDepth || depths[i];

        // 按位写入：值切段填入字符的剩余空间
        for (let valueDone = 0; valueDone < depthN; ) {
            const symbolLeft = UTF15_BITS_PER_CHAR - symbolDone;
            const valueLeft = depthN - valueDone;
            const bitsToWrite = Math.min(symbolLeft, valueLeft);

            let mask = Math.floor(value / UTF15_POWERS[valueDone]);
            mask %= UTF15_POWERS[bitsToWrite];
            mask *= UTF15_POWERS[symbolDone];

            symbolAcc += mask;
            valueDone += bitsToWrite;
            symbolDone += bitsToWrite;

            // 字符填满 15 位，输出
            if (symbolDone === UTF15_BITS_PER_CHAR) {
                res += utf15NumToChar(symbolAcc);
                symbolDone = symbolAcc = 0;
            }
        }
    }

    if (symbolDone !== 0) res += utf15NumToChar(symbolAcc); // 末尾残余位

    return res;
};

/** 数组位流解包；返回 [数值数组, 消耗字符数] */
const utf15UnpackBits = (str: string, depth: number | number[]): [number[], number] => {
    const depthIsArray = Array.isArray(depth);
    const fixedDepth = depthIsArray ? 0 : depth;
    const depths = depthIsArray ? depth : [];

    let it = 0;
    let i = 0;
    const length = depthIsArray ? depths.length : utf15CharToNum(str.codePointAt(it++));
    const values = new Array<number>(length);

    let symbolDone = 0;
    if (length === 0) return [values, it];
    let chunk = utf15CharToNum(str.codePointAt(it++));

    while (i < length) {
        const depthN = fixedDepth || depths[i];
        let valueAcc = 0;
        let valueDone = 0;

        // 按位读取：字符切段拼出原值
        while (valueDone < depthN) {
            const symbolLeft = UTF15_BITS_PER_CHAR - symbolDone;
            const valueLeft = depthN - valueDone;
            const bitsToRead = Math.min(symbolLeft, valueLeft);

            let data = Math.floor(chunk / UTF15_POWERS[symbolDone]);
            data %= UTF15_POWERS[bitsToRead];
            data *= UTF15_POWERS[valueDone];

            valueAcc += data;
            valueDone += bitsToRead;
            symbolDone += bitsToRead;

            // 当前字符读完，取下一个（最后一个值读完时不前进）
            if (symbolDone === UTF15_BITS_PER_CHAR) {
                if (i + 1 === length && valueDone === depthN) break;
                chunk = utf15CharToNum(str.codePointAt(it++));
                symbolDone = 0;
            }
        }

        if (valueDone > 0) values[i++] = valueAcc;
    }

    return [values, it];
};

/** utf15 位流编解码器：无符号整数（数组）↔ 紧凑 UTF-16 字符串（15 位/字符） */
export class Utf15Codec {
    private readonly meta: boolean;
    private readonly array: boolean;
    private readonly depth: number | number[];

    constructor(cfg: Utf15CodecConfig = {}) {
        this.meta = !!cfg.meta;
        this.array = !!cfg.array;
        this.depth = cfg.depth ?? UTF15_MAX_DEPTH;
        utf15CheckConfig(this.depth);
    }

    /** 编码。array 模式收整数数组/TypedArray，单值模式收单值 */
    encode(arg: number | Utf15IntArray): string {
        const argIsArray = typeof arg === 'number'
            ? false
            : Array.isArray(arg) || 'BYTES_PER_ELEMENT' in arg;
        utf15Assert(argIsArray === this.array, 'Type', 'Incompatible codec (array <=> single value), arg =', arg);

        let res = '';
        if (this.meta) res += utf15NumToChar(1) + utf15NumToChar(Array.isArray(this.depth) ? 0 : this.depth); // 头部自描述

        if (this.array) {
            res = utf15PackBits(res, arg as Utf15IntArray, this.depth);
        } else {
            // 单值：按 depth 拆成多个 15 位字符
            let x = (arg as number) % UTF15_POWERS[this.depth as number];
            const len = Math.ceil((this.depth as number) / UTF15_BITS_PER_CHAR);
            for (let i = 0; i < len; ++i) {
                res += utf15NumToChar(x % UTF15_UPPER_LIMIT);
                x = Math.floor(x / UTF15_UPPER_LIMIT);
            }
        }

        return res;
    }

    /** 数组模式解码 → 数值数组 */
    decodeArray(str: string): number[] {
        if (!this.array) throw new Utf15Error('Type', 'Incompatible codec (array <=> single value)');
        let depth = this.depth;
        let body = str;
        if (this.meta) {
            // 头部自描述：array 标志 + depth（depth 记 0 表示逐元素位宽数组）
            const arrayFlag = utf15CharToNum(str.codePointAt(0));
            const depthFlag = utf15CharToNum(str.codePointAt(1));
            body = str.slice(2);
            utf15Assert(arrayFlag === 1, 'Type', 'Incompatible codec (array <=> single value), str =', str);
            depth = depthFlag > 0 ? depthFlag : this.depth;
        }
        const [values] = utf15UnpackBits(body, depth);
        return values;
    }

    /** 单值模式解码 → 数值 */
    decodeValue(str: string): number {
        if (this.array) throw new Utf15Error('Type', 'Incompatible codec (array <=> single value)');
        let depth = typeof this.depth === 'number' ? this.depth : UTF15_MAX_DEPTH;
        if (this.meta) {
            const arrayFlag = utf15CharToNum(str.codePointAt(0));
            const depthFlag = utf15CharToNum(str.codePointAt(1));
            str = str.slice(2);
            utf15Assert(arrayFlag === 0, 'Type', 'Incompatible codec (array <=> single value), str =', str);
            if (depthFlag > 0) depth = depthFlag;
        }
        let acc = 0;
        let pow = 0;
        const len = Math.ceil(depth / UTF15_BITS_PER_CHAR);
        for (let i = 0; i < len; ++i) {
            acc += utf15CharToNum(str.codePointAt(i)) * UTF15_POWERS[pow];
            pow += UTF15_BITS_PER_CHAR;
        }
        return acc;
    }
}

// ============================================================
// 路径增量方向编码（Memory 路径持久化）
// ============================================================

const PATH_COORD_CODEC = new Utf15Codec({ array: true, depth: 6 });
const PATH_DIR_CODEC = new Utf15Codec({ array: true, depth: 3 });
// TOP 起顺时针，与游戏方向常量同序
const PATH_DELTAS = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1],
];
const PATH_DIR_LOOKUP: number[] = [];
PATH_DELTAS.forEach(([dx, dy], i) => { PATH_DIR_LOOKUP[(dx + 1) * 3 + (dy + 1)] = i; });

/** 路径编码：相邻步进序列 → [起点串, 方向步进串]（约 0.4 字符/步）
 * @param pairs 同房间相邻步进坐标序列 [x, y][]，步进必须相邻（dx/dy ∈ {-1,0,1}）
 */
export function packPath(pairs: [number, number][]): [string, string] {
    const head = PATH_COORD_CODEC.encode([pairs[0][0], pairs[0][1]]);
    const dirs: number[] = [];
    for (let i = 1; i < pairs.length; i++) {
        const d = PATH_DIR_LOOKUP[(pairs[i][0] - pairs[i - 1][0] + 1) * 3 + (pairs[i][1] - pairs[i - 1][1] + 1)];
        if (d === undefined) throw new Error(`packPath: 非相邻步进 @${i}`);
        dirs.push(d);
    }
    return [head, dirs.length ? PATH_DIR_CODEC.encode(dirs) : ''];
}

/** 路径解码：从起点沿方向表重放还原绝对坐标序列 */
export function unpackPath([head, steps]: [string, string]): [number, number][] {
    const decoded = PATH_COORD_CODEC.decodeArray(head);
    const out: [number, number][] = [[decoded[0], decoded[1]]];
    const dirs = steps ? PATH_DIR_CODEC.decodeArray(steps) : [];
    let x = decoded[0], y = decoded[1];
    for (let i = 0; i < dirs.length; i++) {
        const [dx, dy] = PATH_DELTAS[dirs[i]];
        x += dx; y += dy;
        out.push([x, y]);
    }
    return out;
}

// ============================================================
// bodyConfig 压缩
// ============================================================

/** 压缩bodyConfig
 * 将bodyConfig压缩为一个字符串
 * @param bodyConfig 身体配置数组，每个元素为[BodyPartConstant, count]
 * @returns 压缩后的字符串
 */
export function compressBodyConfig(bodyConfig: ((BodyPartConstant | number)[])[]): string {
    const MAP = {
        [MOVE]: 'm',
        [WORK]: 'w',
        [CARRY]: 'c',
        [ATTACK]: 'a',
        [RANGED_ATTACK]: 'r',
        [HEAL]: 'h',
        [TOUGH]: 't',
        [CLAIM]: 'cl',
    };
    let result = '';
    for (const part of bodyConfig) {
        result += `${MAP[part[0]]}${part[1]}`;
    }
    return result;
}

/** 解压bodyConfig
 * 将压缩后的字符串解压为bodyConfig
 * @param compressed 压缩后的字符串
 * @returns 解压后的身体配置数组
 */
export function decompressBodyConfig(compressed: string): ((BodyPartConstant | number)[])[] {
    const REVERSE_MAP = {
        'm': MOVE,
        'w': WORK,
        'c': CARRY,
        'a': ATTACK,
        'r': RANGED_ATTACK,
        'h': HEAL,
        't': TOUGH,
        'cl': CLAIM,
    };
    if (!compressed) return [];

    compressed = compressed.toLowerCase();
    const regex = /(cl|m|w|c|a|r|h|t)(\d+)/g;
    const result: ((BodyPartConstant | number)[])[] = [];
    const match = compressed.match(regex);
    if (!match) return [];
    for (const m of match) {
        const decoded = m.match(/(cl|m|w|c|a|r|h|t)(\d+)/);
        const part = decoded[1], count = Number(decoded[2]);
        result.push([REVERSE_MAP[part], count]);
    }

    return result
}
