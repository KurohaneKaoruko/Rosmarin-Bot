// 非交互连接私服终端，采集 bot 运行状态诊断信息
// 用法: node scripts/console-diag.mjs <target> [account]
// 目标支持 本地 xxscreeps 私服
import { ScreepsAPI } from 'screeps-api';
import fs from 'node:fs';

const target = process.argv[2];
const secretRaw = JSON.parse(fs.readFileSync('.secret.json', 'utf8'));
const servers = secretRaw.servers || secretRaw;
const serverCfg = servers[target];
if (!serverCfg) { console.error(`目标 ${target} 不在 .secret.json`); process.exit(1); }
const accounts = serverCfg.accounts || {};
const account = (process.argv[3] && accounts[process.argv[3]]) || Object.values(accounts)[0] || {};
const cfg = { ...serverCfg, ...account };

const api = new ScreepsAPI(cfg);
if (cfg.token) api.token = cfg.token;
await api.auth(cfg.email ?? cfg.username, cfg.password);
console.log(`[diag] 已连接 ${target} (${cfg.branch})`);

const cmds = {
    D1: `console.log('[D1]'+JSON.stringify({tick:Game.time,cpuLimit:Game.cpu.limit,cpu:Math.round(Game.cpu.getUsed()*10)/10,rooms:_.size(Game.rooms),creeps:_.size(Game.creeps)}))`,
    D2: `console.log('[D2]'+JSON.stringify(Object.values(Game.rooms).filter(r=>r.controller&&r.controller.my).map(r=>({room:r.name,mode:(Memory.rooms[r.name]||{}).mode,lv:r.controller.level,p:r.controller.progress,need:r.controller.progressTotal,ea:r.energyAvailable,se:r.storage?r.storage.store.energy:0,state:(r.memory||{}).energyState,defend:!!r.memory.defend}))))`,
    D3: `console.log('[D3]'+JSON.stringify(_.countBy(Game.creeps,c=>c.memory.role||'?')))`,
    D4: `console.log('[D4]'+JSON.stringify(Memory.OutMineData||{}))`,
    D5: `console.log('[D5]'+Object.values(Game.rooms).filter(r=>r.controller&&r.controller.my).map(r=>({room:r.name,pool:_.size(r.getAllMissionFromPool('spawn')),sites:_.countBy(r.find(FIND_CONSTRUCTION_SITES),s=>s.structureType)})).map(x=>x.room+' pool='+x.pool+' sites='+JSON.stringify(x.sites)).join(' | '))`,
};

for (const cmd of Object.values(cmds)) {
    await api.raw.user.console(cmd, cfg.branch);
    await new Promise((r) => setTimeout(r, 600));
}
console.log('[diag] 等待引擎输出…');
await new Promise((r) => setTimeout(r, 3500));

const res = await api.raw.user.console() ?? {};
const log = ((res.messages ?? {}).log ?? res.log ?? []).map(String);
console.log(`[diag] 收到 ${log.length} 条：\n`);
for (const line of log) {
    if (/^\[D\d\]/.test(line)) console.log(line);
}
process.exit(0);
