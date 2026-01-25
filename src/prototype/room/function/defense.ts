export default class RoomDefense extends Room {
    activeDefense() {
        // 如果处于安全模式，则不进行后续处理
        if (this.controller.safeMode) return;

        // 处于防御时, 检查是否需要激活安全模式
        if (this.memory.defend && this.activateSafeMode()) return true;

        // 关于主动防御的检查
        if (Game.time % 5) return;
        
        if (!Memory['whitelist']) Memory['whitelist'] = [];
        const roomHostiles = this.findEnemyCreeps({
            filter: c => c.owner.username !== 'Invader' &&
                c.body?.some(b =>
                    b.type === ATTACK ||
                    b.type === RANGED_ATTACK ||
                    b.type === WORK ||
                    b.type === HEAL ||
                    b.type === CLAIM
                )
        }) as any as Creep[];
        const powerHostiles = this.find(FIND_HOSTILE_POWER_CREEPS, {
            filter: hostile => !hostile.isWhiteList()
        }) as any;
        const threats = roomHostiles.concat(powerHostiles);

        if (!global.Hostiles) global.Hostiles = {};

        if (threats.length === 0) {
            global.Hostiles[this.name] = [];
            if (this.memory['defendUntil'] && this.memory['defendUntil'] > Game.time) {
                this.memory.defend = true;
            } else {
                this.memory.defend = false;
                delete this.memory['defendUntil'];
            }
            return;
        }

        // 进入防御状态（避免频繁抖动：按威胁强度延长一段时间）
        this.memory.defend = true;
        const threatScore = threats.reduce((sum: number, c: any) => {
            if (!c?.body) return sum + 5;
            let s = 0;
            for (const p of c.body) {
                if (p.type === HEAL) s += 3;
                else if (p.type === RANGED_ATTACK) s += 2;
                else if (p.type === ATTACK || p.type === WORK) s += 1;
                else if (p.type === CLAIM) s += 3;
            }
            return sum + s;
        }, 0);
        this.memory['defendUntil'] = Game.time + Math.min(200, 50 + threatScore * 2);

        // 如果房间等级小于4，则不进行主动防御
        if (this.level < 4) return;
        
        // 搜索有威胁的敌人
        const hostiles = threats.filter((c: any) => c) as any[];

        /** --------主动防御孵化-------- */
        // 40A红球 或 40R蓝球
        global.Hostiles[this.name] = hostiles.map((hostile: Creep) => hostile.id);
        
        const threatLevel = hostiles.reduce((sum: number, c: any) => {
            if (!c?.body) return sum + 5;
            return sum + c.body.filter((p: BodyPartDefinition) =>
                p.type === ATTACK ||
                p.type === RANGED_ATTACK ||
                p.type === WORK ||
                p.type === HEAL ||
                p.type === CLAIM
            ).length;
        }, 0);

        if (Array.isArray(this[STRUCTURE_RAMPART]) && this[STRUCTURE_RAMPART].length > 0) {
            const costs = this.getDefenseCostMatrix(false);

            let breached = false;
            for (const c of hostiles as any[]) {
                if (!c?.pos) continue;
                if (c.pos.roomName !== this.name) continue;
                if (costs.get(c.pos.x, c.pos.y) < 254) {
                    breached = true;
                    break;
                }
            }
            this.memory['breached'] = breached;
            const rampartMinHits = breached ? 1e5 : 1e6;

            let sumX = 0;
            let sumY = 0;
            let count = 0;
            for (const c of hostiles as any[]) {
                if (!c?.pos) continue;
                if (c.pos.roomName !== this.name) continue;
                sumX += c.pos.x;
                sumY += c.pos.y;
                count++;
            }
            const meanX = count > 0 ? Math.round(sumX / count) : 25;
            const meanY = count > 0 ? Math.round(sumY / count) : 25;
            const meanPos = new RoomPosition(meanX, meanY, this.name);

            const rampartCandidates = (this[STRUCTURE_RAMPART] as StructureRampart[])
                .filter(r => r?.my && r.hits >= rampartMinHits && costs.get(r.pos.x, r.pos.y) === 1)
                .filter(r => {
                    const lookStructure = this.lookForAt(LOOK_STRUCTURES, r.pos);
                    if (lookStructure.length && lookStructure.some(structure =>
                        structure.structureType !== STRUCTURE_RAMPART &&
                        structure.structureType !== STRUCTURE_ROAD &&
                        structure.structureType !== STRUCTURE_CONTAINER)) {
                        return false;
                    }
                    return true;
                });

            const scored = rampartCandidates.map(r => {
                const dist = r.pos.getRangeTo(meanPos);
                const meleeScore = -dist;
                const rangedScore = -Math.abs(dist - 3) - dist * 0.05;
                return { id: r.id, meleeScore, rangedScore };
            });
            scored.sort((a, b) => b.meleeScore - a.meleeScore);
            const melee = scored.slice(0, 10).map(s => s.id);
            scored.sort((a, b) => b.rangedScore - a.rangedScore);
            const ranged = scored.slice(0, 10).map(s => s.id);

            this.memory['defenseRamparts'] = { tick: Game.time, melee, ranged, minHits: rampartMinHits };
        } else {
            delete this.memory['defenseRamparts'];
            delete this.memory['breached'];
        }

        const attackDefender = Object.values(Game.creeps).filter((creep:any) => creep.room.name == this.name && creep.memory.role == 'defend-attack');
        const rangedDefender = Object.values(Game.creeps).filter((creep:any) => creep.room.name == this.name && creep.memory.role == 'defend-ranged');
        const doubleAttackDefender = Object.values(Game.creeps).filter((creep:any) => creep.room.name == this.name && creep.memory.role == 'defend-2attack');
        const doubleHealDefender = Object.values(Game.creeps).filter((creep:any) => creep.room.name == this.name && creep.memory.role == 'defend-2heal');
        
        const SpawnMissionNum = this.getSpawnMissionNum() ?? {};
        const attackQueueNum = SpawnMissionNum['defend-attack'] || 0;
        const rangedQueueNum = SpawnMissionNum['defend-ranged'] || 0;
        const doubleAttackQueueNum = SpawnMissionNum['defend-2attack'] || 0;
        const doubleHealQueueNum = SpawnMissionNum['defend-2heal'] || 0;

        const hasMeleeThreat = hostiles.some((c: any) => c?.body && c.body.some((p: BodyPartDefinition) =>
            p.type == ATTACK || p.type == WORK || p.type == CLAIM
        ));
        const hasRangedThreat = hostiles.some((c: any) => c?.body && c.body.some((p: BodyPartDefinition) => p.type == RANGED_ATTACK));
        const hasHealThreat = hostiles.some((c: any) => c?.body && c.body.some((p: BodyPartDefinition) => p.type == HEAL));
        const hasBoostedThreat = hostiles.some((c: any) => c?.body && c.body.some((p: BodyPartDefinition) => p.boost));
        const breached = !!this.memory['breached'];

        const canDoubleAttackBoost = this.level >= 7 && this['XGHO2'] >= 3000 && this['XUH2O'] >= 3000 && this['XZHO2'] >= 3000;
        const canDoubleHealBoost = this.level >= 7 && this['XGHO2'] >= 3000 && this['XLHO2'] >= 3000 && this['XZHO2'] >= 3000;
        // const useDouble = this.level >= 7 &&
        //     (breached || threatLevel >= 25 || (hasHealThreat && (hasMeleeThreat || hasRangedThreat)) || hasBoostedThreat) &&
        //     canDoubleAttackBoost && canDoubleHealBoost;
        const useDouble = false;

        if (useDouble) {
            if (doubleAttackDefender.length + doubleAttackQueueNum < 1) {
                const body = this.GetRoleBodys('defend-2attack');
                this.SpawnMissionAdd('', body, -1, 'defend-2attack', {home: this.name} as any);
                this.AssignBoostTaskByBody(body, { [ATTACK]: 'XUH2O', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' });
            }
            if (doubleHealDefender.length + doubleHealQueueNum < 1) {
                const body = this.GetRoleBodys('defend-2heal');
                this.SpawnMissionAdd('', body, -1, 'defend-2heal', {home: this.name} as any);
                this.AssignBoostTaskByBody(body, { [HEAL]: 'XLHO2', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' });
            }
        }

        const enemyStats = hostiles.reduce((acc: any, c: any) => {
            if (!c?.body) {
                acc.other += 1;
                return acc;
            }
            for (const p of c.body as BodyPartDefinition[]) {
                if (p.type === ATTACK || p.type === WORK || p.type === CLAIM) acc.melee += 1;
                else if (p.type === RANGED_ATTACK) acc.ranged += 1;
                else if (p.type === HEAL) acc.heal += 1;
                if (p.boost) acc.boosted = true;
            }
            acc.count += 1;
            return acc;
        }, { count: 0, melee: 0, ranged: 0, heal: 0, boosted: false, other: 0 });

        const enemyPressure =
            enemyStats.melee * 1 +
            enemyStats.ranged * 1.25 +
            enemyStats.heal * 1.8 +
            (enemyStats.boosted ? 8 : 0) +
            enemyStats.other * 3;

        let desiredAttack = 0;
        let desiredRanged = 0;
        if (enemyPressure > 0) {
            // 近战为主，远程为辅：优先补齐近战（站 rampart，不追击）来压制入口
            const needMeleeMain =
                hasMeleeThreat ||
                breached ||
                enemyStats.count >= 1;

            if (needMeleeMain) {
                desiredAttack = 1;
                if (breached || enemyStats.boosted || enemyStats.heal > 0 || enemyStats.count >= 2 || enemyPressure >= 25) {
                    desiredAttack = 2;
                }
                if (breached && (enemyStats.boosted || enemyStats.heal >= 10 || enemyStats.count >= 3 || enemyPressure >= 40)) {
                    desiredAttack = 3;
                }
            }

            // 远程仅作为辅助位：用于对付远程/高治疗/boost，默认不强制出
            const needRangedSupport =
                hasRangedThreat ||
                enemyStats.heal > 0 ||
                enemyStats.boosted ||
                breached;

            if (needRangedSupport) {
                desiredRanged = 1;
                if (breached && (enemyStats.boosted || enemyStats.heal >= 15 || enemyStats.ranged >= 20)) {
                    desiredRanged = 2;
                }
            }
        }

        if (desiredAttack > 0 && (attackDefender.length + attackQueueNum < desiredAttack)) {
            const body = this.GetRoleBodys('defend-attack');
            let mustBoost = false;
            if ((enemyStats.boosted || enemyStats.heal >= 10 || threatLevel > 20) &&
                this.level >= 7 && this['XUH2O'] >= 3000 && this['XZHO2'] >= 3000) mustBoost = true;
            this.SpawnMissionAdd('', body, -1, 'defend-attack', {home: this.name, mustBoost} as any);
            if (mustBoost) {
                this.AssignBoostTaskByBody(body, { [ATTACK]: 'XUH2O', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' });
            }
        }

        if (desiredRanged > 0 && (rangedDefender.length + rangedQueueNum < desiredRanged)) {
            const body = this.GetRoleBodys('defend-ranged');
            let mustBoost = false;
            if ((enemyStats.boosted || enemyStats.heal >= 10 || threatLevel > 20) &&
                this.level >= 7 && this['XKHO2'] >= 3000 && this['XZHO2'] >= 3000) mustBoost = true;
            this.SpawnMissionAdd('', body, -1, 'defend-ranged', {home: this.name, mustBoost} as any);
            if (mustBoost) {
                this.AssignBoostTaskByBody(body, { [RANGED_ATTACK]: 'XKHO2', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' });
            }
        }
    }

    activateSafeMode() {
        if (this.controller.safeModeAvailable) return;
        if (this.controller.safeModeCooldown) return;
        if (this.controller.upgradeBlocked) return;
        let RuinCount = this.find(FIND_RUINS, {filter: (e: any) => e.structure.owner &&
            e.structure.owner.username==this.controller.owner.username
            &&e.structure.structureType!=STRUCTURE_ROAD
            &&e.structure.structureType!=STRUCTURE_CONTAINER
            &&e.structure.structureType!=STRUCTURE_WALL
            &&e.structure.structureType!=STRUCTURE_RAMPART
            &&e.structure.structureType!=STRUCTURE_EXTRACTOR
            &&e.structure.structureType!=STRUCTURE_LINK
            &&e.structure.ticksToDecay<=500
        }).length
        if (!RuinCount)  return;
        this.controller.activateSafeMode();
        return true;
    }

    // 获取防御用CostMatrix
    // 做了相当多的优化, 消耗大约1~5CPU每次
    getDefenseCostMatrix(show: boolean = false): CostMatrix {
        if (!global.DefenseCostMatrix) global.DefenseCostMatrix = {};
        let dcm = global.DefenseCostMatrix[this.name];
        if (dcm && dcm.tick + 20 > Game.time) return dcm.costMatrix;
        global.DefenseCostMatrix[this.name] = {}; // 清空缓存

        const CPU_start = Game.cpu.getUsed();
        const costs = new PathFinder.CostMatrix();
        const avoidArea = new Uint8Array(3200); // 记录已经标记为不可通行的点位

        if (!global['ROOM_EXITS']) global['ROOM_EXITS'] = {};
        let cacheExits = global['ROOM_EXITS'][this.name];
        let exits = cacheExits || [];
        let visitedEXITS = !cacheExits ? {
            [LEFT]: new Uint8Array(50),
            [RIGHT]: new Uint8Array(50),
            [TOP]: new Uint8Array(50),
            [BOTTOM]: new Uint8Array(50)
        } : null;
        // 标记不可通过的地形, 并记录出入口点位
        const terrain = this.getTerrain();
        for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            let xy = (x << 6) + y;
            if (terrain.get(x, y) == TERRAIN_MASK_WALL) {
                costs.set(x, y, 255);
                avoidArea[xy] = 1;
                continue;
            }
            if (x > 0 && x < 49 && y > 0 && y < 49) continue;
            costs.set(x, y, 255);
            avoidArea[xy] = 1;
            if (cacheExits) continue;
            // 判断该出入口的前一个点位是否已经被标记过(已标记代表前一个点位也是出入口)
            let p = (x == 0) ? LEFT : (x == 49) ? RIGHT : (y == 0) ? TOP : BOTTOM;
            let p2 = (p == LEFT || p == RIGHT) ? y : x;
            visitedEXITS[p][p2] = 1;
            if (visitedEXITS[p][p2-1]) continue;
            exits.push([x, y]);
        }}
        if (!cacheExits) {
            global['ROOM_EXITS'][this.name] = exits;
            visitedEXITS = null; // 释放
        }
        
        // 使用建筑缓存
        let structs = [
            ...this[STRUCTURE_SPAWN], ...this[STRUCTURE_EXTENSION], ...this[STRUCTURE_TOWER],
            ...this[STRUCTURE_LINK], ...this[STRUCTURE_LAB], ...this[STRUCTURE_RAMPART],
            ...this[STRUCTURE_WALL], this[STRUCTURE_TERMINAL], this[STRUCTURE_STORAGE],
             this[STRUCTURE_NUKER], this[STRUCTURE_FACTORY], this[STRUCTURE_EXTRACTOR],
            this[STRUCTURE_OBSERVER], this[STRUCTURE_POWER_SPAWN]
        ].filter(s => s);
        const RAM_MIN_HITS = 1e6;
        // 标记不可通过的建筑
        structs.forEach(s => {
            if (s.structureType === STRUCTURE_RAMPART && s.my) {
                if (s.hits < RAM_MIN_HITS) return;
                if (costs.get(s.pos.x, s.pos.y) > 0) return;
                costs.set(s.pos.x, s.pos.y, 1); // 设置 rampart 为 1
            } else {
                let xy = (s.pos.x << 6) + s.pos.y;
                if (avoidArea[xy]) return; // 已标记则跳过
                costs.set(s.pos.x, s.pos.y, 255);
                avoidArea[xy] = 1;
            }
        });
        structs = null; // 释放

        const CPU_bfs = Game.cpu.getUsed();

        // BFS
        const barriers = [];
        let visited = new Uint8Array(3200);
        const queue = [...exits];
        let length = queue.length;
        for (let idx = 0; idx < length; idx++) {
            const p = queue[idx];
            const x = p[0], y = p[1];
            costs.set(x, y, 255);
            avoidArea[(x << 6) | y] = 1;
            for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx == 0 && dy == 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
                const nextXY = (nx << 6) | ny;
                // 访问过的, 则跳过
                if (visited[nextXY]) continue;
                // 如果此处大于0, 表示到达了不可移动的位置(255的墙或1的rampart)
                else if (avoidArea[nextXY] || costs.get(nx, ny)) barriers.push(nextXY);
                else { queue.push([nx, ny]); length++; }
                visited[nextXY] = 1;
            }}
        }

        for (let p of barriers) {
            const x = p >> 6, y = p & 0b111111;
            for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (dx == 0 && dy == 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
                // 大于0时跳过
                if (costs.get(nx, ny)) continue;
                else costs.set(nx, ny, 10);
            }}
        }

        const CPU_ramBFS = Game.cpu.getUsed();
        // 对ram广搜, 将与安全区相邻的标记为安全, 否则为危险
        visited.fill(0);
        let ram_BFS_length = 0;
        const ramPos = [...this[STRUCTURE_RAMPART].map(r => [r.pos.x, r.pos.y])];
        for (let p of ramPos) {
            const xy = (p[0] << 6) | p[1];
            if (visited[xy]) continue;
            visited[xy] = 1;
            const queue = [[p[0], p[1]]];
            let safe = false;
            for (let idx = 0; idx < queue.length; idx++) {
                ram_BFS_length++;
                const p = queue[idx];
                const x = p[0], y = p[1];
                for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx == 0 && dy == 0) continue;
                    const nx = x + dx, ny = y + dy;
                    let nextXY = (nx << 6) | ny;
                    if (avoidArea[nextXY]) continue;
                    if (visited[nextXY]) continue;
                    if (costs.get(nx, ny) == 1) queue.push([nx, ny]);
                    else safe = true;
                    visited[nextXY] = 1;
                }}
            }
            if (!safe) queue.forEach(p => costs.set(p[0], p[1], 255));
        }

        const CPU_end = Game.cpu.getUsed();

        if (show) {
            console.log(`[${this.name}] DefenseCostMatrix生成开销:`);
            console.log('- 地形建筑开销:', (CPU_bfs - CPU_start).toFixed(2));
            console.log('- BFS开销:', (CPU_ramBFS - CPU_bfs).toFixed(2), '外部搜索量:', length);
            console.log('- RAM BFS开销:', (CPU_end - CPU_ramBFS).toFixed(2), 'RAM搜索量:', ram_BFS_length);
            console.log('- 总开销:', (CPU_end - CPU_start).toFixed(4));
        }
        
        global.DefenseCostMatrix[this.name] = {
            tick: Game.time,
            costMatrix: costs
        };
        return costs;
    }

    showDefenseCostMatrix() {
        if (!Game.flags[`${this.name}/SDCM`]) return;
        const costs = this.getDefenseCostMatrix(true);

        for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            const cost = costs.get(x, y);

            // 根据不同的成本值绘制不同颜色
            if (cost >= 254) {
                // 红色：不可通行区域（建筑/外部区域）
                this.visual.circle(x, y, { fill: 'red', opacity: 0.25, radius: 0.5, stroke: 'red' });
            } else if (cost == 10) {
                // 黄色：rampart 内侧缓冲区
                this.visual.circle(x, y, { fill: 'yellow', opacity: 0.25, radius: 0.5, stroke: 'yellow' });
            } else if (cost == 1) {
                // 蓝色：rampart 位置
                this.visual.circle(x, y, { fill: 'blue', opacity: 0.25, radius: 0.5, stroke: 'blue' });
            } else if (cost == 0) {
                // 绿色：默认可通行区域
                this.visual.circle(x, y, { fill: 'green', opacity: 0.25, radius: 0.5, stroke: 'green' });
            } else {
                // 灰色：意外Cost区域
                this.visual.circle(x, y, { fill: 'gray', opacity: 0.25, radius: 0.5, stroke: 'gray' });
            }
        }}
    }
}
