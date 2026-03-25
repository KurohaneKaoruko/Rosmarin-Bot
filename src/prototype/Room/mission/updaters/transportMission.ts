import { compress } from '@/shared/compress';
import { getLabAB } from '@/shared/labReservations';
import { getRoomData, getStructData } from '@/shared/memory';
import { THRESHOLDS } from '@/constant/Thresholds';



type PosLike = RoomPosition | { pos: RoomPosition } | number;
type TransportLevelKey = 'boost' | 'ext' | 'tower' | 'controllerBuffer' | 'labEnergy' | 'lab' | 'powerSpawn' | 'nuker';
type PrimaryStoreStructure = StructureStorage | StructureTerminal;
type StoreTarget = {
    id: Id<any>;
    pos: RoomPosition;
    store: {
        getFreeCapacity(resource?: ResourceConstant): number | null;
        [key: string]: any;
    };
};

const TransportLevelMap: Record<TransportLevelKey, number> = {
    boost: 0,
    ext: 1,
    tower: 1,
    controllerBuffer: 2,
    labEnergy: 1,
    lab: 2,
    powerSpawn: 2,
    nuker: 3,
};

const isLowEnergyState = (state?: string) => state === 'LOW' || state === 'CRITICAL';
const isHighLikeMode = (mode: string) => mode === 'high' || mode === 'rush';

/**
 * 房间搬运任务模块（transport）
 * @description
 * - 生成 transport 任务：能量填充、lab 搬运/boost、powerSpawn、nuker 等
 * - 提供统一的任务写入与去重逻辑（TransportMissionAdd / addTransportMission）
 * - 提供任务池校验清理（TransportMissionCheck）
 */
export default class TransportMission extends Room {
    private static LAB_FILL_AMOUNT = THRESHOLDS.ENERGY.LAB_FILL;
    private static LAB_TRIGGER_AMOUNT = THRESHOLDS.ENERGY.LAB_TRIGGER;
    private static LAB_MIN_CAPACITY = THRESHOLDS.ENERGY.LAB_MIN_CAPACITY;

    private static getNukeDemandCache() {
        const g = global as any;
        const cached = g._nukeDemandCache;
        if (cached && cached.tick === Game.time) return cached as { tick: number; all: boolean; rooms: Set<string> };

        const rooms = new Set<string>();
        let all = false;
        for (const name in Game.flags) {
            if (!(name.startsWith('nuke-') || name.startsWith('nuke_'))) continue;
            const flag = Game.flags[name];
            const list = flag?.memory?.['rooms'];
            if (!Array.isArray(list) || list.length === 0) {
                all = true;
                break;
            }
            for (const r of list) rooms.add(r);
        }

        const next = { tick: Game.time, all, rooms };
        g._nukeDemandCache = next;
        return next;
    }

    private static hasNukeDemandForRoom(roomName: string) {
        const cache = TransportMission.getNukeDemandCache();
        return cache.all || cache.rooms.has(roomName);
    }

    /**
     * 在 storage / terminal 之间选择该资源储量更多的来源。
     * transport 的多个分支都会做这个判断，统一后主流程更短。
     */
    private pickStoreWithMostResource(
        resourceType: ResourceConstant,
        candidates: Array<PrimaryStoreStructure | null | undefined>,
    ) {
        return candidates.reduce<PrimaryStoreStructure | null>((best, candidate) => {
            if (!candidate) return best;
            if (!best) return candidate;
            return (candidate.store[resourceType] || 0) > (best.store[resourceType] || 0)
                ? candidate
                : best;
        }, null);
    }

    private getPreferredEnergySource() {
        return this.pickStoreWithMostResource(RESOURCE_ENERGY, [this.terminal, this.storage]);
    }

