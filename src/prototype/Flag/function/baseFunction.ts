import { shouldRun } from "@/modules/infra/qos";

export default class FlagBaseFunction extends Flag {
    // 移动旗帜
    handleSetPositionFlag() {
        if (!this.memory['setPosition']) return false;

        let [x, y, roomName] = this.memory['setPosition'].split('/');
        x = +x%50, y = +y%50;
        if (!(x>=0&&x<=49&&y>=0&&y<=49)) { x=25, y=25; }
        let reg = /^[EW]\d+[NS]\d+$/;
        if (!reg.test(roomName) || this.pos.roomName === roomName) {
            delete this.memory['setPosition'];
        } else {
            this.setPosition(new RoomPosition(x, y, roomName));
        }
        return true;
    }

    // 核弹打击（仅处理 nuke-* / nuke_*，不影响其他旗帜）
    handleNukeFlag() {
        if (!(this.name.startsWith('nuke-') || this.name.startsWith('nuke_'))) return false;

        if (!shouldRun({ every: 5, minBucket: 2000, allowLevels: ['normal', 'constrained'] })) return true;

        const nextTryTick = typeof this.memory['nextTryTick'] === 'number' ? this.memory['nextTryTick'] : 0;
        if (nextTryTick && nextTryTick > Game.time) return true;

        const match = this.name.match(/^nuke[-_](\d+)?(?:[-_].+)?$/);
        if (!match) return true;

        const targetPos = this.pos;
        const targetRoomName = targetPos.roomName;

        const amountFromName = match[1] ? Math.max(1, Number(match[1])) : 1;
        const amountFromMemory = typeof this.memory['amount'] === 'number' ? Math.max(1, this.memory['amount']) : undefined;
        const amount = amountFromMemory || amountFromName;

        const roomNames: string[] = Array.isArray(this.memory['rooms']) && this.memory['rooms'].length > 0
            ? this.memory['rooms']
            : Object.keys(Game.rooms);

        let launchedCount = 0;
        let hasCandidate = false;
        for (const roomName of roomNames) {
            const room = Game.rooms[roomName];
            if (!room || !room.my) continue;
            if (!room.NukerCanLaunchTo(targetPos)) continue;
            hasCandidate = true;

            const code = room.NukerLaunchTo(targetPos);
            if (code !== OK) {
                // 失败降噪：同 tick 不重复打印
                if (this.memory['lastFailTick'] !== Game.time || this.memory['lastFailCode'] !== code) {
                    this.memory['lastFailTick'] = Game.time;
                    this.memory['lastFailCode'] = code;
                    console.log(`房间 ${roomName} 发射核弹失败，code: ${code}`);
                }
                continue;
            }

            launchedCount++;
            console.log(`从房间 ${roomName} 发射核弹到 ${targetRoomName} (x:${targetPos.x}  y:${targetPos.y})`);

            if (launchedCount >= amount) break;
        }

        if (!hasCandidate || launchedCount === 0) {
            const failCount = (typeof this.memory['failCount'] === 'number' ? this.memory['failCount'] : 0) + 1;
            this.memory['failCount'] = failCount;
            const delay = Math.min(50, 5 * Math.pow(2, Math.min(6, failCount - 1)));
            this.memory['nextTryTick'] = Game.time + delay;
        } else {
            delete this.memory['failCount'];
            delete this.memory['nextTryTick'];
        }

        // 达到计划数量才删除旗帜，未完成则下次 tick 自动重试
        if (launchedCount >= amount) this.remove();
        return true;
    }
}
