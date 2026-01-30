import { runAssist } from './mode/assist';
import { runOperate } from './mode/operate';

export default class PowerCreepExecute extends PowerCreep {
    exec() {
        if(!this.room) return;

        const assistFlag = Game.flags[`${this.name}-assist`];
        if (assistFlag) {
            runAssist(this, assistFlag);
            return;
        }

        const mem = this.memory as any;
        const hasAssistContext = !!mem.assistTargetRoom || !!mem.assistIdleRoom || !!mem.assistState;
        if (hasAssistContext) {
            const idleFlag = Game.flags[`${this.name}-idle`];
            const homeFlag = Game.flags[`${this.name}-home`];
            const idleRoom = idleFlag?.pos.roomName || homeFlag?.pos.roomName || mem.assistIdleRoom || mem.spawnRoom || this.room.name;
            const idlePos =
                (idleFlag && idleFlag.pos.roomName === idleRoom ? idleFlag.pos : undefined) ||
                (homeFlag && homeFlag.pos.roomName === idleRoom ? homeFlag.pos : undefined) ||
                new RoomPosition(25, 25, idleRoom);

            const healerName = mem.healerName as string | undefined;
            const healer = healerName ? Game.creeps[healerName] : undefined;
            const healerOk = !!healer && healer.memory.role === 'pc-heal' && healer.ticksToLive > 250;

            if (this.room.name !== idleRoom) {
                if (healerOk) this.pcDoubleMoveToRoom(idleRoom, healer, '#ffffff', { plainCost: 1, swampCost: 5 } as any);
                else this.moveToRoom(idleRoom, { plainCost: 1, swampCost: 5 });
                return;
            }

            if (this.pos.isRoomEdge()) {
                if (healerOk) this.pcDoubleFleeEdge(healer, { plainCost: 1, swampCost: 5 } as any);
                else this.moveTo(idlePos, { plainCost: 1, swampCost: 5 });
                return;
            }

            if (!this.pos.isEqualTo(idlePos)) {
                if (healerOk) this.pcDoubleMoveTo(idlePos, healer, '#ffffff', { plainCost: 1, swampCost: 5 } as any);
                else this.moveTo(idlePos, { plainCost: 1, swampCost: 5 });
                return;
            }

            if (healerOk && this.room.my) {
                if (healer!.room.name !== idlePos.roomName) return;
                if (!healer!.pos.inRangeTo(idlePos, 1)) return;
                healer!.suicide();
                delete mem.healerName;
            }

            delete mem.assistTargetRoom;
            delete mem.assistIdleRoom;
            delete mem.assistState;
            delete mem.assistAbortReason;
        }

        if (this.ToRenew()) return true;
        runOperate(this);
    }
}
