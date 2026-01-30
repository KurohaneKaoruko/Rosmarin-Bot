export default class PowerCreepDoubleAction extends PowerCreep {
    pcDoubleMove(Direction: DirectionConstant, healer?: Creep): number {
        const bindCreep = healer || this.getPcHealer();
        if (!bindCreep) return ERR_NOT_FOUND;
        bindCreep.memory.dontPullMe = false;

        if (this.pos.isNearTo(bindCreep.pos)) {
            if (bindCreep.fatigue > 0) return ERR_TIRED;
            const followDir = bindCreep.pos.getDirectionTo(this.pos);
            const result = this.move(Direction);
            if (result === OK) {
                bindCreep.move(followDir);
            }
            return result;
        } else {
            if (this.pos.isRoomEdge()) this.move(Direction);
            bindCreep.moveTo(this as any, { range: 1, ignoreCreeps: true, maxRooms: 16, reusePath: 5 });
            return OK;
        }
    }

    pcDoubleMoveTo(target: RoomPosition, healer?: Creep, color = '#ffffff', ops: MoveToOpts = {} as MoveToOpts): number | boolean {
        const bindCreep = healer || this.getPcHealer();
        if (!bindCreep) return ERR_NOT_FOUND;
        bindCreep.memory.dontPullMe = false;

        const _ops: any = ops || {};
        _ops.visualizePathStyle = { stroke: color };
        if (_ops.ignoreCreeps === undefined) _ops.ignoreCreeps = false;

        if (this.pos.isNearTo(bindCreep.pos)) {
            if (bindCreep.fatigue > 0) return ERR_TIRED;
            const followDir = bindCreep.pos.getDirectionTo(this.pos);
            const result = this.moveTo(target, _ops);
            if (result === OK) {
                bindCreep.move(followDir);
            }
            return result;
        } else {
            if (this.pos.isRoomEdge()) this.moveTo(target, _ops);
            bindCreep.moveTo(this as any, { range: 1, ignoreCreeps: true, maxRooms: 16, reusePath: 5 });
            return OK;
        }
    }

    pcDoubleMoveToRoom(roomName: string, healer?: Creep, color = '#ffffff', ops: MoveToOpts = {} as MoveToOpts): boolean {
        const bindCreep = healer || this.getPcHealer();
        if (!bindCreep) return true;

        if (this.room.name !== roomName) {
            this.pcDoubleMoveTo(new RoomPosition(25, 25, roomName), bindCreep, color, ops);
            return true;
        }
        this.pcDoubleFleeEdge(bindCreep, ops);
        return false;
    }

    pcDoubleFleeEdge(healer?: Creep, ops: MoveToOpts = {} as MoveToOpts) {
        const bindCreep = healer || this.getPcHealer();
        if (!bindCreep) return;
        bindCreep.memory.dontPullMe = false;
        if (bindCreep.fatigue > 0) {
            bindCreep.moveTo(this as any, { range: 1, ignoreCreeps: true, maxRooms: 16, reusePath: 5 });
            return true;
        }

        if (this.pos.isRoomEdge()) {
            const dir = getInwardDirection(this.pos);
            if (dir) this.move(dir);
            else this.moveTo(new RoomPosition(25, 25, this.room.name), { ...ops, range: 10 });

            bindCreep.moveTo(this as any, { range: 1, ignoreCreeps: true, maxRooms: 16, reusePath: 5 });
            return true;
        }

        if (this.room.name == bindCreep.room.name && bindCreep.pos.isRoomEdge()) {
            const terrain = this.room.getTerrain();
            const p = this.pos;
            const Pos = [
                [p.x - 1, p.y - 1], [p.x - 1, p.y], [p.x - 1, p.y + 1],
                [p.x, p.y - 1], [p.x, p.y + 1],
                [p.x + 1, p.y - 1], [p.x + 1, p.y], [p.x + 1, p.y + 1]
            ].find(pos => {
                if (pos[0] <= 0 || pos[0] >= 49 || pos[1] <= 0 || pos[1] >= 49) return false;
                if (!bindCreep.pos.isNearTo(pos[0], pos[1])) return false;
                if (bindCreep.pos.isEqualTo(pos[0], pos[1])) return false;
                if (terrain.get(pos[0], pos[1]) === TERRAIN_MASK_WALL) return false;
                return true;
            });
            if (!Pos) return false;
            const toPos = new RoomPosition(Pos[0], Pos[1], this.room.name);
            bindCreep.move(bindCreep.pos.getDirectionTo(toPos));
        }
        return false;
    }

    private getPcHealer(): Creep | undefined {
        const name = (this.memory as any).healerName as string | undefined;
        if (!name) return undefined;
        const creep = Game.creeps[name];
        if (!creep) return undefined;
        if (creep.memory.role !== 'pc-heal') return undefined;
        if ((creep.memory as any).targetPcName !== this.name) return undefined;
        return creep;
    }
}

function getInwardDirection(pos: RoomPosition): DirectionConstant | null {
    if (pos.x === 0) return RIGHT;
    if (pos.x === 49) return LEFT;
    if (pos.y === 0) return BOTTOM;
    if (pos.y === 49) return TOP;
    return null;
}
