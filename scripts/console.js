// 连接 Screeps 控制台实时交互
// 登录数据与 submit 共用 .secret.json, 用法: pnpm console [服务器[@账号]]
import { select, confirm } from '@inquirer/prompts';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { getSecretPath, loadSecret, getServers, getServerAccounts, resolveTarget, matchName } from './secret.js';

const secret = loadSecret();
if (!secret) {
    console.error('配置文件未找到:', getSecretPath());
    process.exit(1);
}

const COLORS = {
    system: '\x1b[36m',   // cyan
    error: '\x1b[31m',    // red
    status: '\x1b[35m',   // magenta
    result: '\x1b[33m',   // yellow
    reset: '\x1b[0m'
};

const logConsole = (message) => console.log(`[console] ${message}`);

// HTTP 接口与 WebSocket 的基地址, 与 plugin-screeps.js 的 getEndpointLabel 保持同一约定
const getHttpBase = (config) => {
    const protocol = config.protocol || 'https';
    const hostname = config.hostname || 'screeps.com';
    const defaultPort = protocol === 'https' ? 443 : 80;
    const port = config.port && config.port !== defaultPort ? `:${config.port}` : '';
    const apiPath = (config.path || '/').replace(/\/+$/, '');
    return `${protocol}://${hostname}${port}${apiPath}`;
};

const getSocketBase = (config) => {
    const secure = (config.protocol || 'https') === 'https';
    const protocol = secure ? 'wss' : 'ws';
    const hostname = config.hostname || 'screeps.com';
    const defaultPort = secure ? 443 : 80;
    const port = config.port && config.port !== defaultPort ? `:${config.port}` : '';
    const apiPath = (config.path || '/').replace(/\/+$/, '');
    return `${protocol}://${hostname}${port}${apiPath}`;
};

const formatWithColor = (color, label, message) => `${color}[${label}]${COLORS.reset} ${message}`;

// ---- 控制台输出中的 HTML 渲染 ----
// Screeps 的 console.log/results 支持有限的 HTML 标记 (官网控制台会渲染),
// 终端里无法直接渲染 HTML, 这里把它转换成 ANSI 转义序列:
// 颜色/背景色/加粗/斜体/下划线/删除线, 未知标签剥离, 实体字符解码
const NAMED_COLORS = {
    black: [0, 0, 0], silver: [192, 192, 192], gray: [128, 128, 128], grey: [128, 128, 128],
    white: [255, 255, 255], maroon: [128, 0, 0], red: [255, 0, 0], purple: [128, 0, 128],
    fuchsia: [255, 0, 255], magenta: [255, 0, 255], green: [0, 128, 0], lime: [0, 255, 0],
    olive: [128, 128, 0], yellow: [255, 255, 0], navy: [0, 0, 128], blue: [0, 0, 255],
    teal: [0, 128, 128], aqua: [0, 255, 255], cyan: [0, 255, 255], orange: [255, 165, 0],
    gold: [255, 215, 0], pink: [255, 192, 203], brown: [165, 42, 42]
};

