// 纯 GET 读私服 Memory 诊断 (不触发 console eval, 无泄漏)
// 用法: node scripts/diag-mem.mjs [path]
import fs from 'node:fs';
import zlib from 'node:zlib';

const BASE = 'http://localhost:21035';
const secret = JSON.parse(fs.readFileSync('.secret.json', 'utf8'));
const acc = secret.servers['xx-local'].accounts.Rosmarin;

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
    if (typeof data === 'string' && data.startsWith('gz:')) {
        return JSON.parse(zlib.gunzipSync(Buffer.from(data.slice(3), 'base64')).toString());
    }
    return data;
};

const pathArg = process.argv[2];
if (pathArg) {
    console.log(JSON.stringify(decode(await readMem(pathArg)), null, 1));
    process.exit(0);
}

// 默认: race 采样 + 各房间记忆的闸门字段
const dump = decode(await readMem('__raceDump'));
console.log('=== __raceDump ===');
console.log(JSON.stringify(dump, null, 1));

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
