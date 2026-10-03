// 本地服 Memory 诊断: __wd/race 快照读取（薄调用方，公共层见 lib/server-client.mjs）
// 用法: node scripts/diag-mem.mjs [path] [账号名]
import fs from 'node:fs';
import { createServerClient } from './lib/server-client.mjs';

const BASE = 'http://localhost:21035';
const secret = JSON.parse(fs.readFileSync('.secret.json', 'utf8'));
const accName = process.argv[3] ?? 'Rosmarin';
const acc = secret.servers['xx-local'].accounts[accName] ?? secret.servers['xx-local'].accounts.Rosmarin;

const client = await createServerClient(secret.servers['xx-local'], acc);
const pathArg = process.argv[2];

const target = pathArg ?? '__wd';
const wd = await client.getMemory(target, (v) => v && typeof v === 'object' && v.time !== undefined);
if (!wd) { console.log(`[${target}] 未命中（40 次重试）`); process.exit(1); }
console.log(JSON.stringify(wd, null, 1));
