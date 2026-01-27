/**
 * DD (Definite Domination) 交流系统
 *
 * 功能：
 * 1. 基于 Memory Segments 的玩家间通讯
 * 2. 使用白名单控制通讯权限（只监听标记为 true 的玩家）
 * 3. 自动检测并在 console 输出新消息
 *
 * 使用方法：
 * - dd.send('Hello world!') - 发送消息到公共频道
 * - dd.list() - 查看所有监听的玩家
 * - dd.history() - 查看最近的消息历史
 * 
 * 这是一个集成了 "白名单管理" 和 "安全通讯" 的一体化模块。
 * 旨在让 Screeps 玩家能够方便地建立友盟，并进行安全的加密通讯。
 * 
 * ## 主要功能
 * 1. **白名单管理**: 自动重写 Room.find 等原生方法，自动识别友军，防止误伤。
 * 2. **安全通讯**: 默认使用 XOR+Hex 加密，无感收发消息。
 * 3. **私有历史**: 消息记录不占用 Memory，存储于 Private Segment 99。
 * 4. **CPU 优化**: 智能低功耗轮询，不占用正常逻辑 CPU。
 * 
 * ## 导出接口 (Exports)
 * - `mountDD()`: [初始化] 挂载原型重写。必须在全局重置时运行一次。
 * - `checkDDMessages()`: [主循环] 消息轮询与处理。必须在 loop 中每个 tick 运行。
 * - `ddTools`: [控制台] 供玩家手动操作的 API 对象 (add, send, list 等)。
 * 
 * ## 快速安装 (Installation)
 * 
 * // 1. 在 main.ts 或 mount 入口文件引入
 * import { mountDD, checkDDMessages, ddTools } from './dd'
 * 
 * // 2. 在全局通过 mount 调用 (仅需一次)
 * mountDD()
 * 
 * // 3. 挂载控制台命令 (可选，方便手操)
 * global.dd = ddTools
 * 
 * // 4. 在 loop 循环中调用 (每 tick)
 * export const loop = function() {
 *     checkDDMessages()
 *     // ... 你的其他代码
 * }
 * 
 * // 5. 注册自定义指令 (高级用法)
 * ddTools.register('attack', (roomName) => {
 *     ddTools.send(`[ATTACK] 进攻 ${roomName}!`, 'all')
 * })
 * // 使用: dd.exec('attack', 'W1N1')
 * 
 */

// DD 系统使用的 segment ID
const DD_SEGMENT_ID = 98
const DD_HISTORY_SEGMENT_ID = 99
const POLL_INTERVAL = 3 // 每 3 tick 请求一次
const HISTORY_RETENTION = 1000 // 历史记录保留 1000 tick
const DEFAULT_SECRET_KEY = 'dd3_default_secret_key_change_me_32'

// 消息接口
interface DDMessage {
    from: string        // 发送者用户名
    msg: string         // 消息内容
    time: number        // 游戏时间戳
    to?: string // 指定接收人
    id: string // 消息唯一标识
}

interface DDMemory {
    lastSendTick?: number
    nextIndex?: number
    watchedIds?: string[]
    lastAlert?: Record<string, number>
    username?: string // 缓存自己的名字
    secretKey?: string // 私有通讯密钥（3.0 起必须设置，否则不收发通讯）
    seq?: number // 本地发送自增序列（用于生成更稳定的消息 id）
    keyWarned?: boolean // 是否提示过默认密钥风险
}

// ==================== Global Cache & Buffer ====================
let messageHistoryCache: DDMessage[] | null = null
let lastCheckTick = -1
const processedMessages = new Set<string>()

// 消息发送缓冲区 (本 tick 产生的所有加密消息片段)
let currentTickBuffer: string[] = []

// Whitelist 缓存
let whitelistSet: Set<string> | null = null
let whitelistMap: Record<string, boolean> | null = null

// Command Registry
type CommandAction = (arg?: any) => void
const commandRegistry: Record<string, CommandAction> = {}

// ==================== Command System ====================

/**
 * 注册默认指令
 */
