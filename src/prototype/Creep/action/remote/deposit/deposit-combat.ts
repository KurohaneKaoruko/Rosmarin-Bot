import { getRoomTickCacheValue } from '@/modules/shared/roomTickCache';
import { resolveBoundPartner } from '@/prototype/Creep/function/boundPartner';
import { ensureInTargetRoomForCombat, runRangedCombat } from '@/prototype/Creep/function/combatCore';

const runDepositAttack = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();
    if (!resolveBoundPartner(creep)) return;
    if (creep.doubleMoveToRoom(creep.memory.targetRoom, '#ff0000')) return;

    const combatHostiles = getRoomTickCacheValue(creep.room, 'deposit_attack_combat_hostiles', () =>
        creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: (hostile) =>
                !Memory['whitelist'].includes(hostile.owner.username) &&
                hostile.body.some((part) =>
                    part.type === ATTACK ||
                    part.type === RANGED_ATTACK ||
                    part.type === HEAL ||
                    part.type === WORK
                )
        }) as Creep[]
    );
    const deposits = getRoomTickCacheValue(creep.room, 'deposit_attack_deposits', () =>
        creep.room.find(FIND_DEPOSITS) as Deposit[]
    );
    const hostileNearDeposit = getRoomTickCacheValue(creep.room, 'deposit_attack_hostile_near_deposit', () => {
        const result: Record<string, true> = {};
        for (const hostile of combatHostiles) {
            if (deposits.some((deposit) => deposit.pos.inRangeTo(hostile.pos, 5))) result[hostile.id] = true;
        }
        return result;
    });
    const hostiles = combatHostiles.filter((hostile) => hostileNearDeposit[hostile.id] || hostile.pos.inRangeTo(creep, 3));
    if (hostiles.length <= 0) return;

    const hostile = creep.pos.findClosestByRange(hostiles);
    if (!hostile) return;
    if (creep.pos.isNearTo(hostile)) {
        creep.attack(hostile);
    } else {
        creep.doubleMoveTo(hostile.pos, '#ff0000');
    }
};

const runDepositRanged = (creep: Creep) => {
    creep.disableAttackNotificationsOnce();
    if (!ensureInTargetRoomForCombat(creep)) return;

    const acted = runRangedCombat(creep, {
        hostilesInRange: (self) => {
            const combatHostiles = getRoomTickCacheValue(self.room, 'deposit_ranged_combat_hostiles', () =>
                self.room.find(FIND_HOSTILE_CREEPS, {
                    filter: (hostile) => !Memory['whitelist'].includes(hostile.owner.username) &&
                        hostile.body.some((part) =>
                            part.type === ATTACK ||
                            part.type === RANGED_ATTACK ||
                            part.type === HEAL ||
                            part.type === WORK ||
                            part.type === CARRY
                        )
                }) as Creep[]
            );
            const deposits = getRoomTickCacheValue(self.room, 'deposit_ranged_deposits', () =>
                self.room.find(FIND_DEPOSITS) as Deposit[]
            );
            return combatHostiles.filter((hostile) =>
                hostile.pos.inRangeTo(self, 3) || deposits.some((deposit) => deposit.pos.inRangeTo(hostile.pos, 5))
            );
        },
        injuredAllies: (self) => {
            const damagedAllies = getRoomTickCacheValue(self.room, 'deposit_ranged_damaged_allies', () =>
                self.room.find(FIND_MY_CREEPS, {
                    filter: (ally) => ally.hits < ally.hitsMax &&
                        ally.memory.role !== 'deposit-attack' &&
                        ally.memory.role !== 'deposit-heal'
                }) as Creep[]
            );
            return damagedAllies.filter((ally) => self.pos.inRangeTo(ally, 3));
        },
        attackerParts: [ATTACK, RANGED_ATTACK],
    });
    if (acted) return;

    const deposit = creep.pos.findClosestByRange(FIND_DEPOSITS);
    if (deposit && !creep.pos.inRangeTo(deposit, 5)) {
        creep.moveTo(deposit, { range: 5, ignoreCreeps: false });
    }
};

const depositAttack = {
    run: runDepositAttack
};

const depositRanged = {
    run: runDepositRanged
};

export { depositAttack, depositRanged };
