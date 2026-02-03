/**
 * DD (Definite Domination) 交流系统 v4.4
 * 
 * 功能：
 * 1. 基于 Memory Segments 的玩家间加密通讯
 * 2. 战争指令（defend/attack）需要二次确认
 * 3. 资源指令（energy/resource）不需要确认直接执行
 * 4. 自动计算最近房间
 * 5. 被攻击自动通知
 * 
 * ========================================
 * 🔧 用户需要修改的地方（搜索 "USER_IMPLEMENT"）:
 * ========================================
 * 1. onDefendAccepted()   - 接受防守请求后执行
 * 2. onAttackAccepted()   - 接受进攻请求后执行
 * 3. onEnergyRequest()    - 收到能量请求后执行
 * 4. onResourceRequest()  - 收到资源请求后执行
 * ========================================
 */

// ==================== 常量 ====================

const DD_SEGMENT_ID = 98 // 通讯段ID
const DD_HISTORY_SEGMENT_ID = 99 // 历史段ID
const HISTORY_RETENTION = 1000 // 历史保留时间（tick）
const REQUEST_TIMEOUT = 100 // 请求超时时间（tick）
const DEFAULT_SECRET_KEY = 'defintely_domination'

// ==================== 类型定义 ====================

type DDMessageType = 'msg' | 'command' | 'request' | 'response'
type WarType = 'defend' | 'attack'

interface DDMessage {
    from: string
    msg: string
    time: number
    to?: string
    id: string
    type?: DDMessageType
    data?: any
}

interface DDMemory {
    nextIndex?: number         // 轮询通讯名单的索引
    watchedIds?: string[]      // 监控攻击通知的对象 ID 列表
    lastAlert?: Record<string, number>  // 上次报警时间
    username?: string          // 缓存的用户名
    seq?: number               // 消息序号
    commList?: string[]        // 通讯名单
    attackNotify?: boolean     // 是否开启攻击通知
    lastSeen?: Record<string, string> // 每个对端最后处理的 msg.id（用于重载去重）
    seen?: Record<string, number> // 消息指纹 -> 处理 tick（用于无 id 对端的重载去重）
}

interface PendingRequest {
    id: string
    type: WarType
    from: string
    to: string
    roomName: string
    expireTick: number
    receivedTick: number
    attacker?: string
    nearestRoom: string | null  // 已计算好的最近房间
    distance: number            // 距离
}

interface SentRequest {
    id: string
    type: WarType
    to: string
    roomName: string
    expireTick: number
    status: 'pending' | 'accepted' | 'rejected' | 'expired'
}

// ==================== 全局缓存 ====================

let messageHistoryCache: DDMessage[] | null = null
let lastCheckTick = -1
const processedMessages = new Set<string>()
let currentTickBuffer: string[] = []
const pendingRequests: Map<string, PendingRequest> = new Map()
const sentRequests: Map<string, SentRequest> = new Map()

// ==================== 房间距离计算 ====================

function parseRoomName(roomName: string): { x: number, y: number } | null {
    const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/)
    if (!match) return null

    const [, we, weNum, ns, nsNum] = match
    const x = we === 'W' ? -parseInt(weNum) - 1 : parseInt(weNum)
    const y = ns === 'N' ? -parseInt(nsNum) - 1 : parseInt(nsNum)
    return { x, y }
}

function getRoomDistance(room1: string, room2: string): number {
    const pos1 = parseRoomName(room1)
    const pos2 = parseRoomName(room2)
    if (!pos1 || !pos2) return Infinity
    return Math.max(Math.abs(pos1.x - pos2.x), Math.abs(pos1.y - pos2.y))
}

function findNearestOwnedRoom(targetRoom: string, minRCL: number = 4): { room: string | null, distance: number } {
    let nearestRoom: string | null = null
    let minDistance = Infinity

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName]
        if (!room.controller?.my) continue
        if (room.controller.level < minRCL) continue

        const distance = getRoomDistance(roomName, targetRoom)
        if (distance < minDistance) {
            minDistance = distance
            nearestRoom = roomName
        }
    }

    return { room: nearestRoom, distance: minDistance }
}

