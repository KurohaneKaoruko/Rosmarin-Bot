import { BehaviorTree, BtStatus, condition, fail, leaf, selector, sequence } from '@/framework/ai/behaviorTree';
import { createBoostedRole } from '@/framework/ai/creepRole';
import { getRoomTickCacheValue } from '@/shared/roomTickCache';

type AioContext = {
    creep: Creep;
    baseName: string;
};

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
        creep.room.find(FIND_STRUCTURES, { filter: (e) => e.hits && e.structureType != STRUCTURE_ROAD }) as AnyStructure[]
    );

const findNonWhitelistHostilesInRange = (creep: Creep, range: number, filter?: (e: Creep) => boolean) => {
    const hostiles = getRoomNonWhitelistHostiles(creep).filter((e) => creep.pos.inRangeTo(e, range));
    return filter ? hostiles.filter(filter) : hostiles;
};

const getAioBaseName = (creep: Creep) => creep.name.match(/_(\w+)/)?.[1] ?? creep.name;

const getFlag = (name: string) => Game.flags?.[name];

const getAioFlag = (baseName: string) => getFlag(`aio-${baseName}`);

const getMoveFlag = (baseName: string) => getFlag(`${baseName}-move`);

const hasEnemyTower = (creep: Creep) => (creep.room.tower || []).some((tower) => !tower.my);

const isInnerRoomPosition = (pos: RoomPosition) => pos.x > 2 && pos.x < 47 && pos.y > 2 && pos.y < 47;

const findBoostedThreat = (creep: Creep) =>
    findNonWhitelistHostilesInRange(creep, 3, (e) =>
        e.body.some((part) => part.boost === 'XUH2O')
    )[0] || null;

const rangedAttackNearby = (creep: Creep) => {
    let creeps = findNonWhitelistHostilesInRange(creep, 1);
    if (creeps.length) {
        creep.rangedMassAttack();
        return;
    }

    creeps = findNonWhitelistHostilesInRange(creep, 3);
    if (creeps.length) {
        creep.rangedAttack(creeps.reduce((a, b) => a.hits < b.hits ? a : b));
    }
};

