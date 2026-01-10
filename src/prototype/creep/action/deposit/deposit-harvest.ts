import { OUTMINE_CONFIG } from '@/constant/config';

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
            deposits.sort((a, b) => a.lastCooldown - b.lastCooldown);
            let deposit = deposits.find(d => {
                // 统计当前房间内绑定该Deposit的Creep数量
                let creepCount = creep.room.find(FIND_MY_CREEPS, {
                    filter: (c: any) => 
                        c.memory.role === creep.memory.role &&
                        c.memory.targetDeposit === d.id &&
                        c.ticksToLive > 150
                }).length;
                // 最大站位数
                if (!creep.room.memory) creep.room.memory = {} as any;
                if (!creep.room.memory['depositMine']) creep.room.memory['depositMine'] = {};
                let maxPosCount = creep.room.memory['depositMine'][d.id] as number;
                if (!maxPosCount) {
                    maxPosCount = 0;
                    const terrain = new Room.Terrain(creep.room.name);
                    [[d.pos.x-1, d.pos.y-1], [d.pos.x, d.pos.y-1], [d.pos.x+1, d.pos.y-1],
                     [d.pos.x-1, d.pos.y], [d.pos.x+1, d.pos.y],
                     [d.pos.x-1, d.pos.y+1], [d.pos.x, d.pos.y+1], [d.pos.x+1, d.pos.y+1],
                    ].forEach((p) => {
                        if (terrain.get(p[0], p[1]) != TERRAIN_MASK_WALL) maxPosCount++;
                    })
                    creep.room.memory['depositMine'][d.id] = maxPosCount;
                }
                // 绑定满的忽略
                if (creepCount >= maxPosCount) return;
                if (creepCount >= 3) return;
                return true;
            });
            if (!deposit) return;
            creep.memory['targetDeposit'] = deposit.id;
        }

        const deposit = Game.getObjectById(creep.memory['targetDeposit']) as Deposit;
        if (!deposit) {
            creep.memory['targetDeposit'] = null;
            return;
        }

        if (creep.pos.inRangeTo(deposit, 1)) {
            if (!creep.memory.dontPullMe) creep.memory.dontPullMe = true;
            if (deposit.cooldown == 0) {
                creep.harvest(deposit);
                return false;
            }
            if (creep.getActiveBodyparts(ATTACK) > 0) {
                const hostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1, {
                    filter: c => c.body.some(p => p.type == WORK || p.type == HEAL)
                });
                if (hostiles.length > 0) creep.attack(hostiles[0]);
            }
        } else{
            if (creep.getActiveBodyparts(ATTACK) > 0) {
                const hostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1, {
                    filter: c => c.body.some(p => p.type == WORK || p.type == HEAL)
                });
                if (hostiles.length > 0) {
                    creep.attack(hostiles[0]);
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
            const nearbyTransport = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
                filter: c => c.memory.role === 'deposit-transfer' && c.store.getFreeCapacity() > 0
            })[0];
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
        const nearbyTransport = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
            filter: c => c.memory.role === 'deposit-transfer' && c.store.getFreeCapacity() > 0
        })[0];
        if (!nearbyTransport) return creep.store.getUsedCapacity() == 0;

        const resourceType = Object.keys(creep.store)[0] as ResourceConstant;
        creep.transfer(nearbyTransport, resourceType);
        return creep.store.getUsedCapacity() == 0;
    }
}

export default deposit_harvest;