function findNearestRoomWithResource(targetRoom: string, resourceType: ResourceConstant, minAmount: number = 10000): { room: string | null, distance: number } {
    let nearestRoom: string | null = null
    let minDistance = Infinity

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName]
        if (!room.controller?.my) continue
        if (room.controller.level < 6) continue  // 需要 Terminal
        if (!room.terminal) continue

        const stored = room.terminal.store[resourceType] || 0
        if (stored < minAmount) continue

        const distance = getRoomDistance(roomName, targetRoom)
        if (distance < minDistance) {
            minDistance = distance
            nearestRoom = roomName
        }
    }

    return { room: nearestRoom, distance: minDistance }
}

// ========================================
// 🔧 USER_IMPLEMENT: 战争指令执行逻辑
// ========================================

/**
 * 接受防守请求后执行
 * 
 * @param fromRoom 出兵房间（已自动选择最近的 RCL4+ 房间）
 * @param targetRoom 目标房间（需要防守的房间）
 * @param requester 请求者用户名
 * @param attacker 攻击者用户名（可选）
 */
function onDefendAccepted(fromRoom: string, targetRoom: string, requester: string, attacker?: string): void {
    console.log(`[DD] 🛡️ 执行防守: ${fromRoom} -> ${targetRoom} (请求者: ${requester}${attacker ? `, 攻击者: ${attacker}` : ''})`)

    // USER_IMPLEMENT: 在这里实现你的防守小队派遣逻辑
    // 例如: 创建旗帜、写入任务队列、调用小队管理器等

}

/**
 * 接受进攻请求后执行
 * 
 * @param fromRoom 出兵房间（已自动选择最近的 RCL4+ 房间）
 * @param targetRoom 目标房间（需要进攻的房间）
 * @param requester 请求者用户名
 */
function onAttackAccepted(fromRoom: string, targetRoom: string, requester: string): void {
    console.log(`[DD] ⚔️ 执行进攻: ${fromRoom} -> ${targetRoom} (请求者: ${requester})`)

    // USER_IMPLEMENT: 在这里实现你的进攻小队派遣逻辑
    // 例如: 创建旗帜、写入任务队列、调用小队管理器等

}

// ========================================
// 🔧 USER_IMPLEMENT: 资源指令执行逻辑
// ========================================

/**
 * 收到能量请求后执行（不需要确认，直接执行）
 * 
 * @param fromRoom 发送房间（已自动选择有足够能量的最近房间，可能为 null）
 * @param targetRoom 目标房间
 * @param requester 请求者用户名
 * @param amount 请求数量（可选）
 */
function onEnergyRequest(fromRoom: string | null, targetRoom: string, requester: string, amount?: number): void {
    if (!fromRoom) {
        console.log(`[DD] ❌ 没有房间有足够的能量发送到 ${targetRoom}`)
        return
    }

    console.log(`[DD] ⚡ 发送能量: ${fromRoom} -> ${targetRoom} (数量: ${amount || '未指定'}, 请求者: ${requester})`)

    // USER_IMPLEMENT: 在这里实现你的能量发送逻辑
    // 例如: Game.rooms[fromRoom].terminal.send(RESOURCE_ENERGY, amount || 50000, targetRoom)

}

/**
 * 收到资源请求后执行（不需要确认，直接执行）
 * 
 * @param fromRoom 发送房间（已自动选择有足够资源的最近房间，可能为 null）
 * @param targetRoom 目标房间
 * @param resourceType 资源类型
 * @param requester 请求者用户名
 * @param amount 请求数量（可选）
 */
function onResourceRequest(fromRoom: string | null, targetRoom: string, resourceType: ResourceConstant, requester: string, amount?: number): void {
    if (!fromRoom) {
        console.log(`[DD] ❌ 没有房间有足够的 ${resourceType} 发送到 ${targetRoom}`)
        return
    }

    console.log(`[DD] 📦 发送资源: ${resourceType} | ${fromRoom} -> ${targetRoom} (数量: ${amount || '未指定'}, 请求者: ${requester})`)

    // USER_IMPLEMENT: 在这里实现你的资源发送逻辑
    // 例如: Game.rooms[fromRoom].terminal.send(resourceType, amount || 10000, targetRoom)

}

// ==================== 加密/解密 ====================

