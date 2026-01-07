// 外矿设置
export default {
    outmine: {
        add(roomName: string, targetRoom: string) {
            if (!roomName || !targetRoom) return -1;
            const BotMem = Memory['OutMineData'];
            if (!BotMem[roomName]) BotMem[roomName] = {};
            const Mem = BotMem[roomName];
            const isCenterRoom = /^[EW]\d*[456][NS]\d*[456]$/.test(targetRoom); // 中间房间
            const isNotHighway = /^[EW]\d*[1-9][NS]\d*[1-9]$/.test(targetRoom); // 非过道房间
            // 普通房间
            if(!isCenterRoom && isNotHighway) {
                if (!Mem['energy']) Mem['energy'] = [];
                if (Mem['energy'].indexOf(targetRoom) === -1) {
                    Mem['energy'].push(targetRoom);
                    console.log(`房间 ${targetRoom} 已添加到 ${roomName} 的外矿列表。 `);
                    return OK;
                } else {
                    console.log(`房间 ${targetRoom} 已存在于 ${roomName} 的外矿列表中。 `);
                    return OK;
                }
            }
            // 过道房间
            else if(!isNotHighway) {
                if (!Mem['highway']) Mem['highway'] = [];
                if (Mem['highway'].indexOf(targetRoom) === -1) {
                    Mem['highway'].push(targetRoom);
                    console.log(`过道房间 ${targetRoom} 已添加到 ${roomName} 的监控列表`);
                    return OK;
                } else {
                    console.log(`过道房间 ${targetRoom} 已存在于 ${roomName} 的监控列表中。`);
                    return OK;
                }
            }
            // 中间房间
            else {
                if (!Mem['centerRoom']) Mem['centerRoom'] = [];
                if (Mem['centerRoom'].indexOf(targetRoom) === -1) {
                    Mem['centerRoom'].push(targetRoom);
                    console.log(`中间房间 ${targetRoom} 已添加到 ${roomName} 的采矿列表`);
                    return OK;
                } else {
                    console.log(`中间房间 ${targetRoom} 已存在于 ${roomName} 的采矿列表中。`);
                    return OK;
                }
            }
        },
        // 删除外矿
        remove(roomName: string, targetRoom: string) {
            if (!roomName || !targetRoom) return -1;
            const BotMem = Memory['OutMineData'];
            if (!BotMem[roomName]) return ERR_NOT_FOUND;
            const Mem = BotMem[roomName];
            const isCenterRoom = /^[EW]\d*[456][NS]\d*[456]$/.test(targetRoom); // 中间房间
            const isNotHighway = /^[EW]\d*[1-9][NS]\d*[1-9]$/.test(targetRoom); // 非过道房间
            // 普通房间
            if(!isCenterRoom && isNotHighway) {
                if (!Mem['energy']) return ERR_NOT_FOUND;
                if (Mem['energy'].indexOf(targetRoom) === -1) return Error(`房间 ${targetRoom} 不存在于 ${roomName} 的外矿列表中。`);
                else {
                    Mem['energy'].splice(Mem['energy'].indexOf(targetRoom), 1);
                    delete Memory.rooms[targetRoom]?.['road'];
                    console.log(`房间 ${targetRoom} 从 ${roomName} 的外矿列表中删除。`);
                    return OK;
                }
            }
            // 过道房间
            else if(!isNotHighway) {
                if (!Mem['highway']) return ERR_NOT_FOUND;
                if (Mem['highway'].indexOf(targetRoom) === -1) return ERR_NOT_FOUND;
                else {
                    Mem['highway'].splice(Mem['highway'].indexOf(targetRoom), 1);
                    console.log(`过道房间 ${targetRoom} 从 ${roomName} 的监控列表中删除。`);
                    return OK;
                }
            }
            // 中间房间
            else {
                if (!Mem['centerRoom']) return ERR_NOT_FOUND;
                if (Mem['centerRoom'].indexOf(targetRoom) === -1) return ERR_NOT_FOUND;
                else {
                    Mem['centerRoom'].splice(Mem['centerRoom'].indexOf(targetRoom), 1);
                    console.log(`中间房间 ${targetRoom} 从 ${roomName} 的外矿列表中删除。`);
                    return OK;
                }
            }
        },
        // 获取外矿列表
        list(roomName: string) {
            if (!roomName) return -1;
            const BotMem = Memory['OutMineData'];
            if (!BotMem[roomName]) return '该房间没有外矿数据';
            return `energy: ${BotMem[roomName]['energy'] || []}\n` +
                   `highway: ${BotMem[roomName]['highway'] || []}\n` +
                   `centerRoom: ${BotMem[roomName]['centerRoom'] || []}`;
        },
        // 清空外矿road缓存
        clearRoad(roomName: string) {
            delete Memory.rooms[roomName]['road'];
            console.log(`外矿房间 ${roomName} 的Road缓存已清空。`);
            return OK;
        },
        auto(roomName: string, type: 'power' | 'deposit') {
            const BotMem = Memory['RoomControlData'][roomName];
            if (type === 'power') {
                BotMem['outminePower'] = !BotMem['outminePower'];
                console.log(`房间 ${roomName} 的自动采集Power已设置为 ${BotMem['outminePower']}。`);
            } else if (type === 'deposit') {
                BotMem['outmineDeposit'] = !BotMem['outmineDeposit'];
                console.log(`房间 ${roomName} 的自动采集Deposit已设置为 ${BotMem['outmineDeposit']}。`);
            }
            return OK;
        },
        // 立即开始到指定房间开采power
        power(roomName: string, targetRoom: string, num: number, boostLevel: number=0, prNum?: number) {
            if (!roomName || !targetRoom || !num) return -1;
            const room = Game.rooms[roomName];
            if (!room) return;
            if (!room.memory['powerMine']) room.memory['powerMine'] = {};
            if (boostLevel == 1) {
                const stores = [room.storage, room.terminal, ...room.lab]
                const GO_Amount = stores.reduce((a, b) => a + b.store['GO'], 0);
                const UH_Amount = stores.reduce((a, b) => a + b.store['UH'], 0);
                const LO_Amount = stores.reduce((a, b) => a + b.store['LO'], 0);
                if (GO_Amount < 3000 || UH_Amount < 3000 || LO_Amount < 3000) {
                    console.log(`房间 ${roomName} 的仓库中GO/UH/LO数量不足，无法孵化T1 power开采队。`);
                    return -1;
                }
            } else if (boostLevel == 2) {
                const stores = [room.storage, room.terminal, ...room.lab]
                const GHO2_Amount = stores.reduce((a, b) => a + b.store['GHO2'], 0);
                const UH2O_Amount = stores.reduce((a, b) => a + b.store['UH2O'], 0);
                const LO_Amount = stores.reduce((a, b) => a + b.store['LO'], 0);
                if (GHO2_Amount < 3000 || UH2O_Amount < 3000 || LO_Amount < 3000) {
                    console.log(`房间 ${roomName} 的仓库中GHO2/UH2O/LO数量不足，无法孵化T2 power开采队。`);
                    return -1;
                }
            }
            room.memory['powerMine'][targetRoom] = {
                creep: num,                      // creep队伍数
                max: num,                        // 最大孵化数量
                boostLevel: boostLevel || 0,     // 强化等级
                prNum: prNum || 0,              // ranged孵化数量
                prMax: prNum || 0,     // ranged孵化上限
            };
            console.log(`房间 ${roomName} 即将向 ${targetRoom} 派出 ${num} 数量的T${boostLevel} Power开采队。`);
            return OK;
        },
        // 立即开始到指定房间开采deposit
        deposit(roomName: string, targetRoom: string, num: number) {
            if (!roomName || !targetRoom || !num) return -1;
            const room = Game.rooms[roomName];
            if (!room) return;
            if (!room.memory['depositMine']) room.memory['depositMine'] = {};
            room.memory['depositMine'][targetRoom] = {
                num: num,                      // creep队伍数
                active: true,                  // 是否激活
            }
            console.log(`房间 ${roomName} 即将向 ${targetRoom} 派出 ${num} 数量的Deposit开采队。`);
            return OK;
        },
        // 取消指定房间的开采
        cancel(roomName: string, targetRoom: string, type: 'power' | 'deposit') {
            const room = Game.rooms[roomName];
            if (!room) return;
            const spawnmission = room.getAllMissionFromPool('spawn');
            if ((!type || type == 'power') && room.memory['powerMine'])
                delete room.memory['powerMine'][targetRoom]
            if ((!type || type == 'deposit') && room.memory['depositMine'])
                delete room.memory['depositMine'][targetRoom]
            if (!spawnmission) return OK;
            for (const mission of spawnmission) {
                const data = mission.data;
                if (data.memory.targetRoom == targetRoom) {
                    room.deleteMissionFromPool('spawn', mission.id);
                }
            }
            console.log(`房间 ${roomName} 的 ${targetRoom} 开采已取消。`);
            return OK;
        }
    },
}