const parseCssColor = (value) => {
    const v = value.trim().toLowerCase();
    let m;
    if ((m = v.match(/^#([0-9a-f]{3})$/))) return m[1].split('').map((c) => parseInt(c + c, 16));
    if ((m = v.match(/^#([0-9a-f]{6})$/))) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    if ((m = v.match(/^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/))) {
        return [Number(m[1]), Number(m[2]), Number(m[3])];
    }
    return NAMED_COLORS[v] ?? null;
};

const safeFromCodePoint = (code) => (
    Number.isInteger(code) && code >= 1 && code <= 0x10ffff ? String.fromCodePoint(code) : null
);

const decodeEntities = (s) => s.replace(/&(?:lt|gt|quot|apos|amp|nbsp|#[0-9]+|#x[0-9a-f]+);/gi, (ent) => {
    const e = ent.toLowerCase();
    if (e === '&lt;') return '<';
    if (e === '&gt;') return '>';
    if (e === '&quot;') return '"';
    if (e === '&apos;' || e === '&#39;' || e === '&#x27;') return "'";
    if (e === '&amp;') return '&';
    if (e === '&nbsp;') return ' ';
    let code = null;
    const hex = e.match(/^&#x([0-9a-f]+);$/);
    const dec = e.match(/^&#([0-9]+);$/);
    if (hex) code = parseInt(hex[1], 16);
    else if (dec) code = parseInt(dec[1], 10);
    return code !== null ? (safeFromCodePoint(code) ?? ent) : ent;
});

// 把 style="..." 里的声明映射为 ANSI SGR 参数
const styleToAnsi = (style) => {
    const codes = [];
    for (const decl of (style || '').split(';')) {
        const idx = decl.indexOf(':');
        if (idx === -1) continue;
        const prop = decl.slice(0, idx).trim().toLowerCase();
        const value = decl.slice(idx + 1).trim();
        if (!value) continue;
        const v = value.toLowerCase();
        if (prop === 'color') {
            const rgb = parseCssColor(value);
            if (rgb) codes.push(`38;2;${rgb.join(';')}`);
        } else if (prop === 'background-color' || prop === 'background') {
            const rgb = parseCssColor(value);
            if (rgb) codes.push(`48;2;${rgb.join(';')}`);
        } else if (prop === 'font-weight') {
            if (/bold|bolder|^[6-9]00$/.test(v)) codes.push('1');
        } else if (prop === 'font-style') {
            if (/italic|oblique/.test(v)) codes.push('3');
        } else if (prop === 'text-decoration') {
            if (v.includes('underline')) codes.push('4');
            if (v.includes('line-through')) codes.push('9');
        }
        // font-size 等终端无法表达的属性忽略
    }
    return codes;
};

// 匹配任意合法的 html 标签; 已知标签参与渲染, 其余剥离 (与官网控制台的净化行为一致)
const HTML_TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)>/g;

const renderRichText = (text) => {
    // 1) 先解码 HTML 实体: log 通道内容是实体编码的 (&#x3C;span...), 解码后才能识别标签
    // 2) 再剥掉内容里自带的 ANSI 转义, 防止破坏终端状态
    let src = decodeEntities(String(text ?? ''));
    src = src.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
    if (!src) return src;

    const stack = [];      // 每层标签对应一组 SGR 参数, 嵌套时取并集
    let out = '';
    let last = 0;
    const flush = (chunk) => {
        if (!chunk) return;
        const codes = stack.flat();
        if (codes.length) {
            out += `\x1b[${codes.join(';')}m${chunk}\x1b[0m`;
        } else {
            out += chunk;
        }
    };

    src.replace(HTML_TAG_RE, (match, closing, tag, attrs, offset) => {
        flush(src.slice(last, offset));
        last = offset + match.length;

        const name = tag.toLowerCase();
        if (name === 'br') {
            out += '\n';
            return match;
        }
        if (closing) {
            stack.pop();
            return match;
        }
        if (name === 'span') {
            const styleMatch = /style\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs || '');
            stack.push(styleToAnsi(styleMatch ? (styleMatch[1] ?? styleMatch[2]) : ''));
        } else if (name === 'b' || name === 'strong') {
            stack.push(['1']);
        } else if (name === 'i' || name === 'em') {
            stack.push(['3']);
        } else if (name === 'u') {
            stack.push(['4']);
        } else {
            stack.push([]);   // 未知标签: 剥离但保留其内容
        }
        return match;
    });
    flush(src.slice(last));

    return out;
};


// Screeps 控制台客户端, 移植自插件的 ScreepsClient.ts (SockJS 风格 WebSocket 协议)
// - 收消息: websocket 订阅 user:<id>/console, 实时接收 log/results
// - 发消息: HTTP POST /api/user/console, 结果经 websocket 回来
class ScreepsClient extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.httpBase = getHttpBase(config);
        this.socketBase = getSocketBase(config);
        this.token = config.token || null;
        this.email = config.email;
        this.password = config.password;
        this.userId = null;
        this.ws = null;
        this.connected = false;
        this.activeShard = 'shard0';
        this.intentionalClose = false;
        this.pendingConnect = undefined;
        this.keepAliveTimer = null;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
    }

    async connect() {
        if (this.pendingConnect) {
            return;
        }

        this.emit('status', { state: 'connecting' });

        try {
            // 私服账号是 email/password, 先登录换取 token
            if (!this.token) {
                this.emit('debug', '使用账号密码登录...');
                const data = await this.apiRequest('POST', '/api/auth/signin', {
                    email: this.email,
                    password: this.password
                });
                if (!data?.token) throw new Error('登录失败: 服务器未返回 token');
                this.token = data.token;
            }

            this.emit('debug', 'Authenticating...');
            const me = await this.apiRequest('GET', '/api/auth/me');
            if (!me?._id) {
                throw new Error('Failed to retrieve user ID');
            }
            this.userId = me._id;
            this.emit('debug', `Authenticated as user ID: ${this.userId}`);

            await this.connectWebSocket();
            this.reconnectAttempts = 0;
        } catch (error) {
            this.emit('status', { state: 'disconnected' });
            this.emit('error', `Connection failed: ${error.message}`);
            throw error;
        }
    }

    async apiRequest(method, apiPath, body) {
        const response = await fetch(`${this.httpBase}${apiPath}`, {
            method,
            headers: {
                'X-Token': this.token ?? '',
                'X-Username': this.token ?? '',
                ...(body ? { 'Content-Type': 'application/json' } : {})
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(15000)
        });
        this.updateTokenFromHeaders(response.headers);

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error ?? `HTTP ${response.status}`);
        }
        return data;
    }

    connectWebSocket() {
        this.closeWebSocket(true);
        this.intentionalClose = false;

        // 仿 SockJS 的原生 websocket 地址: /socket/<server>/<session>/websocket
        const serverId = Math.floor(Math.random() * 1000);
        const sessionId = Math.random().toString(36).substring(2, 10);
        const url = `${this.socketBase}/socket/${serverId}/${sessionId}/websocket`;

        this.emit('debug', `Connecting to WebSocket: ${url}`);
        this.ws = new WebSocket(url);

        return new Promise((resolve, reject) => {
            this.pendingConnect = { resolve, reject };

            this.ws.on('open', () => {
                this.emit('debug', 'WebSocket connected.');
                this.authenticateWebSocket();
            });

            this.ws.on('message', (data) => {
                this.handleMessage(data.toString());
            });

            this.ws.on('close', (code, reason) => {
                if (process.env.CONSOLE_DEBUG) process.stderr.write(`[ws close] code=${code} reason=${reason}\n`);
                this.emit('debug', 'WebSocket disconnected.');
                this.stopKeepAlive();

                const wasConnected = this.connected;
                this.connected = false;

                const pending = this.pendingConnect;
                this.pendingConnect = undefined;
                if (pending) {
                    pending.reject(new Error('WebSocket closed before authentication completed.'));
                }

                if (!this.intentionalClose && wasConnected) {
                    this.emit('status', { state: 'disconnected' });
                    this.scheduleReconnect();
                }
            });

            this.ws.on('error', (err) => {
                const message = err?.message ?? 'unknown error';
                this.emit('error', `WebSocket error: ${message}`);

                const pending = this.pendingConnect;
                this.pendingConnect = undefined;
                if (pending) {
                    pending.reject(new Error(`WebSocket error: ${message}`));
                }
            });
        });
    }

    authenticateWebSocket() {
        if (!this.ws) return;
        // SockJS: ["message"]
        this.sendSockJS(`auth ${this.token}`);
    }

    subscribeConsole() {
        if (!this.ws || !this.userId) return;
        this.sendSockJS(`subscribe user:${this.userId}/console`);
        this.emit('debug', 'Subscribed to console.');
    }

    sendSockJS(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // 包一层数组以符合 SockJS 协议
            this.ws.send(JSON.stringify([msg]));
        }
    }

    handleMessage(data) {
        // SockJS 协议: o=打开, h=心跳, a=消息数组, c=关闭
        if (process.env.CONSOLE_DEBUG) process.stderr.write(`[frame] ${data.slice(0, 300)}\n`);
        if (data.startsWith('o')) {
            // 打开帧, 无需处理
        } else if (data.startsWith('h')) {
            // 心跳
        } else if (data.startsWith('a')) {
            try {
                const messages = JSON.parse(data.substring(1));
                for (const msg of messages) {
                    this.processInnerMessage(msg);
                }
            } catch {
                this.emit('error', 'Failed to parse SockJS message');
            }
        }
    }

    processInnerMessage(msg) {
        // 内部消息: "auth ok <token>" / "time <time>" / "protocol <ver>" / "[channel, data]"
        if (msg.startsWith('auth ok')) {
            this.emit('debug', 'WebSocket Authentication successful.');
            const parts = msg.split(' ');
            const nextToken = parts.length >= 3 ? parts[2] : undefined;
            if (nextToken) {
                this.setToken(nextToken);
            }
            this.connected = true;
            this.subscribeConsole();
            this.startKeepAlive();
            this.emit('status', { state: 'connected' });

            const pending = this.pendingConnect;
            this.pendingConnect = undefined;
            pending?.resolve();
        } else if (msg.startsWith('auth failed')) {
            this.emit('error', 'WebSocket Authentication failed.');
            this.emit('status', { state: 'disconnected' });

            const pending = this.pendingConnect;
            this.pendingConnect = undefined;
            pending?.reject(new Error('WebSocket authentication failed.'));
        } else if (msg.startsWith('time')) {
            // tick 更新
        } else if (msg.startsWith('[')) {
            // 频道消息
            try {
                const [channel, payload] = JSON.parse(msg);
                if (channel.endsWith('/console')) {
                    this.handleConsolePayload(payload);
                }
            } catch {
                // 忽略
            }
        }
    }

    handleConsolePayload(payload) {
        // 结构: { messages: { log: [], results: [] }, shard: "shard0" }
        // 订阅会收到所有 shard 的消息; 发送目标只跟随用户选择, 不自动切换,
        // 非当前 shard 的消息加前缀标识
        const fromOtherShard = Boolean(payload.shard && payload.shard !== this.activeShard);
        const prefix = fromOtherShard ? `\x1b[90m[${payload.shard}]${COLORS.reset} ` : '';
        if (payload.messages) {
            for (const log of payload.messages.log ?? []) {
                this.emit('console', `${prefix}${renderRichText(log)}`);
            }
            for (const res of payload.messages.results ?? []) {
                this.emit('console', `${prefix}${COLORS.result}Result: ${renderRichText(res)}${COLORS.reset}`);
            }
        } else if (payload.error) {
            this.emit('console', `${prefix}${COLORS.error}Error: ${renderRichText(payload.error)}${COLORS.reset}`);
        }
    }

    startKeepAlive() {
        this.stopKeepAlive();
        // 与 screeps-api 一致: 认证成功后每 10s 发送 websocket 协议层 ping 保活,
        // 否则空闲约 10s 就会被服务器断开
        this.keepAliveTimer = setInterval(() => {
            if (process.env.CONSOLE_DEBUG) process.stderr.write('[ws ping]\n');
            this.ws?.ping();
        }, 10000);
    }

    stopKeepAlive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    scheduleReconnect() {
        if (this.intentionalClose || this.reconnectTimer) return;
        if (this.reconnectAttempts >= 10) {
            this.emit('error', '重连 10 次失败, 放弃重连');
            return;
        }
        this.reconnectAttempts += 1;
        this.emit('status', { state: 'reconnecting' });
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect().catch(() => this.scheduleReconnect());
        }, 3000);
    }

    setActiveShard(shard) {
        this.activeShard = shard;
    }

    async sendCommand(expression) {
        if (!this.userId) {
            this.emit('error', 'Cannot send command: Not authenticated.');
            return;
        }

        try {
            await this.apiRequest('POST', '/api/user/console', {
                expression,
                shard: this.activeShard
            });
            // 结果会通过 websocket 异步返回, 这里无需打印
        } catch (error) {
            this.emit('error', `Command failed: ${error.message}`);
        }
    }

    closeWebSocket(silent) {
        if (this.ws) {
            this.intentionalClose = true;
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.pendingConnect = undefined;
        this.stopKeepAlive();
        if (!silent) {
            this.emit('status', { state: 'disconnected' });
        }
    }

    // 用户主动退出时静默关闭, 不再广播"已断开"
    disconnect() {
        this.intentionalClose = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.closeWebSocket(true);
    }

    setToken(token) {
        if (!token || token === this.token) {
            return;
        }
        // 服务器可能轮换 token, 仅在本次会话内生效, 不回写 .secret.json
        this.token = token;
    }

    updateTokenFromHeaders(headers) {
        const nextToken = headers?.get?.('x-token');
        if (typeof nextToken === 'string' && nextToken.trim()) {
            this.setToken(nextToken.trim());
        }
    }
}

