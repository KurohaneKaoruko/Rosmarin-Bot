import { CostMatrixCache, RoadMemory, RoadBuilder, PathPlanner, RoadVisual } from '@/modules/features/external/externalRoad';
import { HighwayMineVisual } from '@/modules/shared/highwayMineVisual';
import { getOutMineData, getRoomData } from '@/modules/shared/memory';

const CENTER_ROOM_REGEX = /^[EW]\d*[456][NS]\d*[456]$/;
const NON_HIGHWAY_ROOM_REGEX = /^[EW]\d*[1-9][NS]\d*[1-9]$/;
type OutMineBucket = 'energy' | 'centerRoom' | 'highway';
type AddOutMineResult = {
    bucket: OutMineBucket;
    added: boolean;
};

function getOutMineBucket(targetRoom: string): OutMineBucket {
    const isCenterRoom = CENTER_ROOM_REGEX.test(targetRoom);
    const isNotHighway = NON_HIGHWAY_ROOM_REGEX.test(targetRoom);
    if (isCenterRoom) return 'centerRoom';
    if (!isNotHighway) return 'highway';
    return 'energy';
}

function addOutMineTarget(sourceRoom: string, targetRoom: string, verbose = true): AddOutMineResult | -1 {
    if (!sourceRoom || !targetRoom) return -1;
    const Mem = getOutMineData(sourceRoom);
    const targetBucket = getOutMineBucket(targetRoom);
    const bucketName: OutMineBucket = targetBucket;

    if (!Mem[bucketName]) Mem[bucketName] = [];
    const added = Mem[bucketName].indexOf(targetRoom) === -1;
    if (added) Mem[bucketName].push(targetRoom);

    if (verbose) {
        if (targetBucket === 'energy') {
            console.log(added
                ? `房间 ${targetRoom} 已添加到 ${sourceRoom} 的外矿列表。 `
                : `房间 ${targetRoom} 已存在于 ${sourceRoom} 的外矿列表中。 `);
        } else if (targetBucket === 'highway') {
            console.log(added
                ? `过道房间 ${targetRoom} 已添加到 ${sourceRoom} 的监控列表`
                : `过道房间 ${targetRoom} 已存在于 ${sourceRoom} 的监控列表中。`);
        } else {
            console.log(added
                ? `中间房间 ${targetRoom} 已添加到 ${sourceRoom} 的采矿列表`
                : `中间房间 ${targetRoom} 已存在于 ${sourceRoom} 的采矿列表中。`);
        }
    }

    return { bucket: targetBucket, added };
}

function parseRoomCoord(roomName: string): { x: number; y: number } | null {
    const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
    if (!match) return null;

    const xNum = Number(match[2]);
    const yNum = Number(match[4]);
    const x = match[1] === 'E' ? xNum : -xNum - 1;
    const y = match[3] === 'S' ? yNum : -yNum - 1;
    return { x, y };
}

function formatRoomCoord(x: number, y: number): string {
    const horizontal = x >= 0 ? `E${x}` : `W${-x - 1}`;
    const vertical = y >= 0 ? `S${y}` : `N${-y - 1}`;
    return `${horizontal}${vertical}`;
}

function getNearbyRooms(sourceRoom: string, range = 1): string[] {
    const parsed = parseRoomCoord(sourceRoom);
    if (!parsed) return [];

    const rooms: string[] = [];
    for (let dx = -range; dx <= range; dx++) {
        for (let dy = -range; dy <= range; dy++) {
            if (dx === 0 && dy === 0) continue;
            rooms.push(formatRoomCoord(parsed.x + dx, parsed.y + dy));
        }
    }
    return rooms;
}

