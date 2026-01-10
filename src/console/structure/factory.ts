export default {
    factory: {
        // 开启factory
        open(roomName: string) {
            const room = Game.rooms[roomName];
            const BotMemStructures =  Memory['StructControlData'];
            if(!room || !room.my || !BotMemStructures[roomName]) {
                global.log(`房间 ${roomName} 不存在、未拥有或未添加。`);
                return;
            }
            BotMemStructures[roomName]['factory'] = true;
            global.log(`已开启 ${roomName} 的factory。`);
            return OK;
        },
        // 关闭factory
        stop(roomName: string) {
            const room = Game.rooms[roomName];
            const BotMemStructures =  Memory['StructControlData'];
            if(!room || !room.my || !BotMemStructures[roomName]) {
                global.log(`房间 ${roomName} 不存在、未拥有或未添加。`);
                return;
            }
            BotMemStructures[roomName]['factory'] = false;
            global.log(`已关闭 ${roomName} 的factory。`);
            return OK;
        },
        // 设置factory生产
        set(roomName: string, product: string, amount: number = 0) {
            const RES = global.BASE_CONFIG.RESOURCE_ABBREVIATIONS;
            const room = Game.rooms[roomName];
            const BotMemStructures =  Memory['StructControlData'];
            if(!room || !room.my || !BotMemStructures[roomName]) {
                return Error(`房间 ${roomName} 不存在、未拥有或未添加。`);
            }
            product = RES[product] || product;
            if(!COMMODITIES[product]) {
                return Error(`生产目标 ${product} 不存在。`);
            }
            const flv = room.factory?.level || Memory['StructControlData'][roomName]?.['factoryLevel'] || 0;
            if(COMMODITIES[product].level && COMMODITIES[product].level != flv) {
                return Error(`生产目标 ${product} 需要factory等级为 ${COMMODITIES[product].level}, 而factory等级不匹配或未设置等级。`);
            }
            BotMemStructures[roomName]['factoryProduct'] = product as any;
            BotMemStructures[roomName]['factoryAmount'] = Math.max(0, amount);
            global.log(`[${roomName}] 已设置factory生产任务为 ${product}。`);
            if (!BotMemStructures[roomName]['factory']) {
                BotMemStructures[roomName]['factory'] = true;
                global.log(`[${roomName}] 已开启factory。`);
            }
            return OK;
        },
        // 设置factory等级
        setlevel(roomName: string, level: number) {
            const room = Game.rooms[roomName];
            const BotMemStructures =  Memory['StructControlData'];
            if(!room || !room.my || !BotMemStructures[roomName]) {
                global.log(`[${roomName}] 房间不存在、未拥有或未添加。`);
                return;
            }
            if(level < 0 || level > 5) {
                global.log(`[${roomName}] factory等级 ${level} 不存在。`);
                return;
            }
            BotMemStructures[roomName]['factoryLevel'] = level;
            global.log(`[${roomName}] 已设置factory等级为 ${level}。`);
            return OK;
        },
        auto: {
            set(roomName: string, product: string, amount?: number) {
                const RES = global.BASE_CONFIG.RESOURCE_ABBREVIATIONS;
                product = RES[product] || product;
                const room = Game.rooms[roomName];
                if(!room || !room.my) {
                    global.log(`房间 ${roomName} 不存在或未拥有。`);
                    return;
                }
                if(!COMMODITIES[product]) {
                    global.log(`资源 ${product} 不存在。`);
                    return;
                }
                const flv = room.factory?.level || Memory['StructControlData'][roomName]?.['factoryLevel'];
                if(COMMODITIES[product].level && COMMODITIES[product].level != flv) {
                    global.log(`资源 ${product} 的等级 ${COMMODITIES[product].level} 不匹配 factory 等级 ${flv}。`);
                    return;
                }
                const BotMemStructures =  Memory['AutoData']['AutoFactoryData'];
                if(!BotMemStructures[roomName]) BotMemStructures[roomName] = {};
                amount = amount || 0
                BotMemStructures[roomName][product] = amount;
                global.log(`已设置 ${roomName} 的factory自动生产: ${product} - ${amount}。`);
                return OK;
            },
            remove(roomName: string, product: string) {
                const RES = global.BASE_CONFIG.RESOURCE_ABBREVIATIONS;
                product = RES[product] || product;
                const room = Game.rooms[roomName];
                if(!room || !room.my) {
                    global.log(`房间 ${roomName} 不存在或未拥有。`);
                    return;
                }
                if(!COMMODITIES[product]) {
                    global.log(`资源 ${product} 不存在。`);
                    return;
                }
                const BotMemStructures =  Memory['AutoData']['AutoFactoryData'];
                if(!BotMemStructures[roomName]) BotMemStructures[roomName] = {};
                delete BotMemStructures[roomName][product];
                global.log(`已删除 ${roomName} 的factory自动生产: ${product}。`);
                return OK;
            },
            list(roomName: string) {
                const BotMemAutoFactory = Memory['AutoData']['AutoFactoryData'];
                if(roomName) {
                    const autoFactory = BotMemAutoFactory[roomName];
                    if(!autoFactory || autoFactory.length == 0) {
                        global.log(`[${roomName}]没有开启自动factory生产`);
                    }
                    else {
                        global.log(`[${roomName}]自动factory生产:`);
                        for(const product in autoFactory) {
                            console.log(`   ${product} - ${autoFactory[product]}`);
                        }
                    }
                    return OK;
                }
    
                if(!BotMemAutoFactory || Object.keys(BotMemAutoFactory).length == 0) {
                    global.log(`没有房间开启自动factory生产`);
                }
                for(const room in BotMemAutoFactory) {
                    if(!BotMemAutoFactory[room] || BotMemAutoFactory[room].length == 0) {
                        continue;
                    }
                    global.log(`[${room}]自动factory生产:`);
                    for(const product in BotMemAutoFactory[room]) {
                        console.log(`   ${product} - ${BotMemAutoFactory[room][product]}`);
                    }
                }
                return OK;
            },
        },
    }
}