    /**
     * 统一封装 transport 入队，避免各分支重复拼装 source/target/pos。
     */
    private queueTransportTransfer(
        level: number,
        source: { id: Id<any> },
        target: { id: Id<any>; pos: RoomPosition },
        resourceType: ResourceConstant,
        amount: number,
    ) {
        if (amount <= 0) return;
        this.addTransportMission(level, {
            pos: target,
            source: source.id as Id<Structure>,
            target: target.id as Id<Structure>,
            resourceType,
            amount,
        });
    }

    private queueEnergyTransfer(
        level: number,
        source: PrimaryStoreStructure,
        target: StoreTarget,
        amount: number,
    ) {
        this.queueTransportTransfer(level, source, target, RESOURCE_ENERGY, amount);
    }

    /**
     * 为一批建筑补能；只有在当前可调度能量足够时才会创建任务，
     * 这样不会把后续分支的预算提前透支。
     */
    private fillEnergyTargets<T extends StoreTarget>(
        source: PrimaryStoreStructure,
        targets: T[],
        level: number,
        availableEnergy: number,
        getAmount: (target: T) => number,
    ) {
        let remainingEnergy = availableEnergy;
        for (const target of targets) {
            const amount = getAmount(target);
            if (amount <= 0 || remainingEnergy < amount) continue;
            remainingEnergy -= amount;
            this.queueEnergyTransfer(level, source, target, amount);
        }
        return remainingEnergy;
    }

    private fillSpawnAndExtensionEnergy(source: PrimaryStoreStructure, availableEnergy: number) {
        if (!this.spawn || this.spawn.length === 0) return availableEnergy;
        if (this.energyAvailable >= this.energyCapacityAvailable) return availableEnergy;

        let remainingEnergy = this.fillEnergyTargets(
            source,
            this.spawn as unknown as StoreTarget[],
            this.TransportLevel('ext'),
            availableEnergy,
            (spawn) => spawn.store.getFreeCapacity(RESOURCE_ENERGY) || 0,
        );

        remainingEnergy = this.fillEnergyTargets(
            source,
            (this.extension || []) as unknown as StoreTarget[],
            this.TransportLevel('ext'),
            remainingEnergy,
            (extension) => extension.store.getFreeCapacity(RESOURCE_ENERGY) || 0,
        );

        return remainingEnergy;
    }

    private fillTowerEnergy(source: PrimaryStoreStructure, availableEnergy: number) {
        if (this.level < 3 || !this.tower || this.tower.length === 0) return availableEnergy;
        const towers = this.tower.filter(
            tower => tower && tower.store.getFreeCapacity(RESOURCE_ENERGY) > THRESHOLDS.ENERGY.TOWER_REPAIR_THRESHOLD,
        );
        return this.fillEnergyTargets(
            source,
            towers as unknown as StoreTarget[],
            this.TransportLevel('tower'),
            availableEnergy,
            (tower) => tower.store.getFreeCapacity(RESOURCE_ENERGY) || 0,
        );
    }

