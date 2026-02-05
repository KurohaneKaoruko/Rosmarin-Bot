import { getStructureSignature } from '@/utils';
import { shouldRun } from '@/modules/infra/qos';

type DefenderCounts = {
    attack: number;
    ranged: number;
    doubleAttack: number;
    doubleHeal: number;
};

const getDefenderCounts = (() => {
    const cache: { tick: number; byRoom: Record<string, DefenderCounts> } = { tick: -1, byRoom: {} };
    return (room: Room): DefenderCounts => {
        if (cache.tick !== Game.time) {
            cache.tick = Game.time;
            cache.byRoom = {};
        }
        const hit = cache.byRoom[room.name];
        if (hit) return hit;

        const counts: DefenderCounts = { attack: 0, ranged: 0, doubleAttack: 0, doubleHeal: 0 };
        const myCreeps = room.find(FIND_MY_CREEPS);
        for (const creep of myCreeps as any[]) {
            const role = creep?.memory?.role;
            if (role === 'defend-attack') counts.attack++;
            else if (role === 'defend-ranged') counts.ranged++;
            else if (role === 'defend-2attack') counts.doubleAttack++;
            else if (role === 'defend-2heal') counts.doubleHeal++;
        }
        cache.byRoom[room.name] = counts;
        return counts;
    };
})();

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
            // 无威胁时撤销未孵化的防御兵孵化任务，避免防御冷却期仍继续出兵
            this.deleteSpawnMissionsByRole(['defend-attack', 'defend-ranged', 'defend-2attack', 'defend-2heal']);
            if (this.memory['defendUntil'] && this.memory['defendUntil'] > Game.time) {
                this.memory.defend = true;
            } else {
                this.memory.defend = false;
                delete this.memory['defendUntil'];
                delete this.memory['defenseRamparts'];
                delete this.memory['breached'];
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
            const allowHeavyDefenseCalc = shouldRun({ minBucket: 2000, allowLevels: ['normal', 'constrained'] });
            if (!allowHeavyDefenseCalc) {
                this.memory['breached'] = true;
            } else {
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

                const blockedDefenseRampartPos = new Set<number>();
                const allStructures = this.find(FIND_STRUCTURES);
                for (const s of allStructures as Structure[]) {
                    const st = s.structureType;
                    if (st === STRUCTURE_RAMPART || st === STRUCTURE_ROAD || st === STRUCTURE_CONTAINER) continue;
                    blockedDefenseRampartPos.add((s.pos.x << 6) | s.pos.y);
                }

                const rampartCandidates = (this[STRUCTURE_RAMPART] as StructureRampart[])
                    .filter(r => r?.my && r.hits >= rampartMinHits && costs.get(r.pos.x, r.pos.y) === 1)
                    .filter(r => !blockedDefenseRampartPos.has((r.pos.x << 6) | r.pos.y));

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
            }
        } else {
            delete this.memory['defenseRamparts'];
            delete this.memory['breached'];
        }

        const defenderCounts = getDefenderCounts(this);
        const attackDefenderNum = defenderCounts.attack;
        const rangedDefenderNum = defenderCounts.ranged;
        const doubleAttackDefenderNum = defenderCounts.doubleAttack;
        const doubleHealDefenderNum = defenderCounts.doubleHeal;
        
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
        // 双人组队防御的成本很高（占用孵化与资源），只在“确实打不动/会被冲破”时启用。
        const useDouble =
            this.level >= 7 &&
            canDoubleAttackBoost &&
            canDoubleHealBoost &&
            (breached || hasBoostedThreat || (hasHealThreat && (hasMeleeThreat || hasRangedThreat)) || threatLevel >= 28);
        if (useDouble) {
            const desiredDouble = 1;
            if (doubleAttackDefenderNum + doubleAttackQueueNum < desiredDouble) {
                const body = this.GetRoleBodys('defend-2attack');
                const ret = this.SpawnMissionAdd('', body, -1, 'defend-2attack', {home: this.name} as any);
                if (ret === OK) this.AssignBoostTaskByBody(body, { [ATTACK]: 'XUH2O', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' });
            }
            if (doubleHealDefenderNum + doubleHealQueueNum < desiredDouble) {
                const body = this.GetRoleBodys('defend-2heal');
                const ret = this.SpawnMissionAdd('', body, -1, 'defend-2heal', {home: this.name} as any);
                if (ret === OK) this.AssignBoostTaskByBody(body, { [HEAL]: 'XLHO2', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' });
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

        // 把态势写入内存，便于防御 creep 做“追击/撤退”决策（为什么：主防判定应统一，避免各自为政）。
        this.memory['defenseState'] = breached
            ? 'breached'
            : enemyPressure >= 18 || enemyStats.boosted || enemyStats.heal > 0
              ? 'hold'
              : 'observe';

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
        if (useDouble) {
            desiredAttack = Math.min(desiredAttack, 1);
            desiredRanged = Math.min(desiredRanged, 1);
        }

        if (desiredAttack > 0 && (attackDefenderNum + attackQueueNum < desiredAttack)) {
            const body = this.GetRoleBodys('defend-attack');
            let mustBoost = false;
            if ((enemyStats.boosted || enemyStats.heal >= 10 || threatLevel > 20) &&
                this.level >= 7 && this['XUH2O'] >= 3000 && this['XZHO2'] >= 3000) mustBoost = true;
            const ret = this.SpawnMissionAdd('', body, -1, 'defend-attack', {home: this.name, mustBoost} as any);
            if (mustBoost) {
                if (ret === OK) this.AssignBoostTaskByBody(body, { [ATTACK]: 'XUH2O', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' });
            }
        }

        if (desiredRanged > 0 && (rangedDefenderNum + rangedQueueNum < desiredRanged)) {
            const body = this.GetRoleBodys('defend-ranged');
            let mustBoost = false;
            if ((enemyStats.boosted || enemyStats.heal >= 10 || threatLevel > 20) &&
                this.level >= 7 && this['XKHO2'] >= 3000 && this['XZHO2'] >= 3000) mustBoost = true;
            const ret = this.SpawnMissionAdd('', body, -1, 'defend-ranged', {home: this.name, mustBoost} as any);
            if (mustBoost) {
                if (ret === OK) this.AssignBoostTaskByBody(body, { [RANGED_ATTACK]: 'XKHO2', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' });
            }
        }
    }

    activateSafeMode() {
        if (!this.controller.safeModeAvailable) return;
        if (this.controller.safeModeCooldown) return;
        if (this.controller.upgradeBlocked) return;
        // 强威胁优先：高强度 boost 治疗团一旦压进来，若我方已有关键建筑被打爆（出现 Ruin），应立刻保全核心。
        const hostiles = this.find(FIND_HOSTILE_CREEPS, {
            filter: (c: Creep) =>
                c.owner.username !== 'Invader' &&
                !c.isWhiteList() &&
                c.body?.some(b => b.hits > 0 && b.type === HEAL && !!b.boost)
        }) as any as Creep[];
        if (hostiles.length) {
            const boostedHealParts = hostiles.reduce((sum, c) => {
                return sum + (c.body?.filter(b => b.hits > 0 && b.type === HEAL && !!b.boost).length || 0);
            }, 0);
            const threshold = this.level >= 8 ? 12 : this.level >= 7 ? 6 : 999;
            if (boostedHealParts >= threshold) {
                const hasMyRuin = this.find(FIND_RUINS, {
                    filter: (e: any) =>
                        e.structure?.owner &&
                        e.structure.owner.username === this.controller.owner.username &&
                        e.structure.structureType !== STRUCTURE_ROAD &&
                        e.structure.structureType !== STRUCTURE_CONTAINER &&
                        e.structure.structureType !== STRUCTURE_WALL &&
                        e.structure.structureType !== STRUCTURE_RAMPART &&
                        e.structure.structureType !== STRUCTURE_EXTRACTOR &&
                        e.structure.structureType !== STRUCTURE_LINK
                }).length;
                if (hasMyRuin) {
                    this.controller.activateSafeMode();
                    return true;
                }
            }
        }
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
        const dcm = global.DefenseCostMatrix[this.name];
        if (dcm && dcm.costMatrix &&
            typeof dcm.lastCheckTick === 'number' &&
            dcm.lastCheckTick + 5 > Game.time) {
            return dcm.costMatrix;
        }

        const RAM_MIN_HITS = 1e6;
        const room = this;
        const structuresIterable = (function* () {
            const iterArr = function* (arr: any) {
                if (!arr || !arr.length) return;
                for (let i = 0; i < arr.length; i++) yield arr[i];
            };

            yield* iterArr(room[STRUCTURE_SPAWN]);
            yield* iterArr(room[STRUCTURE_EXTENSION]);
            yield* iterArr(room[STRUCTURE_TOWER]);
            yield* iterArr(room[STRUCTURE_LINK]);
            yield* iterArr(room[STRUCTURE_LAB]);
            yield* iterArr(room[STRUCTURE_RAMPART]);
            yield* iterArr(room[STRUCTURE_WALL]);
            yield room[STRUCTURE_TERMINAL];
            yield room[STRUCTURE_STORAGE];
            yield room[STRUCTURE_NUKER];
            yield room[STRUCTURE_FACTORY];
            yield room[STRUCTURE_EXTRACTOR];
            yield room[STRUCTURE_OBSERVER];
            yield room[STRUCTURE_POWER_SPAWN];
        })();
        const structSig = getStructureSignature(structuresIterable, { rampartMinHits: RAM_MIN_HITS }).sig;

        if (dcm && dcm.sig === structSig) {
            dcm.lastCheckTick = Game.time;
            return dcm.costMatrix;
        }

        if (!global['DefenseCostMatrixBase']) global['DefenseCostMatrixBase'] = {};
        let base = global['DefenseCostMatrixBase'][this.name];
        if (!base) {
            if (!global['ROOM_EXITS']) global['ROOM_EXITS'] = {};
            let exits = global['ROOM_EXITS'][this.name];
            let visitedEXITS = !exits ? {
                [LEFT]: new Uint8Array(50),
                [RIGHT]: new Uint8Array(50),
                [TOP]: new Uint8Array(50),
                [BOTTOM]: new Uint8Array(50)
            } : null;
            exits = exits || [];

            const baseCosts = new PathFinder.CostMatrix();
            const baseAvoidArea = new Uint8Array(3200);
            const terrain = this.getTerrain();
            for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y++) {
                const xy = (x << 6) | y;
                if (terrain.get(x, y) == TERRAIN_MASK_WALL) {
                    baseCosts.set(x, y, 255);
                    baseAvoidArea[xy] = 1;
                    continue;
                }
                if (x > 0 && x < 49 && y > 0 && y < 49) continue;
                baseCosts.set(x, y, 255);
                baseAvoidArea[xy] = 1;
                if (visitedEXITS) {
                    const p = (x == 0) ? LEFT : (x == 49) ? RIGHT : (y == 0) ? TOP : BOTTOM;
                    const p2 = (p == LEFT || p == RIGHT) ? y : x;
                    visitedEXITS[p][p2] = 1;
                    if (visitedEXITS[p][p2 - 1]) continue;
                    exits.push([x, y]);
                }
            }}
            if (visitedEXITS) {
                global['ROOM_EXITS'][this.name] = exits;
                visitedEXITS = null;
            }

            base = global['DefenseCostMatrixBase'][this.name] = {
                costMatrix: baseCosts,
                avoidArea: baseAvoidArea,
            };
        }

        if (!global['DefenseCostMatrixScratch']) global['DefenseCostMatrixScratch'] = {};
        let scratch = global['DefenseCostMatrixScratch'][this.name];
        if (!scratch) {
            scratch = global['DefenseCostMatrixScratch'][this.name] = {
                avoidArea: new Uint8Array(3200),
                rampartCost1: new Uint8Array(3200),
                visitedMark: new Uint8Array(3200),
                visitedList: new Uint16Array(3200),
                barrierSeen: new Uint8Array(3200),
                barrierList: new Uint16Array(3200),
                queuePacked: new Uint16Array(3200),
                rampartPacked: new Uint16Array(3200),
                visitedLen: 0,
                barrierLen: 0,
                rampartLen: 0,
            };
        }

        const CPU_start = Game.cpu.getUsed();
        const costs = base.costMatrix.clone();
        const avoidArea: Uint8Array = scratch.avoidArea;
        const rampartCost1: Uint8Array = scratch.rampartCost1;
        const visitedMark: Uint8Array = scratch.visitedMark;
        const visitedList: Uint16Array = scratch.visitedList;
        const barrierSeen: Uint8Array = scratch.barrierSeen;
        const barrierList: Uint16Array = scratch.barrierList;
        const queuePacked: Uint16Array = scratch.queuePacked;
        const rampartPacked: Uint16Array = scratch.rampartPacked;

        avoidArea.set(base.avoidArea);
        rampartCost1.fill(0);
        if (scratch.visitedLen) {
            const len = scratch.visitedLen;
            for (let i = 0; i < len; i++) visitedMark[visitedList[i]] = 0;
            scratch.visitedLen = 0;
        }
        if (scratch.barrierLen) {
            const len = scratch.barrierLen;
            for (let i = 0; i < len; i++) barrierSeen[barrierList[i]] = 0;
            scratch.barrierLen = 0;
        }
        scratch.rampartLen = 0;
        const exits = global['ROOM_EXITS'][this.name] || [];
        const markStruct = (s: any) => {
            if (!s) return;
            if (s.structureType === STRUCTURE_RAMPART && s.my) {
                if (s.hits < RAM_MIN_HITS) return;
                if (costs.get(s.pos.x, s.pos.y) > 0) return;
                costs.set(s.pos.x, s.pos.y, 1);
                const xy = (s.pos.x << 6) | s.pos.y;
                rampartCost1[xy] = 1;
                rampartPacked[scratch.rampartLen++] = xy as any;
                return;
            }
            const xy = (s.pos.x << 6) | s.pos.y;
            if (avoidArea[xy]) return;
            costs.set(s.pos.x, s.pos.y, 255);
            avoidArea[xy] = 1;
        };
        const markStructArray = (arr: any) => {
            if (!arr || !arr.length) return;
            for (let i = 0; i < arr.length; i++) markStruct(arr[i]);
        };
        markStructArray(this[STRUCTURE_SPAWN]);
        markStructArray(this[STRUCTURE_EXTENSION]);
        markStructArray(this[STRUCTURE_TOWER]);
        markStructArray(this[STRUCTURE_LINK]);
        markStructArray(this[STRUCTURE_LAB]);
        markStructArray(this[STRUCTURE_RAMPART]);
        markStructArray(this[STRUCTURE_WALL]);
        markStruct(this[STRUCTURE_TERMINAL]);
        markStruct(this[STRUCTURE_STORAGE]);
        markStruct(this[STRUCTURE_NUKER]);
        markStruct(this[STRUCTURE_FACTORY]);
        markStruct(this[STRUCTURE_EXTRACTOR]);
        markStruct(this[STRUCTURE_OBSERVER]);
        markStruct(this[STRUCTURE_POWER_SPAWN]);

        const CPU_bfs = Game.cpu.getUsed();

        // BFS
        let head = 0;
        let tail = 0;
        for (let i = 0; i < exits.length; i++) {
            const p = exits[i];
            queuePacked[tail++] = ((p[0] << 6) | p[1]) as any;
        }
        for (; head < tail; head++) {
            const xy = queuePacked[head];
            const x = xy >> 6;
            const y = xy & 0b111111;
            costs.set(x, y, 255);
            avoidArea[xy] = 1;
            for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx == 0 && dy == 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
                const nextXY = (nx << 6) | ny;
                // 访问过的, 则跳过
                if (visitedMark[nextXY]) continue;
                visitedMark[nextXY] = 1;
                visitedList[scratch.visitedLen++] = nextXY as any;
                if (avoidArea[nextXY] || rampartCost1[nextXY]) {
                    if (!barrierSeen[nextXY]) {
                        barrierSeen[nextXY] = 1;
                        barrierList[scratch.barrierLen++] = nextXY as any;
                    }
                }
                else queuePacked[tail++] = nextXY as any;
            }}
        }
        const externalSearchCount = tail;
        for (let i = 0; i < scratch.visitedLen; i++) visitedMark[visitedList[i]] = 0;
        scratch.visitedLen = 0;

        for (let i = 0; i < scratch.barrierLen; i++) {
            const p = barrierList[i];
            barrierSeen[p] = 0;
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
        scratch.barrierLen = 0;

        const CPU_ramBFS = Game.cpu.getUsed();
        // 对ram广搜, 将与安全区相邻的标记为安全, 否则为危险
        let ram_BFS_length = 0;
        const rampartLen = scratch.rampartLen;
        for (let i = 0; i < rampartLen; i++) {
            const startXY = rampartPacked[i];
            if (!rampartCost1[startXY]) continue;
            if (visitedMark[startXY]) continue;
            visitedMark[startXY] = 1;
            visitedList[scratch.visitedLen++] = startXY as any;
            head = 0;
            tail = 0;
            queuePacked[tail++] = startXY as any;
            let safe = false;
            for (; head < tail; head++) {
                ram_BFS_length++;
                const xy = queuePacked[head];
                const x = xy >> 6;
                const y = xy & 0b111111;
                for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx == 0 && dy == 0) continue;
                    const nx = x + dx, ny = y + dy;
                    const nextXY = (nx << 6) | ny;
                    if (avoidArea[nextXY]) continue;
                    if (visitedMark[nextXY]) continue;
                    visitedMark[nextXY] = 1;
                    visitedList[scratch.visitedLen++] = nextXY as any;
                    if (rampartCost1[nextXY]) queuePacked[tail++] = nextXY as any;
                    else safe = true;
                }}
            }
            if (!safe) {
                for (let j = 0; j < tail; j++) {
                    const xy = queuePacked[j];
                    costs.set(xy >> 6, xy & 0b111111, 255);
                    rampartCost1[xy] = 0;
                }
            }
        }
        for (let i = 0; i < scratch.visitedLen; i++) visitedMark[visitedList[i]] = 0;
        scratch.visitedLen = 0;

        const CPU_end = Game.cpu.getUsed();

        if (show) {
            console.log(`[${this.name}] DefenseCostMatrix生成开销:`);
            console.log('- 地形建筑开销:', (CPU_bfs - CPU_start).toFixed(2));
            console.log('- BFS开销:', (CPU_ramBFS - CPU_bfs).toFixed(2), '外部搜索量:', externalSearchCount);
            console.log('- RAM BFS开销:', (CPU_end - CPU_ramBFS).toFixed(2), 'RAM搜索量:', ram_BFS_length);
            console.log('- 总开销:', (CPU_end - CPU_start).toFixed(4));
        }

        global.DefenseCostMatrix[this.name] = { sig: structSig, costMatrix: costs, lastCheckTick: Game.time };
        return costs;
    }

    getDefenseDangerCostMatrix(): CostMatrix {
        if (!global.DefenseDangerCostMatrix) global.DefenseDangerCostMatrix = {};
        const cache = global.DefenseDangerCostMatrix[this.name];
        if (cache && cache.tick === Game.time && cache.costMatrix) return cache.costMatrix;

        if (!global.DefenseDangerOffsets) {
            const r1: Array<[number, number, number]> = [];
            const r2: Array<[number, number, number]> = [];
            const r3: Array<[number, number, number]> = [];
            const r4: Array<[number, number, number]> = [];
            for (let dx = -4; dx <= 4; dx++) {
                for (let dy = -4; dy <= 4; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const d = Math.max(Math.abs(dx), Math.abs(dy));
                    if (d <= 1) r1.push([dx, dy, d]);
                    if (d <= 2) r2.push([dx, dy, d]);
                    if (d <= 3) r3.push([dx, dy, d]);
                    if (d <= 4) r4.push([dx, dy, d]);
                }
            }
            global.DefenseDangerOffsets = { r1, r2, r3, r4 };
        }

        const base = this.getDefenseCostMatrix(false);
        const matrix = base.clone();

        const hostiles = this.findEnemyCreeps({
            filter: (c: Creep) =>
                !!c?.body?.some((b: BodyPartDefinition) =>
                    b.type === ATTACK || b.type === RANGED_ATTACK
                )
        }) as any as Creep[];

        const apply = (x: number, y: number, add: number) => {
            if (x < 0 || x > 49 || y < 0 || y > 49) return;
            // 高血量自家 rampart 是安全点位：不应被危险区抬高 cost
            if (base.get(x, y) === 1) return;
            const old = matrix.get(x, y);
            if (old >= 254) return;
            const next = Math.min(253, old + add);
            if (next !== old) matrix.set(x, y, next);
        };

        const offsets = global.DefenseDangerOffsets;
        for (const hostile of hostiles) {
            if (!hostile?.pos || hostile.pos.roomName !== this.name) continue;
            const hasRanged = hostile.getActiveBodyparts(RANGED_ATTACK) > 0;
            const hasMelee = hostile.getActiveBodyparts(ATTACK) > 0;
            if (!hasRanged && !hasMelee) continue;

            const ox = hostile.pos.x;
            const oy = hostile.pos.y;

            if (hasRanged) {
                for (const [dx, dy, d] of offsets.r4 as Array<[number, number, number]>) {
                    apply(ox + dx, oy + dy, d <= 1 ? 80 : d <= 3 ? 45 : 25);
                }
            } else {
                for (const [dx, dy, d] of offsets.r2 as Array<[number, number, number]>) {
                    apply(ox + dx, oy + dy, d <= 1 ? 80 : 45);
                }
            }
        }

        global.DefenseDangerCostMatrix[this.name] = { tick: Game.time, costMatrix: matrix };
        return matrix;
    }

    getDefenseCreepCostCallback(excludeCreepName?: string): (roomName: string, costMatrix: CostMatrix) => CostMatrix {
        const roomName = this.name;
        return (rn: string, cm: CostMatrix) => {
            if (rn !== roomName) return cm;
            const base = this.getDefenseDangerCostMatrix();
            const matrix = base.clone();
            const creeps = this.find(FIND_CREEPS) as Creep[];
            for (const other of creeps) {
                if (!other?.pos) continue;
                if (excludeCreepName && other.name === excludeCreepName) continue;
                matrix.set(other.pos.x, other.pos.y, 255);
            }
            return matrix;
        };
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
                this.visual.circle(x, y, { fill: 'red', opacity: 0.2, radius: 0.5, stroke: 'red' });
            } else if (cost == 10) {
                // 黄色：rampart 内侧缓冲区
                this.visual.circle(x, y, { fill: 'yellow', opacity: 0.2, radius: 0.5, stroke: 'yellow' });
            } else if (cost == 1) {
                // 蓝色：rampart 位置
                this.visual.circle(x, y, { fill: 'blue', opacity: 0.2, radius: 0.5, stroke: 'blue' });
            } else if (cost == 0) {
                // 绿色：默认可通行区域
                this.visual.circle(x, y, { fill: 'green', opacity: 0.2, radius: 0.5, stroke: 'green' });
            } else {
                // 灰色：意外Cost区域
                this.visual.circle(x, y, { fill: 'gray', opacity: 0.2, radius: 0.5, stroke: 'gray' });
            }
        }}
    }
}