function initCommands() {
    // 注册基础指令
    if (!commandRegistry['war']) {
        commandRegistry['war'] = () => {
            sendMessage(`[WAR] 请求支援! ${Game.shard.name}/${Object.keys(Game.rooms)[0]}`, 'all')
            console.log('[DD] 已发送支援请求')
        }
    }
    if (!commandRegistry['greet']) {
        commandRegistry['greet'] = (target: string) => {
            if (target) {
                sendMessage(`👋 很高兴见到你, ${target}!`, target)
                console.log(`[DD] 已向 ${target} 发送问候`)
            } else {
                sendMessage(`👋 大家好!`, 'all')
            }
        }
    }
    // 示例: Echo 指令 (用于测试)
    if (!commandRegistry['echo']) {
        commandRegistry['echo'] = (content: any) => {
            const msg = `Echo: ${content || 'Ping'}`
            console.log(`[DD] 执行 Echo 指令: ${msg}`)
            sendMessage(msg) // 也会发到公共频道
        }
    }
}

// ==================== 加密/解密 ====================

function getCipherKey(): string {
    const mem = getDDMemory()
    const key = mem.secretKey
    if (key === '') return ''
    if (key) return key
    if (!mem.secretKey) {
        mem.secretKey = DEFAULT_SECRET_KEY
        if (!mem.keyWarned) {
            mem.keyWarned = true
            console.log('[DD] 已自动设置默认密钥。建议使用 dd.genKey() 生成新密钥并同步给盟友。')
        }
        return mem.secretKey
    }
    return ''
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

function generateSecretKey(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    let out = ''
    let x = ((Math.random() * 0xffffffff) >>> 0) ^ Game.time
    for (let i = 0; i < length; i++) {
        x ^= (x << 13) >>> 0
        x ^= (x >>> 17) >>> 0
        x ^= (x << 5) >>> 0
        const idx = x % chars.length
        out += chars[idx]
    }
    return out
}

function utf8Encode(str: string): Uint8Array {
    const bytes: number[] = []
    for (let i = 0; i < str.length; i++) {
        let codePoint = str.charCodeAt(i)
        if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < str.length) {
            const next = str.charCodeAt(i + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
                codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00)
                i++
            }
        }
        if (codePoint <= 0x7f) {
            bytes.push(codePoint)
        } else if (codePoint <= 0x7ff) {
            bytes.push(0xc0 | (codePoint >> 6))
            bytes.push(0x80 | (codePoint & 0x3f))
        } else if (codePoint <= 0xffff) {
            bytes.push(0xe0 | (codePoint >> 12))
            bytes.push(0x80 | ((codePoint >> 6) & 0x3f))
            bytes.push(0x80 | (codePoint & 0x3f))
        } else {
            bytes.push(0xf0 | (codePoint >> 18))
            bytes.push(0x80 | ((codePoint >> 12) & 0x3f))
            bytes.push(0x80 | ((codePoint >> 6) & 0x3f))
            bytes.push(0x80 | (codePoint & 0x3f))
        }
    }
    return new Uint8Array(bytes)
}

function utf8Decode(bytes: Uint8Array): string {
    let out = ''
    for (let i = 0; i < bytes.length; ) {
        const b0 = bytes[i++]
        if (b0 < 0x80) {
            out += String.fromCharCode(b0)
            continue
        }
        if ((b0 & 0xe0) === 0xc0) {
            const b1 = bytes[i++] & 0x3f
            const cp = ((b0 & 0x1f) << 6) | b1
            out += String.fromCharCode(cp)
            continue
        }
        if ((b0 & 0xf0) === 0xe0) {
            const b1 = bytes[i++] & 0x3f
            const b2 = bytes[i++] & 0x3f
            const cp = ((b0 & 0x0f) << 12) | (b1 << 6) | b2
            out += String.fromCharCode(cp)
            continue
        }
        const b1 = bytes[i++] & 0x3f
        const b2 = bytes[i++] & 0x3f
        const b3 = bytes[i++] & 0x3f
        let cp = ((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3
        cp -= 0x10000
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    }
    return out
}

function base64Encode(bytes: Uint8Array): string {
    let out = ''
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i]
        const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
        const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
        const n = (b0 << 16) | (b1 << 8) | b2
        out += BASE64_ALPHABET[(n >> 18) & 63]
        out += BASE64_ALPHABET[(n >> 12) & 63]
        out += i + 1 < bytes.length ? BASE64_ALPHABET[(n >> 6) & 63] : '='
        out += i + 2 < bytes.length ? BASE64_ALPHABET[n & 63] : '='
    }
    return out
}