function getCipherKey(): string {
    // 使用固定默认密钥，所有人必须相同
    return DEFAULT_SECRET_KEY
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP = (() => {
    const table = new Int16Array(128)
    table.fill(-1)
    for (let i = 0; i < BASE64_ALPHABET.length; i++) {
        table[BASE64_ALPHABET.charCodeAt(i)] = i
    }
    return table
})()


function utf8Encode(str: string): Uint8Array {
    const bytes: number[] = []
    for (let i = 0; i < str.length; i++) {
        let cp = str.charCodeAt(i)
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
            const next = str.charCodeAt(i + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
                cp = ((cp - 0xd800) << 10) + (next - 0xdc00) + 0x10000
                i++
            }
        }
        if (cp < 0x80) bytes.push(cp)
        else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
        else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
        else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    }
    return new Uint8Array(bytes)
}

function utf8Decode(bytes: Uint8Array): string {
    let result = '', i = 0
    while (i < bytes.length) {
        const b1 = bytes[i++]
        if (b1 < 0x80) result += String.fromCharCode(b1)
        else if ((b1 & 0xe0) === 0xc0) result += String.fromCharCode(((b1 & 0x1f) << 6) | (bytes[i++] & 0x3f))
        else if ((b1 & 0xf0) === 0xe0) {
            const b2 = bytes[i++], b3 = bytes[i++]
            result += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f))
        } else {
            const b2 = bytes[i++], b3 = bytes[i++], b4 = bytes[i++]
            let cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f) - 0x10000
            result += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
        }
    }
    return result
}

function base64Encode(data: Uint8Array): string {
    let result = '', len = data.length, rem = len % 3, full = len - rem
    for (let i = 0; i < full; i += 3) {
        const n = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
        result += BASE64_ALPHABET[(n >> 18) & 0x3f] + BASE64_ALPHABET[(n >> 12) & 0x3f] + BASE64_ALPHABET[(n >> 6) & 0x3f] + BASE64_ALPHABET[n & 0x3f]
    }
    if (rem === 1) result += BASE64_ALPHABET[(data[full] >> 2) & 0x3f] + BASE64_ALPHABET[(data[full] << 4) & 0x3f] + '=='
    else if (rem === 2) {
        const n = (data[full] << 8) | data[full + 1]
        result += BASE64_ALPHABET[(n >> 10) & 0x3f] + BASE64_ALPHABET[(n >> 4) & 0x3f] + BASE64_ALPHABET[(n << 2) & 0x3f] + '='
    }
    return result
}

function base64Decode(str: string): Uint8Array {
    let len = str.length
    if (len === 0) return new Uint8Array(0)
    let padding = str[len - 1] === '=' ? (str[len - 2] === '=' ? 2 : 1) : 0
    len -= padding
    const bytes = new Uint8Array(((len * 6) / 8) | 0)
    let idx = 0, buf = 0, bits = 0
    for (let i = 0; i < len; i++) {
        const val = BASE64_LOOKUP[str.charCodeAt(i)]
        if (val === -1) continue
        buf = (buf << 6) | val
        bits += 6
        if (bits >= 8) { bits -= 8; bytes[idx++] = (buf >> bits) & 0xff }
    }
    return bytes.subarray(0, idx)
}

function xorEncrypt(plaintext: string, key: string): string {
    if (!key) return plaintext
    const textBytes = utf8Encode(plaintext), keyBytes = utf8Encode(key), keyLen = keyBytes.length
    const result = new Uint8Array(textBytes.length)
    for (let i = 0; i < textBytes.length; i++) result[i] = textBytes[i] ^ keyBytes[i % keyLen]
    return base64Encode(result)
}

function xorDecrypt(ciphertext: string, key: string): string | null {
    if (!key) return ciphertext
    try {
        const encBytes = base64Decode(ciphertext), keyBytes = utf8Encode(key), keyLen = keyBytes.length
        const result = new Uint8Array(encBytes.length)
        for (let i = 0; i < encBytes.length; i++) result[i] = encBytes[i] ^ keyBytes[i % keyLen]
        return utf8Decode(result)
    } catch { return null }
}

// ==================== 消息发送/接收 ====================

function generateMessageId(): string {
    const mem = getDDMemory()
    if (!mem.seq) mem.seq = 0
    return `${Game.time}_${++mem.seq}`
}

