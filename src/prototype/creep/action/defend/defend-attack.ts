import {
    getStableStartIndex,
    isDefenseRampartLockActive,
    isDefenseRampartValid,
    isPosOccupiedByOtherCreep,
    scoreRampart,
    shouldSwitchDefenseRampart
} from '@/modules/utils/defenseUtils';

const DEFENSE_RAMPART_LOCK_TTL = 25;
const DEFENSE_RAMPART_SWITCH_THRESHOLD = 2;

const autoDefend = function (creep: Creep) {
    // 使用 findHostileCreeps 方法查找敌对 creep
    const hostileCreeps = creep.findHostileCreeps() as Creep[];
    // 如果没有敌对 creep，也可以考虑是否继续执行或返回
    if (hostileCreeps.length === 0) {
        return;
    }

    const mem = creep.room.memory['defenseRamparts'];
    const minHits = (mem && mem.minHits) ? mem.minHits : (creep.room.memory['breached'] ? 1e5 : 1e6);
    let targetRampart: StructureRampart | null = null;

    // 防御站位粘性：在锁定期内尽量坚持同一 rampart，避免多敌人/多防御 creep 造成来回抖动
    const lockUntil = creep.memory['defenseRampartLockUntil'] as number | undefined;
    const lockActive = isDefenseRampartLockActive(lockUntil);
    const lockedRampartId = creep.memory['defenseRampartId'] as Id<StructureRampart> | undefined;

    // 如果当前已经站在可用 rampart 上，则直接刷新锁（优先保证稳定驻守）
    const standingRampart = creep.pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_RAMPART) as
        | StructureRampart
        | undefined;
    if (standingRampart && isDefenseRampartValid(creep.room, standingRampart, minHits)) {
        creep.memory['defenseRampartId'] = standingRampart.id;
        creep.memory['defenseRampartLockUntil'] = Game.time + DEFENSE_RAMPART_LOCK_TTL;
        creep.memory['defenseRampartBlockedTicks'] = 0;
        targetRampart = standingRampart;
    }

    // 锁定期内优先使用已选 rampart（仅当点位本身失效或被其它 creep 占用时才放弃）
    if (!targetRampart && lockActive && lockedRampartId) {
        const r = Game.getObjectById(lockedRampartId);
        if (r && isDefenseRampartValid(creep.room, r, minHits)) {
            if (creep.pos.isEqualTo(r.pos) || !isPosOccupiedByOtherCreep(creep.room, r.pos, creep.name)) {
                targetRampart = r;
            } else {
                creep.memory['defenseRampartBlockedTicks'] = ((creep.memory['defenseRampartBlockedTicks'] as number) || 0) + 1;
                // 被占用时直接释放锁，避免“互相抢点位”导致持续往返
                delete creep.memory['defenseRampartId'];
                delete creep.memory['defenseRampartLockUntil'];
            }
        } else {
            delete creep.memory['defenseRampartId'];
            delete creep.memory['defenseRampartLockUntil'];
        }
    }

    // 优先使用房间缓存的防御点位列表，并用稳定起始索引避免所有 creep 从 index0 抢点
    if (
        !targetRampart &&
        mem &&
        mem.tick &&
        mem.tick + 15 >= Game.time &&
        Array.isArray(mem.melee) &&
        mem.melee.length > 0
    ) {
        const startIndex = getStableStartIndex(creep.name, mem.melee.length);
        for (let i = 0; i < mem.melee.length; i++) {
            const id = mem.melee[(startIndex + i) % mem.melee.length];
            const r = Game.getObjectById(id as Id<StructureRampart>);
            if (!r || !isDefenseRampartValid(creep.room, r, minHits)) continue;
            if (!creep.pos.isEqualTo(r.pos) && isPosOccupiedByOtherCreep(creep.room, r.pos, creep.name)) continue;
            targetRampart = r;
            break;
        }
    }
    
    if (!targetRampart) {
        const ramparts = creep.room.rampart.filter(r => {
            if (!isDefenseRampartValid(creep.room, r, minHits)) return false;
            if (!creep.pos.isEqualTo(r.pos) && isPosOccupiedByOtherCreep(creep.room, r.pos, creep.name)) return false;
            return true;
        });

        let best: StructureRampart | null = null;
        let bestScore = -Infinity;
        for (const r of ramparts) {
            const s = scoreRampart(r.pos, hostileCreeps as any, 'melee');
            if (s > bestScore) {
                bestScore = s;
                best = r;
            }
        }

        const currentId = creep.memory['defenseRampartId'] as Id<StructureRampart> | undefined;
        const current = currentId ? Game.getObjectById(currentId) : null;
        if (current && isDefenseRampartValid(creep.room, current, minHits)) {
            if (creep.pos.isEqualTo(current.pos)) {
                targetRampart = current;
            } else if (best) {
                const currentScore = scoreRampart(current.pos, hostileCreeps as any, 'melee');
                if (!shouldSwitchDefenseRampart(currentScore, bestScore, DEFENSE_RAMPART_SWITCH_THRESHOLD)) {
                    targetRampart = current;
                } else {
                    targetRampart = best;
                }
            } else {
                targetRampart = current;
            }
        } else {
            targetRampart = best;
        }
    }

    if (targetRampart && creep.memory['defenseRampartId'] !== targetRampart.id) {
        creep.memory['defenseRampartId'] = targetRampart.id;
        creep.memory['defenseRampartLockUntil'] = Game.time + DEFENSE_RAMPART_LOCK_TTL;
        creep.memory['defenseRampartBlockedTicks'] = 0;
    }

    if (targetRampart && !creep.pos.isEqualTo(targetRampart.pos)) {
        creep.moveTo(targetRampart.pos, {
            visualizePathStyle: { stroke: '#ff0000' },
            range: 0,
            costCallback: creep.room.getDefenseCreepCostCallback(creep.name)
        });
        const movingTarget = creep.pos.findClosestByRange(hostileCreeps);
        if (movingTarget) creep.room.CallTowerAttack(movingTarget);
        return;
    }

    const focusId = creep.room.memory['_towerFocus']?.id as Id<Creep | PowerCreep> | undefined;
    const focus = focusId ? (Game.getObjectById(focusId) as any) : null;
    const target = (focus && focus.pos?.roomName === creep.room.name ? focus : null) || creep.pos.findClosestByRange(hostileCreeps);
    if(target) {
        if (creep.pos.isNearTo(target)) {
            const result = creep.attack(target);
            if(result == OK) creep.room.CallTowerAttack(target);
        } else {
            const state = creep.room.memory['defenseState'];
            const hasRamparts = Array.isArray(creep.room[STRUCTURE_RAMPART]) && creep.room[STRUCTURE_RAMPART].length > 0;
            if (state === 'breached' || !hasRamparts) {
                // 破口/无工事时必须主动贴脸，否则敌人会持续推进（ 近战是“止损位”，不出手就会丢核心）。
                delete creep.memory['defenseRampartId'];
                delete creep.memory['defenseRampartLockUntil'];
                creep.memory['defenseRampartBlockedTicks'] = 0;
                creep.moveTo(target, {
                    visualizePathStyle: { stroke: '#ff0000' },
                    range: 1,
                    costCallback: creep.room.getDefenseCreepCostCallback(creep.name)
                });
                creep.room.CallTowerAttack(target);
                return;
            }
            // 有工事且未破口时不追击：继续守点压制入口（ 追击会导致防线被拉开、被对方逐个击破）。
            creep.room.CallTowerAttack(target);
        }
    }
}


const defend_attack = {
    run: function (creep: Creep) {
        if (!creep.memory.boosted) {
            const must = !!creep.memory['mustBoost'];
            const boostmap = must ? {
                [ATTACK]: ['XUH2O'],
                [MOVE]: ['XZHO2'],
            } : {
                [ATTACK]: ['XUH2O', 'UH2O', 'UH'],
                [MOVE]: ['XZHO2', 'ZHO2', 'ZO'],
            };
            creep.memory.boosted = creep.goBoost(boostmap as any, { must }) === OK;
            return
        }
        autoDefend(creep);
    }
}

export default defend_attack