function base64Decode(input: string): Uint8Array {
    const clean = input.replace(/[^A-Za-z0-9+/=]/g, '')
    const bytes: number[] = []
    for (let i = 0; i < clean.length; i += 4) {
        const c0 = clean[i]
        const c1 = clean[i + 1]
        const c2 = clean[i + 2]
        const c3 = clean[i + 3]
        if (!c0 || !c1) break
        const n0 = BASE64_LOOKUP[c0.charCodeAt(0)]
        const n1 = BASE64_LOOKUP[c1.charCodeAt(0)]
        if (n0 < 0 || n1 < 0) break
        const n2 = c2 === '=' ? 0 : BASE64_LOOKUP[c2.charCodeAt(0)]
        const n3 = c3 === '=' ? 0 : BASE64_LOOKUP[c3.charCodeAt(0)]
        if (n2 < 0 || n3 < 0) break
        const n = (n0 << 18) | (n1 << 12) | (n2 << 6) | n3
        bytes.push((n >> 16) & 0xff)
        if (c2 !== '=') bytes.push((n >> 8) & 0xff)
        if (c3 !== '=') bytes.push(n & 0xff)
    }
    return new Uint8Array(bytes)
}

const DD_V4_PREFIX = 'DD4:'

function readU32LE(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >>> 8) & 0xff
    bytes[offset + 2] = (value >>> 16) & 0xff
    bytes[offset + 3] = (value >>> 24) & 0xff
}

function readU16LE(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0
}

function writeU16LE(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >>> 8) & 0xff
}

function fnv1a32(str: string): number {
    let hash = 2166136261 >>> 0
    const bytes = utf8Encode(str)
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i]
        hash = Math.imul(hash, 16777619) >>> 0
    }
    return hash >>> 0
}

function splitmix32(seed: number): number {
    let z = (seed + 0x9e3779b9) >>> 0
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
    return (z ^ (z >>> 16)) >>> 0
}

function xorshift32(x: number): number {
    x >>>= 0
    x ^= (x << 13) >>> 0
    x ^= (x >>> 17) >>> 0
    x ^= (x << 5) >>> 0
    return x >>> 0
}

let crc32Table: Uint32Array | null = null
function getCrc32Table(): Uint32Array {
    if (crc32Table) return crc32Table
    const table = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
        let c = i
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
        }
        table[i] = c >>> 0
    }
    crc32Table = table
    return table
}

function crc32(bytes: Uint8Array, offset: number = 0, length: number = bytes.length - offset): number {
    const table = getCrc32Table()
    let crc = 0xffffffff >>> 0
    const end = offset + length
    for (let i = offset; i < end; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff]
    }
    return (crc ^ 0xffffffff) >>> 0
}

export type DD4LiteEncodeOptions = {
    secretKey: string
    nonceSeed: number
    time: number
    seq: number
    to?: string | 'all'
    enableCrc?: boolean
}

export type DD4LiteDecoded = {
    time: number
    seq: number
    to?: string
    msg: string
}

export function encodeDD4Lite(message: string, opts: DD4LiteEncodeOptions): string {
    const enableCrc = opts.enableCrc !== false
    const to = opts.to && opts.to !== 'all' ? opts.to : undefined
    const toBytes = to ? utf8Encode(to) : null
    const msgBytes = utf8Encode(message)
    const toLen = toBytes ? Math.min(31, toBytes.length) : 0
    const msgLen = Math.min(1000, msgBytes.length)

    const headerLen = 15
    const cipherLen = toLen + msgLen
    const totalLen = headerLen + cipherLen + (enableCrc ? 4 : 0)
    const out = new Uint8Array(totalLen)

    const flags = toLen > 0 ? 1 : 0
    const time = opts.time >>> 0
    const seq = (opts.seq & 0xffff) >>> 0
    const nonce = splitmix32((opts.nonceSeed ^ time ^ seq) >>> 0)

    out[0] = 4
    out[1] = flags
    writeU32LE(out, 2, time)
    writeU16LE(out, 6, seq)
    out[8] = toLen
    writeU16LE(out, 9, msgLen)
    writeU32LE(out, 11, nonce)

    let state = (fnv1a32(opts.secretKey) ^ nonce ^ time ^ ((seq << 16) >>> 0)) >>> 0
    state = (state | 1) >>> 0

    let cipherOff = headerLen
    for (let i = 0; i < cipherLen; i++) {
        if ((i & 3) === 0) state = xorshift32(state)
        const keyByte = (state >>> (8 * (i & 3))) & 0xff
        let plainByte: number
        if (i < toLen) plainByte = (toBytes as Uint8Array)[i]
        else plainByte = msgBytes[i - toLen]
        out[cipherOff + i] = plainByte ^ keyByte
    }

    if (enableCrc) {
        const c = crc32(out, 0, headerLen + cipherLen)
        writeU32LE(out, headerLen + cipherLen, c)
    }

    return `${DD_V4_PREFIX}${base64Encode(out)}`
}