function generateRequestId(): string {
    return `req_${Game.time}_${Math.floor(Math.random() * 10000)}`
}

function sendMessage(msg: string, to?: string, type: DDMessageType = 'msg', data?: any): void {
    const key = getCipherKey()
    if (!key) return

    const mem = getDDMemory()
    const myName = mem.username || Object.values(Game.spawns)[0]?.owner?.username || 'unknown'
    mem.username = myName

    const payload: DDMessage = { from: myName, msg, time: Game.time, to: to || 'all', id: generateMessageId(), type, data }
    currentTickBuffer.push(xorEncrypt(JSON.stringify([payload]), key))
}

function flushMessages(): void {
    if (currentTickBuffer.length === 0) return
    // 🔥 关键：必须设置 segment 为公开，其他玩家才能读取
    RawMemory.setPublicSegments([DD_SEGMENT_ID])
    RawMemory.segments[DD_SEGMENT_ID] = currentTickBuffer.join('||')
    currentTickBuffer = []
}

function requestForeignSegment(): void {
    const mem = getDDMemory()
    const commList = mem.commList || []
    if (commList.length === 0) return
    if (!mem.nextIndex) mem.nextIndex = 0
    RawMemory.setActiveForeignSegment(commList[mem.nextIndex++ % commList.length], DD_SEGMENT_ID)
}

function processForeignSegment(): void {
    const seg = RawMemory.foreignSegment
    // 🔥 修复：如果没有数据，立即请求下一个玩家
    if (!seg || !seg.data) {
        requestForeignSegment()
        return
    }

    const username = seg.username
    const key = getCipherKey()
    if (!key) return

    const mem = getDDMemory()
    if (!mem.lastSeen) mem.lastSeen = {}
    if (!mem.seen) mem.seen = {}

    const parseMsgId = (id: string): { time: number; seq: number } | null => {
        const m = id.match(/^(\d+)_(\d+)$/)
        if (!m) return null
        return { time: parseInt(m[1]), seq: parseInt(m[2]) }
    }

    const isNewerThan = (a: string, b: string): boolean => {
        if (a === b) return false
        const pa = parseMsgId(a)
        const pb = parseMsgId(b)
        if (!pa || !pb) return a > b
        if (pa.time !== pb.time) return pa.time > pb.time
        return pa.seq > pb.seq
    }

    if (Object.keys(mem.seen).length > 5000) {
        for (const k in mem.seen) {
            if (Game.time - (mem.seen[k] || 0) > HISTORY_RETENTION) delete mem.seen[k]
        }
    }

    for (const part of seg.data.split('||')) {
        if (!part) continue
        const decrypted = xorDecrypt(part, key)
        if (!decrypted) continue  // 解密失败静默忽略

        try {
            for (const msg of JSON.parse(decrypted) as DDMessage[]) {
                const myName = mem.username
                if (msg.to && msg.to !== 'all' && myName && msg.to !== myName) continue

                const msgId = `${username}_${msg.id}`
                if (processedMessages.has(msgId)) continue
                processedMessages.add(msgId)
                msg.from = username
                const fingerprint = `${username}|${msg.id || ''}|${msg.to || 'all'}|${msg.type || ''}|${msg.time}|${msg.msg}`
                const seenTick = mem.seen[fingerprint]
                if (seenTick && Game.time - seenTick <= HISTORY_RETENTION) continue

                const lastSeen = mem.lastSeen[username]
                const canUseLastSeen = !!parseMsgId(msg.id)
                if (canUseLastSeen && lastSeen && !isNewerThan(msg.id, lastSeen)) continue

                // 处理战争请求（需要确认）
                if (msg.type === 'request' && msg.data) {
                    handleWarRequest(msg)
                    mem.seen[fingerprint] = Game.time
                    if (canUseLastSeen) mem.lastSeen[username] = lastSeen ? (isNewerThan(msg.id, lastSeen) ? msg.id : lastSeen) : msg.id
                    continue
                }

                // 处理响应
                if (msg.type === 'response' && msg.data) {
                    handleResponse(msg)
                    mem.seen[fingerprint] = Game.time
                    if (canUseLastSeen) mem.lastSeen[username] = lastSeen ? (isNewerThan(msg.id, lastSeen) ? msg.id : lastSeen) : msg.id
                    continue
                }

                // 处理资源请求（不需要确认，直接执行）
                if (msg.msg.includes('[ENERGY]') || msg.msg.includes('[RESOURCE]')) {
                    handleResourceRequest(msg)
                }

                const history = loadHistory()
                const historyKey = `${msg.from}_${msg.id}`
                const tail = history.slice(-50)
                if (!tail.some(m => `${m.from}_${m.id}` === historyKey)) {
                    history.push(msg)
                    saveHistory(history)
                }

                console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📨 [DD] 来自 ${username}${msg.to && msg.to !== 'all' ? ' (私信)' : ''}\n⏰ ${msg.time}\n💬 ${msg.msg}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)

                mem.seen[fingerprint] = Game.time
                if (canUseLastSeen) mem.lastSeen[username] = lastSeen ? (isNewerThan(msg.id, lastSeen) ? msg.id : lastSeen) : msg.id
            }
        } catch { /* 静默忽略 */ }
    }

    // 🔥 修复：处理完后立即请求下一个玩家
    requestForeignSegment()
}

