// 本地服 attempt 观察采样器：每 60s 抓一次 __wd，输出时间序列到 attempt/observe-log.jsonl
import zlib from 'node:zlib';
import fs from 'node:fs';

const OUT = 'attempt/observe-log.jsonl';
const auth = await (await fetch('http://localhost:21035/api/auth/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'Rosmarin', password: 'rosmarin123' }) })).json();
const H = { 'X-Token': auth.token, 'X-Username': 'Rosmarin' };
const dec = (d) => typeof d === 'string' && d.startsWith('gz:') ? JSON.parse(zlib.gunzipSync(Buffer.from(d.slice(3), 'base64')).toString()) : d;
const get = async (p) => {
    try {
        const r = await (await fetch(`http://localhost:21035/api/user/memory?path=${encodeURIComponent(p)}`, { headers: H })).json();
        return dec(r.data);
    } catch { return null; }
};

const ROUNDS = Number(process.argv[2] ?? 10);
for (let i = 0; i < ROUNDS; i++) {
    const wd = await get('__wd');
    const line = {
        wall: new Date().toISOString(),
        ...(wd ? {
            tick: wd.time,
            elapsed: wd.race?.baseline ? wd.time - wd.race.baseline : null,
            lv: wd.level,
            progress: wd.progress,
            energy: wd.energyState,
            starved: wd.upgradersStarved,
            creeps: wd.creeps,
            census: wd.census,
        } : { tick: null, note: 'no __wd' })
    };
    fs.appendFileSync(OUT, JSON.stringify(line) + '\n');
    console.log(JSON.stringify(line));
    if (i < ROUNDS - 1) await new Promise(r => setTimeout(r, 60000));
}
