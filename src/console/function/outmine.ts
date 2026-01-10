import { CostMatrixCache, RoadMemory, RoadBuilder, PathPlanner, RoadVisual } from '@/modules/utils/outMineRoad';

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
    // 外矿道路管理
    road: {
        /**
         * 重新计算指定路线
         * @param homeRoom 主房间名
         * @param targetRoom 目标房间名
         */
        recalc(homeRoom: string, targetRoom: string) {
            if (!homeRoom || !targetRoom) {
                console.log('用法: road.recalc(homeRoom, targetRoom)');
                return ERR_INVALID_ARGS;
            }
            const home = Game.rooms[homeRoom];
            const target = Game.rooms[targetRoom];
            if (!home) {
                console.log(`错误: 无法访问主房间 ${homeRoom}`);
                return ERR_NOT_FOUND;
            }
            if (!target) {
                console.log(`错误: 无法访问目标房间 ${targetRoom}，请确保有视野`);
                return ERR_NOT_FOUND;
            }
            const success = RoadBuilder.recalculateRoute(homeRoom, targetRoom);
            if (success) {
                console.log(`✓ 路线 ${homeRoom} -> ${targetRoom} 已重新计算`);
                return OK;
            } else {
                console.log(`✗ 路线重新计算失败`);
                return ERR_INVALID_TARGET;
            }
        },

        /**
         * 重新计算主房间的所有外矿路线
         * @param homeRoom 主房间名
         */
        recalcAll(homeRoom?: string) {
            // 如果没有指定房间，获取所有有外矿配置的房间
            const homeRooms: string[] = [];
            
            if (homeRoom) {
                homeRooms.push(homeRoom);
            } else {
                // 从 Memory 获取所有有外矿配置的房间
                const outMineData = Memory['OutMineData'];
                if (!outMineData || Object.keys(outMineData).length === 0) {
                    console.log('没有找到任何外矿配置');
                    return ERR_NOT_FOUND;
                }
                for (const room in outMineData) {
                    const data = outMineData[room];
                    // 只处理有外矿目标的房间
                    if ((data.energy && data.energy.length > 0) || 
                        (data.centerRoom && data.centerRoom.length > 0)) {
                        homeRooms.push(room);
                    }
                }
                if (homeRooms.length === 0) {
                    console.log('没有找到配置了外矿目标的房间');
                    return OK;
                }
                console.log(`\n找到 ${homeRooms.length} 个有外矿配置的房间: ${homeRooms.join(', ')}\n`);
            }

            let totalSuccess = 0;
            let totalFailed = 0;
            let totalNoVision = 0;

            for (const currentHomeRoom of homeRooms) {
                const home = Game.rooms[currentHomeRoom];
                if (!home) {
                    console.log(`[${currentHomeRoom}] 跳过 - 无法访问主房间`);
                    continue;
                }

                // 从 Memory 获取所有目标房间
                const outMineData = Memory['OutMineData']?.[currentHomeRoom];
                if (!outMineData) {
                    console.log(`[${currentHomeRoom}] 跳过 - 没有外矿配置`);
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
                    console.log(`[${currentHomeRoom}] 跳过 - 没有配置外矿目标`);
                    continue;
                }

                console.log(`\n========== 重新计算外矿道路 [${currentHomeRoom}] ==========`);
                console.log(`目标房间: ${[...targetRooms].join(', ')}`);
                
                // 先清除所有旧路线和缓存
                for (const targetRoom of targetRooms) {
                    RoadMemory.deleteRoute(currentHomeRoom, targetRoom);
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
                    const pathResults = PathPlanner.planPaths(currentHomeRoom, targets);
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

                    RoadMemory.setPaths(currentHomeRoom, targetRoom, pathsToSave);
                    console.log(`  [${targetRoom}] ✓ 成功 - ${pathsToSave.size}条路径`);
                    success++;
                }

                console.log(`结果: 成功 ${success}, 失败 ${failed}, 无视野 ${noVision}`);
                totalSuccess += success;
                totalFailed += failed;
                totalNoVision += noVision;
            }

            if (homeRooms.length > 1) {
                console.log(`\n========== 总计 ==========`);
                console.log(`成功 ${totalSuccess}, 失败 ${totalFailed}, 无视野 ${totalNoVision}`);
            }
            console.log(`==========================================\n`);
            return OK;
        },

        /**
         * 清除指定路线
         * @param homeRoom 主房间名
         * @param targetRoom 目标房间名
         */
        clear(homeRoom: string, targetRoom: string) {
            if (!homeRoom || !targetRoom) {
                console.log('用法: road.clear(homeRoom, targetRoom)');
                return ERR_INVALID_ARGS;
            }
            const success = RoadMemory.deleteRoute(homeRoom, targetRoom);
            if (success) {
                console.log(`✓ 路线 ${homeRoom} -> ${targetRoom} 已清除`);
                return OK;
            } else {
                console.log(`✗ 路线不存在`);
                return ERR_NOT_FOUND;
            }
        },

        /**
         * 清除主房间的所有路线
         * @param homeRoom 主房间名
         */
        clearAll(homeRoom: string) {
            if (!homeRoom) {
                console.log('用法: road.clearAll(homeRoom)');
                return ERR_INVALID_ARGS;
            }
            const targets = RoadMemory.getRouteTargets(homeRoom);
            if (targets.length === 0) {
                console.log(`房间 ${homeRoom} 没有道路数据`);
                return OK;
            }
            let count = 0;
            for (const target of targets) {
                if (RoadMemory.deleteRoute(homeRoom, target)) {
                    count++;
                }
            }
            console.log(`✓ 已清除 ${homeRoom} 的 ${count} 条路线`);
            return OK;
        },

        /**
         * 迁移旧格式数据
         * @param homeRoom 主房间名
         */
        migrate(homeRoom: string) {
            if (!homeRoom) {
                console.log('用法: road.migrate(homeRoom)');
                return ERR_INVALID_ARGS;
            }
            const count = RoadMemory.migrate(homeRoom);
            if (count > 0) {
                console.log(`✓ 已迁移 ${count} 条路线到新格式`);
            } else {
                console.log(`无需迁移（已是最新格式或无数据）`);
            }
            return OK;
        },

        /**
         * 显示统计信息
         * @param homeRoom 主房间名
         */
        stats(homeRoom: string) {
            if (!homeRoom) {
                console.log('用法: road.stats(homeRoom)');
                return ERR_INVALID_ARGS;
            }
            const stats = RoadMemory.getStats(homeRoom);
            const cacheStats = CostMatrixCache.getStats();
            const plannerStats = PathPlanner.getStats();

            console.log(`\n========== 外矿道路统计 [${homeRoom}] ==========`);
            console.log(`目标房间: ${stats.routeCount}`);
            console.log(`独立路径: ${stats.pathCount}`);
            console.log(`道路总长: ${stats.totalLength}`);
            console.log(`覆盖房间: ${stats.roomCount}`);
            console.log(`数据版本: ${stats.version}`);
            console.log(`旧数据: ${stats.hasOldData ? '存在（可迁移）' : '无'}`);
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
         * @param homeRoom 主房间名
         */
        validate(homeRoom: string) {
            if (!homeRoom) {
                console.log('用法: road.validate(homeRoom)');
                return ERR_INVALID_ARGS;
            }
            const result = RoadMemory.validate(homeRoom);
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
         * @param homeRoom 主房间名
         */
        health(homeRoom: string) {
            if (!homeRoom) {
                console.log('用法: road.health(homeRoom)');
                return ERR_INVALID_ARGS;
            }
            const targets = RoadMemory.getRouteTargets(homeRoom);
            if (targets.length === 0) {
                console.log(`房间 ${homeRoom} 没有道路数据`);
                return OK;
            }

            console.log(`\n========== 道路健康检查 [${homeRoom}] ==========`);
            for (const targetRoom of targets) {
                const route = RoadMemory.getRoads(homeRoom, targetRoom);
                if (!route) continue;

                const positions = RoadMemory.routeToPositions(route);
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

                const status = route.status || 'unknown';
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
            console.log(`
========== 外矿道路命令帮助 ==========
road.recalc(homeRoom, targetRoom)  - 重新计算指定路线
road.recalcAll([homeRoom])         - 重新计算所有外矿路线(不填则全部房间)
road.clear(homeRoom, targetRoom)   - 清除指定路线
road.clearAll(homeRoom)            - 清除所有路线
road.migrate(homeRoom)             - 迁移旧格式数据
road.stats(homeRoom)               - 显示统计信息
road.validate(homeRoom)            - 验证数据完整性
road.clearCache()                  - 清除CostMatrix缓存
road.health(homeRoom)              - 检查道路健康状态
road.show(homeRoom, [targetRoom])  - 显示道路可视化
road.hide(homeRoom)                - 隐藏道路可视化
road.help()                        - 显示此帮助
==========================================
            `);
            return OK;
        },

        /**
         * 显示道路可视化
         * @param homeRoom 主房间名
         * @param targetRoom 可选，指定目标房间
         */
        show(homeRoom: string, targetRoom?: string) {
            if (!homeRoom) {
                console.log('用法: road.show(homeRoom, [targetRoom])');
                return ERR_INVALID_ARGS;
            }
            if (targetRoom) {
                RoadVisual.visualize(homeRoom, targetRoom);
                console.log(`✓ 已显示 ${homeRoom} -> ${targetRoom} 的道路可视化（单次）`);
            } else {
                RoadVisual.enable(homeRoom);
                RoadVisual.visualizeAll(homeRoom);
                console.log(`✓ 已启用 ${homeRoom} 的道路可视化`);
                console.log(`  提示: 也可以创建 Flag "${homeRoom}/roadVisual" 来触发可视化`);
            }
            return OK;
        },

        /**
         * 隐藏道路可视化
         * @param homeRoom 主房间名
         */
        hide(homeRoom: string) {
            if (!homeRoom) {
                console.log('用法: road.hide(homeRoom)');
                return ERR_INVALID_ARGS;
            }
            RoadVisual.disable(homeRoom);
            console.log(`✓ 已禁用 ${homeRoom} 的道路可视化`);
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