export function decodeDD4Lite(encrypted: string, opts: { secretKey: string; now: number; enableCrc?: boolean }): DD4LiteDecoded | null {
    if (!encrypted.startsWith(DD_V4_PREFIX)) return null
    const body = encrypted.slice(DD_V4_PREFIX.length)
    let bytes: Uint8Array
    try {
        bytes = base64Decode(body)
    } catch {
        return null
    }

    const headerLen = 15
    if (bytes.length < headerLen) return null
    if (bytes[0] !== 4) return null

    const flags = bytes[1] >>> 0
    const time = readU32LE(bytes, 2)
    const seq = readU16LE(bytes, 6) & 0xffff
    const toLen = bytes[8] >>> 0
    const msgLen = readU16LE(bytes, 9) >>> 0
    const nonce = readU32LE(bytes, 11)

    if (toLen > 31) return null
    if (msgLen > 1000) return null
    if ((flags & 1) === 0 && toLen !== 0) return null

    const cipherLen = toLen + msgLen
    const withCrcLen = headerLen + cipherLen + 4
    const withoutCrcLen = headerLen + cipherLen
    const hasCrc = bytes.length === withCrcLen
    if (bytes.length !== withCrcLen && bytes.length !== withoutCrcLen) return null

    const enableCrc = opts.enableCrc !== false
    if (enableCrc && hasCrc) {
        const expected = readU32LE(bytes, headerLen + cipherLen)
        const actual = crc32(bytes, 0, headerLen + cipherLen)
        if (expected !== actual) return null
    }

    let state = (fnv1a32(opts.secretKey) ^ nonce ^ time ^ (((seq & 0xffff) << 16) >>> 0)) >>> 0
    state = (state | 1) >>> 0

    const plain = new Uint8Array(cipherLen)
    const cipherOff = headerLen
    for (let i = 0; i < cipherLen; i++) {
        if ((i & 3) === 0) state = xorshift32(state)
        const keyByte = (state >>> (8 * (i & 3))) & 0xff
        plain[i] = bytes[cipherOff + i] ^ keyByte
    }

    const toBytes = toLen ? plain.subarray(0, toLen) : null
    const msgBytes2 = plain.subarray(toLen, toLen + msgLen)
    const to = toBytes && toBytes.length ? utf8Decode(toBytes) : undefined
    const msg = utf8Decode(msgBytes2)

    return { time, seq, to, msg }
}

function getMyUsername(): string | undefined {
    // 优先从 Memory 读取
    if (Memory.dd && Memory.dd.username) return Memory.dd.username

    // 尝试获取
    const spawn = Object.values(Game.spawns)[0]
    if (spawn && spawn.owner) {
        if (!Memory.dd) Memory.dd = {}
        Memory.dd.username = spawn.owner.username
        return Memory.dd.username
    }

    const creep = Object.values(Game.creeps)[0]
    if (creep && creep.owner) {
        if (!Memory.dd) Memory.dd = {}
        Memory.dd.username = creep.owner.username
        return Memory.dd.username
    }

    return undefined
}

// ==================== Communication Core ====================

/**
 * 发送消息 (入队)
 * 支持多消息混发 (Broadcast + Private)
 */
function sendMessage(message: string, to?: string): string {
    try {
        const mem = getDDMemory()
        mem.seq = (mem.seq || 0) + 1
        const key = getCipherKey()
        if (!key) return '[DD] 发送失败: 未设置密钥'

        const seed = ((Math.random() * 0xffffffff) >>> 0) ^ Game.time ^ mem.seq
        const encryptedData = encodeDD4Lite(message, {
            secretKey: key,
            nonceSeed: seed,
            time: Game.time,
            seq: mem.seq,
            to,
            enableCrc: true
        })

        // 3. 入队
        currentTickBuffer.push(encryptedData)

        // 4. 更新发送时间
        mem.lastSendTick = Game.time

        return `[DD] 消息已入队${(to && to !== 'all') ? ' -> ' + to : ''}: "${message}"`
    } catch (e) {
        return `[DD] 发送失败: ${e}`
    }
}

/**
 * 将队列中的消息写入 RawMemory (Tick End)
 */