// 输出统一走 printer: REPL 启动后会替换成"清行 -> 打印 -> 重绘输入行"的版本,
// 避免实时日志打断正在输入的命令
const printer = {
    print: (line) => console.log(line),
    printIncoming: (line) => console.log(line)
};

const wireClientEvents = (client) => {
    client.on('debug', (msg) => {
        // 连接过程的细节只在调试模式显示, 平时保持输出干净
        if (process.env.CONSOLE_DEBUG) printer.print(formatWithColor(COLORS.system, 'System', msg));
    });
    client.on('log', (msg) => printer.print(formatWithColor(COLORS.system, 'System', msg)));
    client.on('error', (msg) => printer.print(formatWithColor(COLORS.error, 'Error', msg)));
    client.on('status', ({ state }) => {
        const label =
            state === 'connecting' ? '连接中...' :
            state === 'connected' ? '已连接' :
            state === 'reconnecting' ? '重连中...' :
            '已断开';
        printer.print(formatWithColor(COLORS.status, 'Status', label));
    });
    client.on('console', (msg) => printer.printIncoming(msg));
};

const startRepl = (client) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '> '
    });

    // 括号/引号自动成对:
    // - 输入 ( [ { " ' ` 自动补全另一半, 光标停在中间
    // - 光标停在同种闭合符上时输入闭合符直接跳过, 不重复输入
    // - 退格时如果两侧正好是成对符号, 一次删掉
    const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
    const QUOTES = new Set(['"', "'", '`']);
    const CLOSERS = new Set(Object.values(PAIRS));
    const isWordChar = (c) => /[A-Za-z0-9_$]/.test(c ?? '');

    const origTtyWrite = rl._ttyWrite.bind(rl);
    let composing = false;   // 内部插入时绕过拦截, 防递归
    // 直接调用原始 _ttyWrite, 不走 rl.write: 后者会按 terminal 标志路由到
    // 不同的写入路径, 传 null 会崩 (ERR_INVALID_ARG_TYPE)
    const runOriginal = (data, key) => {
        composing = true;
        try {
            origTtyWrite(data, key);
        } finally {
            composing = false;
        }
    };

    const handleAutoPair = (s, key) => {
        if (key && key.name === 'backspace' && !key.ctrl && !key.meta) {
            if (rl.cursor > 0) {
                const before = rl.line[rl.cursor - 1];
                if (PAIRS[before] && PAIRS[before] === (rl.line[rl.cursor] ?? '')) {
                    runOriginal('', { name: 'delete' });
                    runOriginal('', { name: 'backspace' });
                    return true;
                }
            }
            return false;
        }

        if (!s || s.length !== 1 || (key && (key.ctrl || key.meta))) return false;

        const ch = s;
        const next = rl.line[rl.cursor] ?? '';
        const prev = rl.cursor > 0 ? rl.line[rl.cursor - 1] : '';
        // 光标停在同种闭合符上 -> 跳过而不是重复输入
        if (CLOSERS.has(ch) && next === ch) {
            runOriginal('', { name: 'right' });
            return true;
        }
        const closer = PAIRS[ch];
        if (!closer) return false;
        // 引号落在单词旁边时不自动成对 (避免 don't 变成 don't')
        if (QUOTES.has(ch) && (isWordChar(prev) || isWordChar(next))) return false;

        runOriginal(ch, {});
        runOriginal(closer, {});
        runOriginal('', { name: 'left' });
        return true;
    };

    rl._ttyWrite = (s, key) => {
        if (composing) {
            origTtyWrite(s, key);
            return;
        }
        if (handleAutoPair(s, key)) return;
        origTtyWrite(s, key);
    };

    // 触发一次重绘, 让 readline 初始化游标状态:
    // 否则首次输入时 rl.cursor 是 NaN, 配对的回移光标会被跳过
    rl.prompt(true);
    rl._refreshLine();

    printer.printIncoming = (line) => {
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
        console.log(line);
        rl.prompt(true);
    };

    const exit = () => {
        client.disconnect();
        rl.close();
        process.exit(0);
    };

    const printHelp = () => {
        printer.print([
            '内置命令:',
            '  /help            显示帮助',
            '  /shard           查看当前 shard',
            '  /shard <name>    切换 shard, 例如 /shard shard1',
            '  /clear           清屏',
            '  /quit            退出 (Ctrl+C 同效)',
            '其他输入都会作为命令发送到游戏控制台'
        ].join('\n'));
    };

    rl.on('line', (line) => {
        const command = line.trim();
        if (!command) return;
        if (command === '/help') {
            printHelp();
        } else if (command === '/shard') {
            printer.print(`当前 shard: ${client.activeShard}`);
        } else if (command.startsWith('/shard ')) {
            const shard = command.slice('/shard '.length).trim();
            client.setActiveShard(shard);
            printer.print(`Shard 切换为: ${shard}`);
        } else if (command === '/clear') {
            console.clear();
        } else if (command === '/quit' || command === '/exit') {
            exit();
        } else {
            client.sendCommand(command);
        }
    });

    rl.on('SIGINT', () => {
        if (rl.line) {
            // 正在输入时只清空当前行, 不退出
            readline.cursorTo(process.stdout, 0);
            readline.clearLine(process.stdout, 0);
        } else {
            exit();
        }
    });

    rl.on('close', () => process.exit(0));
};

