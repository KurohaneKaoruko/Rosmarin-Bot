/**
 * 私服深度诊断：登录 → 回读已注册代码 → 发控制台探针（console.log 与 Console.log 双路）→ 收 socket。
 * 用法: node scripts/probe-server.mjs --port 21035 --email U --password P
 */
import { ScreepsAPI } from 'screeps-api';

const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? process.argv[i + 1] : def;
};
const host = arg('host', '127.0.0.1');
const port = Number(arg('port', '21035'));
const email = arg('email');
const password = arg('password');

const base = `http://${host}:${port}`;
const captured = [];

const main = async () => {
    const api = new ScreepsAPI({ protocol: 'http', hostname: host, port, path: '/' });
    await api.auth(email, password);
    console.log('[auth] ok');
    const token = api.token ?? api._token;
    const http = async (method, apiPath, body) => {
        const res = await fetch(`${base}${apiPath}`, {
            method,
            headers: { 'X-Token': token, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (data.token) api.token = data.token;
        return data;
    };

    // 已注册代码回读
    try {
        const code = await http('GET', '/api/user/code');
        const branches = Object.keys(code?.code ?? {});
        for (const b of branches) {
            const body = code.code[b];
            const mainBody = typeof body === 'string' ? body : (body?.main ?? '');
            console.log(`[code] 分支 ${b}: ${(mainBody.length / 1024).toFixed(0)}KB, 开头: ${String(mainBody).slice(0, 60).replace(/\n/g, ' ')}`);
        }
    } catch (e) {
        console.log(`[code] 回读失败: ${e?.message}`);
    }

    // socket 订阅
    api.socket.on('console', (msg) => {
        for (const line of [...(msg?.messages?.log ?? []), ...(msg?.messages?.errors ?? [])]) {
            captured.push(String(line));
        }
    });
    await api.socket.connect();
    console.log('[socket] connected');

    // 双路探针
    await http('POST', '/user/console', { expression: `console.log('PROBE-A console.log', Game.time)` }).catch(() => {});
    await http('POST', '/user/console', { expression: `Console.log('PROBE-B Console.log', Game.time)` }).catch(() => {});
    await http('POST', '/user/console', { expression: `JSON.stringify({rooms: Object.keys(Game.rooms), time: Game.time})` }).catch(() => {});

    await new Promise((r) => setTimeout(r, 8000));
    console.log(`[socket] 捕获 ${captured.length} 条:`);
    for (const line of captured.slice(0, 12)) console.log(`  ${line.slice(0, 150)}`);
};

main().catch((e) => { console.error(`失败: ${e?.message}`); process.exit(1); });
