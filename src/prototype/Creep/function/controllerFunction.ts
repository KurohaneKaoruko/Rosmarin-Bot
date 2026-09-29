import { BASE_CONFIG } from '@/constant/config';
import { getRoomData } from '@/shared/memory';

// 控制器工作位周边允许站人的结构。
// 这些结构不会阻断 upgrader/worker 的“前压换位”。
const CONTROLLER_LANE_PASSABLE_STRUCTURES = new Set<StructureConstant>([
    STRUCTURE_ROAD,
    STRUCTURE_CONTAINER,
    STRUCTURE_RAMPART,
    STRUCTURE_LINK,
]);

// 允许参与控制器工位“让前排”判断的角色。
// 这里仅纳入会长期围绕 controller 工作的 creep。
const CONTROLLER_FRONT_FOLLOWER_ROLES = new Set(['upgrader', 'worker', 'aid-upgrade']);

type ControllerEnergyKind = 'link' | 'container' | 'terminal' | 'storage';

/**
 * 控制器缓冲能源候选项。
 * 这里只关心“来源类型”和“当前能量”，真正的对象引用在下方扩展类型里追加。
 */
type ControllerEnergyCandidate = {
    kind: ControllerEnergyKind;
    energy: number;
};

type ControllerEnergyTarget = ControllerEnergyCandidate & {
    target: StructureLink | StructureContainer | StructureTerminal | StructureStorage;
};

// 控制器取能优先级：
// 1. link: 最贴近 upgrader 工作流，吞吐高且不干扰主仓
// 2. container: 常规控制器缓冲
// 3. terminal/storage: 仅作兜底来源
const CONTROLLER_ENERGY_PRIORITY: ControllerEnergyKind[] = ['link', 'container', 'terminal', 'storage'];

/**
 * 解析房间应该使用的签名文本。
 * - 有自定义签名时，仅在当前文本不同的情况下返回新文本
 * - 无自定义签名时：未签名或签名不属于自己时返回默认签名
 * - 返回 undefined 表示本 tick 不需要签名
 */
export const resolveRoomSignText = (
    customSign: string | undefined,
    sign: { text?: string; username?: string } | null | undefined,
    defaultSign: string,
    myUsername?: string
) => {
    if (customSign) {
        return sign?.text === customSign ? undefined : customSign;
    }

    if (!defaultSign) return undefined;
    if (!sign) return defaultSign;
    if (!myUsername) return undefined;
    if (!sign.username) return undefined;
    if (sign.username !== myUsername) return defaultSign;
    return undefined;
};

/**
 * 判断在房间未设置自定义签名时，是否需要补默认签名。
 *
 * @remarks
 * 仅依据“签名归属”判断，不比较文本：
 * - 无签名：需要补默认签名；
 * - 非自己签名：需要补默认签名；
 * - 自己签名：不处理（即使文本与默认签名不同也不覆盖）。
 */
const shouldApplyDefaultSignByOwnership = (
    sign: { username?: string } | null | undefined,
    myUsername: string
) => {
    if (!sign) return true;
    return sign.username !== myUsername;
};

/**
 * 从多个控制器周边能源来源中挑选一个最合适的候选。
 * 该函数只负责“静态排序”，不做寻路和 withdraw 执行。
 */
export const pickControllerEnergyCandidate = (
    candidates: ControllerEnergyCandidate[],
    minEnergy: number = 1
) => {
    return candidates
        .filter((candidate) => candidate.energy >= minEnergy)
        .sort((a, b) => CONTROLLER_ENERGY_PRIORITY.indexOf(a.kind) - CONTROLLER_ENERGY_PRIORITY.indexOf(b.kind))[0] || null;
};

/**
 * 判断某个位置是否会阻断控制器工位。
 * 用于“前排 creep 主动往前挪一步，让后排 creep 更靠近锚点”。
 */
