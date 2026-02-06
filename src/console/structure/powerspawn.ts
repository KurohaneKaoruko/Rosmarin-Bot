import { getAutoPowerData, getStructData } from '@/modules/utils/memory';

export default {
    power: {
        // 开启powerSpawn
        open(roomName: string) {
            const room = Game.rooms[roomName];
            const BotMemStructures =  getStructData();
            if(!room || !room.my || !BotMemStructures[roomName]) {
                global.log(`房间 ${roomName} 不存在、未拥有或未添加。`);
                return;
            }
            BotMemStructures[roomName]['powerSpawn'] = true;
            BotMemStructures[roomName]['powerSpawnMode'] = 'manual';
            global.log(`已开启${roomName}的烧power。`);
            return OK;
        },
        // 关闭powerSpawn
        stop(roomName: string) {
            const room = Game.rooms[roomName];
            const BotMemStructures =  getStructData();
            if(!room || !room.my || !BotMemStructures[roomName]) {
                global.log(`房间 ${roomName} 不存在、未拥有或未添加。`);
                return;
            }
            BotMemStructures[roomName]['powerSpawn'] = false;
            BotMemStructures[roomName]['powerSpawnMode'] = 'manual';
            global.log(`已关闭${roomName}的烧power。`);
            return OK;
        },
        show(roomName: string) {
            const room = Game.rooms[roomName];
            const BotMemStructures =  getStructData();
            if(!room || !room.my || !BotMemStructures[roomName]) {
                return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
            }
            const structMem = BotMemStructures[roomName];
            const mode = structMem['powerSpawnMode'] ?? 'auto';
            const enabled = !!structMem['powerSpawn'];
            const autoMem = getAutoPowerData()?.[roomName] || {};
            const energy = autoMem['energy'] ?? 100e3;
            const power = autoMem['power'] ?? 10e3;
            console.log(
                `[PowerSpawn] ${roomName} mode=${mode} enabled=${enabled} ` +
                `energy=${room.getResAmount(RESOURCE_ENERGY)} power=${room.getResAmount(RESOURCE_POWER)} ` +
                `threshold(energy=${energy}, power=${power})`
            );
            return OK;
        },
        auto: {
            on(roomName: string) {
                const room = Game.rooms[roomName];
                const BotMemStructures =  getStructData();
                if(!room || !room.my || !BotMemStructures[roomName]) {
                    return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
                }
                BotMemStructures[roomName]['powerSpawnMode'] = 'auto';
                global.log(`已设置${roomName}的烧power为自动模式。`);
                return OK;
            },
            set(roomName: string, energy: number, power: number) {
                const room = Game.rooms[roomName];
                if (!room || !room.my) {
                    return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
                }
                const BotMem = getAutoPowerData(roomName);

                BotMem['energy'] = energy;
                BotMem['power'] = power;
                const struct = getStructData();
                if (struct?.[roomName]) struct[roomName]['powerSpawnMode'] = 'auto';
                global.log(`已设置${roomName}的自动烧power的阈值为 ${energy} Energy 和 ${power} Power。`);
                return OK;
            },
            remove(roomName: string) {
                const room = Game.rooms[roomName];
                if (!room || !room.my) {
                    return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
                }
                const BotMem = getAutoPowerData();
                if(!BotMem[roomName]) return;

                delete BotMem[roomName];
                const struct = getStructData();
                if (struct?.[roomName]) struct[roomName]['powerSpawnMode'] = 'auto';
                global.log(`已移除${roomName}的自动烧power的阈值。`);
                return OK;
            }
        }
    }
}
