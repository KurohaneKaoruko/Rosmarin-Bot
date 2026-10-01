// 远端服落地看门狗：账号被清（全部 spawn 消失）后自动在指定房间重新放置出生点。
// 用法:
//   node scripts/watchdog-remote.mjs --server <服务器> --account <账号名> --room <房间名>
// 可选:
//   --shard shard0        shard 名（默认 shard0）
//   --name Spawn1         出生点名（默认 Spawn1）
//   --x 25 --y 25         指定落脚点（默认按地形自动选开阔格）
//   --interval 300        轮询间隔秒（默认 300）
//   --once                单次检查后退出
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- CLI ----
const argv = process.argv.slice(2);
const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : null;
};
const SERVER = flag('server');
const ACCOUNT = flag('account');
const ROOM = flag('room');
if (!SERVER || !ACCOUNT || !ROOM) {
    console.error('缺少必填参数。用法:');
    console.error('  node scripts/watchdog-remote.mjs --server <secret.json 服务器键> --account <账号名> --room <房间名>');
    console.error('可选: --shard shard0 --name Spawn1 --x N --y N --interval 300 --once');
    process.exit(1);
}
const SHARD = flag('shard') ?? 'shard0';
const SPAWN_NAME = flag('name') ?? 'Spawn1';
const INTERVAL_MS = Number(flag('interval') ?? 300) * 1000;
const ONCE = argv.includes('--once');
const OVERRIDE_X = flag('x') != null ? Number(flag('x')) : null;
const OVERRIDE_Y = flag('y') != null ? Number(flag('y')) : null;

const serverCfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.secret.json'), 'utf8')).servers[SERVER];
if (!serverCfg?.accounts?.[ACCOUNT]) {
    console.error(`.secret.json 里找不到 servers.${SERVER}.accounts.${ACCOUNT}`);
    process.exit(1);
}
const BASE = `${serverCfg.protocol ?? 'http'}://${serverCfg.hostname}:${serverCfg.port}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...msg) => console.log(`[${new Date().toISOString().replace('T', ' ').slice(0, 19)}]`, ...msg);

// ---- 认证 ----
let token = null;
const signin = async () => {
    const acc = serverCfg.accounts[ACCOUNT];
    const res = await fetch(`${BASE}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: acc.email, password: acc.password }),
    });
    const auth = await res.json();
    if (!auth.token) throw new Error(`signin 失败: ${JSON.stringify(auth).slice(0, 200)}`);
    token = auth.token;
};
const authHeaders = () => ({ 'X-Token': token, 'X-Username': token });