const isControllerLaneBlocked = (pos: RoomPosition) => {
    const structures = pos.lookFor(LOOK_STRUCTURES);
    if (structures.some((s) => !CONTROLLER_LANE_PASSABLE_STRUCTURES.has(s.structureType))) return true;

    const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    if (sites.some((s) => !CONTROLLER_LANE_PASSABLE_STRUCTURES.has(s.structureType))) return true;

    return false;
};

/**
 * 控制器取能的统一移动封装。
 * 抽出来是为了让 link/container/storage 的取能逻辑走同一套视觉与寻路参数。
 */
const moveToEnergyTarget = (creep: Creep, target: RoomObject) => {
    creep.moveTo(target, {
        visualizePathStyle: { stroke: '#ffaa00' },
        range: 1,
        maxRooms: 1,
    });
};

/**
 * 尝试把当前 creep 往 controller 更优的工位前压一格。
 * 使用场景：
 * - 当前 creep 已经在 controller 3 格内
 * - 身后有同类工作 creep，需要向前收缩队形
 * 这样可以减少 upgrader/worker 在 controller 周边互卡的问题。
 */
const tryAdvanceControllerFront = (creep: Creep, controller: StructureController, anchorPos: RoomPosition) => {
    if (!creep.pos.inRangeTo(controller, 3) || creep.fatigue > 0) return false;

    const currentAnchorRange = creep.pos.getRangeTo(anchorPos);
    const currentControllerRange = creep.pos.getRangeTo(controller);
    const hasFollower = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
        filter: (other) =>
            other.id !== creep.id &&
            CONTROLLER_FRONT_FOLLOWER_ROLES.has(other.memory.role || '') &&
            other.pos.getRangeTo(anchorPos) > currentAnchorRange
    }).length > 0;
    if (!hasFollower) return false;

    const terrain = creep.room.getTerrain();
    let bestPos: RoomPosition | null = null;
    let bestAnchorRange = currentAnchorRange;
    let bestControllerRange = currentControllerRange;

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const x = creep.pos.x + dx;
            const y = creep.pos.y + dy;
            if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

            const pos = new RoomPosition(x, y, creep.room.name);
            if (!pos.inRangeTo(controller, 3)) continue;
            if (isControllerLaneBlocked(pos)) continue;
            if (pos.lookFor(LOOK_CREEPS).some((other) => other.id !== creep.id)) continue;
            if (pos.lookFor(LOOK_POWER_CREEPS).length > 0) continue;

            const anchorRange = pos.getRangeTo(anchorPos);
            const controllerRange = pos.getRangeTo(controller);
            const better =
                anchorRange < bestAnchorRange ||
                (anchorRange === bestAnchorRange && controllerRange < bestControllerRange);
            if (!better) continue;

            bestPos = pos;
            bestAnchorRange = anchorRange;
            bestControllerRange = controllerRange;
        }
    }

    if (!bestPos) return false;
    creep.moveTo(bestPos, {
        visualizePathStyle: { stroke: '#ffffff' },
        range: 0,
        maxRooms: 1,
        ignoreCreeps: false,
    });
    return true;
};

export default class ControllerFunction extends Creep {
    /**
     * 获取 controller 周边 link。
     * 默认按 2 格寻找，兼容主房升级位常见布局。
     */
    getControllerLink(range: number = 2): StructureLink | null {
        const controller = this.room.controller;
        if (!controller) return null;
        return (this.room.link || []).find((link) => link.pos.inRangeTo(controller, range)) || null;
    }

    /**
     * 获取 controller 周边 container。
     * 默认按 3 格寻找，兼容常见 controller container 布局。
     */
    getControllerContainer(range: number = 3): StructureContainer | null {
        const controller = this.room.controller;
        if (!controller) return null;
        return (this.room.container || []).find((container) => container.pos.inRangeTo(controller, range)) || null;
    }