// 官网主服有多个 shard 可选, 默认 shard3 (与插件一致, 也是通常有实际活动的 shard);
// 私服/季节服固定 shard0
const shardFor = (config) => (
    (config.hostname === 'screeps.com' && (!config.path || config.path === '/')) ? 'shard3' : 'shard0'
);

const pickShard = async (config) => {
    const isOfficialMain = config.hostname === 'screeps.com' && (!config.path || config.path === '/');
    if (!isOfficialMain) return 'shard0';
    try {
        return await select({
            message: '选择 shard',
            default: 'shard3',
            choices: ['shard3', 'shard0', 'shard1', 'shard2'].map((name) => ({ name, value: name }))
        });
    } catch {
        return 'shard3';
    }
};

// ── 目标解析: .secret.json 中账号挂在服务器下, 目标形如 服务器@账号 (如 服务器IP@账号名) ──
// 可连接目标 = 有 hostname 的服务器及其下账号; local 等纯复制目标只用于 push
const remoteServers = Object.entries(getServers(secret)).filter(([, cfg]) => cfg.hostname);

const serverAccountNames = (serverName) => (
    Object.keys(getServerAccounts(remoteServers.find(([name]) => name === serverName)?.[1] ?? {}))
);

// 非交互兜底: 第一台配置了账号的服务器
const firstConnectable = () => {
    for (const [serverName] of remoteServers) {
        const accounts = serverAccountNames(serverName);
        if (accounts.length) return [serverName, accounts[0]];
    }
    return ['', ''];
};

