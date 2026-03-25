type CreepCacheRoot = NonNullable<CreepMemory['cache']>;
type CacheSectionKey = 'source' | 'target';
type LegacyCacheField = 'cacheSource' | 'cacheTarget';

const TARGET_CACHE_FIELDS = ['targetId', 'targetType', 'resourceType'] as const;

const isPlainObject = (value: unknown): value is Record<string, any> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const LEGACY_CACHE_FIELDS: Record<CacheSectionKey, LegacyCacheField> = {
    source: 'cacheSource',
    target: 'cacheTarget',
};
const CACHE_SECTION_KEYS = Object.keys(LEGACY_CACHE_FIELDS) as CacheSectionKey[];

const clearLegacyCacheAliases = (memory: CreepMemory) => {
    delete (memory as any).cacheSource;
    delete (memory as any).cacheTarget;
};

const migrateLegacyCacheSection = (memory: CreepMemory, root: CreepCacheRoot, key: CacheSectionKey) => {
    const legacyField = LEGACY_CACHE_FIELDS[key];
    const legacySection = isPlainObject((memory as any)[legacyField]) ? (memory as any)[legacyField] as Record<string, any> : undefined;
    if (!legacySection) return;

    const currentSection = isPlainObject(root[key]) ? root[key] as Record<string, any> : undefined;
    root[key] = currentSection ? { ...legacySection, ...currentSection } : legacySection;
    delete (memory as any)[legacyField];
};

// 统一 creep 缓存根：
// 所有运行时代码都应只读写 memory.cache，旧 cacheSource/cacheTarget 只在这里做一次性兼容迁移。
export const ensureMemoryCache = (memory: CreepMemory): CreepCacheRoot => {
    const root = isPlainObject(memory.cache)
        ? memory.cache as CreepCacheRoot
        : (memory.cache = {} as CreepCacheRoot);
    for (const key of CACHE_SECTION_KEYS) {
        migrateLegacyCacheSection(memory, root, key);
    }
    return root;
};

/**
 * 清空 creep 的本地临时缓存，并顺手丢弃旧别名字段。
 *
 * @remarks
 * 这个入口专门给跨房迁移、强制重定向这类“整包缓存失效”的场景用，
 * 避免在别处重复写 `cache = {}` 和旧字段删除逻辑。
 */
export const clearMemoryCache = (memory: CreepMemory) => {
    memory.cache = {} as CreepCacheRoot;
    clearLegacyCacheAliases(memory);
};

const clearUnifiedTargetFields = (cache: CreepFlatCache) => {
    for (const field of TARGET_CACHE_FIELDS) {
        delete cache[field];
    }
};

/**
 * 统一 creep 原型缓存辅助。
 *
 * @remarks
 * 这里收敛的是原先 `src/shared/creepCache.ts` 的那组扁平目标缓存能力：
 * - 继续复用 `memory.cache` 作为根对象；
 * - 继续兼容旧 `cacheSource/cacheTarget` 的迁移；
 * - 但把读写入口收回到 `Creep` 原型，避免再维护一层 shared 包装。
 */
export default class CacheFunction extends Creep {
    /**
     * 获取 creep 的统一缓存根对象。
     *
     * @returns `memory.cache` 对象；若此前不存在则自动创建。
     *
     * @remarks
     * 该方法不会强制清理其他角色的自定义字段，只负责：
     * 1. 确保 `memory.cache` 一定存在；
     * 2. 把旧 `cacheSource/cacheTarget` 一次性迁移进统一根对象。
     */
    getCache(): CreepFlatCache {
        return ensureMemoryCache(this.memory) as CreepFlatCache;
    }

    /**
     * 清空统一目标缓存的目标字段。
     *
     * @remarks
     * 只移除 `targetId`、`targetType`、`resourceType`，
     * 这样不会误伤同层其他角色专用缓存。
     */
    clearTarget(): void {
        clearUnifiedTargetFields(this.getCache());
    }

    /**
     * 写入当前目标到统一缓存。
     *
     * @param target 要缓存的目标对象。
     * @param type 目标的语义类型标签。
     * @param resourceType 与该目标绑定的资源类型；未传时会清理旧值。
     *
     * @remarks
     * 缓存中只存 `id` 与轻量元信息，不直接持久化完整对象，
     * 这样能避免多余的序列化体积和过期引用。
     */
    setTarget(
        target: { id?: Id<any> } | null | undefined,
        type: CreepCacheTargetType,
        resourceType?: ResourceConstant
    ): void {
        if (!target?.id) {
            this.clearTarget();
            return;
        }

        const cache = this.getCache();
        cache.targetId = target.id;
        cache.targetType = type;
        if (resourceType === undefined) delete cache.resourceType;
        else cache.resourceType = resourceType;
    }

    /**
     * 读取当前缓存目标。
     *
     * @typeParam T 期望返回的目标类型。
     * @returns 对应 id 的游戏对象；若对象已失效则返回 `null` 并顺手清缓存。
     */
    getTarget<T extends RoomObject = RoomObject>(): T | null {
        const cache = this.getCache();
        if (!cache.targetId) return null;

        const target = Game.getObjectById(cache.targetId);
        if (target) return target;

        this.clearTarget();
        return null;
    }

    /**
     * 判断当前是否存在缓存目标。
     *
     * @returns `true` 表示统一缓存内已有目标 id。
     */
    hasTarget(): boolean {
        return !!this.getCache().targetId;
    }

    /**
     * 校验缓存对象是否保持扁平结构。
     *
     * @param cache 待校验的缓存对象；不传时默认检查当前 creep 的缓存根对象。
     * @returns `true` 表示所有字段都是原始值、数组或空值；`false` 表示发现嵌套对象。
     *
     * @remarks
     * 这是迁移与单测辅助方法，不会在运行时主动阻止写入。
     * 当前项目里仍有历史角色在 `memory.cache` 下使用嵌套块，
     * 因此这个校验应被视作“对指定对象的显式断言”，而不是全局强约束。
     */
    validateCacheDepth(cache: CreepFlatCache = this.getCache()): boolean {
        for (const key in cache) {
            const value = cache[key];
            if (value === null || value === undefined) continue;
            if (typeof value !== 'object') continue;
            if (Array.isArray(value)) continue;
            return false;
        }
        return true;
    }
}