// ==================== 战争请求处理 ====================

function handleWarRequest(msg: DDMessage): void {
    const data = msg.data
    if (!data?.requestId || !data?.type) return

    if (Game.time > data.expireTick) {
        console.log(`[DD] ⏰ 收到过期请求 (${data.type}) 来自 ${msg.from}，已忽略`)
        return
    }

    // 自动计算最近房间
    const { room: nearestRoom, distance } = findNearestOwnedRoom(data.roomName)

    const request: PendingRequest = {
        id: data.requestId,
        type: data.type,
        from: msg.from,
        to: getDDMemory().username || 'unknown',
        roomName: data.roomName,
        expireTick: data.expireTick,
        receivedTick: Game.time,
        attacker: data.attacker,
        nearestRoom,
        distance
    }

    pendingRequests.set(request.id, request)

    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 [DD] 收到${data.type === 'defend' ? '防守' : '进攻'}请求!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 请求ID: ${request.id}
📌 类型: ${data.type}
👤 来自: ${msg.from}
🎯 目标: ${data.roomName}${data.attacker ? `\n⚔️ 攻击者: ${data.attacker}` : ''}
⏰ 剩余: ${data.expireTick - Game.time} tick
🏠 最近房间: ${nearestRoom || '无'} (距离: ${distance === Infinity ? '∞' : distance})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 dd.accept('${request.id}')  接受
📝 dd.reject('${request.id}')  拒绝
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
}

