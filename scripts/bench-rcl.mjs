/**
 * xx-local RCL 冲级基准：放出生点 → 上传 bundle → 清 Memory → 轮询 __wd 直到达成 RCL3 或超时。
 * 判定口径：elapsed = tick - race.baseline（服务端 attempt 起点），RCL3 需 ≤ 3000t。
 * 用法: node scripts/bench-rcl.mjs [--port 21035] [--code dist/main.js] [--seconds 720] [--branch main] [--keep-memory]
 */
import zlib from 'node:zlib';

const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? process.argv[i + 1] : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const port = Number(arg('port', '21035'));
const codeFile = arg('code', 'dist/main.js');
const seconds = Number(arg('seconds', '720'));
const branch = arg('branch', 'local');
const base = `http://localhost:${port}`;
const USER = 'Rosmarin';
const PASS = 'rosmarin123';

const main = async () => {
    // ── 认证：signin 拿 token（user API），Basic 供 game API ──
    const auth = await (await fetch(`${base}/api/auth/signin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: USER, password: PASS }),
    })).json();
    if (!auth.token) throw new Error('signin 失败: ' + JSON.stringify(auth).slice(0, 150));
    const H = { 'X-Token': auth.token, 'X-Username': USER };
    const basic = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

    const get = async (p) => {
        const r = await fetch(`${base}${p}`, { headers: H });
        return r.json().catch(() => ({}));
    };
    const post = async (p, body, extra = {}) => {
        const r = await fetch(`${base}${p}`, {
            method: 'POST', headers: { 'X-Token': auth.token, 'Content-Type': 'application/json', ...extra },
            body: JSON.stringify(body),
        });
        return r.json().catch(() => ({}));
    };
    const dec = (d) => typeof d === 'string' && d.startsWith('gz:')
        ? JSON.parse(zlib.gunzipSync(Buffer.from(d.slice(3), 'base64')).toString()) : d;

    // ── 放出生点：轮询可玩房直到成功 ──
    const terrain = async (room) => {
        const r = await (await fetch(`${base}/api/game/room-terrain?room=${room}`)).json();
        const encoded = r?.terrain?.[0]?.terrain;
        if (!encoded) return null;
        return { get: (x, y) => Number(encoded[y * 50 + x]) };
    };
    const openPosition = (t) => {
        for (let y = 10; y <= 39; y++) for (let x = 10; x <= 39; x++) {
            if (t.get(x, y) === 0 && t.get(x + 1, y) === 0 && t.get(x - 1, y) === 0 && t.get(x, y + 1) === 0 && t.get(x, y - 1) === 0) return { x, y };
        }
        return { x: 25, y: 25 };
    };
    let spawnPlaced = false;
    outer: for (const room of ['E1S1', 'E2S2', 'E3S3', 'E4S4', 'E1S2', 'E2S1', 'E3S4', 'E4S3']) {
        const t = await terrain(room);
        if (!t) continue;
        const body = { name: 'Spawn1', room, ...openPosition(t) };
        const r = await fetch(`${base}/api/game/place-spawn`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: basic },
            body: JSON.stringify(body),
        });
        const d = await r.json().catch(() => ({}));
        console.log(`[spawn] ${room} @${body.x},${body.y} → ${JSON.stringify(d).slice(0, 120)}`);
        if (d.ok === 1) { spawnPlaced = true; break outer; }
    }
    console.log(`[spawn] 放置: ${spawnPlaced ? '成功' : '全部失败（可能已有房间，沿用现状）'}`);

    // ── 上传 bundle（必须是 /api/user/code；无 /api 前缀的旧端点 404 会被 .catch 吞成假成功）──
    const fs = await import('node:fs');
    const code = fs.readFileSync(codeFile, 'utf8');
    const branches = await get('/api/user/branches');
    const names = (branches?.list ?? []).map((b) => b.branch);
    const target = names.includes(branch) ? branch : (names[0] ?? branch);
    const up = await post('/api/user/code', { branch: target, modules: { main: code } });
    if (up?.error) throw new Error('上传失败: ' + JSON.stringify(up.error).slice(0, 150));
    // 回读校验（防假成功）
    const back = await get(`/api/user/code?branch=${target}`);
    const remote = typeof back?.modules?.main === 'string' ? back.modules.main : '';
    if (remote !== code) throw new Error(`上传校验失败: 远端 ${remote.length}B ≠ 本地 ${code.length}B`);
    console.log(`[code] 上传并校验 ${(code.length / 1024).toFixed(0)}KB → 分支 ${target}`);

    // ── 清 Memory（危险操作：会抹掉正在运行的 creep 记忆；默认关闭，--wipe 显式开启）──
    if (flag('wipe')) {
        await post('/user/console', { expression: `RawMemory.set('{}'); Console.log('BENCH memory wiped')` });
        console.log('[memory] 已清空（--wipe）');
    }
    const parseWd = (d) => {
        const raw = typeof d === 'string' && d.startsWith('gz:') ? zlib.gunzipSync(Buffer.from(d.slice(3), 'base64')).toString() : d;
        if (raw == null || raw === '') return null;
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return typeof obj?.tick === 'number' ? obj : null;
    };
    const t0 = Date.now();
    let baseline = null, startTick = null, hit2 = null, hit3 = null, lastLine = '';
    process.on('SIGINT', () => report());
    const report = () => {
        console.log(`\n═══ 基准结果 ═══`);
        console.log(`baseline(tick): ${baseline ?? '?'}  当前: ${lastLine}`);
        if (hit2) console.log(`RCL2 达成: ${hit2.elapsed}t`);
        if (hit3) console.log(`RCL3 达成: ${hit3.elapsed}t → ${hit3.elapsed <= 3000 ? 'PASS（≤3kt）' : 'FAIL（>3kt）'}`);
        else console.log(`RCL3 未达成（观察窗 ${Math.round((Date.now() - t0) / 1000)}s）`);
    };

    while (Date.now() - t0 < seconds * 1000) {
        await new Promise((r) => setTimeout(r, 15000));
        let wd = null;
        try { wd = parseWd((await get('/api/user/memory?path=__wd')).data); } catch {}
        if (!wd) { console.log('[poll] 无 __wd'); continue; }
        if (baseline == null && wd.race?.baseline) baseline = wd.race.baseline;
        if (baseline == null && startTick == null) startTick = wd.tick;
        const elapsed = baseline != null ? wd.tick - baseline : (startTick != null ? wd.tick - startTick : 0);
        const census = Object.entries(wd.census ?? {}).map(([k, v]) => `${k}:${v}`).join(',');
        lastLine = `tick=${wd.tick} elapsed=${elapsed} lv=${wd.level} prog=${wd.progress}/${wd.progressMax} creeps=${wd.creeps} [${census}] mode=${wd.mode} state=${wd.energyState}`;
        console.log(`[poll] ${lastLine}`);
        if (wd.level >= 2 && !hit2) hit2 = { elapsed, at: new Date().toISOString() };
        if (wd.level >= 3) { hit3 = { elapsed, at: new Date().toISOString() }; report(); process.exit(0); }
        if (elapsed > 3600) { console.log('[poll] 超 3600t，提前收工'); break; }
    }
    report();
    process.exit(hit3 ? 0 : 1);
};

main().catch((e) => { console.error('基准失败:', e?.message ?? e); process.exit(2); });