// 外矿设置
export default {
    mine: {
        add(sourceRoom: string, ...targetRooms: string[]) {
            if (!sourceRoom || targetRooms.length === 0) return -1;
            let hadError = false;
            for (const targetRoom of targetRooms) {
                if (addOutMineTarget(sourceRoom, targetRoom) === -1) hadError = true;
            }
            return hadError ? -1 : OK;
        },
        // 批量添加周围外矿
        addarea(sourceRoom: string, range: number = 1) {
            if (!sourceRoom) return -1;
            if (range < 1) return ERR_INVALID_ARGS;

            const nearbyRooms = getNearbyRooms(sourceRoom, Math.floor(range));
            if (nearbyRooms.length <= 0) {
                console.log(`房间 ${sourceRoom} 周围没有可添加的房间。`);
                return ERR_NOT_FOUND;
            }

            const addedRooms: string[] = [];
            const existedRooms: string[] = [];

            for (const targetRoom of nearbyRooms) {
                const result = addOutMineTarget(sourceRoom, targetRoom, false);
                if (result === -1) continue;
                if (result.added) {
                    addedRooms.push(`${targetRoom}[${result.bucket}]`);
                } else {
                    existedRooms.push(`${targetRoom}[${result.bucket}]`);
                }
            }

            console.log(
                `[mine.addarea] ${sourceRoom} 范围 ${range} 圈: ` +
                `新增 ${addedRooms.length}, 已存在 ${existedRooms.length}`
            );
            if (addedRooms.length > 0) console.log(`新增: ${addedRooms.join(', ')}`);
            if (existedRooms.length > 0) console.log(`已存在: ${existedRooms.join(', ')}`);
            return OK;
        },
        // 删除外矿
        remove(sourceRoom: string, targetRoom: string) {
            if (!sourceRoom || !targetRoom) return -1;
            const BotMem = getOutMineData();
            if (!BotMem[sourceRoom]) return ERR_NOT_FOUND;
            const Mem = BotMem[sourceRoom];
            const buckets: OutMineBucket[] = ['energy', 'centerRoom', 'highway'];
            const removedBuckets = buckets.filter((bucket) => {
                const list = Mem[bucket];
                if (!Array.isArray(list)) return false;
                const index = list.indexOf(targetRoom);
                if (index === -1) return false;
                list.splice(index, 1);
                return true;
            });
            if (removedBuckets.length <= 0) {
                return Error(`房间 ${targetRoom} 不存在于 ${sourceRoom} 的外矿列表中。`);
            }

            delete Memory.rooms[targetRoom]?.['road'];
            console.log(`房间 ${targetRoom} 已从 ${sourceRoom} 的列表中删除: ${removedBuckets.join(', ')}`);
            return OK;
        },
        // 获取外矿列表
        list(sourceRoom: string) {
            if (!sourceRoom) return -1;
            const BotMem = getOutMineData();
            if (!BotMem[sourceRoom]) return '该房间没有外矿数据';
            return `energy: ${BotMem[sourceRoom]['energy'] || []}\n` +
                   `highway: ${BotMem[sourceRoom]['highway'] || []}\n` +
                   `centerRoom: ${BotMem[sourceRoom]['centerRoom'] || []}`;
        },
        // 清空外矿road缓存
        clearRoad(roomName: string) {
            delete Memory.rooms[roomName]['road'];
            console.log(`外矿房间 ${roomName} 的Road缓存已清空。`);
            return OK;
        },
        auto(sourceRoom: string, type: 'power' | 'deposit') {
            const BotMem = getRoomData()[sourceRoom];
            if (!BotMem) return ERR_NOT_FOUND;
            if (type === 'power') {
                BotMem['outminePower'] = !BotMem['outminePower'];
                console.log(`房间 ${sourceRoom} 的自动采集Power已设置为 ${BotMem['outminePower']}。`);
            } else if (type === 'deposit') {
                BotMem['outmineDeposit'] = !BotMem['outmineDeposit'];
                console.log(`房间 ${sourceRoom} 的自动采集Deposit已设置为 ${BotMem['outmineDeposit']}。`);
            }
            return OK;
        },
        mapShow(sourceRoom?: string) {
            if (sourceRoom) {
                HighwayMineVisual.enable(sourceRoom);
                HighwayMineVisual.visualizeOnMap(sourceRoom);
                console.log(`✓ 已启用 ${sourceRoom} 的 power/deposit 大地图可视化`);
                console.log(`  提示: 也可以创建 Flag "${sourceRoom}/mineMapVisual" 来触发可视化`);
                return OK;
            }

            HighwayMineVisual.enableAll();
            HighwayMineVisual.run();
            console.log('✓ 已启用所有房间的 power/deposit 大地图可视化');
            console.log('  提示: 也可以创建 Flag "ALL/mineMapVisual" 来触发可视化');
            return OK;
        },
        mapHide(sourceRoom?: string) {
            if (sourceRoom) {
                HighwayMineVisual.disable(sourceRoom);
                console.log(`✓ 已禁用 ${sourceRoom} 的 power/deposit 大地图可视化`);
                return OK;
            }

            HighwayMineVisual.disableAll();
            console.log('✓ 已禁用所有房间的 power/deposit 大地图可视化');
            return OK;
        },
        // 立即开始到指定房间开采power
        power(sourceRoom: string, targetRoom: string, num: number, boostLevel: number=0, prNum?: number) {
            if (!sourceRoom || !targetRoom || !num) return -1;
            const room = Game.rooms[sourceRoom];
            if (!room) return;
            
            // 使用新任务池方法
            if (boostLevel == 1) {
                const stores = [room.storage, room.terminal, ...room.lab]
                const GO_Amount = stores.reduce((a, b) => a + (b?.store['GO']||0), 0);
                const UH_Amount = stores.reduce((a, b) => a + (b?.store['UH']||0), 0);
                const LO_Amount = stores.reduce((a, b) => a + (b?.store['LO']||0), 0);
                if (GO_Amount < 3000 || UH_Amount < 3000 || LO_Amount < 3000) {
                    console.log(`房间 ${sourceRoom} 的仓库中GO/UH/LO数量不足，无法孵化T1 power开采队。`);
                    return -1;
                }
            } else if (boostLevel == 2) {
                const stores = [room.storage, room.terminal, ...room.lab]
                const GHO2_Amount = stores.reduce((a, b) => a + (b?.store['GHO2']||0), 0);
                const UH2O_Amount = stores.reduce((a, b) => a + (b?.store['UH2O']||0), 0);
                const LO_Amount = stores.reduce((a, b) => a + (b?.store['LO']||0), 0);
                if (GHO2_Amount < 3000 || UH2O_Amount < 3000 || LO_Amount < 3000) {
                    console.log(`房间 ${sourceRoom} 的仓库中GHO2/UH2O/LO数量不足，无法孵化T2 power开采队。`);
                    return -1;
                }
            }

            const data: PowerMineTask = {
                targetRoom: targetRoom,
                creep: num,                      // creep队伍数
                max: num,                        // 最大孵化数量
                boostLevel: boostLevel || 0,     // 强化等级
                prNum: prNum || 0,              // ranged孵化数量
                prMax: prNum || 0,     // ranged孵化上限
            };
            
            // 先尝试删除旧任务（如果存在）
            const duplicateTask = { targetRoom } as any;
            const existId = room.checkSameMissionInPool('mine', 'power', duplicateTask);
            if (existId) room.deleteMissionFromPool('mine', existId);

            room.addMissionToPool('mine', 'power', 1, data);
            console.log(`房间 ${sourceRoom} 即将向 ${targetRoom} 派出 ${num} 数量的T${boostLevel} Power开采队。`);
            return OK;
        },
        // 立即开始到指定房间开采deposit
        deposit(sourceRoom: string, targetRoom: string, num: number) {
            if (!sourceRoom || !targetRoom || !num) return -1;
            const room = Game.rooms[sourceRoom];
            if (!room) return;
            
            const data: DepositMineTask = {
                targetRoom: targetRoom,
                num: num,                      // creep队伍数
                active: true,                  // 是否激活
            }

            // 先尝试删除旧任务（如果存在）
            const duplicateTask = { targetRoom } as any;
            const existId = room.checkSameMissionInPool('mine', 'deposit', duplicateTask);
            if (existId) room.deleteMissionFromPool('mine', existId);

            room.addMissionToPool('mine', 'deposit', 1, data);
            console.log(`房间 ${sourceRoom} 即将向 ${targetRoom} 派出 ${num} 数量的Deposit开采队。`);
            return OK;
        },
        // 取消指定房间的开采
        cancel(sourceRoom: string, targetRoom: string, type: 'power' | 'deposit') {
            const room = Game.rooms[sourceRoom];
            if (!room) return;
            
            // 删除任务池中的任务
            const mineTasks = room.getAllMissionFromPool('mine');
            if (mineTasks) {
                for (const task of mineTasks) {
                    const data = task.data as MineTask;
                    if (data.targetRoom !== targetRoom) continue;
                    if (type && task.type !== type) continue;
                    
                    room.deleteMissionFromPool('mine', task.id);
                }
            }

            // 删除相关的 Spawn 任务
            const spawnmission = room.getAllMissionFromPool('spawn');
            if (!spawnmission) return OK;
            for (const mission of spawnmission) {
                const data = mission.data as SpawnTask;
                if (data.memory.targetRoom == targetRoom) {
                    // 如果指定了类型，则需要进一步检查 role
                    if (type === 'power' && !data.memory.role.startsWith('power-')) continue;
                    if (type === 'deposit' && !data.memory.role.startsWith('deposit-')) continue;

                    room.deleteMissionFromPool('spawn', mission.id);
                }
            }
            console.log(`房间 ${sourceRoom} 的 ${targetRoom} 开采已取消。`);
            return OK;
        }
    },
    // 外矿道路管理
    road: {
        /**
         * 重新计算指定路线
         * @param sourceRoom 源头房间名
         * @param targetRoom 目标房间名
         */
        recalc(sourceRoom: string, targetRoom: string) {
            if (!sourceRoom || !targetRoom) {
                console.log('用法: road.recalc(sourceRoom, targetRoom)');
                return ERR_INVALID_ARGS;
            }
            const home = Game.rooms[sourceRoom];
            const target = Game.rooms[targetRoom];
            if (!home) {
                console.log(`错误: 无法访问源头房间 ${sourceRoom}`);
                return ERR_NOT_FOUND;
            }
            if (!target) {
                console.log(`错误: 无法访问目标房间 ${targetRoom}，请确保有视野`);
                return ERR_NOT_FOUND;
            }
            const success = RoadBuilder.recalculateRoute(sourceRoom, targetRoom);
            if (success) {
                console.log(`✓ 路线 ${sourceRoom} -> ${targetRoom} 已重新计算`);
                return OK;
            } else {
                console.log(`✗ 路线重新计算失败`);
                return ERR_INVALID_TARGET;
            }
        },

        /**
         * 重新计算源头房间的所有外矿路线
         * @param sourceRoom 源头房间名
         */
        recalcAll(sourceRoom?: string) {
            // 如果没有指定房间，获取所有有外矿配置的房间
            const sourceRooms: string[] = [];
            
            if (sourceRoom) {
                sourceRooms.push(sourceRoom);
            } else {
                // 从 Memory 获取所有有外矿配置的房间
                const outMineData = getOutMineData();
                if (!outMineData || Object.keys(outMineData).length === 0) {
                    console.log('没有找到任何外矿配置');
                    return ERR_NOT_FOUND;
                }
                for (const room in outMineData) {
                    const data = outMineData[room];
                    // 只处理有外矿目标的房间
                    if ((data.energy && data.energy.length > 0) || 
                        (data.centerRoom && data.centerRoom.length > 0)) {
                        sourceRooms.push(room);
                    }
                }
                if (sourceRooms.length === 0) {
                    console.log('没有找到配置了外矿目标的房间');
                    return OK;
                }
                console.log(`\n找到 ${sourceRooms.length} 个有外矿配置的房间: ${sourceRooms.join(', ')}\n`);
            }

            let totalSuccess = 0;
            let totalFailed = 0;
            let totalNoVision = 0;

            for (const currentSourceRoom of sourceRooms) {
                const home = Game.rooms[currentSourceRoom];
                if (!home) {
                    console.log(`[${currentSourceRoom}] 跳过 - 无法访问源头房间`);
                    continue;
                }

                // 从 Memory 获取所有目标房间
                const outMineData = getOutMineData()?.[currentSourceRoom];
                if (!outMineData) {
                    console.log(`[${currentSourceRoom}] 跳过 - 没有外矿配置`);
                    continue;
                }

                const targetRooms = new Set<string>();
                
                // 收集能量外矿
                if (outMineData.energy) {
                    for (const room of outMineData.energy) {
                        targetRooms.add(room);
                    }
                }
                
                // 收集中央九房
                if (outMineData.centerRoom) {
                    for (const room of outMineData.centerRoom) {
                        targetRooms.add(room);
                    }
                }

                if (targetRooms.size === 0) {
                    console.log(`[${currentSourceRoom}] 跳过 - 没有配置外矿目标`);
                    continue;
                }

                console.log(`\n========== 重新计算外矿道路 [${currentSourceRoom}] ==========`);
                console.log(`目标房间: ${[...targetRooms].join(', ')}`);
                
                // 先清除所有旧路线和缓存
                for (const targetRoom of targetRooms) {
                    RoadMemory.deleteRoute(currentSourceRoom, targetRoom);
                }
                CostMatrixCache.clear();
                
                let success = 0;
                let failed = 0;
                let noVision = 0;

                for (const targetRoom of targetRooms) {
                    const target = Game.rooms[targetRoom];
                    if (!target) {
                        console.log(`  [${targetRoom}] 跳过 - 无视野`);
                        noVision++;
                        continue;
                    }

                    // 获取目标位置
                    const targets = RoadBuilder.getTargetPositions(target);
                    if (targets.length === 0) {
                        console.log(`  [${targetRoom}] ✗ 失败 - 无目标(Source/Mineral)`);
                        failed++;
                        continue;
                    }

                    // 计算路径
                    const pathResults = PathPlanner.planPaths(currentSourceRoom, targets);
                    if (pathResults.size === 0) {
                        console.log(`  [${targetRoom}] ✗ 失败 - 寻路失败(CPU:${Game.cpu.getUsed().toFixed(1)})`);
                        failed++;
                        continue;
                    }

                    // 转换并保存
                    const pathsToSave = new Map<string, RoomPosition[]>();
                    for (const [targetKey, positions] of pathResults) {
                        const parts = targetKey.split(':');
                        const posKey = `${parts[1]}:${parts[2]}`;
                        pathsToSave.set(posKey, positions);
                    }

                    RoadMemory.setPaths(currentSourceRoom, targetRoom, pathsToSave);
                    console.log(`  [${targetRoom}] ✓ 成功 - ${pathsToSave.size}条路径`);
                    success++;
                }

                console.log(`结果: 成功 ${success}, 失败 ${failed}, 无视野 ${noVision}`);
                totalSuccess += success;
                totalFailed += failed;
                totalNoVision += noVision;
            }

            if (sourceRooms.length > 1) {
                console.log(`\n========== 总计 ==========`);
                console.log(`成功 ${totalSuccess}, 失败 ${totalFailed}, 无视野 ${totalNoVision}`);
            }
            console.log(`==========================================\n`);
            return OK;
        },

        /**
         * 清除指定路线
         * @param sourceRoom 源头房间名
         * @param targetRoom 目标房间名
         */
        clear(sourceRoom: string, targetRoom: string) {
            if (!sourceRoom || !targetRoom) {
                console.log('用法: road.clear(sourceRoom, targetRoom)');
                return ERR_INVALID_ARGS;
            }
            const success = RoadMemory.deleteRoute(sourceRoom, targetRoom);
            if (success) {
                console.log(`✓ 路线 ${sourceRoom} -> ${targetRoom} 已清除`);
                return OK;
            } else {
                console.log(`✗ 路线不存在`);
                return ERR_NOT_FOUND;
            }
        },

        /**
         * 清除源头房间的所有路线
         * @param sourceRoom 源头房间名
         */
        clearAll(sourceRoom: string) {
            if (!sourceRoom) {
                console.log('用法: road.clearAll(sourceRoom)');
                return ERR_INVALID_ARGS;
            }
            const targets = RoadMemory.getRouteTargets(sourceRoom);
            if (targets.length === 0) {
                console.log(`房间 ${sourceRoom} 没有道路数据`);
                return OK;
            }
            let count = 0;
            for (const target of targets) {
                if (RoadMemory.deleteRoute(sourceRoom, target)) {
                    count++;
                }
            }
            console.log(`✓ 已清除 ${sourceRoom} 的 ${count} 条路线`);
            return OK;
        },

        /**
         * 显示统计信息
         * @param sourceRoom 源头房间名
         */
        stats(sourceRoom: string) {
            if (!sourceRoom) {
                console.log('用法: road.stats(sourceRoom)');
                return ERR_INVALID_ARGS;
            }
            const stats = RoadMemory.getStats(sourceRoom);
            const cacheStats = CostMatrixCache.getStats();
            const plannerStats = PathPlanner.getStats();

            console.log(`\n========== 外矿道路统计 [${sourceRoom}] ==========`);
            console.log(`目标房间: ${stats.routeCount}`);
            console.log(`独立路径: ${stats.pathCount}`);
            console.log(`道路总长: ${stats.totalLength}`);
            console.log(`覆盖房间: ${stats.roomCount}`);
            console.log(`\n---------- CostMatrix 缓存 ----------`);
            console.log(`缓存数量: ${cacheStats.total}`);
            console.log(`已过期: ${cacheStats.expired}`);
            console.log(`缓存房间: ${cacheStats.rooms.join(', ') || '无'}`);
            console.log(`\n---------- 路径规划器 ----------`);
            console.log(`本tick计算: ${plannerStats.pathsThisTick}`);
            console.log(`可继续计算: ${plannerStats.canPlan ? '是' : '否'}`);
            console.log(`CPU使用率: ${(plannerStats.cpuUsage * 100).toFixed(1)}%`);
            console.log(`==========================================\n`);
            return OK;
        },

        /**
         * 验证数据完整性
         * @param sourceRoom 源头房间名
         */
        validate(sourceRoom: string) {
            if (!sourceRoom) {
                console.log('用法: road.validate(sourceRoom)');
                return ERR_INVALID_ARGS;
            }
            const result = RoadMemory.validate(sourceRoom);
            if (result.valid) {
                console.log(`✓ 数据验证通过`);
            } else {
                console.log(`✗ 数据验证失败:`);
                for (const error of result.errors) {
                    console.log(`  - ${error}`);
                }
            }
            return result.valid ? OK : ERR_INVALID_ARGS;
        },

        /**
         * 清除 CostMatrix 缓存
         */
        clearCache() {
            CostMatrixCache.clear();
            console.log(`✓ CostMatrix 缓存已清除`);
            return OK;
        },

        /**
         * 检查道路健康状态
         * @param sourceRoom 源头房间名
         */
        health(sourceRoom: string) {
            if (!sourceRoom) {
                console.log('用法: road.health(sourceRoom)');
                return ERR_INVALID_ARGS;
            }
            const targets = RoadMemory.getRouteTargets(sourceRoom);
            if (targets.length === 0) {
                console.log(`房间 ${sourceRoom} 没有道路数据`);
                return OK;
            }

            console.log(`\n========== 道路健康检查 [${sourceRoom}] ==========`);
            for (const targetRoom of targets) {
                const group = RoadMemory.getRouteGroup(sourceRoom, targetRoom);
                if (!group) continue;

                const positions = RoadMemory.getGroupPositions(sourceRoom, targetRoom);
                let built = 0;
                let damaged = 0;
                let missing = 0;
                let noVision = 0;

                for (const pos of positions) {
                    const room = Game.rooms[pos.roomName];
                    if (!room) {
                        noVision++;
                        continue;
                    }
                    const structures = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
                    const road = structures.find(s => s.structureType === STRUCTURE_ROAD) as StructureRoad | undefined;
                    if (road) {
                        built++;
                        if (road.hits < road.hitsMax * 0.5) {
                            damaged++;
                        }
                    } else {
                        missing++;
                    }
                }

                const status = group.status || 'unknown';
                const healthPct = positions.length > 0 ? ((built / positions.length) * 100).toFixed(1) : '0';
                console.log(`[${targetRoom}] 状态:${status} 完成:${healthPct}% 已建:${built} 缺失:${missing} 损坏:${damaged} 无视野:${noVision}`);
            }
            console.log(`==========================================\n`);
            return OK;
        },

        /**
         * 显示帮助信息
         */
        help() {
            return global['helpRoad'];
        },

        /**
         * 显示道路可视化
         * @param sourceRoom 源头房间名
         * @param targetRoom 可选，指定目标房间
         */
        show(sourceRoom: string, targetRoom?: string) {
            if (!sourceRoom) {
                console.log('用法: road.show(sourceRoom, [targetRoom])');
                return ERR_INVALID_ARGS;
            }
            if (targetRoom) {
                RoadVisual.visualize(sourceRoom, targetRoom);
                console.log(`✓ 已显示 ${sourceRoom} -> ${targetRoom} 的道路可视化（单次）`);
            } else {
                RoadVisual.enable(sourceRoom);
                RoadVisual.visualizeAll(sourceRoom);
                console.log(`✓ 已启用 ${sourceRoom} 的道路可视化`);
                console.log(`  提示: 也可以创建 Flag "${sourceRoom}/roadVisual" 来触发可视化`);
            }
            return OK;
        },

        /**
         * 隐藏道路可视化
         * @param sourceRoom 源头房间名
         */
        hide(sourceRoom: string) {
            if (!sourceRoom) {
                console.log('用法: road.hide(sourceRoom)');
                return ERR_INVALID_ARGS;
            }
            RoadVisual.disable(sourceRoom);
            console.log(`✓ 已禁用 ${sourceRoom} 的道路可视化`);
            return OK;
        },

        /**
         * 显示图例
         * @param roomName 房间名
         */
        legend(roomName: string) {
            if (!roomName) {
                console.log('用法: road.legend(roomName)');
                return ERR_INVALID_ARGS;
            }
            RoadVisual.drawLegend(roomName);
            console.log(`✓ 已在 ${roomName} 显示图例`);
            return OK;
        }
    },
}