function flushMessages(): void {
    if (currentTickBuffer.length === 0) return

    // 获取旧数据 (如果是 Array)
    let existing: string[] = []
    try {
        const raw = RawMemory.segments[DD_SEGMENT_ID]
        if (raw) existing = JSON.parse(raw)
        if (!Array.isArray(existing)) existing = []
    } catch (e) { }

    // 合并 (限制最大长度防止溢出)
    const combined = existing.concat(currentTickBuffer)
    if (combined.length > 20) combined.splice(0, combined.length - 20) // 只保留最近 20 条

    RawMemory.setPublicSegments([DD_SEGMENT_ID])
    RawMemory.segments[DD_SEGMENT_ID] = JSON.stringify(combined)

    currentTickBuffer = []
}

function tryDecodeForeignMessage(encrypted: string, foreignUsername: string): DDMessage | null {
    const key = getCipherKey()
    if (!key) return null
    const decoded = decodeDD4Lite(encrypted, { secretKey: key, now: Game.time })
    if (!decoded) return null
    if (decoded.time < Game.time - HISTORY_RETENTION) return null
    if (decoded.to && decoded.to !== 'all') {
        const myName = getMyUsername()
        if (myName && decoded.to !== myName) return null
    }
    const id = `${decoded.time}_${decoded.seq.toString(36)}`
    return {
        id,
        from: foreignUsername,
        msg: decoded.msg,
        time: decoded.time,
        to: decoded.to
    }
}

/**
 * 处理接收到的外部 segment 数据 (支持数组)
 */
function processForeignSegment(): void {
    if (!RawMemory.foreignSegment) return
    const username = RawMemory.foreignSegment.username
    const rawData = RawMemory.foreignSegment.data

    if (!isCommEnabled(username)) return
    if (!rawData) return
    if (!getCipherKey()) return

    let messages: string[] = []

    // 1. 尝试解析为数组 (多消息格式)
    try {
        const arr = JSON.parse(rawData)
        if (Array.isArray(arr)) {
            messages = arr
        } else {
            messages = [rawData] // 单消息兼容
        }
    } catch (e) {
        messages = [rawData] // 可能是加过密的纯字符串
    }

    // 2. 遍历处理
    for (const encryptedItem of messages) {
        const msg = tryDecodeForeignMessage(encryptedItem, username)

        if (msg) {
            // 隐私检查
            if (msg.to && msg.to !== 'all') {
                const myName = getMyUsername()
                if (myName && msg.to !== myName) continue // 忽略他人的私信
            }

            const msgId = `${username}_${msg.id}`
            if (processedMessages.has(msgId)) continue
            processedMessages.add(msgId)

            msg.from = username // 确保来源正确
            const history = loadHistory()
            history.push(msg)
            saveHistory(history)
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📨 [DD] 新消息来自 ${username}${(msg.to && msg.to !== 'all') ? ' (私信)' : ''}\n⏰ 时间: ${msg.time}\n💬 内容: ${msg.msg}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
        }
    }
}



// ==================== Whitelist Memory 管理 ====================

function initWhitelistMemory() {
    // 迁移：如果还是旧的数组，转为对象
    if (Array.isArray(Memory.DD_Whitelist)) {
        const oldList = Memory.DD_Whitelist as string[]
        const newObj: Record<string, boolean> = {}
        oldList.forEach(name => {
            newObj[name] = true // 默认旧的都开启通讯
        })
        Memory.DD_Whitelist = newObj as any
        console.log('[DD] 已将 whitelist 迁移为对象格式')
    }

    if (!Memory.DD_Whitelist) {
        Memory.DD_Whitelist = {}
    }
}

function getWhitelist(): Record<string, boolean> {
    if (!whitelistMap) {
        initWhitelistMemory()
        whitelistMap = Memory.DD_Whitelist || {}
    }
    return whitelistMap
}

function saveWhitelist(map: Record<string, boolean>) {
    Memory.DD_Whitelist = map
    whitelistMap = map
    whitelistSet = new Set(Object.keys(map))
}

/**
 * 是否在白名单中 (Friend Check)
 */
function isWhitelisted(username: string): boolean {
    if (!whitelistSet) {
        const map = getWhitelist()
        whitelistSet = new Set(Object.keys(map))
    }
    return whitelistSet.has(username)
}

/**
 * 是否允许通讯 (Communication Check)
 */
function isCommEnabled(username: string): boolean {
    const map = getWhitelist()
    return map[username] === true
}