    /**
     * 高速升级模式下，需要让 controller 周围的 link / container 始终有缓冲能量。
     */
    private fillControllerBufferEnergy(
        source: PrimaryStoreStructure,
        availableEnergy: number,
        energyState: string,
        roomMode: string,
    ) {
        const controller = this.controller;
        if (!controller || isLowEnergyState(energyState)) return availableEnergy;

        const creepNum = this.getCreepNum() || {};
        const highMode = isHighLikeMode(roomMode);
        const hasUpgradeConsumer =
            (creepNum['upgrader'] || 0) +
            (creepNum['aid-upgrade'] || 0) +
            (creepNum['universal'] || 0) > 0;
        if (!highMode && !hasUpgradeConsumer) return availableEnergy;

        const ticksToDowngrade = controller.ticksToDowngrade || 0;
        const upgradeFocus = highMode || ticksToDowngrade < (this.level >= 6 ? 12000 : 7000);
        const level = upgradeFocus
            ? this.TransportLevel('ext')
            : this.TransportLevel('controllerBuffer');
        let remainingEnergy = availableEnergy;

        for (const link of this.link || []) {
            if (!link.pos.inRangeTo(controller, 2)) continue;
            const free = link.store.getFreeCapacity(RESOURCE_ENERGY) || 0;
            if (free <= 0) continue;

            const targetAmount = THRESHOLDS.UNIVERSAL.CONTROLLER_LINK_BUFFER_TARGET;
            const lack = Math.min(free, Math.max(0, targetAmount - link.store[RESOURCE_ENERGY]));
            if (lack <= 0 || remainingEnergy <= 0) continue;

            const amount = Math.min(lack, remainingEnergy);
            remainingEnergy -= amount;
            this.queueEnergyTransfer(level, source, link as unknown as StoreTarget, amount);
        }

        for (const container of this.container || []) {
            if (!container.pos.inRangeTo(controller, 3)) continue;
            const free = container.store.getFreeCapacity(RESOURCE_ENERGY) || 0;
            if (free <= 0) continue;

            const targetAmount = THRESHOLDS.UNIVERSAL.CONTROLLER_CONTAINER_BUFFER_TARGET;
            const lack = Math.min(free, Math.max(0, targetAmount - container.store[RESOURCE_ENERGY]));
            if (lack <= 0 || remainingEnergy <= 0) continue;

            const amount = Math.min(lack, remainingEnergy);
            remainingEnergy -= amount;
            this.queueEnergyTransfer(level, source, container as unknown as StoreTarget, amount);
        }

        return remainingEnergy;
    }

    private fillLabEnergy(availableEnergy: number, offset = 0) {
        if (this.level < 6 || !this.lab || this.lab.length === 0) return availableEnergy;
        const source = this.storage || this.terminal;
        if (!source) return availableEnergy;

        const checkAllLabs = global.qos.isTickAligned(THRESHOLDS.TICK.LAB_CHECK, offset);
        const labs = this.lab.filter((lab: StructureLab) => {
            if (!lab) return false;
            const freeCap = lab.store.getFreeCapacity(RESOURCE_ENERGY) || 0;
            if (freeCap <= 0) return false;
            return lab.store[RESOURCE_ENERGY] < THRESHOLDS.ENERGY.LAB_MIN_ENERGY || checkAllLabs;
        });

        let remainingEnergy = availableEnergy;
        for (const lab of labs) {
            const freeCap = lab.store.getFreeCapacity(RESOURCE_ENERGY) || 0;
            const amount = Math.min(freeCap, remainingEnergy);
            if (amount <= 0) continue;

            remainingEnergy -= amount;
            this.queueEnergyTransfer(
                this.TransportLevel('labEnergy'),
                source,
                lab as unknown as StoreTarget,
                amount,
            );
        }
        return remainingEnergy;
    }

    private fillPowerSpawnEnergy(availableEnergy: number, offset = 0) {
        if (this.level !== 8 || !this.powerSpawn || !this.storage) return availableEnergy;
        if (!global.qos.isTickAligned(THRESHOLDS.TICK.LAB_CHECK, offset)) return availableEnergy;
        if (this.powerSpawn.pos.inRangeTo(this.getCenter(), 1)) return availableEnergy;

        const amount = this.powerSpawn.store.getFreeCapacity(RESOURCE_ENERGY) || 0;
        if (amount <= THRESHOLDS.ENERGY.LINK_MIN || availableEnergy < amount) return availableEnergy;

        this.queueEnergyTransfer(
            this.TransportLevel('powerSpawn'),
            this.storage,
            this.powerSpawn as unknown as StoreTarget,
            amount,
        );
        return availableEnergy - amount;
    }

