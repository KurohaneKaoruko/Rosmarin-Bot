/**
 * 远程战斗的通用决策核。
 *
 * @remarks
 * 「自愈 → 选敌对目标拉扯 → 依敌人数决定 rangedMassAttack 还是 rangedAttack → 顺手治疗友军」
 * 这一段在多个远程战斗角色里是同一套逻辑，原本有两份逐字复制（power-ranged 与 deposit-ranged）。
 * 各族的差异只有三处：**打谁**（敌对筛选）、**救谁**（友军筛选）、**打完干什么**（收尾）。
 * 所以这里把中段收敛成一处，族文件只提供这两张筛选表 + 自己的收尾。
 *
 * 判定顺序与原实现一致，不做「优化」：先自愈，再处理敌对，最后治疗友军；
 * 三个动作各自有 `OK` 标记，任一没做成都会落进治疗分支（这是原实现的取向——
 * 站着不动时优先补一口血，而不是空耗）。
 */

export type RangedCombatConfig = {
    /**
     * 本 tick 要打的敌对 creep，**已按距离筛过**。
     *
     * @remarks 由族文件自己实现，因为它同时决定缓存键与「多远算威胁」。
     */
    hostilesInRange: (creep: Creep) => Creep[];

    /**
     * 本 tick 要治疗的友军，**已按距离/角色筛过**。
     *
     * @remarks 同样由族文件实现；留空表示该族不做友军治疗。
     */
    injuredAllies?: (creep: Creep) => Creep[];

    /**
     * 选「集火目标」时算作攻击手的身位类型，默认只看 `ATTACK`。
     *
     * @remarks 有的族把远程也算攻击手（deposit 族把 `RANGED_ATTACK` 一并纳入），
     * 这会影响集火偏好，所以做成参数而不是写死。
     */
    attackerParts?: string[];
};

/** 集体攻击阈值：3 格内这么多敌人时改用范围攻击。 */
const MASS_ATTACK_RANGE3_THRESHOLD = 10;
const MASS_ATTACK_RANGE2_THRESHOLD = 3;

const hasPart = (creep: Creep, parts: string[]): boolean =>
    creep.body.some((part) => parts.includes(part.type));

/**
 * 执行一次远程战斗决策。
 *
 * @returns 本 tick 是否采取了行动（自愈 / 攻击 / 移动 / 治疗友军任一）。
 *          收尾逻辑（打 powerBank、撤回集结点、自杀计时）由调用方在返回 `false` 后处理。
 */
export const runRangedCombat = (creep: Creep, config: RangedCombatConfig): boolean => {
    let healOK = false;
    let rangedOK = false;
    let moveOK = false;

    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
        healOK = true;
    }

    const hostileCreeps = config.hostilesInRange(creep);
    if (hostileCreeps.length > 0) {
        const attackerParts = config.attackerParts ?? [ATTACK];
        // 集火偏好：先打会回血的治疗手，再打输出手
        const healer = hostileCreeps.find((hostile) => hasPart(hostile, [HEAL]));
        const attacker = hostileCreeps.find((hostile) => hasPart(hostile, attackerParts));
        const focus = healer || attacker;
        if (focus && !creep.pos.inRangeTo(focus, 1)) {
            creep.moveTo(focus, { ignoreCreeps: false, range: 1 });
            moveOK = true;
        }

        const range3Hostiles = hostileCreeps.filter((hostile) => creep.pos.inRangeTo(hostile, 3));
        if (range3Hostiles.length >= MASS_ATTACK_RANGE3_THRESHOLD) {
            creep.rangedMassAttack();
            rangedOK = true;
        } else if (range3Hostiles.filter((hostile) => creep.pos.inRangeTo(hostile, 2)).length >= MASS_ATTACK_RANGE2_THRESHOLD) {
            creep.rangedMassAttack();
            rangedOK = true;
        } else if (range3Hostiles.filter((hostile) => creep.pos.inRangeTo(hostile, 1)).length >= 1) {
            creep.rangedMassAttack();
            rangedOK = true;
        } else {
            const range3Healer = range3Hostiles.find((hostile) => hasPart(hostile, [HEAL]));
            const range3Attacker = range3Hostiles.find((hostile) => hasPart(hostile, [ATTACK]));
            const range3Target = range3Healer || range3Attacker || range3Hostiles[0];
            if (range3Target) {
                creep.rangedAttack(range3Target);
                rangedOK = true;
            }
        }
    }

    if (!healOK || !rangedOK || !moveOK) {
        const allies = config.injuredAllies?.(creep) ?? [];
        let healTarget = allies.find((ally) => creep.pos.inRangeTo(ally, 1));
        if (healTarget) {
            if (!healOK) creep.heal(healTarget);
        } else if (allies.length > 0) {
            healTarget = creep.pos.findClosestByRange(allies);
            if (!healTarget) return true;
            if (!moveOK) creep.moveTo(healTarget, { ignoreCreeps: false });
            if (!rangedOK && creep.pos.isNearTo(healTarget)) creep.rangedHeal(healTarget);
        }
    }

    return rangedOK || moveOK || healOK;
};

/**
 * 交战站位：贴脸出手 → 3 格内远程打并继续前压 → 再远就单纯靠近。
 *
 * @remarks
 * 「贴脸用不用近战」是这一族唯一的差别：带 ATTACK 身位的（如 out-defend 的高阶体）
 * 贴脸时先 `attack` 再 `rangedMassAttack`；只有 RANGED_ATTACK 的贴脸时只放范围攻击。
 * 其余分支完全相同，原本在 out-defend 里被写了两遍（按身位二选一）、
 * out-ranged 里又写了一遍。
 */
export const engageTarget = (creep: Creep, target: any, options: { melee?: boolean } = {}): void => {
    if (creep.pos.inRangeTo(target, 1)) {
        if (options.melee) creep.attack(target);
        creep.rangedMassAttack();
        return;
    }
    if (creep.pos.inRangeTo(target, 3)) {
        creep.rangedAttack(target);
        creep.moveTo(target);
        return;
    }
    creep.moveTo(target);
};

/**
 * 远程战斗的「到岗」前置：不在目标房（或贴在房间边缘）就往里走，并顺手自愈。
 *
 * @remarks
 * 自愈是刻意加在这里的：这族角色（power / deposit 的远程手）在赶路时没有别的动作，
 * 顺手补血不占动作额度。**不带自愈的版本**（外矿战斗族，自愈时机是站定之后）
 * 请见 `out-combat` 里的同名局部函数——两者语义不同，没有合并。
 *
 * @param resetDontPullMe 赶路期间是否解除站位锁（有的角色在房里会锁住自己不被拉扯，
 *                        赶路途中必须先解锁，否则会被自己上一 tick 的锁卡住）。
 * @returns `true` 表示已经在目标房内、可以继续战斗决策。
 */
export const ensureInTargetRoomForCombat = (creep: Creep, resetDontPullMe = false): boolean => {
    if (creep.room.name !== creep.memory.targetRoom || creep.pos.isRoomEdge()) {
        if (resetDontPullMe) creep.memory.dontPullMe = false;
        creep.moveToRoom(creep.memory.targetRoom);
        if (creep.hits < creep.hitsMax) creep.heal(creep);
        return false;
    }
    return true;
};
