

export default class MoveFunction extends Creep {
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

    // 移动到所属房间
    moveHomeRoom(): boolean {
        if(!this.memory.home) { return true; }
        if(this.room.name === this.memory.home) { return true; }
        this.moveToRoom(this.memory.home, { visualizePathStyle: { stroke: '#ff0000' } });
        return false;
    }
}