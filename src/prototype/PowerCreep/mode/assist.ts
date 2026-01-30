import { RoleData } from '@/constant/CreepConstant';

export function runAssist(pc: PowerCreep, assistFlag: Flag): boolean {
    const PC_RETREAT_TTL = 800;
    const PC_RECOVER_TTL = 2000;
    const HEALER_RETREAT_TTL = 250;

    const name = pc.name;
    const mem = pc.memory as any;

    const targetRoom = assistFlag.pos.roomName;
    mem.assistTargetRoom = targetRoom;

    const idleFlag = Game.flags[`${name}-idle`];
    const homeFlag = Game.flags[`${name}-home`];
    const idleRoom = idleFlag?.pos.roomName || homeFlag?.pos.roomName || mem.spawnRoom || pc.room.name;

    const idlePos =
        (idleFlag && idleFlag.pos.roomName === idleRoom ? idleFlag.pos : undefined) ||
        (homeFlag && homeFlag.pos.roomName === idleRoom ? homeFlag.pos : undefined) ||
        new RoomPosition(25, 25, idleRoom);

    mem.assistIdleRoom = idleRoom;

    const healerName = mem.healerName as string | undefined;
    const healer = healerName ? Game.creeps[healerName] : undefined;
    if (healer && healer.memory.role !== 'pc-heal') {
        mem.healerName = undefined;
    }
    if (healerName && !healer) {
        mem.healerName = undefined;
    }

    if (!mem.healerName) {
        const candidate = Object.values(Game.creeps).find(
            c => c.memory.role === 'pc-heal' && (c.memory as any).targetPcName === pc.name
        );
        if (candidate) mem.healerName = candidate.name;
    }

    const activeHealer = mem.healerName ? Game.creeps[mem.healerName] : undefined;
    const healerOk = !!activeHealer && activeHealer.ticksToLive > HEALER_RETREAT_TTL;

    const targetRoomObj = Game.rooms[targetRoom];
    const targetController = targetRoomObj?.controller;
    if (targetController?.safeMode) {
        mem.assistAbortReason = 'safeMode';
        assistFlag.remove();
        mem.assistState = 'retreat';
    }

    const controller = pc.room.controller;
    if (pc.room.name === targetRoom && controller && controller.my && !controller.isPowerEnabled) {
        const reachable = isControllerReachable(pc.pos, controller);
        if (reachable) {
            if (pc.pos.isNearTo(controller)) {
                pc.enableRoom(controller);
                return true;
            }
            if (activeHealer && healerOk) {
                pc.pcDoubleMoveTo(controller.pos, activeHealer, '#ffffff', { plainCost: 1, swampCost: 5 } as any);
            } else {
                pc.moveTo(controller, { plainCost: 1, swampCost: 5 });
            }
            return true;
        }
    }

    let state = (mem.assistState as string | undefined) || 'recruit';
    const healerMissingOrLow = !activeHealer || activeHealer.ticksToLive <= HEALER_RETREAT_TTL;
    const needRetreat =
        pc.ticksToLive <= PC_RETREAT_TTL ||
        ((state === 'travel' || state === 'anchor') && healerMissingOrLow);
    if (needRetreat) state = 'retreat';
    mem.assistState = state;

    if (state === 'retreat') {
        if (pc.room.name !== idleRoom) {
            if (activeHealer && healerOk) pc.pcDoubleMoveToRoom(idleRoom, activeHealer, '#ffffff', { plainCost: 1, swampCost: 5 } as any);
            else pc.moveToRoom(idleRoom, { plainCost: 1, swampCost: 5 });
            return true;
        }
        if (pc.pos.isRoomEdge()) {
            if (activeHealer && healerOk) pc.pcDoubleFleeEdge(activeHealer, { plainCost: 1, swampCost: 5 } as any);
            else pc.moveTo(idlePos, { plainCost: 1, swampCost: 5 });
            return true;
        }
        if (!pc.pos.isEqualTo(idlePos)) {
            if (!canStandOn(pc.room, idlePos)) return true;
            if (activeHealer && healerOk) pc.pcDoubleMoveTo(idlePos, activeHealer, '#ffffff', { plainCost: 1, swampCost: 5 } as any);
            else pc.moveTo(idlePos, { plainCost: 1, swampCost: 5 });
            return true;
        }
        mem.assistState = 'recover';
        return true;
    }

    if (state === 'recover') {
        if (pc.room.name !== idleRoom) {
            if (activeHealer && healerOk) pc.pcDoubleMoveToRoom(idleRoom, activeHealer, '#ffffff', { plainCost: 1, swampCost: 5 } as any);
            else pc.moveToRoom(idleRoom, { plainCost: 1, swampCost: 5 });
            return true;
        }
        const powerSpawn = pc.room.powerSpawn;
        if (powerSpawn && pc.ticksToLive < PC_RECOVER_TTL) {
            if (pc.pos.isNearTo(powerSpawn)) pc.renew(powerSpawn);
            else {
                if (activeHealer && healerOk) pc.pcDoubleMoveTo(powerSpawn.pos, activeHealer, '#ffffff', { plainCost: 1, swampCost: 5 } as any);
                else pc.moveTo(powerSpawn, { plainCost: 1, swampCost: 5 });
            }
            return true;
        }
        if (pc.ticksToLive >= PC_RECOVER_TTL) mem.assistState = 'recruit';
        return true;
    }

    if (state === 'recruit' || state === 'assemble') {
        if (pc.room.name !== idleRoom) {
            if (activeHealer && healerOk) pc.pcDoubleMoveToRoom(idleRoom, activeHealer, '#ffffff', { plainCost: 1, swampCost: 5 } as any);
            else pc.moveToRoom(idleRoom, { plainCost: 1, swampCost: 5 });
            mem.assistState = 'recruit';
            return true;
        }

        if (pc.room.my && fillOpsBeforeAssist(pc, { plainCost: 1, swampCost: 5 })) {
            mem.assistState = 'recruit';
            return true;
        }

        if (activeHealer && healerOk && activeHealer.room.name === idleRoom) {
            if (!pc.pos.isNearTo(activeHealer)) {
                pc.moveTo(activeHealer, { plainCost: 1, swampCost: 5, range: 1, ignoreCreeps: true });
                mem.assistState = 'assemble';
                return true;
            }
        } else if (!pc.pos.isEqualTo(idlePos)) {
            if (!canStandOn(pc.room, idlePos)) return true;
            pc.moveTo(idlePos, { plainCost: 1, swampCost: 5 });
            mem.assistState = 'recruit';
            return true;
        }

        if (!healerOk) {
            const room = Game.rooms[idleRoom];
            if (room && room.my) {
                const lastReq = mem.healerReqTime as number | undefined;
                const boostOwnerId = `PCH-${pc.name}`;
                const boostBody = RoleData['pc-heal']?.bodypart || [];
                const boostmap = {
                    [HEAL]: ['XLHO2', 'LHO2', 'LO'],
                    [MOVE]: ['XZHO2', 'ZHO2', 'ZO']
                } as any;

                if (!mem.healerBoostOwnerId && hasPendingHealer(room, pc.name)) {
                    if (room.CheckBoostRes(boostBody, boostmap) && room.AssignBoostTaskByBody(boostBody, boostmap, boostOwnerId)) {
                        mem.healerBoostOwnerId = boostOwnerId;
                    }
                    mem.healerReqTime = Game.time;
                    mem.assistState = 'assemble';
                    return true;
                }

                if ((!lastReq || Game.time - lastReq >= 20) && !hasPendingHealer(room, pc.name)) {
                    const boostmap = {
                        [HEAL]: ['XLHO2', 'LHO2', 'LO'],
                        // [MOVE]: ['XZHO2', 'ZHO2', 'ZO']
                    } as any;
                    if (room.CheckBoostRes(boostBody, boostmap)) {
                        const ret = room.SpawnMissionAdd(`PCH-${pc.name}`, [], -1, 'pc-heal', {
                            targetPcName: pc.name,
                            homeRoom: idleRoom,
                            boostmap,
                            boostOwnerId,
                            mustBoost: true,
                            boosted: false
                        } as any);
                        if (ret === OK) {
                            room.AssignBoostTaskByBody(boostBody, boostmap, boostOwnerId);
                            mem.healerBoostOwnerId = boostOwnerId;
                        }
                        mem.healerReqTime = Game.time;
                    }
                }
            }
            mem.assistState = 'assemble';
            return true;
        }

        if (activeHealer!.room.name !== idleRoom) {
            mem.assistState = 'assemble';
            return true;
        }
        if (!pc.pos.isNearTo(activeHealer!)) {
            pc.pcDoubleMoveTo(activeHealer!.pos, activeHealer!, '#ffffff', { plainCost: 1, swampCost: 5 } as any);
            mem.assistState = 'assemble';
            return true;
        }
        mem.assistState = 'travel';
        state = 'travel';
    }

    if (state === 'travel') {
        if (!activeHealer) return true;
        if (pc.room.name !== targetRoom) {
            pc.Generate_OPS();
            pc.pcDoubleMoveToRoom(targetRoom, activeHealer, '#ffffff', { plainCost: 1, swampCost: 5 } as any);
            return true;
        }
        mem.assistState = 'anchor';
        state = 'anchor';
    }

    if (state === 'anchor') {
        pc.Generate_OPS();

        if (!activeHealer) return true;

        if (pc.pos.isRoomEdge()) {
            pc.pcDoubleFleeEdge(activeHealer, { plainCost: 1, swampCost: 5 } as any);
            return true;
        }

        const anchor = getAssistAnchorPair(pc.room, assistFlag.pos, pc.pos, activeHealer.pos);
        const anchorPcPos = anchor?.pcPos || assistFlag.pos;
        const anchorHealerPos = anchor?.healerPos;

        if (!pc.pos.inRangeTo(assistFlag.pos, 1) || (anchor && !pc.pos.isEqualTo(anchorPcPos))) {
            pc.pcDoubleMoveTo(anchorPcPos, activeHealer, '#ffffff', { plainCost: 1, swampCost: 5, range: 0 } as any);
            return true;
        }

        if (anchorHealerPos && pc.pos.isNearTo(activeHealer) && !activeHealer.pos.isEqualTo(anchorHealerPos)) {
            if (activeHealer.fatigue > 0) return true;
            activeHealer.moveTo(anchorHealerPos, { range: 0, ignoreCreeps: true, maxRooms: 1, reusePath: 5 });
            return true;
        }

        if (pc.Disrupt_Tower()) return true;
        if (pc.Disrupt_Spawn()) return true;

        const hostiles = pc.room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            if (pc.Shield(pc.pos)) return true;
        }
        return true;
    }

    mem.assistState = 'recruit';
    return true;
}