    /**
     * 按需签署 controller。
     * - overwrite=true: 只要文本不同就覆盖
     * - overwrite=false: 仅在没有签名时签署
     */
    signControllerIfNeeded(
        text?: string,
        options?: { overwrite?: boolean; moveOptions?: MoveToOpts }
    ): boolean {
        const controller = this.room.controller;
        if (!controller || !text) return false;

        const shouldSign = options?.overwrite ? controller.sign?.text !== text : !controller.sign;
        if (!shouldSign) return false;

        if (this.pos.inRangeTo(controller, 1)) {
            this.signController(controller, text);
        } else {
            this.moveTo(controller, options?.moveOptions || {
                visualizePathStyle: { stroke: '#ffffff' },
                range: 1,
                maxRooms: 1,
            });
        }
        return true;
    }

    /**
     * 维护本房默认签名。
     *
     * @remarks
     * 规则：
     * - 配置了自定义签名：只比较文本是否一致，不比较归属；
     * - 未配置自定义签名：只比较归属是否为自己，不比较文本。
     */
    maintainRoomSign(): boolean {
        const controller = this.room.controller;
        if (!controller || !controller.my) return false;

        const customSign = getRoomData(this.room.name)?.sign;
        const myUsername = this.owner.username;

        let desired: string | undefined;
        let shouldSign = false;

        if (customSign) {
            desired = customSign;
            // 已设置房间签名时，仅比较文本，不关心当前签名归属。
            shouldSign = controller.sign?.text !== customSign;
        } else {
            desired = BASE_CONFIG.DEFAULT_SIGN;
            if (!desired) return false;
            // 未设置房间签名时，仅比较归属，不比较文本。
            shouldSign = shouldApplyDefaultSignByOwnership(controller.sign, myUsername);
        }

        if (!shouldSign) return false;

        // 这里不复用 signControllerIfNeeded：
        // 未配置自定义签名时我们按“归属”判定签名，而 signControllerIfNeeded 的 overwrite 分支只比较文本。
        if (this.pos.inRangeTo(controller, 1)) {
            this.signController(controller, desired);
        } else {
            this.moveTo(controller, {
                visualizePathStyle: { stroke: '#ffffff' },
                range: 1,
                maxRooms: 1,
            });
        }
        return true;
    }

    /**
     * 从 controller 周边缓冲结构取能。
     * 核心目标：
     * - 先吃 link/container，尽量不直接碰主仓
     * - 如果主目标能量不足以装满，则提前朝下一个候选靠拢
     * - 没有候选时可选回退到通用 TakeEnergy
     */
    withdrawControllerEnergy(options?: {
        linkRange?: number;
        containerRange?: number;
        storageRange?: number;
        terminalRange?: number;
        minEnergy?: number;
        fallbackToTakeEnergy?: boolean;
    }): boolean {
        const controller = this.room.controller;
        if (!controller) return options?.fallbackToTakeEnergy ? this.TakeEnergy() : false;

        const linkRange = options?.linkRange ?? 2;
        const containerRange = options?.containerRange ?? 3;
        const terminalRange = options?.terminalRange ?? 0;
        const storageRange = options?.storageRange ?? 0;
        const minEnergy = options?.minEnergy ?? 1;

        const candidates: ControllerEnergyTarget[] = [];

        // 先收集所有合法来源，再统一按优先级排序。
        // 这样 role 侧只需要关心“取控制器缓冲能量”，不用重复实现来源决策。
        const link = this.getControllerLink(linkRange);
        if (link) candidates.push({ kind: 'link', target: link, energy: link.store[RESOURCE_ENERGY] || 0 });

        const container = this.getControllerContainer(containerRange);
        if (container) candidates.push({ kind: 'container', target: container, energy: container.store[RESOURCE_ENERGY] || 0 });

        const terminal = terminalRange > 0 && this.room.terminal?.pos.inRangeTo(controller, terminalRange)
            ? this.room.terminal
            : null;
        if (terminal) candidates.push({ kind: 'terminal', target: terminal, energy: terminal.store[RESOURCE_ENERGY] || 0 });

        const storage = storageRange > 0 && this.room.storage?.pos.inRangeTo(controller, storageRange)
            ? this.room.storage
            : null;
        if (storage) candidates.push({ kind: 'storage', target: storage, energy: storage.store[RESOURCE_ENERGY] || 0 });

        const ordered = [...candidates].sort(
            (a, b) => CONTROLLER_ENERGY_PRIORITY.indexOf(a.kind) - CONTROLLER_ENERGY_PRIORITY.indexOf(b.kind)
        );
        const primary = pickControllerEnergyCandidate(ordered, minEnergy) as ControllerEnergyTarget | null;

        // 没有任何足够能量的控制器缓冲来源时，按配置决定是否回退到通用取能逻辑。
        if (!primary) return options?.fallbackToTakeEnergy ? this.TakeEnergy() : false;
        if (!this.pos.isNearTo(primary.target)) {
            moveToEnergyTarget(this, primary.target);
            return false;
        }

        const freeCapacity = this.store.getFreeCapacity(RESOURCE_ENERGY);
        const availableEnergy = primary.energy;
        const result = this.withdraw(primary.target, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
            moveToEnergyTarget(this, primary.target);
            return false;
        }
        if (result !== OK) return result === ERR_FULL;

        // 主目标足以装满时，本 tick 就可以视为 source 阶段完成。
        if (availableEnergy >= freeCapacity) return true;

        // 主目标不够装满时，提前朝次优目标靠拢，减少下一 tick 的空转。
        const next = ordered.find((candidate) =>
            candidate.target.id !== primary.target.id && candidate.energy >= minEnergy
        );
        if (next) moveToEnergyTarget(this, next.target);
        else if (options?.fallbackToTakeEnergy) this.TakeEnergy();
        return false;
    }

