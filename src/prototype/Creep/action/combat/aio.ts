import { BehaviorTree, BtStatus, condition, fail, leaf, selector, sequence } from '@/framework/ai/behaviorTree';
import { getRoomTickCacheValue } from '@/shared/roomTickCache';

type AioContext = {
    creep: Creep;
    baseName: string;
};

type AttackTarget = Creep | PowerCreep | Structure | ConstructionSite;

const getRoomNonWhitelistHostiles = (creep: Creep) =>
    getRoomTickCacheValue(creep.room, 'aio_room_non_whitelist_hostiles', () =>
        creep.room.find(FIND_HOSTILE_CREEPS, { filter: (e) => !e.isWhiteList() }) as Creep[]
    );

const getRoomHostileStructures = (creep: Creep) =>
    getRoomTickCacheValue(creep.room, 'aio_room_hostile_structures', () =>
        creep.room.find(FIND_HOSTILE_STRUCTURES) as Structure[]
    );

const getRoomNonRoadStructures = (creep: Creep) =>
    getRoomTickCacheValue(creep.room, 'aio_room_non_road_structures', () =>
        creep.room.find(FIND_STRUCTURES, { filter: (e) => e.hits && e.structureType !== STRUCTURE_ROAD }) as AnyStructure[]
    );

const findNonWhitelistHostilesInRange = (creep: Creep, range: number, filter?: (e: Creep) => boolean) => {
    const hostiles = getRoomNonWhitelistHostiles(creep).filter((e) => creep.pos.inRangeTo(e, range));
    return filter ? hostiles.filter(filter) : hostiles;
};

const getAioBaseName = (creep: Creep) => creep.name.match(/#(\w+)/)?.[1] ?? creep.name;

const getFlag = (name: string) => Game.flags?.[name];

const getAioFlag = (baseName: string) => getFlag(`aio-${baseName}`);

const getMoveFlag = (baseName: string) => getFlag(`${baseName}-move`);

const hasEnemyTower = (creep: Creep) => (creep.room.tower || []).some((tower) => !tower.my);

const isInnerRoomPosition = (pos: RoomPosition) => pos.x > 2 && pos.x < 47 && pos.y > 2 && pos.y < 47;

const findBoostedThreat = (creep: Creep) =>
    findNonWhitelistHostilesInRange(creep, 3, (e) => e.body.some((part) => part.boost === 'XUH2O'))[0] || null;

const rangedAttackNearby = (creep: Creep) => {
    const nearHostiles = findNonWhitelistHostilesInRange(creep, 1);
    if (nearHostiles.length) {
        creep.rangedMassAttack();
        return;
    }
    const farHostiles = findNonWhitelistHostilesInRange(creep, 3);
    if (farHostiles.length) {
        creep.rangedAttack(farHostiles.reduce((a, b) => a.hits < b.hits ? a : b));
    }
};

const findAttackTarget = (creep: Creep, baseName: string): AttackTarget | null => {
    const flag = getAioFlag(baseName);

    const cachedTarget = Game.getObjectById(creep.memory.targetId) as AttackTarget | null;
    if (cachedTarget) return cachedTarget;

    if (flag?.room) {
        const structure = flag.pos.lookFor(LOOK_STRUCTURES).find((s: any) => !s.my);
        if (structure) return structure;
    }

    const targets = [
        creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
            filter: (e) => !!e.hits && !e.pos.coverRampart()
        }),
        creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS, {
            filter: (e) => e.body.length > 2 && !e.body.some((p) => p.type === RANGED_ATTACK) && !e.pos.coverRampart() && !e.isWhiteList()
        }),
        creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS, {
            filter: (e) => e.body.length > 2 && !e.body.some((p) => p.type === TOUGH && p.boost) && !e.pos.coverRampart() && !e.isWhiteList()
        }),
        creep.pos.findClosestByPath(FIND_HOSTILE_POWER_CREEPS, {
            filter: (e) => !e.pos.coverRampart() && !e.isWhiteList()
        }),
        creep.pos.findClosestByPath(FIND_HOSTILE_CONSTRUCTION_SITES, {
            filter: (e) => !!e.progress && !e.pos.coverRampart()
        }),
        creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
            filter: (e) => e.structureType === STRUCTURE_SPAWN
        }),
        creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
            filter: (e) => !!e.hits && e.structureType !== STRUCTURE_RAMPART
        }),
    ];

    for (const target of targets) {
        if (target) return target;
    }

    if (creep.room.controller?.owner && !creep.room.my) {
        const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: (e) => !!e.hits && e.structureType !== STRUCTURE_ROAD
        });
        if (target) return target;
    }

    const hostileStructure = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: (e) => e.structureType !== STRUCTURE_INVADER_CORE && e.structureType !== STRUCTURE_CONTROLLER
    });
    if (hostileStructure) return hostileStructure;

    const armedHostile = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS, {
        filter: (e) => !e.pos.coverRampart() && !e.isWhiteList() && e.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK)
    });
    if (armedHostile) return armedHostile;

    const nearbyHostile = findNonWhitelistHostilesInRange(creep, 3, (e) => !e.pos.coverRampart())[0];
    if (nearbyHostile) return nearbyHostile;

    return getRoomHostileStructures(creep).find((e) =>
        creep.pos.inRangeTo(e, 3) && !!e.hits && !e.pos.coverRampart() && e.structureType !== STRUCTURE_ROAD
    ) || null;
};

