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
const DEFAULT_KEY = 'dDomination'
const POLL_INTERVAL = 3 // 每 3 tick 请求一次
const HISTORY_RETENTION = 1000 // 历史记录保留 1000 tick

// 消息接口
interface DDMessage {
    from: string        // 发送者用户名
    msg: string         // 消息内容
    time: number        // 游戏时间戳
    to?: string // 指定接收人
}

// 内存扩展
// 内存扩展
interface DDMemory {
    lastSendTick?: number
    nextIndex?: number
    watchedIds?: string[]
    lastAlert?: Record<string, number>
    username?: string // 缓存自己的名字
    secretKey?: string // 私有通讯密钥
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
    if (Memory.dd && Memory.dd.secretKey) return Memory.dd.secretKey
    return DEFAULT_KEY
}

// 简单的 XOR 加密/解密
function xorCipher(text: string, key: string): string {
    let result = ''
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length))
    }
    return result
}

// 这里的 XOR 产生的是 binary string，直接 Base64 可能会有问题，
// 我们简单点，直接把 charCode 转 hex string，虽然体积大一倍但绝对安全且兼容
function toHex(str: string): string {
    let hex = ''
    for (let i = 0; i < str.length; i++) {
        hex += ('000' + str.charCodeAt(i).toString(16)).slice(-4)
    }
    return hex
}

function fromHex(hex: string): string {
    let str = ''
    for (let i = 0; i < hex.length; i += 4) {
        str += String.fromCharCode(parseInt(hex.substr(i, 4), 16))
    }
    return str
}

/**
 * 加密 (指定 Key，默认使用首选 Key)
 */
function encrypt(text: string, key?: string): string {
    try {
        const k = key || getCipherKey()
        const xored = xorCipher(text, k)
        return toHex(xored)
    } catch (e) {
        return ''
    }
}

/**
 * 解密 (指定 Key，默认使用首选 Key)
 */
function decrypt(text: string, key?: string): string {
    try {
        if (!/^[0-9a-fA-F]+$/.test(text) || text.length % 4 !== 0) return text
        const xored = fromHex(text)
        return xorCipher(xored, key || getCipherKey())
    } catch (e) {
        return text
    }
}

// ... (whitelist etc)

// ... (mountDD etc)

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
        // 1. 构造消息
        const msg: DDMessage = {
            from: 'me',
            msg: message,
            time: Game.time
        }
        if (to && to !== 'all') msg.to = to

        // 2. 决定密钥
        const key = getCipherKey()
        const encryptedData = encrypt(JSON.stringify(msg), key)

        // 3. 入队
        currentTickBuffer.push(encryptedData)

        // 4. 更新发送时间
        getDDMemory().lastSendTick = Game.time

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

/**
 * 尝试解密单条数据 (尝试所有可用 Keys)
 */
function tryDecryptAndParse(encrypted: string): DDMessage | null {
    const keysToTry = [DEFAULT_KEY]
    if (Memory.dd && Memory.dd.secretKey && Memory.dd.secretKey !== DEFAULT_KEY) {
        keysToTry.unshift(Memory.dd.secretKey) // 优先尝试私钥
    }

    for (const key of keysToTry) {
        try {
            const temp = decrypt(encrypted, key)
            const msg = JSON.parse(temp)
            // 验证格式
            if (msg && msg.msg && msg.time && msg.from) return msg
        } catch (e) { }
    }

    // 尝试明文 (旧兼容/未加密)
    try {
        const msg = JSON.parse(encrypted)
        if (msg && msg.msg) return msg
    } catch (e) { }

    return null
}

/**
 * 处理接收到的外部 segment 数据 (支持数组)
 */
function processForeignSegment(): void {
    if (!RawMemory.foreignSegment) return
    const username = RawMemory.foreignSegment.username
    const rawData = RawMemory.foreignSegment.data

    if (!isWhitelisted(username)) return
    if (!rawData) return

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
        const msg = tryDecryptAndParse(encryptedItem)

        if (msg) {
            // 隐私检查
            if (msg.to && msg.to !== 'all') {
                const myName = getMyUsername()
                if (myName && msg.to !== myName) continue // 忽略他人的私信
            }

            const msgId = `${username}_${msg.time}_${msg.msg}`
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

const originalFind = Room.prototype.find
const originalLookForAt = Room.prototype.lookForAt
const originalLookForAtArea = Room.prototype.lookForAtArea

// 备份原始 notifyWhenAttacked
const originalStructureNotify = Structure.prototype.notifyWhenAttacked
const originalCreepNotify = Creep.prototype.notifyWhenAttacked
const originalPowerCreepNotify = PowerCreep.prototype.notifyWhenAttacked

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
        if (!key || key === DEFAULT_KEY) {
            delete mem.secretKey
            return `[DD] 已恢复默认密钥 (${DEFAULT_KEY})`
        }
        mem.secretKey = key
        return `[DD] 已设置私有密钥: ${key} (请确保盟友也使用了相同的 Key)`
    },

    getKey(): string {
        const mem = getDDMemory()
        return `[DD] 当前密钥: ${mem.secretKey || DEFAULT_KEY} (${mem.secretKey ? '私有' : '默认'})`
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
[DD 系统 2.0]
  dd.add('user', true)  添加好友+开启通讯 (自动问候)
  dd.add('user', false) 添加好友+关闭通讯
  dd.remove('user')     移除好友
  dd.list()             查看列表
  dd.exec('code')       执行指令 (如 war, greet)
  dd.setKey('key')      设置私有密钥
  dd.getKey()           查看当前密钥
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
