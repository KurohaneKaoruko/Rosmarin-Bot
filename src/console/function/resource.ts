export default {
    resource: {
        manage: {
            set(roomName: string, resource: string, data: { source: number, target: number }) {
                const RESOURCE_ABBREVIATIONS = global.BASE_CONFIG.RESOURCE_ABBREVIATIONS;
                resource = RESOURCE_ABBREVIATIONS[resource] || resource;
                const source = data.source ?? Infinity;
                const target = data.target ?? 0;
                if (!Memory['ResourceManage']) Memory['ResourceManage'] = {};
                if (!Memory['ResourceManage'][roomName]) Memory['ResourceManage'][roomName] = {};
                Memory['ResourceManage'][roomName][resource] = [target, source];
                global.log(`[资源管理] 已设置房间 ${roomName} 的 ${resource} 供应阈值为 ${source}  需求阈值为 ${target}`);
                return OK;
            },
            remove(roomName: string, resource: string) {
                const RESOURCE_ABBREVIATIONS = global.BASE_CONFIG.RESOURCE_ABBREVIATIONS;
                resource = RESOURCE_ABBREVIATIONS[resource] || resource;
                if (!Memory['ResourceManage']) Memory['ResourceManage'] = {};
                if (!Memory['ResourceManage'][roomName]) Memory['ResourceManage'][roomName] = {};
                if (Memory['ResourceManage'][roomName][resource]) {
                    delete Memory['ResourceManage'][roomName][resource];
                    global.log(`[资源管理] 已移除房间 ${roomName} 的 ${resource} 供需设置`);
                }
                return OK;
            },
            clear(roomName: string) {
                if (!Memory['ResourceManage']) Memory['ResourceManage'] = {};
                if (!Memory['ResourceManage'][roomName]) Memory['ResourceManage'][roomName] = {};
                delete Memory['ResourceManage'][roomName];
                global.log(`[资源管理] 已清空房间 ${roomName} 的资源管理设置`);
                return OK;
            },
            show: {
                all() {
                    const botmem = Memory['ResourceManage'];
                    for (const roomName in botmem) {
                        console.log(`房间${roomName}:`);
                        for (const res in botmem[roomName]) {
                            console.log(`   -资源${res}:`);
                            console.log(`      -供应阈值: ${botmem[roomName][res][1] ?? Infinity}`);
                            console.log(`      -需求阈值: ${botmem[roomName][res][0] ?? 0}`);
                        }
                    }
                    return OK;
                },
                room(roomName: string) {
                    if (!roomName) return Error('必须指定房间');
                    const botmem = Memory['ResourceManage'];
                    if (!botmem[roomName]) return Error('该房间没有资源管理设置');
                    for (const res in botmem[roomName]) {
                        console.log(`资源${res}:`);
                        console.log(`   -供应阈值: ${botmem[roomName][res][1] ?? Infinity}`);
                        console.log(`   -需求阈值: ${botmem[roomName][res][0] ?? 0}`);
                    }
                },
                res(res: string) {
                    if (!res) return Error('必须指定资源');
                    const RESOURCE_ABBREVIATIONS = global.BASE_CONFIG.RESOURCE_ABBREVIATIONS;
                    res = RESOURCE_ABBREVIATIONS[res] || res;
                    const botmem = Memory['ResourceManage'];
                    for (const roomName in botmem) {
                        if (botmem[roomName][res]) {
                            console.log(`房间${roomName} 资源${res}:`);
                            console.log(`   -供应阈值: ${botmem[roomName][res][1] ?? Infinity}`);
                            console.log(`   -需求阈值: ${botmem[roomName][res][0] ?? 0}`);
                        }
                    }
                    return OK;
                }
            }
        },
        transport: {
            task(roomName: string, source: string, target: string, resource: string, amount: number) {
                const RESOURCE_ABBREVIATIONS = global.BASE_CONFIG.RESOURCE_ABBREVIATIONS;
                resource = RESOURCE_ABBREVIATIONS[resource] || resource
                const room = Game.rooms[roomName];
                if (!room) return Error('房间不存在');
                let sourceId = null;
                let targetId = null;
                if (source == 'storage') sourceId = room.storage.id;
                else if (source == 'terminal') sourceId = room.terminal.id;
                else if (source == 'factory') sourceId = room.factory.id;
                if (target == 'storage') targetId = room.storage.id;
                else if (target == 'terminal') targetId = room.terminal.id;
                else if (target == 'factory') targetId = room.factory.id;

                if (!sourceId || !targetId) return Error('源或目标不存在');
                if (sourceId == targetId) return Error('源和目标不能相同');

                room.TransportMissionAdd(2, {
                    source: sourceId as Id<StructureStorage | StructureTerminal>,
                    target: targetId as Id<StructureStorage | StructureTerminal>,
                    resourceType: resource as ResourceConstant,
                    amount: amount,
                    pos: null,
                    });
                return OK;
            }
        }
    }
}