const autoAttack = (creep: Creep) => {
    const baseName = getAioBaseName(creep);
    const flag = getAioFlag(baseName);

    let em = Game.getObjectById(creep.memory.targetId) as Creep | Structure;
    let isHostileCreep = false;
    let isHostileConstruction = false;

    if (!em) em = flag && flag.room && flag.pos.lookFor(LOOK_STRUCTURES).find((e: any) => !e.my);
    if (!em) em = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, { range: 3, filter: e => e.hits && e.structureType != STRUCTURE_WALL && e.structureType != STRUCTURE_ROAD && !e.pos.coverRampart() });
    if (!em) {
        em = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS, { filter: e => e.body.length > 2 && !e.body.some(e => e.type == RANGED_ATTACK) && !e.pos.coverRampart() && !e.isWhiteList() });
        if (em) isHostileCreep = true;
    }
    if (!em) {
        em = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS, { filter: e => e.body.length > 2 && !e.body.some(e => e.type == TOUGH && e.boost) && !e.pos.coverRampart() && !e.isWhiteList() });
        if (em) isHostileCreep = true;
    }
    if (!em) em = creep.pos.findClosestByPath(FIND_HOSTILE_POWER_CREEPS, { filter: e => !e.pos.coverRampart() && !e.isWhiteList() });
    if (!em) {
        em = creep.pos.findClosestByPath(FIND_HOSTILE_CONSTRUCTION_SITES, { filter: e => e.progress && !e.pos.coverRampart() });
    }
    if (!em) em = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, { filter: e => e.structureType == STRUCTURE_SPAWN });
    if (!em) em = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, { filter: e => e.hits && e.structureType != STRUCTURE_RAMPART });
    if (!em && creep.room.controller && creep.room.controller.owner && !creep.room.my) {
        em = creep.pos.findClosestByPath(FIND_STRUCTURES, { filter: e => e.hits && e.structureType != STRUCTURE_ROAD });
    }
    if (!em) em = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, { filter: e => e.structureType != STRUCTURE_INVADER_CORE && e.structureType != STRUCTURE_CONTROLLER && e.structureType != STRUCTURE_ROAD });
    if (!em) {
        em = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS, { filter: e => !e.pos.coverRampart() && !e.isWhiteList() && e.body.some(e => e.type == ATTACK || e.type == RANGED_ATTACK) });
        if (em) isHostileCreep = true;
    }
    if (!em) em = findNonWhitelistHostilesInRange(creep, 3, (e) => !e.pos.coverRampart())[0];
    if (!em) {
        em = getRoomHostileStructures(creep).find((e) =>
            creep.pos.inRangeTo(e, 3) &&
            !!e.hits &&
            !e.pos.coverRampart() &&
            e.structureType != STRUCTURE_ROAD
        ) || null;
    }

    if (em) creep.room.visual?.text?.('_', em.pos.x, em.pos.y + 0.35, { color: 'red', opacity: 0.75, font: 1 });
    if (em && (em as any).structureType) isHostileConstruction = true;

    if (isHostileConstruction) {
        creep.moveTo(em);
        if (creep.pos.isNearTo(em) && (em.pos.coverRampart() || (em as any).owner)) {
            let em1 = findNonWhitelistHostilesInRange(creep, 3, (e) => !e.pos.coverRampart() && !creep.pos.isNearTo(e))[0];
            if (em1) creep.rangedAttack(em1);
            else creep.rangedMassAttack();
        } else if (creep.rangedAttack(em) == ERR_NOT_IN_RANGE) {
            if (creep.room.controller && creep.room.controller.owner && !creep.room.my) {
                em = creep.pos.findClosestByRange(getRoomNonRoadStructures(creep));
                if (em) creep.rangedAttack(em as any);
            }
        }
        const em1 = findNonWhitelistHostilesInRange(creep, 3, (e) => !e.pos.coverRampart() && !creep.pos.isNearTo(e))[0];
        if (em1) creep.rangedAttack(em1);
    } else if (isHostileCreep && em) {
        creep.moveTo(em);
        if (creep.pos.isNearTo(em) && 'body' in em) {
            creep.rangedMassAttack();
        } else if (creep.rangedAttack(em as Creep) == ERR_NOT_IN_RANGE) {
            if (creep.room.controller && creep.room.controller.owner && !creep.room.my) {
                em = creep.pos.findClosestByRange(getRoomNonRoadStructures(creep));
                if (em) creep.rangedAttack(em as any);
            } else if (creep.pos.isNearTo(em) && (em as any).structureType != STRUCTURE_WALL && (em as any).structureType != STRUCTURE_ROAD && (em as any).structureType != STRUCTURE_CONTAINER) {
                creep.rangedMassAttack();
            }
        }
    } else if (em) {
        if (creep.pos.isNearTo(em)) {
            creep.rangedMassAttack();
        } else if (creep.pos.inRangeTo(em, 3)) {
            creep.rangedAttack(em as any);
        }
        if (!creep.pos.inRangeTo(em, 1)) {
            creep.moveTo(em);
        }
    }

    if (creep.hits + 1300 < creep.hitsMax) {
        const exit = creep.pos.findClosestByPath(FIND_EXIT);
        if (exit) creep.moveTo(exit);
    }
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
    if (!heavilyDamaged) return true;
    return false;
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
                    autoAttack(ctx.creep);
                    return BtStatus.Success;
                })
            )
        )
    );

const aioBoost = {
    [TOUGH]: ['XGHO2'],
    [HEAL]: ['XLHO2'],
    [RANGED_ATTACK]: ['XKHO2'],
    [MOVE]: ['XZHO2']
};

const aio = createBoostedRole({
    boost: (creep) => creep.memory['boostmap'] || aioBoost,
    run: (creep) => {
        creep.disableAttackNotificationsOnce();
        createAioBehaviorTree().tick({
            creep,
            baseName: getAioBaseName(creep),
        });
    }
});

export default aio;
