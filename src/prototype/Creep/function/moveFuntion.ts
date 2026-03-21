import { parseShardRoomName } from '@/modules/utils/shardRoom';

const isRoomEdgePosition = (pos: { x: number; y: number }): boolean => (
    pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49
);

const toExitDirection = (exitDir: number): DirectionConstant | null => {
    switch (exitDir) {
        case FIND_EXIT_TOP:
            return TOP;
        case FIND_EXIT_RIGHT:
            return RIGHT;
        case FIND_EXIT_BOTTOM:
            return BOTTOM;
        case FIND_EXIT_LEFT:
            return LEFT;
        default:
            return null;
    }
};

const isOnExitEdge = (pos: { x: number; y: number }, direction: DirectionConstant): boolean => {
    switch (direction) {
        case TOP:
            return pos.y === 0;
        case RIGHT:
            return pos.x === 49;
        case BOTTOM:
            return pos.y === 49;
        case LEFT:
            return pos.x === 0;
        default:
            return false;
    }
};

export default class MoveFunction extends Creep {
    /**
     * 跨房移动到指定房间。
     * @param roomName 目标房间名，支持带 shard 前缀的房间名。
     * @param options 传给 `moveTo` 的移动参数。
     * @returns 移动结果；疲劳时返回 `ERR_TIRED`。
     */
    moveToRoom(roomName: string, options = {}) {
        if (this.fatigue > 0) return ERR_TIRED;

        const { full: fullRoomName, roomName: localRoomName, shard } = parseShardRoomName(roomName);
        const sameShard = !shard || shard === Game.shard.name;

        const DETOUR_WINDOW = 20;
        const COOLDOWN_TTL = 15;
        const currentRoom = this.pos.roomName;
        const exitDir = sameShard && currentRoom !== localRoomName
            ? this.room.findExitTo(localRoomName)
            : null;
        const exitDirection = exitDir === null ? null : toExitDirection(exitDir);

        const opts: any = options || {};
        if (opts.range === undefined) opts.range = 3;

        if (sameShard && this.room.name === localRoomName && this.handleRoomEdge()) {
            return OK;
        }

        if (sameShard && currentRoom !== localRoomName && isRoomEdgePosition(this.pos)) {
            if (exitDirection && isOnExitEdge(this.pos, exitDirection)) {
                return this.move(exitDirection);
            }
            if (this.handleRoomEdge()) {
                return OK;
            }
        }

        let state = this.memory._moveToRoomState;
        if (!state || state.targetRoom !== fullRoomName) {
            state = this.memory._moveToRoomState = {
                targetRoom: fullRoomName,
                targetPos: null,
                lastRoom: currentRoom,
                leftTargetTick: 0,
                cooldownUntil: 0
            };
        }

        if (sameShard) {
            const lastRoom = state.lastRoom || currentRoom;
            if (lastRoom !== currentRoom) {
                if (lastRoom === localRoomName && currentRoom !== localRoomName) {
                    state.leftTargetTick = Game.time;
                }
                if (currentRoom === localRoomName && lastRoom !== localRoomName && state.leftTargetTick && (Game.time - state.leftTargetTick) <= DETOUR_WINDOW) {
                    state.cooldownUntil = Game.time + COOLDOWN_TTL;
                }
                state.lastRoom = currentRoom;
            }
        }

        let targetPos = state.targetPos as { x: number; y: number; roomName?: string } | null;
        if (sameShard) {
            const targetRoom = Game.rooms[localRoomName];
            const targetController = targetRoom?.controller;
            if (targetController) {
                const p = targetController.pos;
                if (!targetPos || targetPos.x !== p.x || targetPos.y !== p.y) {
                    targetPos = { x: p.x, y: p.y };
                    state.targetPos = targetPos;
                }
            }
        }
        if (!targetPos) {
            let seed = 0;
            const s = `${this.name}|${fullRoomName}`;
            for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
            const centerX = 25;
            const centerY = 25;
            const range = 10;
            const span = range * 2 + 1;
            const x = (seed % span) + (centerX - range);
            const y = (((seed >>> 8) % span) + (centerY - range));
            targetPos = { x, y };
            state.targetPos = targetPos;
        }

        if (sameShard && currentRoom !== localRoomName && state.leftTargetTick && (Game.time - state.leftTargetTick) <= DETOUR_WINDOW) {
            let exitPos = null;
            const bm: any = (global as any).BetterMove;
            if (bm && typeof bm.getClosestExitPos === 'function') {
                exitPos = bm.getClosestExitPos(this.pos, localRoomName);
            } else {
                const exitDir = this.room.findExitTo(localRoomName);
                if (exitDir === FIND_EXIT_TOP || exitDir === FIND_EXIT_RIGHT || exitDir === FIND_EXIT_BOTTOM || exitDir === FIND_EXIT_LEFT) {
                    const exits = this.room.find(exitDir);
                    exitPos = exits.length ? this.pos.findClosestByRange(exits) : null;
                }
            }
            if (exitPos) {
                if (opts.maxRooms === undefined) opts.maxRooms = 1;
                return this.moveTo(exitPos, Object.assign({}, opts, { maxRooms: 1, range: 0 }));
            }
        }

        if (sameShard && currentRoom === localRoomName && state.cooldownUntil && Game.time < state.cooldownUntil && opts.maxRooms === undefined) {
            opts.maxRooms = 1;
        }

        if (sameShard) {
            const tarPos = new RoomPosition(targetPos.x, targetPos.y, localRoomName);
            return this.moveTo(tarPos, opts);
        }
        return this.moveTo({ x: targetPos.x, y: targetPos.y, roomName: fullRoomName } as any, opts);
    }

