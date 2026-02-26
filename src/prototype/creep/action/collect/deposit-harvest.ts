import { OUTMINE_CONFIG } from '@/constant/config';
import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';

const deposit_harvest = {
    source: function(creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }
        
        if (creep.room.name != creep.memory.targetRoom || creep.pos.isRoomEdge()) {
            let opt = {};
            if (creep.room.name != creep.memory.homeRoom) opt = { ignoreCreeps: false };
            creep.moveToRoom(creep.memory.targetRoom, opt);
            return;
        }

        if (!creep.memory['targetDeposit']) {
            let deposits = creep.room.find(FIND_DEPOSITS);
            // 筛选
            let activeDeposits = deposits.filter(d => d.lastCooldown <= OUTMINE_CONFIG.DEPOSIT_MAX_COOLDOWN);
            if (activeDeposits.length > 0) {
                deposits = activeDeposits;
            }
            if (deposits.length == 0) return;

            const role = creep.memory.role;
            const boundCountByDeposit = getRoomTickCacheValue(
                creep.room,
                `deposit_harvest_bound_count_${role}`,
                () => {
                    const countByDeposit: Record<string, number> = {};
                    const roleCreeps = creep.room.find(FIND_MY_CREEPS, {
                        filter: (c: any) => c.memory.role === role && c.ticksToLive > 150 && c.memory.targetDeposit
                    }) as Creep[];
                    for (const roleCreep of roleCreeps) {
                        const targetDepositId = roleCreep.memory.targetDeposit as string;
                        countByDeposit[targetDepositId] = (countByDeposit[targetDepositId] || 0) + 1;
                    }
                    return countByDeposit;
                }
            );

            const maxPosByDeposit = getRoomTickCacheValue(creep.room, 'deposit_harvest_max_pos_by_deposit', () => {
                const terrain = new Room.Terrain(creep.room.name);
                const result: Record<string, number> = {};
                const roomDeposits = creep.room.find(FIND_DEPOSITS);
                for (const roomDeposit of roomDeposits) {
                    let maxPosCount = 0;
                    [
                        [roomDeposit.pos.x - 1, roomDeposit.pos.y - 1],
                        [roomDeposit.pos.x, roomDeposit.pos.y - 1],
                        [roomDeposit.pos.x + 1, roomDeposit.pos.y - 1],
                        [roomDeposit.pos.x - 1, roomDeposit.pos.y],
                        [roomDeposit.pos.x + 1, roomDeposit.pos.y],
                        [roomDeposit.pos.x - 1, roomDeposit.pos.y + 1],
                        [roomDeposit.pos.x, roomDeposit.pos.y + 1],
                        [roomDeposit.pos.x + 1, roomDeposit.pos.y + 1],
                    ].forEach((p) => {
                        if (terrain.get(p[0], p[1]) != TERRAIN_MASK_WALL) maxPosCount++;
                    });
                    result[roomDeposit.id] = maxPosCount;
                }
                return result;
            });

            deposits.sort((a, b) => a.lastCooldown - b.lastCooldown);
            let deposit = deposits.find(d => {
                // 统计当前房间内绑定该Deposit的Creep数量
                const creepCount = boundCountByDeposit[d.id] || 0;
                
                // 最大站位数
                // 优先尝试从 mission pool 获取 maxPos，如果没有则回退到实时计算
                let maxPosCount = maxPosByDeposit[d.id] || 0;
                
                // 尝试从 mine 任务池获取对应的任务
                // 注意：这里需要 creep.room.name 对应的房间对象来获取任务池，但 creep.room 此时是在目标房间（过道/外矿）
                // 任务池是存在 HomeRoom (creep.memory.homeRoom) 的 Memory 中的
                // 所以我们无法直接通过 creep.room.getMissionFromPool 获取到 homeRoom 的任务
                
                // 方案 A: 实时计算（轻量级），不写 Memory
                // 绑定满的忽略
                if (creepCount >= maxPosCount) return;
                if (creepCount >= 3) return;
                return true;
            });
            if (!deposit) return;
            boundCountByDeposit[deposit.id] = (boundCountByDeposit[deposit.id] || 0) + 1;
            creep.memory['targetDeposit'] = deposit.id;
        }

        const deposit = Game.getObjectById(creep.memory['targetDeposit']) as Deposit;
        if (!deposit) {
            creep.memory['targetDeposit'] = null;
            return;
        }

        const closeHostiles = getRoomTickCacheValue(creep.room, 'deposit_harvest_close_work_heal_hostiles', () =>
            creep.room.find(FIND_HOSTILE_CREEPS, {
                filter: (c) => c.body.some((p) => p.type == WORK || p.type == HEAL)
            }) as Creep[]
        ).filter((c) => creep.pos.inRangeTo(c, 1));

        if (creep.pos.inRangeTo(deposit, 1)) {
            if (!creep.memory.dontPullMe) creep.memory.dontPullMe = true;
            if (deposit.cooldown == 0) {
                creep.harvest(deposit);
                return false;
            }
            if (creep.getActiveBodyparts(ATTACK) > 0) {
                if (closeHostiles.length > 0) creep.attack(closeHostiles[0]);
            }
        } else{
            if (creep.getActiveBodyparts(ATTACK) > 0) {
                if (closeHostiles.length > 0) {
                    creep.attack(closeHostiles[0]);
                    return false;
                }
            }
            if (creep.memory.dontPullMe) creep.memory.dontPullMe = false;
            creep.moveTo(deposit, {
                visualizePathStyle: { stroke: '#ffaa00' },
                range: 1,
                ignoreCreeps: true
            });
        }

        if (deposit.cooldown > 0 && creep.store.getUsedCapacity() > 0) {
            const transferCreeps = getRoomTickCacheValue(creep.room, 'deposit_harvest_transfer_creeps', () =>
                creep.room.find(FIND_MY_CREEPS, {
                    filter: (c) => c.memory.role === 'deposit-transfer'
                }) as Creep[]
            );
            const nearbyTransport = transferCreeps.find((c) =>
                c.store.getFreeCapacity() > 0 && creep.pos.inRangeTo(c, 1)
            );
            if(nearbyTransport){
                const resourceType = Object.keys(creep.store)[0] as ResourceConstant;
                if (creep.pos.inRangeTo(nearbyTransport, 1)) {
                    creep.transfer(nearbyTransport, resourceType);
                }
                return false;
            }
        }

        return creep.store.getFreeCapacity() == 0;
    },
    target: function(creep: Creep) {
        const transferCreeps = getRoomTickCacheValue(creep.room, 'deposit_harvest_transfer_creeps', () =>
            creep.room.find(FIND_MY_CREEPS, {
                filter: (c) => c.memory.role === 'deposit-transfer'
            }) as Creep[]
        );
        const nearbyTransport = transferCreeps.find((c) =>
            c.store.getFreeCapacity() > 0 && creep.pos.inRangeTo(c, 1)
        );
        if (!nearbyTransport) return creep.store.getUsedCapacity() == 0;

        const resourceType = Object.keys(creep.store)[0] as ResourceConstant;
        creep.transfer(nearbyTransport, resourceType);
        return creep.store.getUsedCapacity() == 0;
    }
}

export default deposit_harvest;