    /**
     * 执行控制器升级主流程。
     * 统一处理：
     * - 向 controller / link 工作位移动
     * - controller 周边前压换位
     * - 脚下捡能量
     * - 升级 controller
     * - 维护签名
     */
    runControllerUpgrade(options?: {
        linkRange?: number;
        sign?: boolean;
        pickupDropped?: boolean;
        advanceFront?: boolean;
    }): boolean {
        const controller = this.room.controller;
        if (!controller) return false;

        const link = this.getControllerLink(options?.linkRange ?? 2);
        const anchorPos = link?.pos || controller.pos;

        if (this.pos.inRangeTo(controller, 3)) {
            // 若房间存在 controller link，则优先围绕 link 形成稳定工位。
            if (link && !this.pos.inRangeTo(link, 1) && !(options?.advanceFront === false)) {
                if (!tryAdvanceControllerFront(this, controller, anchorPos)) {
                    this.moveTo(link, {
                        visualizePathStyle: { stroke: '#ffffff' },
                        range: 1,
                        maxRooms: 1,
                        ignoreCreeps: false,
                    });
                }
            } else if (options?.advanceFront !== false) {
                tryAdvanceControllerFront(this, controller, anchorPos);
            }

            // 贴 controller 工作时顺手捡脚下能量，减少小额掉能浪费。
            if (options?.pickupDropped !== false) {
                const dropped = this.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
                    filter: (resource) => resource.resourceType === RESOURCE_ENERGY && resource.amount > 0
                })[0];
                if (dropped) this.pickup(dropped);

                // 顺手抽相邻墓碑能量（自爆拉能快递的交付落点就在升级圈里）
                const tombstone = this.pos.findInRange(FIND_TOMBSTONES, 1, {
                    filter: (tomb) => (tomb.store[RESOURCE_ENERGY] || 0) > 0
                })[0];
                if (tombstone && this.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                    this.withdraw(tombstone, RESOURCE_ENERGY);
                }
            }

            this.upgradeController(controller);
            if (options?.sign !== false) this.maintainRoomSign();
            return true;
        }

        // 不在 controller 3 格内时，优先向 controller link 靠近。
        if (link) {
            this.moveTo(link, {
                visualizePathStyle: { stroke: '#ffffff' },
                range: 1,
                maxRooms: 1,
                ignoreCreeps: false,
            });
            return false;
        }

        // 没有 controller link 的布局，直接进入 controller 3 格工作圈。
        this.moveTo(controller, {
            visualizePathStyle: { stroke: '#ffffff' },
            range: 3,
            maxRooms: 1,
            ignoreCreeps: false,
        });
        return false;
    }
}
