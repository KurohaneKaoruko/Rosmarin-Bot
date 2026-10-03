// 特殊服(47:8001)状态读取: 重试穿透多 worker 路由 + 多层 JSON 解码
import zlib from 'node:zlib';

const BASE = 'http://47.100.24.220:8001';
const auth = await (await fetch(`${BASE}/api/auth/signin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'Rosmarin', password: 'rosmarin395' }) })).json();
const H = { 'X-Token': auth.token, 'X-Username': 'Rosmarin' };
const get = async (p) => {
    for (let i = 0; i < 40; i++) {
        const r = await (await fetch(`${BASE}/api/user/memory?path=${encodeURIComponent(p)}`, { headers: H })).json();
        if (typeof r.data === 'string' && r.data.startsWith('gz:')) {
            let s = zlib.gunzipSync(Buffer.from(r.data.slice(3), 'base64')).toString();
            let v = s;
            for (let k = 0; k < 2 && typeof v === 'string'; k++) {
                const t = v.trim();
                if (!t.startsWith('{')) break;
                try { v = JSON.parse(t); } catch { break; }
            }
            if (v && typeof v === 'object' && v.time !== undefined) return v;
        }
        await new Promise((res) => setTimeout(res, 600));
    }
    return null;
};

const wd = await get('__wd');
if (!wd) { console.log('__wd 未命中'); process.exit(0); }
console.log('tick:', wd.time, '| lv:', wd.level, '| spawns:', wd.spawns, '| creeps:', wd.creeps, '| state:', wd.energyState, '| mode:', wd.mode);
console.log('census:', JSON.stringify(wd.census));
