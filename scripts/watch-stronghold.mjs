// 特殊规则服（47:8001 要塞挑战）状态观察: __wd 快照轮询
// （薄调用方，公共层见 lib/server-client.mjs）
import fs from 'node:fs';
import { createServerClient } from './lib/server-client.mjs';

const secret = JSON.parse(fs.readFileSync('.secret.json', 'utf8'));
const serverCfg = secret.servers['47.100.24.220:8001'];
const client = await createServerClient(serverCfg, serverCfg.accounts.Rosmarin);

const wd = await client.getMemory('__wd', (v) => v && typeof v === 'object' && v.time !== undefined);
if (!wd) { console.log('__wd 未命中（bot 未写入或 Memory 重置中）'); process.exit(0); }
console.log('tick:', wd.time, '| lv:', wd.level, '| spawns:', wd.spawns, '| creeps:', wd.creeps, '| state:', wd.energyState, '| mode:', wd.mode);
console.log('census:', JSON.stringify(wd.census));