// ==================== Prototype 重写 (Friend/Hostile & Notify) ====================

const originalFind = (typeof Room !== 'undefined' ? Room.prototype.find : undefined) as any
const originalLookForAt = (typeof Room !== 'undefined' ? Room.prototype.lookForAt : undefined) as any
const originalLookForAtArea = (typeof Room !== 'undefined' ? Room.prototype.lookForAtArea : undefined) as any

// 备份原始 notifyWhenAttacked
const originalStructureNotify = (typeof Structure !== 'undefined' ? Structure.prototype.notifyWhenAttacked : undefined) as any
const originalCreepNotify = (typeof Creep !== 'undefined' ? Creep.prototype.notifyWhenAttacked : undefined) as any
const originalPowerCreepNotify = (typeof PowerCreep !== 'undefined' ? PowerCreep.prototype.notifyWhenAttacked : undefined) as any

function updateWatchList(id: string, enabled: boolean) {
    if (!Memory.dd) Memory.dd = {}
    if (!Memory.dd.watchedIds) Memory.dd.watchedIds = []

    if (enabled) {
        if (!Memory.dd.watchedIds.includes(id)) Memory.dd.watchedIds.push(id)
    } else {
        Memory.dd.watchedIds = Memory.dd.watchedIds.filter(i => i !== id)
    }
}

// 通知包装器
function wrapNotify(original: any) {
    return function (this: RoomObject & { id: string }, enabled: boolean) {
        updateWatchList(this.id, enabled)
        if (original) return original.call(this, enabled)
        return OK
    }
}

function isFriend(obj: AnyOwnedStructure | Creep | PowerCreep): boolean {
    return obj.owner && isWhitelisted(obj.owner.username) && !obj.my
}

function isHostile(obj: AnyOwnedStructure | Creep | PowerCreep): boolean {
    return obj.owner && !isWhitelisted(obj.owner.username) && !obj.my
}

function filterWhitelist<T extends { owner?: { username: string } }>(objects: T[]): T[] {
    return objects.filter(obj => obj.owner && !isWhitelisted(obj.owner.username))
}

function filterAreaResult(result: any, asArray: boolean | undefined, filterFn: (obj: any) => boolean): any {
    if (asArray) {
        return (result as any[]).filter(item => {
            const creep = (item as any).creep
            return creep && filterFn(creep)
        })
    } else {
        const matrix = result
        for (const y in matrix) {
            for (const x in matrix[y]) {
                const items = matrix[y][x]
                if (items && items.length > 0) {
                    const filtered = items.filter(filterFn)
                    if (filtered.length === 0) delete matrix[y][x]
                    else matrix[y][x] = filtered
                }
            }
        }
        return matrix
    }
}

export function mountDD(): void {
    if (typeof Room === 'undefined') return
    // 预加载
    getWhitelist()

    // 1. Friend/Hostile Filters
    Room.prototype.find = function <K extends FindConstant>(type: K, opts?: FilterOptions<K>): FindTypes[K][] {
        let result = originalFind.call(this, type, opts) as any[]
        if (
            type === FIND_HOSTILE_CREEPS ||
            type === FIND_HOSTILE_CONSTRUCTION_SITES ||
            type === FIND_HOSTILE_POWER_CREEPS ||
            type === FIND_HOSTILE_SPAWNS ||
            type === FIND_HOSTILE_STRUCTURES
        ) {
            result = filterWhitelist(result)
        }
        return result as FindTypes[K][]
    }

    Room.prototype.lookForAt = function (type: any, x: any, y?: any): any {
        if (type === 'LOOK_FRIEND') {
            const result = originalLookForAt.call(this, LOOK_CREEPS, x, y) as Creep[]
            return result.filter(isFriend)
        } else if (type === 'LOOK_HOSTILE') {
            const result = originalLookForAt.call(this, LOOK_CREEPS, x, y) as Creep[]
            return result.filter(isHostile)
        } else {
            return originalLookForAt.call(this, type, x, y)
        }
    } as any

    Room.prototype.lookForAtArea = function (type: any, top: number, left: number, bottom: number, right: number, asArray?: boolean): any {
        if (type === 'LOOK_FRIEND') {
            const result = originalLookForAtArea.call(this, LOOK_CREEPS, top, left, bottom, right, asArray)
            return filterAreaResult(result, asArray, isFriend)
        } else if (type === 'LOOK_HOSTILE') {
            const result = originalLookForAtArea.call(this, LOOK_CREEPS, top, left, bottom, right, asArray)
            return filterAreaResult(result, asArray, isHostile)
        } else {
            return originalLookForAtArea.call(this, type, top, left, bottom, right, asArray)
        }
    } as any

    // 2. Notify Override
    Structure.prototype.notifyWhenAttacked = wrapNotify(originalStructureNotify)
    Creep.prototype.notifyWhenAttacked = wrapNotify(originalCreepNotify)
    PowerCreep.prototype.notifyWhenAttacked = wrapNotify(originalPowerCreepNotify)
}

