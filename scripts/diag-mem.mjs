// 纯 GET 读私服 Memory 诊断 (不触发 console eval, 无泄漏)
// 用法: node scripts/diag-mem.mjs [path] [账号名]
import fs from 'node:fs';
import zlib from 'node:zlib';

const BASE = 'http://localhost:21035';
const secret = JSON.parse(fs.readFileSync('.secret.json', 'utf8'));
const accName = process.argv[3] ?? 'Rosmarin';
const acc = secret.servers['xx-local'].accounts[accName] ?? secret.servers['xx-local'].accounts.Rosmarin;
console.log(`[diag] 账号: ${acc.email}`);

const authRes = await fetch(`${BASE}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: acc.email, password: acc.password })
});
const { token } = await authRes.json();

const apiGet = async (pathName) => {
    const res = await fetch(`${BASE}${pathName}`, { headers: { 'X-Token': token, 'X-Username': acc.email } });
    return res.json();
};

const readMem = async (memPath) => {
    const res = await apiGet(`/api/user/memory?path=${encodeURIComponent(memPath)}`);
    if (typeof res.data === 'string' && res.data.includes('Incorrect memory path')) return undefined;
    return res.data;
};

const decode = (data) => {
    let v = data;
    if (typeof v === 'string' && v.startsWith('gz:')) {
        v = zlib.gunzipSync(Buffer.from(v.slice(3), 'base64')).toString();
    }
    // API 层可能多重 JSON 编码，逐层剥壳
    for (let i = 0; i < 3 && typeof v === 'string'; i++) {
        const t = v.trim();
        if (!(t.startsWith('{') || t.startsWith('[') || t.startsWith('"'))) break;
        try { v = JSON.parse(t); } catch { break; }
    }
    return v;
};

const pathArg = process.argv[2];
if (pathArg) {
    console.log(JSON.stringify(decode(await readMem(pathArg)), null, 1));
    process.exit(0);
}

// 默认: race 采样 + 看门狗 + 外矿交付链快照 + 各房间记忆的闸门字段
const dump = decode(await readMem('__raceDump'));
console.log('=== __raceDump ===');
console.log(JSON.stringify(dump, null, 1).slice(0, 1200));

const wd = decode(await readMem('__wd'));
console.log('=== __wd ===');
console.log(JSON.stringify(wd, null, 1));

const om = decode(await readMem('__om'));
console.log('=== __om ===');
console.log(JSON.stringify(om, null, 1));

const rooms = await readMem('rooms');
if (rooms && typeof rooms === 'object') {
    for (const [name, mem] of Object.entries(rooms)) {
        if (!mem || typeof mem !== 'object') continue;
        console.log(`=== Memory.rooms.${name} 闸门字段 ===`);
        console.log(JSON.stringify({
            mode: mem.mode, building: mem.building, isBuilding: mem.isBuilding,
            energyState: mem.energyState, spawnUsageEma: mem.spawnUsageEma,
            spawnBalance: mem.spawnBalance, lastBuildTime: mem.lastBuildTime,
            numWork: mem.numWork, rclRecord: mem.rclRecord
        }));
    }
}
