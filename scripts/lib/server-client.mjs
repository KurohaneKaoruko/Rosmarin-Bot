// Screeps 私服 HTTP 客户端公共层：连接/鉴权/gz+多层 JSON 解码/多 worker 路由重试。
// diag-mem / watch-* 等诊断脚本共用；不触达游戏代码。
import zlib from 'node:zlib';

/** 创建可复用的私服客户端。serverCfg 取自 .secret.json 的 servers 条目 */
export const createServerClient = async (serverCfg, account) => {
    const acc = account ?? Object.values(serverCfg.accounts ?? {})[0];
    if (!acc) throw new Error('serverCfg 缺少可用账号');
    const BASE = `${serverCfg.protocol ?? 'http'}://${serverCfg.hostname}:${serverCfg.port}`;
    const authHeaders = (token) => ({ 'X-Token': token, 'X-Username': acc.email });

    const token = (await (await fetch(`${BASE}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: acc.email, password: acc.password }),
    })).json()).token;
    const H = { 'X-Token': token, 'X-Username': acc.email };

    // gz + 多层 JSON 解码（API 对字符串值会双重 JSON 编码）
    const decode = (raw) => {
        let v = raw;
        if (typeof v === 'string' && v.startsWith('gz:')) {
            v = zlib.gunzipSync(Buffer.from(v.slice(3), 'base64')).toString();
        }
        for (let k = 0; k < 3 && typeof v === 'string'; k++) {
            const t = v.trim();
            if (!(t.startsWith('{') || t.startsWith('[') || t.startsWith('"'))) break;
            try { v = JSON.parse(t); } catch { break; }
        }
        return v;
    };

    /** 读 Memory 路径；多 worker 路由下部分 worker 返回占位符，重试穿透。
        isHit(result) 判定是否为真实数据（默认：对象且含 time 字段或非 Incorrect 占位） */
    const getMemory = async (path, isHit = (v) => v != null) => {
        for (let i = 0; i < 40; i++) {
            try {
                const r = await (await fetch(`${BASE}/api/user/memory?path=${encodeURIComponent(path)}`, { headers: H })).json();
                if (typeof r.data === 'string' && r.data.includes('Incorrect')) {
                    await new Promise((res) => setTimeout(res, 600));
                    continue;
                }
                const v = decode(r.data);
                if (isHit(v)) return v;
            } catch { /* 瞬断重试 */ }
            await new Promise((res) => setTimeout(res, 600));
        }
        return null;
    };

    const gameTime = async () => {
        const r = await (await fetch(`${BASE}/api/game/time`, { headers: H })).json();
        return r.time;
    };

    const worldStatus = async () => {
        const r = await (await fetch(`${BASE}/api/user/world-status`, { headers: H })).json();
        return r.status;
    };

    return { BASE, H, getMemory, gameTime, worldStatus };
};
