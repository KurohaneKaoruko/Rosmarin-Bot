// spawn 池 + 孵化状态快照
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
    for (let i = 0; i < 6; i++) {
        try {
            const r = await (await fetch(`${BASE}/api/user/memory?path=${encodeURIComponent(p)}`, { headers: H })).json();
            if (typeof r.data !== 'string' || r.data.includes('Incorrect')) return null;
            let s = r.data.startsWith('gz:') ? zlib.gunzipSync(Buffer.from(r.data.slice(3), 'base64')).toString() : r.data;
            let v = s;
            for (let k = 0; k < 3 && typeof v === 'string'; k++) { try { v = JSON.parse(v); } catch { break; } }
            return v;
        } catch { await new Promise((res) => setTimeout(res, 500)); }
    }
    return null;
};

const t = await (await fetch(`${BASE}/api/game/time`, { headers: H })).json().then(r => r.time).catch(() => -1);
console.log('tick:', t);
const pool = await read('RosmarinBot.MissionPools.W8N7.spawn');
if (!pool) { console.log('spawn 池: 无'); }
else {
    console.log('spawn 池条目数:', pool.length);
    for (const task of pool) {
        const d = task.data || {};
        console.log(` - id:${task.id} role:${d.memory?.role} level:${task.level} lock:${task.lock} body:${JSON.stringify(d.body).slice(0, 60)} energy:${d.energy}`);
    }
}
const spawns = await read('rooms.W8N7');
console.log('房间键:', spawns ? Object.keys(spawns).join(',') : '无');
