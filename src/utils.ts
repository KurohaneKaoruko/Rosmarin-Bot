import { BASE_CONFIG } from '@/constant/config';

/** 签入原型
 * 为obj1添加obj2的原型方法
 * @param obj1 目标对象
 * @param obj2 源对象
 */
export const assignPrototype = function(obj1: any, obj2: any) {
    Object.getOwnPropertyNames(obj2.prototype).forEach(key => {
        obj1.prototype[key] = obj2.prototype[key];
    });
};

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

/** 计算合适的订单价格
 * 根据订单类型和资源类型计算合适的订单价格
 * @param type 资源类型
 * @param orderType 订单类型
 * @returns 合适的订单价格
 */
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
        const roomKey = order.roomName || order.id;
        if (rooms[roomKey]) return false;
        rooms[roomKey] = true;
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
        const filterPrice = (filteredOrders[0]?.price ?? topOrders[0].price);
        Price = Math.min(filterPrice, maxPrice);
    } else if (orderType === ORDER_SELL) {
        // 过滤掉低于平均价格太多的订单
        const filteredOrders = topOrders.filter(order => order.price >= averagePrice * 0.8);
        // 实际价格不低于最低价的一定比例
        const minPrice = topOrders[0].price * 1.005;
        const filterPrice = (filteredOrders[0]?.price ?? topOrders[0].price);
        Price = Math.max(filterPrice, minPrice);
    } else return null;

    return Price;
}

/**
 * 二分匹配算法
 * @param left 左侧节点数组
 * @param right 右侧节点数组
 * @param matchSet 匹配集合，包含左侧节点与右侧节点的匹配关系
 * @returns 匹配结果，记录右侧节点到左侧节点的映射
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
 * @param creeps 爬群数组
 * @param pos 位置数组
 * @param range 匹配范围，默认1
 * @returns 匹配结果，记录爬群到位置的映射
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