    /**
     * 移动到 `memory.home` 指定的固定工作房。
     * @returns `true` 表示已经到达，`false` 表示仍在路上。
     */
    moveHomeRoom(): boolean {
        if(!this.memory.home) { return true; }
        const { roomName: localHome, shard } = parseShardRoomName(this.memory.home);
        if ((!shard || shard === Game.shard.name) && this.room.name === localHome) { return true; }
        this.moveToRoom(this.memory.home, { visualizePathStyle: { stroke: '#ff0000' } });
        return false;
    }

    /**
     * 移动到 `memory.targetRoom` 指定的目标房间。
     * @param options 传给 `moveToRoom` 的移动参数。
     * @returns `true` 表示已经到达，`false` 表示仍在路上。
     */
    moveToTargetRoom(options?: MoveToOpts): boolean {
        const targetRoom = this.memory.targetRoom;
        if (!targetRoom) { return true; }
        
        const { roomName: localTarget, shard } = parseShardRoomName(targetRoom);
        if ((!shard || shard === Game.shard.name) && this.room.name === localTarget && !this.handleRoomEdge()) {
            return true;
        }
        
        this.moveToRoom(targetRoom, options || {});
        return false;
    }

    /**
     * 移动到 `memory.sourceRoom` 指定的补给/来源房。
     * @param options 传给 `moveToRoom` 的移动参数。
     * @returns `true` 表示已经到达，`false` 表示仍在路上。
     */
    moveToSourceRoom(options?: MoveToOpts): boolean {
        const sourceRoom = this.memory.sourceRoom;
        if (!sourceRoom) { return true; }
        
        const { roomName: localSource, shard } = parseShardRoomName(sourceRoom);
        if ((!shard || shard === Game.shard.name) && this.room.name === localSource && !this.handleRoomEdge()) {
            return true;
        }
        
        this.moveToRoom(sourceRoom, options || {});
        return false;
    }

    /**
     * 处理房间边缘卡位，避免跨房移动时停在 0/49 边界。
     * @returns `true` 表示当前在边缘并已尝试挪开，`false` 表示不在边缘。
     */
    handleRoomEdge(): boolean {
        const x = this.pos.x;
        const y = this.pos.y;
        // Screeps 在边界会把 creep 卡在 0/49，需要先向房间内部挪一步。
        if (x === 0 || x === 49 || y === 0 || y === 49) {
            let direction: DirectionConstant | undefined;
            
            if (x === 0) direction = RIGHT;
            else if (x === 49) direction = LEFT;
            else if (y === 0) direction = BOTTOM;
            else if (y === 49) direction = TOP;
            
            if (direction) {
                const code = this.move(direction);
                if (code !== OK && code !== ERR_TIRED) {
                    this.moveTo(new RoomPosition(25, 25, this.room.name), { maxRooms: 1, range: 20 });
                }
            }
            return true;
        }
        
        return false;
    }
}

