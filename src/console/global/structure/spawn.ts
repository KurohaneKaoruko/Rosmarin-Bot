import { RoleData } from '@/constant/CreepConstant';

export default {
    spawn: {
        creep(roomName: string, bodypart: string, role: string, memory?: any) {
            if (!roomName || !role) return -1;
            if (!RoleData[role]) return -1;
            const room = Game.rooms[roomName];
            if(!memory) memory = {};
            if (!memory.home && !memory.homeRoom) {
                memory.homeRoom = roomName;
            }
            room.SpawnMissionAdd('', bodypart, -1, role, _.cloneDeep(memory));
            console.log(`[${roomName}] 即将孵化 ${role}, 体型: ${JSON.stringify(bodypart)} \n memory: ${JSON.stringify(memory)}`);
            return 0;
        },
        role(roomName: string, role: string, memory?: any, num?: number) {
            if (!roomName || !role) return -1;
            if (!RoleData[role]) return -1;
            if (!num) num = 1;
            const room = Game.rooms[roomName];
            if(!memory) memory = {};
            if (!memory.home && !memory.homeRoom) {
                memory.homeRoom = roomName;
            }
            for (let i = 0; i < num; i++) {
                room.SpawnMissionAdd('', '', -1, role, _.cloneDeep(memory));
            }
            console.log(`[${roomName}] 即将孵化 ${role}, 数量: ${num} \n memory: ${JSON.stringify(memory)}`);
            return 0;
        },
        sign(roomName: string, targetRoom: string, sign: string) {
            const room = Game.rooms[roomName];
            room.SpawnMissionAdd('', '', 0, 'scout', {targetRoom: targetRoom, sign: sign} as any);
            console.log(`[${roomName}] 即将孵化scout到${targetRoom}进行签名。签名内容: ${sign}`);
            return 0;
        },
    }
}