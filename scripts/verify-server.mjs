/**
 * 私服验证脚本：登录 → 上传 bundle → 订阅控制台 → 观察运行 → 状态回读。
 * HTTP 用原生 fetch（X-Token），socket 复用 screeps-api。
 * 用法: node scripts/verify-server.mjs --host localhost --port 21035 --email U --password P --code dist/main.js [--seconds 90] [--branch main]
 */
import fs from 'node:fs';
import { ScreepsAPI } from 'screeps-api';

const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? process.argv[i + 1] : def;
};

const host = arg('host', 'localhost');
const port = Number(arg('port', '21035'));
const email = arg('email');
const password = arg('password');
const codeFile = arg('code', 'dist/main.js');
const seconds = Number(arg('seconds', '90'));
const branch = arg('branch', 'main');

if (!email || !password) {
    console.error('需要 --email/--password');
    process.exit(2);
}

const base = `http://${host}:${port}`;
const errors = [];
const logs = [];
let gotConsole = false;

const main = async () => {
    const api = new ScreepsAPI({ protocol: 'http', hostname: host, port, path: '/' });
    await api.auth(email, password);
    console.log(`[auth] 登录成功 @ ${host}:${port}`);
    const token = api.token ?? api._token;

    const http = async (method, apiPath, body) => {
        const res = await fetch(`${base}${apiPath}`, {
            method,
            headers: { 'X-Token': token, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (data.token) api.token = data.token; // xxscreeps 会滚动 token
        return data;
    };

    // 分支列表（决定上传目标）
    let branchNames = [];
    try {
        const list = await http('GET', '/api/user/branches');
        branchNames = (list?.list ?? []).map(b => b.branch);
    } catch {}

    // 上传 bundle
    const code = fs.readFileSync(codeFile, 'utf8');
    const targetBranch = branchNames.includes(branch) ? branch : (branchNames[0] ?? branch);
    console.log(`[code] 上传 ${(code.length / 1024).toFixed(0)}KB → 分支 ${targetBranch}（已有分支: ${branchNames.join(', ') || '无'}）`);
    const upload = await http('POST', '/user/code', { branch: targetBranch, modules: { main: code } });
    if (upload?.error) throw new Error(`上传失败: ${JSON.stringify(upload.error).slice(0, 200)}`);
    console.log('[code] 上传完成');

    // 控制台订阅
    api.socket.on('console', (msg) => {
        gotConsole = true;
        for (const line of msg?.messages?.log ?? []) logs.push(String(line));
        for (const line of msg?.messages?.errors ?? []) errors.push(String(line));
    });
    await api.socket.connect();
    console.log(`[socket] 已连接，观察 ${seconds}s …`);
    await http('POST', '/user/console', { expression: `Console.log('smoke-probe @', Game.time, 'cpu', Game.cpu.getUsed().toFixed(2))` }).catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

    // 状态回读（通过控制台表达式，结果经 socket 回来）
    await http('POST', '/user/console', {
        expression: `Console.log('SMOKE-STATUS time=' + Game.time + ' cpu=' + Game.cpu.getUsed().toFixed(2) + ' bucket=' + Game.cpu.bucket)`,
    }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 3000));

    try { await api.socket.disconnect(); } catch {}
    console.log('[socket] 已断开，输出结果');
    console.log(`\n═══ 验证结果 ═══`);
    const statusLines = logs.filter(l => l.includes('SMOKE-STATUS'));
    console.log(`控制台消息: ${logs.length + errors.length} 条（log ${logs.length} / error ${errors.length}）socket 收到: ${gotConsole}`);
    for (const line of statusLines.slice(-2)) console.log(`  [状态] ${line.slice(0, 140)}`);
    console.log(`错误数: ${errors.length}`);
    for (const line of errors.slice(0, 8)) console.log(`  [err] ${line.slice(0, 160)}`);
    console.log(`最近日志 5 条:`);
    for (const line of logs.slice(-5)) console.log(`  ${String(line).slice(0, 140)}`);

    if (errors.length > 0) { console.error('有错误'); process.exit(1); }
    process.exit(0);
};

main().catch((error) => {
    console.error(`验证失败: ` + (error?.message ?? error));
    process.exit(1);
});