function handleResponse(msg: DDMessage): void {
    const data = msg.data
    if (!data?.requestId) return

    const request = sentRequests.get(data.requestId)
    if (!request) return

    request.status = data.accepted ? 'accepted' : 'rejected'

    if (data.accepted) {
        console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ [DD] 请求已被接受!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${data.requestId}
👤 ${msg.from} 将从 ${data.fromRoom} 出兵
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
    } else {
        console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ [DD] 请求已被拒绝
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ${data.requestId}
👤 ${msg.from}${data.reason ? `\n📝 ${data.reason}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
    }
}

// ==================== 资源请求处理（不需要确认）====================

function handleResourceRequest(msg: DDMessage): void {
    // 解析能量请求
    const energyMatch = msg.msg.match(/\[ENERGY\] 请求能量支援: (\w+)(?: \((\d+)\))?/)
    if (energyMatch) {
        const targetRoom = energyMatch[1]
        const amount = energyMatch[2] ? parseInt(energyMatch[2]) : undefined
        const { room: fromRoom } = findNearestRoomWithResource(targetRoom, RESOURCE_ENERGY, amount || 50000)

        onEnergyRequest(fromRoom, targetRoom, msg.from, amount)
        return
    }

    // 解析资源请求
    const resourceMatch = msg.msg.match(/\[RESOURCE\] 请求 (\w+) 支援: (\w+)(?: \((\d+)\))?/)
    if (resourceMatch) {
        const resourceType = resourceMatch[1] as ResourceConstant
        const targetRoom = resourceMatch[2]
        const amount = resourceMatch[3] ? parseInt(resourceMatch[3]) : undefined
        const { room: fromRoom } = findNearestRoomWithResource(targetRoom, resourceType, amount || 10000)

        onResourceRequest(fromRoom, targetRoom, resourceType, msg.from, amount)
    }
}

function cleanupExpiredRequests(): void {
    const now = Game.time
    for (const [id, req] of pendingRequests) {
        if (now > req.expireTick) pendingRequests.delete(id)
    }
    for (const [id, req] of sentRequests) {
        if (now > req.expireTick && req.status === 'pending') {
            req.status = 'expired'
            console.log(`[DD] ⏰ 请求 ${id} 已过期`)
        }
        if (now > req.expireTick + 100) sentRequests.delete(id)
    }
}

// ==================== Memory ====================

function getDDMemory(): DDMemory {
    if (!Memory.dd) Memory.dd = {}
    return Memory.dd
}

function loadHistory(): DDMessage[] {
    if (messageHistoryCache) return messageHistoryCache
    try {
        const data = RawMemory.segments[DD_HISTORY_SEGMENT_ID]
        messageHistoryCache = data ? JSON.parse(data) : []
    } catch { messageHistoryCache = [] }
    if (!Array.isArray(messageHistoryCache)) messageHistoryCache = []
    return messageHistoryCache
}

function saveHistory(history: DDMessage[]): void {
    history = history.filter(m => m.time > Game.time - HISTORY_RETENTION).slice(-500)
    messageHistoryCache = history
    RawMemory.segments[DD_HISTORY_SEGMENT_ID] = JSON.stringify(history)
}

// ==================== 攻击通知 ====================

const originalStructureNotify = typeof Structure !== 'undefined' ? Structure.prototype.notifyWhenAttacked : undefined
const originalCreepNotify = typeof Creep !== 'undefined' ? Creep.prototype.notifyWhenAttacked : undefined

function ddNotifyWhenAttacked(this: Structure | Creep, enabled: boolean): number {
    const mem = getDDMemory()
    if (!mem.watchedIds) mem.watchedIds = []

    if (enabled) {
        if (!mem.watchedIds.includes(this.id)) mem.watchedIds.push(this.id)
    } else {
        mem.watchedIds = mem.watchedIds.filter(id => id !== this.id)
    }

    if (this instanceof Structure && originalStructureNotify) return originalStructureNotify.call(this, enabled)
    if (this instanceof Creep && originalCreepNotify) return originalCreepNotify.call(this, enabled)
    return OK
}

function checkAttackEvents(): void {
    const mem = getDDMemory()
    if (!mem.attackNotify || !mem.watchedIds?.length) return

    const watched = new Set(mem.watchedIds)
    if (!mem.lastAlert) mem.lastAlert = {}

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName]
        if (!room) continue

        try {
            for (const event of room.getEventLog()) {
                if (event.event !== EVENT_ATTACK) continue
                const targetId = (event.data as any).targetId
                if (!watched.has(targetId)) continue

                const last = mem.lastAlert[targetId] || 0
                if (Game.time - last > 100) {
                    const attacker = Game.getObjectById((event.data as any).attackerId) as Creep | null
                    sendMessage(`⚔️ [ATTACK] ${roomName} 被 ${attacker?.owner?.username || 'unknown'} 攻击!`, 'all')
                    mem.lastAlert[targetId] = Game.time
                }
            }
        } catch { /* 静默 */ }
    }
}

// ==================== 主循环 ====================

export function checkDDMessages(): void {
    if (lastCheckTick === Game.time) { flushMessages(); return }
    lastCheckTick = Game.time

    if (Game.cpu.bucket < 500) return
    if (processedMessages.size > 5000) processedMessages.clear()

    processForeignSegment()
    cleanupExpiredRequests()
    checkAttackEvents()
    flushMessages()

    // 🔥 关键：每个 tick 都要设置 segment 为公开
    RawMemory.setPublicSegments([DD_SEGMENT_ID])
    RawMemory.setActiveSegments([DD_SEGMENT_ID, DD_HISTORY_SEGMENT_ID])
}

export function mountDD(): void {
    if (typeof Structure !== 'undefined') Structure.prototype.notifyWhenAttacked = ddNotifyWhenAttacked as any
    if (typeof Creep !== 'undefined') Creep.prototype.notifyWhenAttacked = ddNotifyWhenAttacked as any
    console.log('[DD] 攻击通知原型已挂载')
}

// ==================== 导出工具 ====================

export const ddTools = {
    // ==================== 消息 ====================

    send(msg: string, to?: string): string {
        sendMessage(msg, to)
        return `[DD] 已发送${to ? ` -> ${to}` : ''}`
    },

    history(count: number = 20): string {
        const h = loadHistory()
        if (!h.length) return '[DD] 暂无历史'
        return `[DD] 最近 ${Math.min(count, h.length)} 条:\n` + h.slice(-count).map(m => `[${m.time}] ${m.from}: ${m.msg}`).join('\n')
    },

    // ==================== 战争指令（需要确认）====================

    defend(roomName: string, targetPlayer: string, attacker?: string): string {
        if (!roomName) return '❌ 需要指定房间名'
        if (!targetPlayer) return '❌ 需要指定目标玩家'

        const mem = getDDMemory()
        if (!mem.commList?.includes(targetPlayer)) return `❌ ${targetPlayer} 不在通讯名单中`

        const requestId = generateRequestId()
        const expireTick = Game.time + REQUEST_TIMEOUT

        sentRequests.set(requestId, { id: requestId, type: 'defend', to: targetPlayer, roomName, expireTick, status: 'pending' })
        sendMessage(`🛡️ [DEFEND] 请求防守: ${roomName}${attacker ? ` (攻击者: ${attacker})` : ''}`, targetPlayer, 'request', { requestId, type: 'defend', roomName, attacker, expireTick })

        return `[DD] 已发送防守请求 -> ${targetPlayer} (${requestId}, ${REQUEST_TIMEOUT} tick)`
    },

    attack(roomName: string, targetPlayer: string): string {
        if (!roomName) return '❌ 需要指定房间名'
        if (!targetPlayer) return '❌ 需要指定目标玩家'

        const mem = getDDMemory()
        if (!mem.commList?.includes(targetPlayer)) return `❌ ${targetPlayer} 不在通讯名单中`

        const requestId = generateRequestId()
        const expireTick = Game.time + REQUEST_TIMEOUT

        sentRequests.set(requestId, { id: requestId, type: 'attack', to: targetPlayer, roomName, expireTick, status: 'pending' })
        sendMessage(`⚔️ [ATTACK] 请求进攻: ${roomName}`, targetPlayer, 'request', { requestId, type: 'attack', roomName, expireTick })

        return `[DD] 已发送进攻请求 -> ${targetPlayer} (${requestId}, ${REQUEST_TIMEOUT} tick)`
    },

    // ==================== 资源指令（不需要确认）====================

    energy(roomName: string, targetPlayer: string, amount?: number): string {
        if (!roomName) return '❌ 需要指定房间名'
        if (!targetPlayer) return '❌ 需要指定目标玩家'

        sendMessage(`⚡ [ENERGY] 请求能量支援: ${roomName}${amount ? ` (${amount})` : ''}`, targetPlayer)
        return `[DD] 已发送能量请求 -> ${targetPlayer}`
    },

    resource(resourceType: string, roomName: string, targetPlayer: string, amount?: number): string {
        if (!resourceType) return '❌ 需要指定资源类型'
        if (!roomName) return '❌ 需要指定房间名'
        if (!targetPlayer) return '❌ 需要指定目标玩家'

        sendMessage(`📦 [RESOURCE] 请求 ${resourceType} 支援: ${roomName}${amount ? ` (${amount})` : ''}`, targetPlayer)
        return `[DD] 已发送资源请求 -> ${targetPlayer}`
    },

    // ==================== 请求管理 ====================

    pending(): string {
        if (!pendingRequests.size) return '[DD] 暂无待处理请求'

        const lines = ['[DD] 待处理请求:']
        for (const [id, r] of pendingRequests) {
            lines.push(`  📋 ${id} | ${r.type} | ${r.from} -> ${r.roomName}`)
            lines.push(`     剩余: ${r.expireTick - Game.time} tick | 最近房间: ${r.nearestRoom || '无'} (${r.distance === Infinity ? '∞' : r.distance})`)
        }
        return lines.join('\n')
    },

    sent(): string {
        if (!sentRequests.size) return '[DD] 暂无已发送请求'

        const emoji = { pending: '⏳', accepted: '✅', rejected: '❌', expired: '⏰' }
        const lines = ['[DD] 已发送请求:']
        for (const [id, r] of sentRequests) {
            lines.push(`  ${emoji[r.status]} ${id} -> ${r.to} (${r.type}: ${r.roomName}) [${r.status}]`)
        }
        return lines.join('\n')
    },

    accept(requestId: string): string {
        const req = pendingRequests.get(requestId)
        if (!req) return `❌ 未找到请求 ${requestId}`
        if (Game.time > req.expireTick) {
            pendingRequests.delete(requestId)
            return `❌ 请求 ${requestId} 已过期`
        }
        if (!req.nearestRoom) return `❌ 没有可用房间`

        // 发送响应
        sendMessage(`✅ [ACCEPTED] ${requestId}，从 ${req.nearestRoom} 出兵`, req.from, 'response', { requestId, accepted: true, fromRoom: req.nearestRoom })

        // 根据类型执行对应逻辑
        if (req.type === 'defend') {
            onDefendAccepted(req.nearestRoom, req.roomName, req.from, req.attacker)
        } else if (req.type === 'attack') {
            onAttackAccepted(req.nearestRoom, req.roomName, req.from)
        }

        pendingRequests.delete(requestId)
        return `[DD] ✅ 已接受 ${requestId}，${req.nearestRoom} -> ${req.roomName} (${req.type})`
    },

    reject(requestId: string, reason?: string): string {
        const req = pendingRequests.get(requestId)
        if (!req) return `❌ 未找到请求 ${requestId}`

        sendMessage(`❌ [REJECTED] ${requestId}${reason ? `: ${reason}` : ''}`, req.from, 'response', { requestId, accepted: false, reason })
        pendingRequests.delete(requestId)
        return `[DD] ❌ 已拒绝 ${requestId}`
    },


    // ==================== 通讯名单 ====================

    add(username: string): string {
        const mem = getDDMemory()
        if (!mem.commList) mem.commList = []
        if (mem.commList.includes(username)) return `[DD] ${username} 已在列表中`
        mem.commList.push(username)
        sendMessage(`👋 你好, ${username}!`, username)
        return `[DD] 已添加 ${username}`
    },

    remove(username: string): string {
        const mem = getDDMemory()
        if (!mem.commList) mem.commList = []
        const i = mem.commList.indexOf(username)
        if (i === -1) return `[DD] ${username} 不在列表中`
        mem.commList.splice(i, 1)
        return `[DD] 已移除 ${username}`
    },

    list(): string {
        const list = getDDMemory().commList || []
        if (!list.length) return '[DD] 通讯名单为空'
        return `[DD] 通讯名单 (${list.length}):\n` + list.map(u => `  - ${u}`).join('\n')
    },

    has(username: string): boolean {
        return (getDDMemory().commList || []).includes(username)
    },

    // ==================== 攻击通知 ====================

    enableAttackNotify(): string {
        getDDMemory().attackNotify = true
        return '[DD] 已开启攻击通知'
    },

    disableAttackNotify(): string {
        getDDMemory().attackNotify = false
        return '[DD] 已关闭攻击通知'
    },

    // ==================== 帮助 ====================

    help(): string {
        return `
[DD v4.4]

[战争指令] (需要确认，100 tick 有效)
  dd.defend('room', 'player', 'attacker?')
  dd.attack('room', 'player')

[资源指令] (不需要确认，直接执行)
  dd.energy('room', 'player', amount?)
  dd.resource('type', 'room', 'player', amount?)

[请求管理]
  dd.pending()              查看待处理
  dd.sent()                 查看已发送
  dd.accept('reqId')        接受
  dd.reject('reqId')        拒绝

[通讯]
  dd.send('msg', 'to?')     发送消息
  dd.add/remove/list()      名单管理

[攻击通知]
  dd.enableAttackNotify()
  structure.notifyWhenAttacked(true)
`.trim()
    }
}

// ==================== 类型声明 ====================

declare global {
    interface Memory {
        dd?: DDMemory
    }
}
