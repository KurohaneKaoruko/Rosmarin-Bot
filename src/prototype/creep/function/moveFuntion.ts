

export default class MoveFunction extends Creep {
    /**
     * 移动到指定房间
     * @param roomName 目标房间名称
     * @param options 移动选项 (range, visualizePathStyle, plainCost, swampCost 等)
     * @returns ScreepsReturnCode - ERR_TIRED 表示疲劳中，其他为 moveTo 返回值
     */
    moveToRoom(roomName: string, options = {}) {
        if (this.fatigue > 0) return ERR_TIRED;

        options['range'] = 3;
        let lastTargetPos = null;

        if (this.memory.lastTargetPos &&
            this.memory.lastTargetPos.roomName === roomName) {
            lastTargetPos = this.memory.lastTargetPos;
        } else {
            if (this.room.name === roomName && this.room.controller) {
                lastTargetPos = this.room.controller.pos;
                this.memory.lastTargetPos = { x: lastTargetPos.x, y: lastTargetPos.y, roomName};
            } else {
                const centerX = 25;
                const centerY = 25;
                const range = 10;
                const randomX = Math.floor(Math.random() * (range * 2 + 1)) + (centerX - range);
                const randomY = Math.floor(Math.random() * (range * 2 + 1)) + (centerY - range);
                lastTargetPos = { x: randomX, y: randomY, roomName }
                this.memory.lastTargetPos = lastTargetPos;
            }
        }

        const tarPos = new RoomPosition(lastTargetPos.x, lastTargetPos.y, roomName);
        return this.moveTo(tarPos, options);
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
                this.move(direction);
            }
            return true;
        }
        
        return false;
    }
}