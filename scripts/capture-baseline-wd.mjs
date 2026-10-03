// 重构基线抓取: 本地服 __wd 快照存档（code-quality-refactor 1.1）
import zlib from 'node:zlib';
import fs from 'node:fs';

const BASE = 'http://localhost:21035';
const secret = JSON.parse(fs.readFileSync('.secret.json', 'utf8'));
const acc = secret.servers['xx-local'].accounts.Rosmarin;

const auth = await (await fetch(`${BASE}/api/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: acc.email, password: acc.password }) })).json();
const H = { 'X-Token': auth.token, 'X-Username': acc.email };
const get = async (p) => {
    for (let i = 0; i < 40; i++) {
        const r = await (await fetch(`${BASE}/api/user/memory?path=${encodeURIComponent(p)}`, { headers: H })).json();
        if (typeof r.data === 'string' && r.data.startsWith('gz:')) {
            let s = zlib.gunzipSync(Buffer.from(r.data.slice(3), 'base64')).toString();
            let v = s;
            // API 可能双重 JSON 编码：逐层 try-parse（非 JSON 串自然 break）
            for (let k = 0; k < 3 && typeof v === 'string'; k++) {
                try { v = JSON.parse(v); } catch { break; }
            }
            if (v && typeof v === 'object' && v.time !== undefined) return v;
        }
        await new Promise((res) => setTimeout(res, 600));
    }
    return null;
};

const wd = await get('__wd');
if (!wd) { console.log('__wd 未命中'); process.exit(1); }
const out = 'openspec/changes/code-quality-refactor/baseline-wd.json';
fs.mkdirSync('openspec/changes/code-quality-refactor', { recursive: true });
fs.writeFileSync(out, JSON.stringify({ capturedAt: new Date().toISOString(), ...wd }, null, 1));
console.log('基线已存档 →', out);
console.log('tick:', wd.time, '| lv:', wd.level, '| progress:', wd.progress, '| census:', JSON.stringify(wd.census), '| state:', wd.energyState);
