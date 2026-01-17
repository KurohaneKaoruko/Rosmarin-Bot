export default {
    power: {
        // 开启powerSpawn
        open(roomName: string) {
            const room = Game.rooms[roomName];
            const BotMemStructures =  Memory['StructControlData'];
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
            const BotMemStructures =  Memory['StructControlData'];
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
            const BotMemStructures =  Memory['StructControlData'];
            if(!room || !room.my || !BotMemStructures[roomName]) {
                return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
            }
            const structMem = BotMemStructures[roomName];
            const mode = structMem['powerSpawnMode'] ?? 'auto';
            const enabled = !!structMem['powerSpawn'];
            const autoMem = Memory['AutoData']?.['AutoPowerData']?.[roomName] || {};
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
                const BotMemStructures =  Memory['StructControlData'];
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
                const BotMem =  Memory['AutoData']['AutoPowerData'];
                if(!BotMem[roomName]) BotMem[roomName] = {};

                BotMem[roomName]['energy'] = energy;
                BotMem[roomName]['power'] = power;
                if (Memory['StructControlData']?.[roomName]) {
                    Memory['StructControlData'][roomName]['powerSpawnMode'] = 'auto';
                }
                global.log(`已设置${roomName}的自动烧power的阈值为 ${energy} Energy 和 ${power} Power。`);
                return OK;
            },
            remove(roomName: string) {
                const room = Game.rooms[roomName];
                if (!room || !room.my) {
                    return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
                }
                const BotMem = Memory['AutoData']['AutoPowerData'];
                if(!BotMem[roomName]) return;

                delete BotMem[roomName];
                if (Memory['StructControlData']?.[roomName]) {
                    Memory['StructControlData'][roomName]['powerSpawnMode'] = 'auto';
                }
                global.log(`已移除${roomName}的自动烧power的阈值。`);
                return OK;
            }
        }
    },
    pc: {
        // 孵化powerCreep
        spawn(pcname: string, roomName: string) {
            const room = Game.rooms[roomName];
            if (!room || !room.my) {
                return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
            }
            const pc = Game.powerCreeps[pcname]
            if (!pc) return Error(`PowerCreep 【${pcname}】 不存在。`);

            const result = pc.spawn(room.powerSpawn);
            if(result === OK) {
                global.log(`在${roomName} 的 PowerSpawn 孵化了 PowerCreep 【${pcname}】 `);
            }
            else {
                global.log(`在${roomName} 的 PowerSpawn 孵化 PowerCreep 【${pcname}】 失败，错误码：${result}`);
            }
            return OK;
        },
        set(pcname: string, roomName: string) {
            const pc = Game.powerCreeps[pcname];
            if (!pc) return Error(`PowerCreep 【${pcname}】 不存在。`);
            
            pc.memory['spawnRoom'] = roomName;
            global.log(`已设置 PowerCreep 【${pcname}】 的孵化房间为 ${roomName}`);
            return OK;
        },
    }
}
