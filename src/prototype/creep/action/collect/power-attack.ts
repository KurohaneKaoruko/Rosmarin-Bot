import { getRoomTickCacheValue } from '@/modules/utils/roomTickCache';

// 未绑定时的行动
const noBindAction = (creep: Creep) => {
    const roomHostiles = getRoomTickCacheValue(creep.room, 'power_attack_room_hostiles', () =>
        creep.room.find(FIND_HOSTILE_CREEPS) as Creep[]
    );
    const hostiles = roomHostiles.filter((c) => creep.pos.inRangeTo(c, 8));
    if (hostiles.length == 0) return;
    const healHostiles = hostiles.filter((c: any) => c.body.some((p: any) => p.type == HEAL));
    if (healHostiles.length > 0) {
        const hostile = creep.pos.findClosestByRange(healHostiles);
        if (creep.pos.isNearTo(hostile)) creep.attack(hostile);
        creep.moveTo(hostile);
        return;
    } 
    const attackHostiles = hostiles.filter((c: any) => c.body.some((p: any) => p.type == ATTACK || p.type == RANGED_ATTACK));
    if (attackHostiles.length > 0) {
        const hostile = creep.pos.findClosestByRange(attackHostiles);
        if (creep.pos.isNearTo(hostile)) creep.attack(hostile);
        creep.moveTo(hostile);
        return;
    }
}



const power_attack = {
    run: function(creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }

        if(!creep.memory.boosted) {
            const boostLevel = creep.memory['boostLevel'];
            if (boostLevel == 1) {
                creep.memory.boosted = creep.goBoost({
                    [ATTACK]: ['UH'],
                    [TOUGH]: ['GO']
                }, { must: true }) === OK;
            } else if (boostLevel == 2) {
                creep.memory.boosted = creep.goBoost({
                    [ATTACK]: ['UH2O'],
                    [TOUGH]: ['GHO2']
                }, { must: true }) === OK;
            } else {
                creep.memory.boosted = true;
            }
            return;
        }

        if (!creep.memory.bind) {
            if (creep.room.name == creep.memory.targetRoom) {
                noBindAction(creep);
            }
            return; // 等待绑定
        }

        const bindcreep = Game.getObjectById(creep.memory.bind) as Creep;
        if (!bindcreep) {
            delete creep.memory.bind;
        }

        // 移动到目标房间.未到达房间不继续行动
        if (creep.doubleMoveToRoom(creep.memory.targetRoom, '#ff0000')) return;

        // 找powerBank
        let powerBank = creep.room.powerBank?.[0];
        if (!powerBank) {
            creep.room.update(STRUCTURE_POWER_BANK);
            powerBank = creep.room.powerBank?.[0];
        }
        if (!powerBank) {
            if(Game.time % 5 === 0){
                creep.suicide();
                const bindCreep = Game.getObjectById(creep.memory.bind) as Creep;
                bindCreep?.suicide();
            }
            return;
        }

        // 索敌
        if (Game.time % 5 == 0 || !creep.memory['hostile']) {
            const roomHostiles = getRoomTickCacheValue(creep.room, 'power_attack_room_hostiles', () =>
                creep.room.find(FIND_HOSTILE_CREEPS) as Creep[]
            );
            const hostiles = roomHostiles.filter((c) =>
                creep.pos.inRangeTo(c, 8) && c.pos.inRangeTo(powerBank.pos, 8)
            );
            const attackHostiles = hostiles.filter((c: any) => c.body.some((p: any) => p.type == ATTACK || p.type == RANGED_ATTACK));
            const healHostiles = hostiles.filter((c: any) => c.body.some((p: any) => p.type == HEAL));
            let hostile = creep.pos.findClosestByRange([...healHostiles, ...attackHostiles]) ||
                            creep.pos.findClosestByRange(hostiles, {
                                filter: (c) => c.pos.inRangeTo(powerBank.pos, 3) &&
                                c.body.some((p: any) => p.type == CARRY)
                            });
            if (hostile) creep.memory['hostile'] = hostile.id;
        }

        // 攻击 Creep
        if (creep.memory['hostile']) {
            const hostile = Game.getObjectById(creep.memory['hostile']) as Creep;
            if (hostile && hostile.pos.inRangeTo(powerBank.pos, 10)) {
                if (creep.pos.isNearTo(hostile)) creep.attack(hostile);
                else {
                    const roomHostiles = getRoomTickCacheValue(creep.room, 'power_attack_non_whitelist_hostiles', () =>
                        creep.room.find(FIND_HOSTILE_CREEPS, {
                            filter: (c) => !Memory['whitelist'].includes(c.owner.username)
                        }) as Creep[]
                    );
                    const nearCreeps = roomHostiles.filter((c) => creep.pos.inRangeTo(c, 1));
                    if (nearCreeps.length > 0) creep.attack(nearCreeps[0]);
                }
                if (!hostile.getActiveBodyparts(ATTACK)) {
                    creep.doubleMoveTo(hostile.pos, '#ff0000');
                }
                return;
            } else {
                delete creep.memory['hostile'];
            }
        }
        

        if (powerBank.hits < 50e3 &&
            powerBank.ticksToDecay > 1500 &&
            creep.ticksToLive > 100) {
            // 如果没有搬运工在附近, 暂时停止采集
            const powerCarryCreeps = getRoomTickCacheValue(creep.room, 'power_attack_power_carries', () =>
                creep.room.find(FIND_MY_CREEPS, {
                    filter: (c) => c.memory.role == 'power-carry'
                }) as Creep[]
            );
            if (!powerCarryCreeps.some((c) => creep.pos.inRangeTo(c, 10))) return;
        }
        
        // 攻击 powerBank
        if (creep.pos.isNearTo(powerBank)) {
            if (creep.hits >= creep.hitsMax / 2)
                creep.attack(powerBank);
        } else {
            creep.doubleMoveTo(powerBank.pos, '#aa0000', { ignoreCreeps: true });
            return;
        }

        // if (Game.time % 10 !== 0) return;
        // if (!creep.pos.isNearTo(bindcreep)) return;
        // let direction = creep.pos.getDirection(powerBank.pos);
        // let pos = getAdjacentPos(creep.pos, getOppositeDirection(direction));
        // if (pos.isRoomEdge() || bindcreep.pos.isEqual(pos)) return;
        // bindcreep.move(bindcreep.pos.getDirection(pos));

        return;
    }
}

export default power_attack;
