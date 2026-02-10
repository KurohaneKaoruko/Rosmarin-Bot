/**
 * Creep 缓存目标接口
 * @description 定义 creep 缓存中存储的目标信息的类型结构
 */

/**
 * TakeTarget 类型定义
 * @description 用于表示 creep 获取资源的目标
 */
type TakeTarget = {
    id: Id<Structure | Resource | Ruin>;
    type: 'dropped' | 'structure' | 'ruin';
};

/**
 * Creep 缓存目标
 * @description 存储 creep 在任务执行过程中缓存的各种目标信息
 */
interface CreepCacheTarget {
    /**
     * 来源结构 ID
     * @description creep 正在从中获取资源的结构 ID
     */
    sourceId?: Id<Structure>;

    /**
     * 来源类型
     * @description 资源来源的具体类型
     */
    sourceKind?: 'dropped' | 'tombstone' | 'ruin' | 'container' | 'link' | 'storage' | 'terminal';

    /**
     * 目标结构 ID
     * @description creep 正在操作或移动到的目标结构 ID
     */
    targetId?: Id<Structure>;

    /**
     * 资源类型
     * @description 正在处理的资源类型常量
     */
    resourceType?: ResourceConstant;

    /**
     * 建造的 Rampart ID
     * @description 当优先建造 rampart 时，存储 rampart 的 ID
     */
    buildRampartId?: Id<StructureRampart>;

    /**
     * 是否建造 rampart
     * @description 标记是否在建造 rampart
     */
    buildRampart?: boolean;

    /**
     * 位置信息索引
     * @description 用于记录目标在某个列表中的位置索引
     */
    posInfo?: number;

    /**
     * 任务数据
     * @description 当前执行的建造或维修任务数据
     */
    task?: BuildTask | RepairTask;

    /**
     * 任务 ID
     * @description 任务的唯一标识符
     */
    taskid?: string;

    /**
     * 任务类型
     * @description 任务的具体类型分类
     */
    tasktype?: 'build' | 'repair';

    /**
     * 墙体维修任务
     * @description 专门针对墙体的维修任务数据
     */
    wallTask?: RepairTask;

    /**
     * 目标血量
     * @description 记录目标的当前血量或目标血量
     */
    targetHits?: number;

    /**
     * 获取目标
     * @description 用于存储能量获取的目标信息
     */
    takeTarget?: TakeTarget;
}

export { CreepCacheTarget, TakeTarget };
