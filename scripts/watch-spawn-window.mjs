// 孵化窗口密集采样：锁释放 → 派单 → 孵化状态追踪
import fs from 'node:fs';
import zlib from 'node:zlib';

const secret = JSON.parse(fs.readFileSync('.secret.json', 'utf8'));
const cfg = secret.servers['47.100.24.220:8001'];
const acc = cfg.accounts.Rosmarin;
const BASE = `http://${cfg.hostname}:${cfg.port}`;

const auth = await (await fetch(`${BASE}/api/auth/signin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: acc.email, password: acc.password }),
})).json();
const H = { 'X-Token': auth.token, 'X-Username': acc.email };

const read = async (p) => {
    for (let i = 0; i < 5; i++) {
        try {
            const r = await (await fetch(`${BASE}/api/user/memory?path=${encodeURIComponent(p)}`, { headers: H })).json();
            if (typeof r.data !== 'string' || r.data.includes('Incorrect')) return null;
            let s = r.data.startsWith('gz:') ? zlib.gunzipSync(Buffer.from(r.data.slice(3), 'base64')).toString() : r.data;
            let v = s;
            for (let k = 0; k < 3 && typeof v === 'string'; k++) { try { v = JSON.parse(v); } catch { break; } }
            return v;
        } catch { await new Promise((res) => setTimeout(res, 600)); }
    }
    return null;
};

for (let round = 0; round < 14; round++) {
    const wd = await read('__wd');
    const trace = await read('spawnTrace');
    const last = (trace || []).slice(-1)[0];
    const ts = new Date().toISOString().slice(11, 19);
    if (wd) {
        const lastTxt = last ? `${last.t}:${last.at}:${last.role}:r${last.result}` : '-';
        console.log(`[${ts}] tick ${wd.time} | spawning ${JSON.stringify(wd.spawning)} | spawnE ${JSON.stringify(wd.spawnEnergy)} | creeps ${wd.creeps} | census ${JSON.stringify(wd.census || {})} | lastTrace ${lastTxt}`);
    } else {
        console.log(`[${ts}] __wd 未命中`);
    }
    await new Promise((res) => setTimeout(res, 25000));
}