    private fillNukerEnergy(source: PrimaryStoreStructure, availableEnergy: number, offset = 0) {
        if (this.level !== 8 || !this.nuker) return availableEnergy;

        const urgent = TransportMission.hasNukeDemandForRoom(this.name);
        const requiredEnergy = urgent ? 300000 : 100000;
        if (this.getResAmount(RESOURCE_ENERGY) < requiredEnergy) return availableEnergy;

        const shouldFill = urgent
            ? global.qos.isTickAligned(10, offset)
            : global.qos.isTickAligned(20, offset);
        if (!shouldFill) return availableEnergy;

        const cap = this.nuker.store.getFreeCapacity(RESOURCE_ENERGY) || 0;
        const amount = urgent
            ? cap
            : Math.min(cap, THRESHOLDS.ENERGY.TRANSPORT_MIN);
        if (amount <= 0 || availableEnergy < amount) return availableEnergy;

        this.queueEnergyTransfer(
            this.TransportLevel('nuker'),
            source,
            this.nuker as unknown as StoreTarget,
            amount,
        );
        return availableEnergy - amount;
    }

    /**
     * 将业务 key 映射为 transport 任务优先级
     * @param key - 优先级类别
     * @returns 优先级（数值越小越高）
     */
    TransportLevel(key: TransportLevelKey) {
        return TransportLevelMap[key];
    }

    /**
     * 将位置转换为压缩坐标
     * @param pos - RoomPosition / {pos: RoomPosition} / 压缩坐标
     * @returns 压缩坐标 number
     */
    toPosNumber(pos: PosLike): number {
        if (typeof pos === 'number') return pos;
        const p = 'pos' in pos ? pos.pos : pos;
        return compress(p.x, p.y);
    }

    /**
     * 以便捷参数形式添加 transport 任务
     * @param level - 优先级（数值越小越高）
     * @param params - 任务参数
     */
    addTransportMission(
        level: number,
        params: {
            pos: PosLike;
            source: Id<Structure>;
            target: Id<Structure>;
            resourceType: ResourceConstant;
            amount: number;
        }
    ) {
        if (!params.amount || params.amount <= 0) return;
        this.TransportMissionAdd(level, {
            pos: this.toPosNumber(params.pos),
            source: params.source,
            target: params.target,
            resourceType: params.resourceType,
            amount: params.amount,
        } as any);
    }

    /**
     * 添加/更新 transport 任务（按 source/target/resourceType 去重）
     * @param level - 优先级（数值越小越高）
     * @param data - transport 任务数据
     * @returns OK/false 等任务池写入结果
     */
    TransportMissionAdd(level: number, data: TransportTask) {
        let existingTaskId = this.checkSameMissionInPool('transport', 'transport',
                    {source:data.source, target:data.target, resourceType:data.resourceType} as any);
        if (existingTaskId) {
            return this.updateMissionPool('transport', existingTaskId, {level, data});
        } else {
            return this.addMissionToPool('transport', 'transport', level, data);
        }
    }

    /**
     * transport 总更新入口
     * @description 依次更新能量、power、lab、boost、nuker 等子逻辑
     */
    UpdateTransportMission(offset = 0) {
        const storage = this.storage;
        const terminal = this.terminal;
        if(!storage && !terminal) return;

        this.UpdateEnergyMission(offset);
        this.UpdatePowerMission(offset);
        this.UpdateLabMission(offset);
        // Boost 逻辑已迁移至 UpdateBoostMission
        this.UpdateNukerMission(offset);
    }

    /**
     * 检查 transport 任务池有效性并清理无效任务
     * @description
     * - 释放丢失绑定 creep 的 lock
     * - source/target 不存在则删除
     * - target 无容量或 amount 无效则删除
     */
    TransportMissionCheck() {
        const checkFunc = (task: Task) => {
            if(task.lock) {
                const creep = Game.getObjectById(task.bindCreep) as Creep;
                const mission = creep?.memory?.mission;
                if(!creep || !mission || mission?.id !== task.id) {
                    task.lock = false;
                    task.bindCreep = null;
                }
            };
            const data = task.data as TransportTask
            const source = Game.getObjectById(data.source) as StructureContainer | StructureStorage;
            const target = Game.getObjectById(data.target) as StructureContainer | StructureStorage;
            if(!source || !target) return false;
            return target.store.getFreeCapacity(data.resourceType) > 0 && data.amount > 0;
        }

        this.checkMissionPool('transport', checkFunc);
    }

