/**
 * 跨房能量漏斗（Tier 1-4）。
 *
 * 每 20 tick 扫描一次全部有 terminal 的自有房间：
 * - energyLevel < 30 → 接收方（按紧急度升序）
 * - energyLevel >= 100 → 捐助方
 * - 捐赠量 = min(接收方缺口, 捐助方 terminal 能量一半)，保证捐助方等级不跌破 100
 * - 同一接收方 500 tick 冷却，给能量在途留时间
 */
import { getEnergyLevel, getStandardReserve } from '@/modules/shared/energyLevel';

const FUNNEL_CHECK_INTERVAL = 20;
const FUNNEL_EMERGENCY_LEVEL = 30;
const FUNNEL_DONOR_LEVEL = 100;
const FUNNEL_MIN_DONATE = 2000;
const FUNNEL_RECEIVER_COOLDOWN = 500;

export const FunnelModule = {
    end: function () {
        if (Game.time % FUNNEL_CHECK_INTERVAL !== 0) return;

        const mem = Memory as any;
        mem.funnelCooldown ??= {};

        const participants = Object.values(Game.rooms)
            .filter((room) => room.my && room.terminal && room.controller?.my)
            .map((room) => ({
                room,
                terminal: room.terminal!,
                level: getEnergyLevel(room),
            }));
        if (participants.length < 2) return;

        const receivers = participants
            .filter((entry) => entry.level < FUNNEL_EMERGENCY_LEVEL)
            .filter((entry) => Game.time - (mem.funnelCooldown[entry.room.name] || 0) > FUNNEL_RECEIVER_COOLDOWN)
            .sort((a, b) => a.level - b.level);
        if (receivers.length === 0) return;

        const donors = participants.filter((entry) => entry.level >= FUNNEL_DONOR_LEVEL);
        if (donors.length === 0) return;

        for (const receiver of receivers) {
            // 缺口：补回到紧急线（30）所需的能量
            const targetEnergy = Math.floor((FUNNEL_EMERGENCY_LEVEL / 100) * getStandardReserve(receiver.room.level));
            const currentEnergy =
                (receiver.room.storage?.store[RESOURCE_ENERGY] || 0) +
                (receiver.terminal.store[RESOURCE_ENERGY] || 0);
            let gap = targetEnergy - currentEnergy;
            if (gap <= 0) continue;

            // 捐助方：等级最高者优先；捐赠后其等级不得跌破 100（捐 terminal 能量的一半为上限）
            const donor = [...donors].sort((a, b) => b.level - a.level)[0];
            const donorSurplus = Math.floor(donor.terminal.store[RESOURCE_ENERGY] / 2);
            const amount = Math.min(gap, donorSurplus, receiver.terminal.store.getFreeCapacity(RESOURCE_ENERGY));

            if (amount < FUNNEL_MIN_DONATE) {
                // 捐不出有效量：本周期跳过该接收方并进入冷却，避免每 20 tick 空转
                mem.funnelCooldown[receiver.room.name] = Game.time;
                continue;
            }

            const result = donor.terminal.send(RESOURCE_ENERGY, amount, receiver.room.name);
            if (result === OK) {
                mem.funnelCooldown[receiver.room.name] = Game.time;
                global.log(`[funnel] ${donor.room.name} → ${receiver.room.name} 漏斗补给 ${amount} 能量（等级 ${donor.level} → ${receiver.level}）`);
            } else {
                global.log(`[funnel] ${donor.room.name} → ${receiver.room.name} 发送失败: ${result}`);
            }
        }
    },
};
