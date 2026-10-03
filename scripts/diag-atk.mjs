// ATK 不出兵诊断：读 47:8001 的旗/队列/队伍/敌房记忆
import fs from 'node:fs';

const secret = JSON.parse(fs.readFileSync('.secret.json', 'utf8'));
const cfg = secret.servers['47.100.24.220:8001'];
const acc = cfg.accounts.Rosmarin;
const BASE = `http://${cfg.hostname}:${cfg.port}`;

const auth = await (await fetch(`${BASE}/api/auth/signin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: acc.email, password: acc.password }),
})).json();
const H = { 'X-Token': auth.token, 'X-Username': acc.email };

const t = (await (await fetch(`${BASE}/api/game/time`, { headers: H })).json()).time;
const w = await (await fetch(`${BASE}/api/user/world-status`, { headers: H })).json();
console.log('tick:', t, '| world:', JSON.stringify(w));

const paths = ['flags', 'RosmarinBot.TeamSpawnQueue', 'RosmarinBot.TeamData', 'RosmarinBot.atk', 'rooms'];
for (const p of paths) {
    let hit = null;
    for (let i = 0; i < 6 && !hit; i++) {
        try {
            const r = await (await fetch(`${BASE}/api/user/memory?path=${encodeURIComponent(p)}`, { headers: H })).json();
            if (typeof r.data === 'string' && r.data.includes('Incorrect')) break;
            hit = r.data;
        } catch { /* retry */ }
        if (!hit) await new Promise((res) => setTimeout(res, 500));
    }
    let out = hit;
    if (typeof hit === 'string' && hit.startsWith('gz:')) {
        const zlib = await import('node:zlib');
        out = zlib.gunzipSync(Buffer.from(hit.slice(3), 'base64')).toString();
    }
    let v = out;
    for (let k = 0; k < 3 && typeof v === 'string'; k++) {
        const s = v.trim();
        if (!(s.startsWith('{') || s.startsWith('[') || s.startsWith('"'))) break;
        try { v = JSON.parse(s); } catch { break; }
    }
    console.log(`\n--- ${p} ---`);
    const text = JSON.stringify(v);
    console.log(text ? (text.length > 1200 ? text.slice(0, 1200) + ` …(共${text.length}字符)` : text) : String(v).slice(0, 120));
}
