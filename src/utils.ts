// 签入原型
export const assignPrototype = function(obj1: any, obj2: any) {
    Object.getOwnPropertyNames(obj2.prototype).forEach(key => {
        obj1.prototype[key] = obj2.prototype[key];
    });
};

export function log(type: string, text: string, ...args: any[]) {
    if (!type) type = `${global.BOT_NAME}`;
    if (text[0] == '[') {
        console.log(`<span style="color: #D0CAE0;"><b>[${type}]</b></span>${text}`, ...args);
    } else {
        console.log(`<span style="color: #D0CAE0;"><b>[${type}]</b></span> ${text}`, ...args);
    }
}

// 坐标压缩函数
export function compress(x: number, y: number): number {
    return (x << 6) | y;
}

// 坐标解压函数
export function decompress(value: number) {
    const x = value >> 6;      // 高 6 位是 x
    const y = value & 0b111111; // 低 6 位是 y
    return [x, y];
}

// 批量压缩坐标
export function compressBatch(coords: number[][]) {
    return coords.map(([x, y]) => compress(x, y));
}

// 批量解压坐标
export function decompressBatch(values: number[]) {
    return values.map(decompress);
}

// 压缩bodyConfig
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

// 解压bodyConfig
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


// 获取一个方向的反方向
export function getOppositeDirection(direction): DirectionConstant {
    if (direction == TOP) {
        return BOTTOM;
    } else if (direction == TOP_RIGHT) {
        return BOTTOM_LEFT;
    } else if (direction == RIGHT) {
        return LEFT;
    } else if (direction == BOTTOM_RIGHT) {
        return TOP_LEFT;
    } else if (direction == BOTTOM) {
        return TOP;
    } else if (direction == BOTTOM_LEFT) {
        return TOP_RIGHT;
    } else if (direction == LEFT) {
        return RIGHT;
    } else if (direction == TOP_LEFT) {
        return BOTTOM_RIGHT;
    } else {
        return direction;
    }
}

// 计算合适的订单价格
export function getPrice(type: any, orderType: any): any {
    let Price = 0.01;
    const orders = Game.market.getAllOrders({type: orderType, resourceType: type});
    if (!orders || orders.length === 0) return null;
    orders.sort((a, b) => {
        if (orderType === ORDER_BUY) {
            return b.price - a.price; // 按价格从高到低排序
        } else {
            return a.price - b.price; // 按价格从低到高排序
        }
    });
    let rooms = {}
    // 取前十
    const topOrders = orders.filter(order => {
        // 初步过滤
        if (type == 'energy' && order.amount < 10000) return false;
        if (rooms[order.roomName]) return false;
        rooms[order.roomName] = true;
        return true;
    }).slice(0, 10);
    if (topOrders.length === 0) return null;

    // 计算筛选出的订单的平均价格
    const averagePrice = topOrders.reduce((sum, order) => sum + order.price, 0) / topOrders.length;
    if (averagePrice == topOrders[0].price) return averagePrice;
    if (orderType === ORDER_BUY) {
        // 过滤掉高于平均价格太多的订单
        const filteredOrders = topOrders.filter(order => order.price <= averagePrice * 1.2);
        // 实际价格不超过最高价的一定比例
        const maxPrice = topOrders[0].price * 0.995;
        const filterPrice = filteredOrders[0].price;
        Price = Math.min(filterPrice, maxPrice);
    } else if (orderType === ORDER_SELL) {
        // 过滤掉低于平均价格太多的订单
        const filteredOrders = topOrders.filter(order => order.price >= averagePrice * 0.8);
        // 实际价格不低于最低价的一定比例
        const minPrice = topOrders[0].price * 1.005;
        const filterPrice = filteredOrders[0].price;
        Price = Math.max(filterPrice, minPrice);
    } else return null;

    return Price;
}

/**
 * 二分匹配算法
 */
export const bipartiteMatch = (left: string[], right: string[], matchSet: Set<string>) => {
    const result: Record<string, string> = {}
    const used = new Map<string, boolean>()
    const dfs = (u: string) => {
        for (const v of right) {
            if (!used.get(v) && matchSet.has(u + v)) {
                used.set(v, true)
                if (!result[v] || dfs(result[v])) {
                    result[v] = u
                    return true
                }
            }
        }
        return false
    }
    for (const u of left) {
        used.clear()
        dfs(u)
    }

    // 将 result 的 key 和 value 换位置后返回
    const newResult: Record<string, string> = {}
    for (const key in result) {
        newResult[result[key]] = key
    }
    return newResult
}


/**
 * 爬与位置的二分匹配
 */
export const creepPosBipartiteMatch = (creeps: Creep[], pos: RoomPosition[], range = 1) => {
    const matchSet = new Set<string>()
    const left = creeps.map((creep) => creep.name)
    const right = pos.map((p) => `${p.x}/${p.y}`)

    const getRange = (x1: number, y1: number, x2: number, y2: number) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2))

    creeps.forEach((creep) => {
        pos.forEach((p) => {
            if (getRange(creep.pos.x, creep.pos.y, p.x, p.y) > range) return

            matchSet.add(`${creep.name}${p.x}/${p.y}`)
        })
    })

    const match = bipartiteMatch(left, right, matchSet)

    const posMap = new Map<string, RoomPosition>()
    pos.forEach((p) => posMap.set(`${p.x}/${p.y}`, p))

    const result: Record<string, RoomPosition> = {}
    for (const creepName in match) {
        const posKey = match[creepName]
        result[creepName] = posMap.get(posKey)!
    }

    return result
}


import { FlowerNames } from '@/constant/CreepName';

// 生成一个短编码
export function GenShortNumber() {
    return (Game.time*1296 + Math.floor(Math.random()*1296))
            .toString(36)
            .slice(-4)
            .toUpperCase();
}
// 生成一个 creep 名称
export function GenCreepName(code: string) {
    const number = GenShortNumber();
    const index = Math.floor(Game.time * Math.random() * 1000) % FlowerNames.length;
    let name: string;
    if (FlowerNames && FlowerNames.length) {
        name = `〈${FlowerNames[index]}〉${code}#${number}`;
    } else {
        name = `${code}#${number}`;
    }
    if (Game.creeps[name]) {
        return GenCreepName(code);
    } else {
        return name;
    }
}