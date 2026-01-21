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
 * @returns 解压后的身体配置数组，每个元素为[BodyPartConstant, count]
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
