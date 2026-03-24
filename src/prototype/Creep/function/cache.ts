type CreepCacheRoot = NonNullable<CreepMemory['cache']>;
type LegacyCacheSectionKey = 'source' | 'target';

const isPlainObject = (value: unknown): value is Record<string, any> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const getLegacyCacheField = (key: LegacyCacheSectionKey): 'cacheSource' | 'cacheTarget' =>
    key === 'source' ? 'cacheSource' : 'cacheTarget';

const syncLegacyCacheAlias = (
    memory: CreepMemory,
    key: LegacyCacheSectionKey,
    section: Record<string, any> | undefined
) => {
    const legacyField = getLegacyCacheField(key);
    if (section) {
        memory[legacyField] = section as any;
        return;
    }
    delete memory[legacyField];
};

const migrateLegacyCacheSection = (memory: CreepMemory, root: CreepCacheRoot, key: LegacyCacheSectionKey) => {
    const legacyField = getLegacyCacheField(key);
    const legacySection = isPlainObject(memory[legacyField]) ? memory[legacyField] as Record<string, any> : undefined;
    const currentSection = isPlainObject(root[key]) ? root[key] as Record<string, any> : undefined;

    if (legacySection && currentSection) {
        // 旧别名已经和新分区指向同一个对象时，不要再次克隆，
        // 否则调用方手里的缓存引用会在同 tick 内失效。
        if (legacySection === currentSection) {
            syncLegacyCacheAlias(memory, key, currentSection);
            return;
        }
        root[key] = { ...legacySection, ...currentSection };
        syncLegacyCacheAlias(memory, key, root[key] as Record<string, any>);
        return;
    }

    if (legacySection) {
        root[key] = legacySection;
        syncLegacyCacheAlias(memory, key, legacySection);
        return;
    }

    if (currentSection) {
        syncLegacyCacheAlias(memory, key, currentSection);
        return;
    }

    syncLegacyCacheAlias(memory, key, undefined);
};

// 统一 creep 缓存根：
// 所有运行时代码都应只读写 memory.cache，旧 cacheSource/cacheTarget 只在这里做兼容迁移。
export const ensureMemoryCache = (memory: CreepMemory): CreepCacheRoot => {
    if (!isPlainObject(memory.cache)) {
        memory.cache = {} as CreepCacheRoot;
    }

    const root = memory.cache as CreepCacheRoot;
    migrateLegacyCacheSection(memory, root, 'source');
    migrateLegacyCacheSection(memory, root, 'target');
    return root;
};

export const ensureMemoryCacheSection = <T extends Record<string, any>>(
    memory: CreepMemory,
    key: string
): T => {
    const root = ensureMemoryCache(memory);
    if (!isPlainObject(root[key])) {
        root[key] = {};
    }

    if (key === 'source' || key === 'target') {
        syncLegacyCacheAlias(memory, key, root[key] as Record<string, any>);
    }
    return root[key] as T;
};

export const getMemoryCacheSection = <T extends Record<string, any>>(
    memory: CreepMemory,
    key: string
): T | undefined => {
    const root = ensureMemoryCache(memory);
    if (!isPlainObject(root[key])) return undefined;
    return root[key] as T;
};

export const replaceMemoryCacheSection = (
    memory: CreepMemory,
    key: LegacyCacheSectionKey,
    section: Record<string, any> | undefined
) => {
    const root = ensureMemoryCache(memory);
    if (section && Object.keys(section).length > 0) {
        root[key] = section;
        syncLegacyCacheAlias(memory, key, section);
        return;
    }

    delete root[key];
    syncLegacyCacheAlias(memory, key, undefined);
};
