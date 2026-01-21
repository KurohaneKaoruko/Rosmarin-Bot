

export default class MoveFunction extends Creep {
    /**
     * 移动到指定房间
     * @param roomName 目标房间名称
     * @param options 移动选项 (range, visualizePathStyle, plainCost, swampCost 等)
     * @returns ScreepsReturnCode - ERR_TIRED 表示疲劳中，其他为 moveTo 返回值
     */
    moveToRoom(roomName: string, options = {}) {
        if (this.fatigue > 0) return ERR_TIRED;

        const DETOUR_WINDOW = 20;
        const COOLDOWN_TTL = 15;

        const opts: any = options || {};
        if (opts.range === undefined) opts.range = 3;

        // 状态机：用于“决定绕房后继续执行绕房方案”，避免 A->B->A 反复横跳
        let state = this.memory._moveToRoomState;
        if (!state || state.targetRoom !== roomName) {
            state = this.memory._moveToRoomState = {
                targetRoom: roomName,
                targetPos: null,
                lastRoom: this.room.name,
                lastRoomTick: Game.time,
                leftTargetTick: 0,
                cooldownUntil: 0
            };
        }

        // 记录“离开目标房间”的时刻与“回到目标房间”的冷却窗口
        if (state.lastRoom !== this.room.name) {
            if (state.lastRoom === roomName && this.room.name !== roomName) {
                state.leftTargetTick = Game.time;
            }
            if (this.room.name === roomName && state.lastRoom !== roomName && state.leftTargetTick && (Game.time - state.leftTargetTick) <= DETOUR_WINDOW) {
                state.cooldownUntil = Game.time + COOLDOWN_TTL;
            }
            state.lastRoom = this.room.name;
            state.lastRoomTick = Game.time;
        }

        // 目标点：保持稳定，避免每 tick 随机导致策略抖动
        if (!state.targetPos || state.targetPos.roomName !== roomName) {
            if (this.room.name === roomName && this.room.controller) {
                const p = this.room.controller.pos;
                state.targetPos = { x: p.x, y: p.y, roomName };
            } else {
                let seed = 0;
                const s = `${this.name}|${roomName}`;
                for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
                const centerX = 25;
                const centerY = 25;
                const range = 10;
                const span = range * 2 + 1;
                const x = (seed % span) + (centerX - range);
                const y = (((seed >>> 8) % span) + (centerY - range));
                state.targetPos = { x, y, roomName };
            }
        }

        // detour 续行：如果刚从目标房间 detour 出来，则在 detour 房间内优先走回目标房间的出口
        if (this.room.name !== roomName && state.leftTargetTick && (Game.time - state.leftTargetTick) <= DETOUR_WINDOW) {
            let exitPos = null;
            const bm: any = (globalThis as any).BetterMove;
            if (bm && typeof bm.getClosestExitPos === 'function') {
                exitPos = bm.getClosestExitPos(this.pos, roomName);
            } else {
                const exitDir = this.room.findExitTo(roomName);
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

        // 回到目标房间后的短冷却：优先房内推进，避免刚回房又立刻再次绕出去
        if (this.room.name === roomName && state.cooldownUntil && Game.time < state.cooldownUntil && opts.maxRooms === undefined) {
            opts.maxRooms = 1;
        }

        const tarPos = new RoomPosition(state.targetPos.x, state.targetPos.y, roomName);
        return this.moveTo(tarPos, opts);
    }

    /**
     * 移动到所属房间 (home)
     * @returns boolean - true 表示已到达或无 home 设置，false 表示正在移动中
     */
    moveHomeRoom(): boolean {
        if(!this.memory.home) { return true; }
        if(this.room.name === this.memory.home) { return true; }
        this.moveToRoom(this.memory.home, { visualizePathStyle: { stroke: '#ff0000' } });
        return false;
    }

    /**
     * 移动到目标房间
     * @param options 移动选项
     * @returns boolean - true 表示已到达目标房间且不在边缘，false 表示未到达
     */
    moveToTargetRoom(options?: MoveToOpts): boolean {
        const targetRoom = this.memory.targetRoom;
        if (!targetRoom) { return true; }
        
        // 检查是否已到达目标房间且不在边缘
        if (this.room.name === targetRoom && !this.handleRoomEdge()) {
            return true;
        }
        
        this.moveToRoom(targetRoom, options || {});
        return false;
    }

    /**
     * 移动到资源房间
     * @param options 移动选项
     * @returns boolean - true 表示已到达资源房间且不在边缘，false 表示未到达
     */
    moveToSourceRoom(options?: MoveToOpts): boolean {
        const sourceRoom = this.memory.sourceRoom;
        if (!sourceRoom) { return true; }
        
        // 检查是否已到达资源房间且不在边缘
        if (this.room.name === sourceRoom && !this.handleRoomEdge()) {
            return true;
        }
        
        this.moveToRoom(sourceRoom, options || {});
        return false;
    }

    /**
     * 检查是否在房间边缘并处理
     * @returns boolean - true 表示在边缘并正在处理，false 表示不在边缘
     */
    handleRoomEdge(): boolean {
        const x = this.pos.x;
        const y = this.pos.y;
        
        // 检查是否在房间边缘 (x/y 为 0 或 49)
        if (x === 0 || x === 49 || y === 0 || y === 49) {
            // 计算移动方向，向房间中心移动
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