// ==================== DD Logic ====================

/**
 * 获取/初始化 DD Memory
 */
function getDDMemory(): DDMemory {
    if (!Memory.dd) Memory.dd = {}
    return Memory.dd
}

/**
 * 清理过期历史记录
 * @param history 历史记录数组
 * @returns 清理后的数组
 */
function cleanExpiredHistory(history: DDMessage[]): DDMessage[] {
    const expireTime = Game.time - HISTORY_RETENTION
    // 过滤掉早于 expireTime 的消息
    return history.filter(msg => msg.time > expireTime)
}

/**
 * 加载历史记录 (从 Segment 99)
 */
function loadHistory(): DDMessage[] {
    if (messageHistoryCache) return messageHistoryCache
    try {
        const data = RawMemory.segments[DD_HISTORY_SEGMENT_ID]
        messageHistoryCache = data ? JSON.parse(data) : []
    } catch (e) {
        messageHistoryCache = []
    }
    // 确保类型安全
    if (!Array.isArray(messageHistoryCache)) messageHistoryCache = []
    return messageHistoryCache
}

/**
 * 保存历史记录 (到 Segment 99)
 */
function saveHistory(history: DDMessage[]) {
    // 1. 先清理过期
    history = cleanExpiredHistory(history)

    messageHistoryCache = history
    // 2. 限制最大长度 (放宽到 500 以容纳更多)
    if (history.length > 500) {
        history = history.slice(-500)
    }
    RawMemory.segments[DD_HISTORY_SEGMENT_ID] = JSON.stringify(history)
}




/**
 * 每个 tick 自动检查
 */
export function checkDDMessages(): void {
    initCommands() // 确保指令注册

    if (lastCheckTick === Game.time) {
        // 确保同一 tick 多次调用能 flush
        flushMessages()
        return
    }
    lastCheckTick = Game.time

    // 0. CPU 保护
    if (Game.cpu.bucket < 500) return

    // 0.1 运行期缓存保护：避免全局去重集合长期增长
    if (processedMessages.size > 5000) processedMessages.clear()

    // 1. 处理接收消息
    processForeignSegment()

    // 2. 检查攻击事件 (Simple)
    const ddMem = getDDMemory()
    if (ddMem.watchedIds && ddMem.watchedIds.length > 0) {
        const watched = new Set(ddMem.watchedIds)
        for (const roomName in Game.rooms) {
            const events = Game.rooms[roomName].getEventLog()
            for (const event of events) {
                // 仅检测物理攻击 EVENT_ATTACK (ID: 1)
                if (event.event === EVENT_ATTACK) {
                    const targetId = (event.data as any).targetId
                    if (watched.has(targetId)) {
                        if (!ddMem.lastAlert) ddMem.lastAlert = {}
                        const last = ddMem.lastAlert[targetId] || 0
                        if (Game.time - last > 100) {
                            // 触发报警 (Broadcast)
                            sendMessage(`[警报] ${roomName} 对象 ${targetId} 正在受到攻击!`, 'all')
                            ddMem.lastAlert[targetId] = Game.time
                        }
                    }
                }
            }
        }
    }

    // 3. 定期清理过期历史
    if (Game.time % 100 === 0) {
        const history = loadHistory()
        const cleaned = cleanExpiredHistory(history)
        if (cleaned.length < history.length) {
            saveHistory(cleaned)
        }
    }

    // 4. 发送队列 Flush & 清理
    flushMessages() // 必须在 tick 结束前写入

    // 清理逻辑: 10 tick 后清空 (覆盖掉)
    if (ddMem.lastSendTick && Game.time > ddMem.lastSendTick + 10) {
        RawMemory.segments[DD_SEGMENT_ID] = ''
        RawMemory.setPublicSegments([])
        delete ddMem.lastSendTick
    }

    // 5. 轮询监听
    if (Game.time % POLL_INTERVAL !== 0) return

    const map = getWhitelist()
    const activeListeners = Object.keys(map).filter(key => map[key] === true)

    if (activeListeners.length > 0) {
        let index = ddMem.nextIndex || 0
        if (index >= activeListeners.length) index = 0

        const username = activeListeners[index]
        try {
            RawMemory.setActiveForeignSegment(username, DD_SEGMENT_ID)
        } catch (e) { }

        ddMem.nextIndex = (index + 1) % activeListeners.length
    }
}