const executeAttack = (creep: Creep, target: AttackTarget) => {
    const isStructure = 'structureType' in target;
    const isCreep = 'body' in target;

    creep.room.visual?.text?.('_', target.pos.x, target.pos.y + 0.35, { color: 'red', opacity: 0.75, font: 1 });

    if (isStructure) {
        executeStructureAttack(creep, target as Structure);
    } else if (isCreep) {
        executeCreepAttack(creep, target as Creep | PowerCreep);
    } else {
        executeDefaultAttack(creep, target);
    }
};

const executeStructureAttack = (creep: Creep, target: Structure) => {
    creep.moveTo(target);

    if (creep.pos.isNearTo(target) && (target.pos.coverRampart() || 'owner' in target)) {
        const altTarget = findNonWhitelistHostilesInRange(creep, 3, (e) => !e.pos.coverRampart() && !creep.pos.isNearTo(e))[0];
        if (altTarget) creep.rangedAttack(altTarget);
        else creep.rangedMassAttack();
        return;
    }

    if (creep.rangedAttack(target) === ERR_NOT_IN_RANGE) {
        tryAttackNearbyStructure(creep);
    }

    const altTarget = findNonWhitelistHostilesInRange(creep, 3, (e) => !e.pos.coverRampart() && !creep.pos.isNearTo(e))[0];
    if (altTarget) creep.rangedAttack(altTarget);
};

const executeCreepAttack = (creep: Creep, target: Creep | PowerCreep) => {
    creep.moveTo(target);

    if (creep.pos.isNearTo(target)) {
        creep.rangedMassAttack();
        return;
    }

    const result = creep.rangedAttack(target);
    if (result === ERR_NOT_IN_RANGE && creep.room.controller?.owner && !creep.room.my) {
        tryAttackNearbyStructure(creep);
    }
};

const executeDefaultAttack = (creep: Creep, target: AttackTarget) => {
    if (creep.pos.isNearTo(target)) {
        creep.rangedMassAttack();
    } else if (creep.pos.inRangeTo(target, 3)) {
        creep.rangedAttack(target as any);
    }
    if (!creep.pos.inRangeTo(target, 1)) {
        creep.moveTo(target);
    }
};

const tryAttackNearbyStructure = (creep: Creep) => {
    if (!creep.room.controller?.owner || creep.room.my) return;
    const structure = creep.pos.findClosestByRange(getRoomNonRoadStructures(creep));
    if (structure) creep.rangedAttack(structure);
};

const tryRetreat = (creep: Creep) => {
    if (creep.hits + 1300 >= creep.hitsMax) return;
    const exit = creep.pos.findClosestByPath(FIND_EXIT);
    if (exit) creep.moveTo(exit);
};

const autoAttack = (creep: Creep, baseName: string) => {
    const target = findAttackTarget(creep, baseName);
    if (target) {
        executeAttack(creep, target);
    }
    tryRetreat(creep);
};

