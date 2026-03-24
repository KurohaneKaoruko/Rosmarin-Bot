type CreepCacheRoot = NonNullable<CreepMemory['cache']>;
type CacheSectionKey = 'source' | 'target';
type LegacyCacheField = 'cacheSource' | 'cacheTarget';

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