const api = async (pathName, init = {}, retries = 1) => {
    if (!token) await signin();
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${pathName}`, { ...init, headers: { ...authHeaders(), ...init.headers } });
        if (res.status === 401 && attempt < retries) { await signin(); continue; }
        return res;
    }
};

// ---- 状态探针：eval 写 Memory.__wd → 读回（写有延迟，循环重试） ----
// 内存读回是 gz+base64，且字符串值会被端点再 JSON 序列化一层：剥两层编码
const decodeJsonDeep = (text) => {
    let value = JSON.parse(text);
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { /* 非嵌套 JSON，保持原样 */ }
    }
    return value;
};
const decodeMemory = (payload) => {
    const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
    if (typeof data !== 'string') return null;
    if (data.startsWith('gz:')) {
        const text = zlib.gunzipSync(Buffer.from(data.slice(3), 'base64')).toString();
        try { return decodeJsonDeep(text); } catch { return null; }
    }
    try { return decodeJsonDeep(data); } catch { return null; }
};

const readProbe = async (nonce, retries = 10) => {
    for (let i = 0; i < retries; i++) {
        await sleep(3000);
        try {
            const res = await api(`/api/user/memory?path=${encodeURIComponent('__wd')}`);
            const raw = await res.text();
            if (process.env.WD_DEBUG) log(`[debug read ${i}] http=${res.status}`, raw.slice(0, 200));
            const value = decodeMemoryBody(raw);
            if (value && typeof value === 'object' && 'spawns' in value) {
                // nonce 不匹配＝runner 还没执行本次写入，读回的是上一轮旧值
                //（账号刚被清时 eval 不再执行，旧值会永久滞留——必须视为探针不可用）
                if (value.nonce !== nonce) continue;
                return value;
            }
        } catch (e) {
            if (process.env.WD_DEBUG) log(`[debug read ${i}] 异常:`, e.message);
        }
    }
    return null;
};

const decodeMemoryBody = (raw) => {
    let body;
    try { body = JSON.parse(raw); } catch { return null; }
    return decodeMemory(body);
};

const getAccountStatus = async (nonce) => {
    await api('/api/user/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            expression: `Memory.__wd = JSON.stringify({ spawns: _.size(Game.spawns), spawnRooms: Object.keys(Game.spawns).map(n => Game.spawns[n].pos.roomName), creeps: _.size(Game.creeps), time: Game.time, nonce: '${nonce}' })`,
        }),
    });
    return readProbe(nonce);
};

// ---- 落脚点：地形上选开阔可建格（确定性），或用 --x/--y 覆盖 ----
const fetchTerrain = async () => {
    const res = await api(`/api/game/room-terrain?room=${ROOM}&shard=${SHARD}`);
    const body = await res.json().catch(() => null);
    const terrain = body?.terrain?.[0]?.terrain;
    if (!terrain) throw new Error(`room-terrain 失败: ${JSON.stringify(body).slice(0, 200)}`);
    return terrain;
};
const isWall = (terrain, x, y) => terrain[y * 50 + x] === '1';
const pickSpawnPos = (terrain) => {
    let best = null;
    for (let y = 5; y <= 44; y++) {
        for (let x = 5; x <= 44; x++) {
            if (isWall(terrain, x, y)) continue;
            let open = 0;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    if (!isWall(terrain, x + dx, y + dy)) open++;
                }
            }
            const centerBias = Math.abs(x - 25) + Math.abs(y - 25);
            const score = open * 100 - centerBias;
            if (!best || score > best.score) best = { x, y, open, score };
        }
    }
    return best;
};

// ---- 放置 ----
const placeSpawn = async (x, y) => {
    const res = await api(`/api/game/place-spawn?shard=${SHARD}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: SPAWN_NAME, room: ROOM, x, y }),
    });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
};

// ---- 主循环 ----
const runCycle = async () => {
    const nonce = `${Date.now()}`;
    const status = await getAccountStatus(nonce).catch(() => null);
    if (status) {
        if (status.spawns > 0) {
            log(`存活中: spawns=${status.spawns} @ ${JSON.stringify(status.spawnRooms)} creeps=${status.creeps} tick=${status.time}`);
            return;
        }
        log(`账号已清空（spawns=0, tick=${status.time}）→ 重新落地 ${ROOM}`);
    } else {
        log('状态探针未执行（账号无活动或刚被清）→ 直接尝试放置');
    }

    const terrain = await fetchTerrain();
    let pos;
    if (OVERRIDE_X != null && OVERRIDE_Y != null) {
        if (isWall(terrain, OVERRIDE_X, OVERRIDE_Y)) {
            log(`--x/--y (${OVERRIDE_X},${OVERRIDE_Y}) 是墙格，放弃本轮`); return;
        }
        pos = { x: OVERRIDE_X, y: OVERRIDE_Y };
    } else {
        pos = pickSpawnPos(terrain);
        if (!pos) { log('无可建格，放弃本轮'); return; }
    }
    log(`放置 ${SPAWN_NAME} @ ${ROOM} (${pos.x},${pos.y})${pos.open != null ? ` 开阔度 ${pos.open}/25` : ''}`);
    const { status: http, body } = await placeSpawn(pos.x, pos.y);
    if (http === 200 && body.includes('"ok"')) {
        log(`落地成功 ✓`);
        await sleep(5000);
        const after = await getAccountStatus(`${Date.now()}`).catch(() => null);
        if (after) log(`确认: spawns=${after.spawns} @ ${JSON.stringify(after.spawnRooms)}`);
    } else {
        // 非 200 常见语义是「已有 spawn 被拒」＝账号存活（幂等拒绝，非错误）
        log(`放置被拒 http=${http}（通常=已有 spawn，账号存活）: ${body}`);
    }
};

const main = async () => {
    log(`看门狗启动: ${BASE} 服务器=${SERVER} 账号=${ACCOUNT} 房间=${ROOM} shard=${SHARD} 间隔=${INTERVAL_MS / 1000}s${ONCE ? '（单次）' : ''}`);
    for (;;) {
        try { await runCycle(); }
        catch (e) { log('本轮异常:', e.message); }
        if (ONCE) break;
        await sleep(INTERVAL_MS);
    }
};
main();