    /**
     * 能量类搬运任务生成
     * @description
     * - spawn/extension 填充
     * - tower 填充
     * - lab 能量填充
     * - powerSpawn/nuker 能量填充（视布局与能量阈值）
     */
    UpdateEnergyMission(offset = 0) {
        let energy = (this.storage?.store[RESOURCE_ENERGY] || 0) + (this.terminal?.store[RESOURCE_ENERGY] || 0);
        if (energy < THRESHOLDS.ENERGY.TRANSPORT_MIN) return;

        const energySource = this.getPreferredEnergySource();
        if (!energySource) return;

        energy = this.fillSpawnAndExtensionEnergy(energySource, energy);
        energy = this.fillTowerEnergy(energySource, energy);

        const state = this.memory.energyState || this.updateEnergyState?.(false);
        const roomMode = (getRoomData(this.name) as any)?.mode || (this.memory as any).mode || 'main';

        energy = this.fillControllerBufferEnergy(energySource, energy, state, roomMode);
        energy = this.fillLabEnergy(energy, offset);

        if (isLowEnergyState(state)) return;
        if (this.getResAmount(RESOURCE_ENERGY) < THRESHOLDS.ENERGY.SEND_REQUEST_MIN) return;

        energy = this.fillPowerSpawnEnergy(energy, offset);
        energy = this.fillNukerEnergy(energySource, energy, offset);

        return OK;
    }

    /**
     * PowerSpawn 资源搬运（POWER）
     * @description 当 powerSpawn 不在中心布局时，补充 power 到阈值
     */
    UpdatePowerMission(offset = 0) {
        void offset;
        if (this.level < 8 || !this.powerSpawn) return;
        if (this.powerSpawn.pos.inRangeTo(this.getCenter(), 1)) return;

        const powerSpawn = this.powerSpawn;
        let neededAmount = 100 - powerSpawn.store[RESOURCE_POWER];
        if (neededAmount < 50) return;

        const source = this.pickStoreWithMostResource(RESOURCE_POWER, [this.storage, this.terminal]);
        if (!source || source.store[RESOURCE_POWER] <= 0) return;

        this.queueTransportTransfer(
            this.TransportLevel('powerSpawn'),
            source,
            powerSpawn,
            RESOURCE_POWER,
            Math.min(neededAmount, source.store[RESOURCE_POWER]),
        );
    }

    /**
     * Nuker 资源搬运（GHODIUM）
     * @description 周期性检查 nuker 的 GHODIUM，不足则从 storage/terminal 补齐
     */
    UpdateNukerMission(offset = 0) {
        const room = this;
        if (!global.qos.isTickAligned(THRESHOLDS.TICK.NUKER_CHECK, offset)) return;
        if(room.level < 8) return;
        if(!room.nuker) return;
        const storage = room.storage;
        const terminal = room.terminal;
        if(!storage && !terminal) return;
        
        const nuker = room.nuker;
        if(!nuker) return;
        if(nuker.store[RESOURCE_GHODIUM] === 5000) return;
    
        let amount = 5000 - nuker.store[RESOURCE_GHODIUM];

        const source = this.pickStoreWithMostResource(RESOURCE_GHODIUM, [storage, terminal]);
        if (!source || source.store[RESOURCE_GHODIUM] <= 0) return;

        amount = Math.min(amount, source.store[RESOURCE_GHODIUM]);
        this.queueTransportTransfer(
            this.TransportLevel('nuker'),
            source,
            nuker,
            RESOURCE_GHODIUM,
            amount,
        );
    }