// 只给账号名时, 定位它所在的服务器
const accountOwnerServers = (accountName) => (
    remoteServers.filter(([, cfg]) => Object.keys(getServerAccounts(cfg)).includes(accountName)).map(([name]) => name)
);

const pickFrom = async (message, names, input) => {
    const candidates = matchName(names, input);
    if (candidates.length === 1 && input) {
        if (candidates[0] === input || await confirm({ message: `确定${message} ${candidates[0]} 吗？` })) {
            return candidates[0];
        }
        return '';
    }
    const list = candidates.length > 1 ? candidates : names;
    try {
        return await select({
            message,
            choices: list.map((name) => ({ name, value: name }))
        });
    } catch (error) {
        return '';
    }
};

// 确定连接目标, 返回 [服务器名, 账号名]; 支持缩写与 服务器@账号 两种写法
const pickTarget = async (input) => {
    const at = input ? input.indexOf('@') : -1;
    const inputServer = at === -1 ? input : input.slice(0, at);
    const inputAccount = at === -1 ? '' : input.slice(at + 1);

    let serverName = '';
    if (input && at === -1 && !matchName(remoteServers.map(([name]) => name), input).length) {
        const owners = accountOwnerServers(input);
        if (owners.length === 1) serverName = owners[0];
        else if (owners.length > 1) serverName = await pickFrom('连接到服务器', owners, '');
    }
    if (!serverName) {
        serverName = await pickFrom('连接到服务器', remoteServers.map(([name]) => name), inputServer);
    }
    if (!serverName) return ['', ''];

    let accountName = '';
    const accountNames = serverAccountNames(serverName);
    if (inputAccount) {
        if (!accountNames.includes(inputAccount)) {
            logConsole(`服务器 ${serverName} 下没有账号 ${inputAccount}`);
            process.exit(1);
        }
        accountName = inputAccount;
    } else if (accountNames.length === 1) {
        accountName = accountNames[0];
    } else if (accountNames.length > 1) {
        accountName = await pickFrom('连接到账号', accountNames, '');
    }
    if (!accountName) return ['', ''];
    return [serverName, accountName];
};

