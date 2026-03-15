type Step = () => boolean;

export function runOperate(pc: PowerCreep): boolean {
    const name = pc.name;
    const flag = Game.flags[`${name}-move`];

    const flagHome = Game.flags[`${pc.name}-home`];
    const steps: Step[] = [
        () => {
            if (!flag || pc.pos.inRangeTo(flag, 0)) return false;
            pc.Generate_OPS();
            pc.moveTo(flag, { visualizePathStyle: { stroke: '#ff0000' }, plainCost: 1, swampCost: 1 });
            return true;
        },
        () => {
            if (!flagHome) return false;
            if (pc.room.name === flagHome.pos.roomName && !pc.pos.isRoomEdge()) return false;
            pc.moveTo(flagHome, { plainCost: 1, swampCost: 1 });
            return true;
        },
        () => pc.PowerEnabled(),
        () => pc.Generate_OPS(),
        () => shouldPrioritizeOperateStorage(pc) && pc.Operate_Storage(),
        () => pc.room.my && pc.transferOPS(),
        () => pc.room.my && pc.withdrawOPS(),
    ];

    for (const step of steps) {
        if (step()) return true;
    }

    const powerHandlers: Array<[PowerConstant, (pc: PowerCreep) => boolean]> = [
        [PWR_REGEN_SOURCE, p => p.Regen_Source()],
        [PWR_REGEN_MINERAL, p => p.Regen_Mineral()],
        [PWR_OPERATE_SPAWN, p => p.Operate_Spawn()],
        [PWR_OPERATE_EXTENSION, p => p.Operate_Extension()],
        [PWR_OPERATE_STORAGE, p => p.Operate_Storage()],
        [PWR_OPERATE_TOWER, p => p.Operate_Tower()],
        [PWR_OPERATE_FACTORY, p => p.Operate_Factory()],
        [PWR_OPERATE_LAB, p => p.Operate_Lab()],
        [PWR_OPERATE_POWER, p => p.Operate_Power()]
    ];

    for (const [powerID, handler] of powerHandlers) {
        const power = pc.powers[powerID];
        if (!power || power.cooldown) continue;
        if (handler(pc)) return true;
    }

    const idleFlag = Game.flags[`${name}-idle`] || Game.flags[`${name}-IDLE`] || flagHome;
    if (idleFlag && pc.room.name == idleFlag.pos.roomName && !pc.pos.isEqualTo(idleFlag.pos)) {
        if (!canStandOn(pc.room, idleFlag.pos)) return true;
        pc.moveTo(idleFlag, { plainCost: 1, swampCost: 1 });
    }
    return true;
}

function shouldPrioritizeOperateStorage(pc: PowerCreep): boolean {
    if (!pc.room.my) return false;

    const storage = pc.room.storage;
    if (!storage) return false;
    if ((pc.store[RESOURCE_OPS] || 0) < 100) return false;
    if (storage.store.getFreeCapacity() > 5000) return false;
    if (storage.effects?.some(e => e.effect == PWR_OPERATE_STORAGE && e.ticksRemaining > 0)) return false;

    const power = pc.powers[PWR_OPERATE_STORAGE];
    if (!power || power.cooldown > 0) return false;

    return true;
}

function canStandOn(room: Room, pos: RoomPosition): boolean {
    if (room.getTerrain().get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;
    const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y) as AnyStructure[];
    for (const s of structures) {
        if (s.structureType === STRUCTURE_ROAD || s.structureType === STRUCTURE_CONTAINER) continue;
        if (s.structureType === STRUCTURE_RAMPART) {
            const r = s as StructureRampart;
            if (r.my || r.isPublic) continue;
            return false;
        }
        if ((OBSTACLE_OBJECT_TYPES as StructureConstant[]).includes(s.structureType)) return false;
    }
    return true;
}