const runBoostedThreatRetreat = (creep: Creep, threat: Creep) => {
    if (creep.room.level > 0 && !creep.room.my && creep.room.tower) {
        const exit = creep.pos.findClosestByPath(FIND_EXIT);
        if (exit) creep.moveTo(exit);
        creep.rangedMassAttack();
        return;
    }

    if (creep.pos.inRangeTo(threat, 2)) {
        const range = creep.pos.getRangeTo(threat) + 1;
        const path = PathFinder.search(creep.pos, { pos: threat.pos, range }, { flee: true }).path;
        creep.moveByPath(path);
        creep.rangedAttack(threat);

        const exit = creep.pos.findClosestByPath(FIND_EXIT);
        if (exit && creep.pos.isNear(exit) && creep.pos.isNearTo(threat)) {
            creep.moveTo(exit);
        }
        return;
    }

    if (creep.pos.inRangeTo(threat, 3)) {
        creep.rangedAttack(threat);
    }
};

const shouldAdvanceToTargetRoom = (creep: Creep) => {
    if (!creep.memory.targetRoom) return false;
    if (creep.room.name === creep.memory.targetRoom) return false;

    const heavilyDamaged = (creep.hitsMax - creep.hits) > 1300;
    if (heavilyDamaged && !isInnerRoomPosition(creep.pos) && !hasEnemyTower(creep)) return true;
    return !heavilyDamaged;
};

const runAdvanceToTargetRoom = (ctx: AioContext) => {
    const { creep, baseName } = ctx;
    const heavilyDamaged = (creep.hitsMax - creep.hits) > 1300;

    rangedAttackNearby(creep);

    if (heavilyDamaged && !isInnerRoomPosition(creep.pos) && !hasEnemyTower(creep)) {
        creep.moveTo(new RoomPosition(25, 25, creep.room.name));
        return;
    }

    const assaultFlagPos = getAioFlag(baseName)?.pos;
    if (assaultFlagPos) {
        creep.moveTo(assaultFlagPos);
    } else {
        creep.moveToRoom(creep.memory.targetRoom);
    }
};

const shouldRecoverInTargetRoom = (creep: Creep) =>
    creep.room.name === creep.memory.targetRoom && creep.hits + 1300 < creep.hitsMax;

const runRecoverInTargetRoom = (creep: Creep) => {
    rangedAttackNearby(creep);
    creep.moveTo(new RoomPosition(25, 25, creep.room.name));
};

const createAioBehaviorTree = () =>
    new BehaviorTree<AioContext>(
        sequence(
            leaf((ctx) => {
                ctx.creep.heal(ctx.creep);
                return BtStatus.Success;
            }),
            selector(
                condition(
                    (ctx) => !!findBoostedThreat(ctx.creep),
                    leaf((ctx) => {
                        runBoostedThreatRetreat(ctx.creep, findBoostedThreat(ctx.creep)!);
                        return BtStatus.Running;
                    }),
                    fail()
                ),
                condition(
                    (ctx) => !!getMoveFlag(ctx.baseName),
                    leaf((ctx) => {
                        const flag = getMoveFlag(ctx.baseName)!;
                        if (ctx.creep.room.name !== flag.pos.roomName) {
                            ctx.creep.memory.targetRoom = flag.pos.roomName;
                        }
                        ctx.creep.moveTo(flag.pos, { visualizePathStyle: { stroke: '#0000ff' } });
                        return BtStatus.Running;
                    }),
                    fail()
                ),
                condition(
                    (ctx) => shouldAdvanceToTargetRoom(ctx.creep),
                    leaf((ctx) => {
                        runAdvanceToTargetRoom(ctx);
                        return BtStatus.Running;
                    }),
                    fail()
                ),
                condition(
                    (ctx) => shouldRecoverInTargetRoom(ctx.creep),
                    leaf((ctx) => {
                        runRecoverInTargetRoom(ctx.creep);
                        return BtStatus.Running;
                    }),
                    fail()
                ),
                leaf((ctx) => {
                    autoAttack(ctx.creep, ctx.baseName);
                    return BtStatus.Success;
                })
            )
        )
    );

const aio = {
    prepare: (creep) => {
        return creep.ensureBoosted(creep.memory['boostmap']);
    },
    run: (creep) => {
        creep.disableAttackNotificationsOnce();
        createAioBehaviorTree().tick({
            creep,
            baseName: getAioBaseName(creep),
        });
    }
};

export default aio;