// 非交互模式的目标解析: 不弹任何选择, 解析不出就用第一台有账号的服务器
const resolveTargetArg = (input) => {
    const at = input ? input.indexOf('@') : -1;
    if (input && at !== -1) {
        return [input.slice(0, at), input.slice(at + 1)];
    }
    if (input) {
        const serverNames = remoteServers.map(([name]) => name);
        if (serverNames.includes(input)) {
            return [input, serverAccountNames(input)[0] ?? ''];
        }
        const owners = accountOwnerServers(input);
        if (owners.length) {
            return [owners[0], input];
        }
    }
    return firstConnectable();
};

const exec = async (serverName, accountName) => {
    const config = resolveTarget(secret, serverName, accountName);
    logConsole(`目标: ${serverName}@${accountName} (${getHttpBase(config)})`);

    // 私服自签证书时与 plugin-screeps.js 保持一致, 可在条目加 "insecure": true
    if (config.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    const client = new ScreepsClient(config);
    client.activeShard = await pickShard(config);
    wireClientEvents(client);

    try {
        await client.connect();
    } catch {
        process.exit(1);
    }

    printer.print('');
    printer.print('已进入控制台, 输入命令回车发送, /help 查看内置命令, Ctrl+C 退出');
    startRepl(client);
};

const run = async () => {
    const argv = process.argv.slice(2);

    // ── 非交互模式：console <目标> -e "表达式" [-e "…"] [--wait 秒] ──
    // 连接后依次发送命令, 收集 --wait 秒(默认 4s)的输出后自动退出。
    if (argv.some((a) => a === '-e' || a === '--exec')) {
        const waitIdx = argv.indexOf('--wait');
        const waitSeconds = waitIdx !== -1 ? Math.max(1, Number(argv[waitIdx + 1]) || 4) : 4;
        const commands = [];
        for (let i = 0; i < argv.length; i += 1) {
            if (argv[i] !== '-e' && argv[i] !== '--exec') continue;
            const expr = argv[i + 1];
            if (expr) commands.push(expr);
        }
        if (commands.length === 0) {
            console.error('非交互模式需要 -e "表达式"（可重复）');
            process.exit(1);
        }
        const nameArg = argv.find((a) => !a.startsWith('-') && a !== commands.find((c) => true) && a !== String(waitSeconds));
        const [serverName, accountName] = resolveTargetArg(nameArg);
        if (!serverName || !accountName) { console.error('无可连接目标（.secret.json）'); process.exit(1); }

        const config = resolveTarget(secret, serverName, accountName);
        logConsole(`非交互执行 -> ${serverName}@${accountName} (${getHttpBase(config)}), ${commands.length} 条命令, 收集窗口 ${waitSeconds}s`);
        if (config.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

        const client = new ScreepsClient(config);
        client.activeShard = shardFor(config);
        wireClientEvents(client);
        await client.connect();

        for (const cmd of commands) {
            await client.sendCommand(cmd);
        }
        setTimeout(() => {
            client.disconnect();
            process.exit(0);
        }, waitSeconds * 1000);
        return;
    }

    const [serverName, accountName] = await pickTarget(argv[0]);
    if (serverName && accountName) {
        await exec(serverName, accountName);
    }
};

run();