// ==================== Export Tools ====================

/**
 * DD 交流系统工具集
 */
export const ddTools = {
    // --- Communication ---
    send(message: string, to?: string): string {
        return sendMessage(message, to)
    },
    history(limit: number = 10): string {
        const h = loadHistory()
        return h.length === 0 ? '[DD] 暂无消息' : `[DD] 历史消息:\n` + h.slice(-limit).map(m => `  [${m.time}] ${m.from}: ${m.msg}`).join('\n')
    },
    clear(): string {
        saveHistory([])
        processedMessages.clear()
        return '[DD] 已清空消息'
    },

    // --- Command System ---
    exec(code: string, arg?: any): string {
        if (commandRegistry[code]) {
            commandRegistry[code](arg)
            return `[DD] 指令 '${code}' 已执行`
        }
        return `[DD] 未知指令 '${code}'`
    },

    register(code: string, action: CommandAction): string {
        commandRegistry[code] = action
        return `[DD] 指令 '${code}' 已注册/更新`
    },

    // --- Security ---
    setKey(key: string): string {
        const mem = getDDMemory()
        if (!key) {
            mem.secretKey = ''
            return `[DD] 已清除私有密钥（通讯已停用）`
        }
        mem.secretKey = key
        return `[DD] 已设置私有密钥 (长度: ${key.length})，请确保盟友也使用相同的 Key`
    },

    getKey(): string {
        const mem = getDDMemory()
        if (!mem.secretKey) return `[DD] 当前未设置私有密钥（通讯停用）`
        const tail = mem.secretKey.slice(-4)
        return `[DD] 当前密钥: ****${tail} (长度: ${mem.secretKey.length})`
    },

    genKey(length: number = 32): string {
        const mem = getDDMemory()
        const len = Math.max(8, Math.min(64, Math.floor(length || 32)))
        const key = generateSecretKey(len)
        mem.secretKey = key
        mem.keyWarned = true
        return `[DD] 已生成新私钥: ${key} (长度: ${len})，请同步给盟友`
    },

    // --- Whitelist Management ---
    has(username: string): boolean {
        return isWhitelisted(username)
    },

    add(username: string, allowComm: boolean = false): string {
        const map = getWhitelist()
        const oldState = map[username]

        map[username] = allowComm
        saveWhitelist(map)

        // 自动问候: 如果从未开启通讯变为开启，且设置了 greet 指令
        if (allowComm && oldState !== true) {
            ddTools.exec('greet', username)
            return `[DD] 已添加 ${username} (通讯: 开启) 并发送自动问候`
        }

        return `[DD] 已添加 ${username} (通讯: ${allowComm ? '开启' : '关闭'})`
    },

    remove(username: string): string {
        const map = getWhitelist()
        if (map[username] === undefined) return `[DD] ${username} 不在白名单中`
        delete map[username]
        saveWhitelist(map)
        return `[DD] 已移除 ${username}`
    },

    list(): string {
        const map = getWhitelist()
        const keys = Object.keys(map)
        if (keys.length === 0) return '[DD] 白名单为空'
        return `[DD] 白名单列表:\n` + keys.map(k => `  - ${k}: ${map[k] ? '✅ 通讯开启' : '❌ 仅好友'}`).join('\n')
    },

    help(): string {
        return `
[DD 系统 4.0]
  dd.add('user', true)  添加好友+开启通讯 (自动问候)
  dd.add('user', false) 添加好友+关闭通讯
  dd.remove('user')     移除好友
  dd.list()             查看列表
  dd.exec('code')       执行指令 (如 war, greet)
  dd.setKey('key')      设置私有密钥
  dd.setKey('')         清除私有密钥 (停用通讯)
  dd.getKey()           查看当前密钥(脱敏)
  dd.genKey(32)         生成新私钥并直接启用
  dd.send('msg', 'to?') 发送消息 (支持混发: all/User)
  dd.history()          查看历史
`.trim()
    }
}

declare global {
    interface Memory {
        DD_Whitelist?: Record<string, boolean>
        dd?: DDMemory
    }
}