    /**
     * 判断 lab 是否为“特殊用途”
     * @description
     * - A/B 反应原料 lab
     * - boostLabs 指定的 boost lab
     */
    private isSpecialLab(labId: Id<StructureLab>, labAId: string | null, labBId: string | null, botmem: any): boolean {
        if (labAId && labId === labAId) return true;
        if (labBId && labId === labBId) return true;
        if (botmem?.boostLabs?.[labId]) return true;
        return false;
    }

    /**
     * Lab 合成相关搬运
     * @description
     * - 合成关闭时：将普通 lab 的矿物搬回 storage
     * - 合成开启时：保持 A/B 原料正确，普通 lab 只保留产物并在容量不足时搬出
     */
    UpdateLabMission(offset = 0) {
        const room = this;
        const storage = room.storage;
        const terminal = room.terminal;
        if (!storage) return;
        if (!room.lab || room.lab.length === 0) return;

        const BotMemStructures = getStructData(room.name);

        const { labA, labB, labAId, labBId } = getLabAB(room.name, room);
        const labAtype = BotMemStructures.labAtype;
        const labBtype = BotMemStructures.labBtype;

        const isShutDown = !BotMemStructures.lab || !labA || !labB || !labAtype || !labBtype;
        const hasBoostTasks = (this.getAllMissionFromPool('boost') as any[])?.length > 0;

        room.lab.forEach(lab => {
            if (isShutDown) {
                //合成结束后需要回收 A/B 底物；且房间无 boost 任务时，所有 lab 都应搬空避免残留底物。
                if (hasBoostTasks && this.isSpecialLab(lab.id, labAId, labBId, BotMemStructures)) return;
                if (!lab.store[lab.mineralType] || lab.store[lab.mineralType] === 0) return;
                
                this.addTransportMission(this.TransportLevel('lab'), {
                    pos: lab,
                    source: lab.id,
                    target: storage.id,
                    resourceType: lab.mineralType,
                    amount: lab.store[lab.mineralType],
                });
                return;
            }

            if ((labAId && lab.id === labAId) || (labBId && lab.id === labBId)) {
                const type = (labAId && lab.id === labAId) ? labAtype : labBtype;
                
                if (lab.mineralType && lab.mineralType !== type && lab.store[lab.mineralType] > 0) {
                    this.addTransportMission(this.TransportLevel('lab'), {
                        pos: lab,
                        source: lab.id,
                        target: storage.id,
                        resourceType: lab.mineralType,
                        amount: lab.store[lab.mineralType],
                    });
                    return;
                }

                if (lab.store.getFreeCapacity(type) >= TransportMission.LAB_TRIGGER_AMOUNT && room.getResAmount(type) >= TransportMission.LAB_TRIGGER_AMOUNT) {
                    const target = [storage, terminal].find(t => t && t.store[type] > 0);
                    if (target) {
                        this.addTransportMission(this.TransportLevel('lab'), {
                            pos: lab,
                            source: target.id,
                            target: lab.id,
                            resourceType: type,
                            amount: Math.min(lab.store.getFreeCapacity(type), target.store[type]),
                        } as any);
                    }
                }
                return;
            }

            if (this.isSpecialLab(lab.id, labAId, labBId, BotMemStructures)) return;

            const reactionProduct = REACTIONS[labAtype][labBtype];
            
            if (lab.mineralType && lab.mineralType !== reactionProduct && lab.store[lab.mineralType] > 0) {
                this.addTransportMission(this.TransportLevel('lab'), {
                    pos: lab,
                    source: lab.id,
                    target: storage.id,
                    resourceType: lab.mineralType,
                    amount: lab.store[lab.mineralType],
                });
                return;
            }

            if (lab.mineralType === reactionProduct && lab.store.getFreeCapacity(reactionProduct) < TransportMission.LAB_MIN_CAPACITY) {
                this.addTransportMission(this.TransportLevel('lab'), {
                    pos: lab,
                    source: lab.id,
                    target: storage.id,
                    resourceType: reactionProduct,
                    amount: lab.store[reactionProduct],
                });
            }
        });
    }
}