function hasPendingHealer(room: Room, targetPcName: string): boolean {
    const creeps = Object.values(Game.creeps);
    if (creeps.some(c => c.memory.role === 'pc-heal' && (c.memory as any).targetPcName === targetPcName)) return true;

    const spawns = (room as any).spawn as StructureSpawn[] | undefined;
    if (spawns) {
        for (const spawn of spawns) {
            const spawning = spawn.spawning;
            if (!spawning) continue;
            const mem = Memory.creeps?.[spawning.name] as any;
            if (mem?.role === 'pc-heal' && mem.targetPcName === targetPcName) return true;
        }
    }

    const tasks = (room as any).getAllMissionFromPool?.('spawn') as any[] | undefined;
    if (!tasks || tasks.length <= 0) return false;
    return tasks.some(t => t?.type === 'spawn' && t?.data?.memory?.role === 'pc-heal' && t.data.memory.targetPcName === targetPcName);
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

function isControllerReachable(fromPos: RoomPosition, controller: StructureController): boolean {
    const ret = PathFinder.search(fromPos, { pos: controller.pos, range: 1 }, { maxRooms: 1, plainCost: 1, swampCost: 5 });
    return !ret.incomplete;
}

function fillOpsBeforeAssist(pc: PowerCreep, moveOpts: MoveToOpts): boolean {
    const free = pc.store.getFreeCapacity();
    if (!free || free <= 0) return false;

    const storage = pc.room.storage;
    const terminal = pc.room.terminal;
    const storageOps = storage?.store[RESOURCE_OPS] || 0;
    const terminalOps = terminal?.store[RESOURCE_OPS] || 0;
    const available = storageOps + terminalOps;
    if (available <= 0) return false;

    const target = storageOps >= terminalOps ? storage : terminal;
    if (!target) return false;

    const amount = Math.min(free, (target.store[RESOURCE_OPS] || 0));
    if (amount <= 0) return false;

    if (pc.pos.isNearTo(target)) {
        pc.withdraw(target, RESOURCE_OPS, amount);
        return true;
    }
    pc.moveTo(target, moveOpts);
    return true;
}

function isUsableRampartTile(room: Room, pos: RoomPosition): boolean {
    if (!canStandOn(room, pos)) return false;
    const ramps = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y).filter(s => (s as AnyStructure).structureType === STRUCTURE_RAMPART) as StructureRampart[];
    if (!ramps || ramps.length <= 0) return false;
    const r = ramps[0];
    return !!r && (r.my || r.isPublic);
}

function getAssistAnchorPair(room: Room, flagPos: RoomPosition, pcPos: RoomPosition, healerPos: RoomPosition): { pcPos: RoomPosition; healerPos: RoomPosition } | null {
    const candidates: RoomPosition[] = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const x = flagPos.x + dx;
            const y = flagPos.y + dy;
            if (x < 0 || x > 49 || y < 0 || y > 49) continue;
            const p = new RoomPosition(x, y, flagPos.roomName);
            if (!isUsableRampartTile(room, p)) continue;
            candidates.push(p);
        }
    }
    if (candidates.length <= 0) return null;

    let best: { pcPos: RoomPosition; healerPos: RoomPosition; score: number } | null = null;
    for (const pcCandidate of candidates) {
        for (const healerCandidate of candidates) {
            if (pcCandidate.isEqualTo(healerCandidate)) continue;
            if (!pcCandidate.isNearTo(healerCandidate)) continue;
            const score = pcPos.getRangeTo(pcCandidate) * 10 + healerPos.getRangeTo(healerCandidate);
            if (!best || score < best.score) {
                best = { pcPos: pcCandidate, healerPos: healerCandidate, score };
            }
        }
    }
    return best ? { pcPos: best.pcPos, healerPos: best.healerPos } : null;
}
