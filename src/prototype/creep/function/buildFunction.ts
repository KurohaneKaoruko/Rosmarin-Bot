export default class BuildFunction extends Creep {
    /**
     * 查找并建造建筑工地
     * @param options 配置选项
     * @returns boolean - true 表示找到并正在建造，false 表示未找到
     */
    findAndBuild(options?: {
        priority?: StructureConstant[];
        range?: number;
    }): boolean {
        const sites = this.room.find(FIND_CONSTRUCTION_SITES);
        if (sites.length === 0) return false;

        // 默认优先级: spawn > storage > terminal > extension > tower > 其他
        const defaultPriority: StructureConstant[] = [
            STRUCTURE_ROAD,
            STRUCTURE_SPAWN,
            STRUCTURE_STORAGE,
            STRUCTURE_TERMINAL,
            STRUCTURE_EXTENSION,
            STRUCTURE_TOWER
        ];
        const priority = options?.priority || defaultPriority;

        let targetSite: ConstructionSite | null = null;

        // 按优先级查找建筑工地
        for (const structureType of priority) {
            const filtered = sites.filter(s => s.structureType === structureType);
            if (filtered.length > 0) {
                targetSite = this.pos.findClosestByRange(filtered);
                break;
            }
        }

        // 如果没有找到优先级内的建筑，选择最近的任意建筑
        if (!targetSite) {
            targetSite = this.pos.findClosestByRange(sites);
        }

        if (!targetSite) return false;

        this.goBuild(targetSite);
        return true;
    }

    /**
     * 查找并维修建筑
     * @param options 配置选项
     * @returns boolean - true 表示找到并正在维修，false 表示未找到
     */
    findAndRepair(options?: {
        maxHitsRatio?: number;
        excludeTypes?: StructureConstant[];
        range?: number;
    }): boolean {
        const maxHitsRatio = options?.maxHitsRatio ?? 0.8;
        const excludeTypes = options?.excludeTypes || [];

        const structures = this.room.find(FIND_STRUCTURES, {
            filter: (s) => {
                if (s.hits >= s.hitsMax * maxHitsRatio) return false;
                if (excludeTypes.includes(s.structureType)) return false;
                return true;
            }
        });

        if (structures.length === 0) return false;

        // 选择血量最低的建筑
        const target = structures.reduce((a, b) => a.hits < b.hits ? a : b);

        this.goRepair(target);
        return true;
    }

    /**
     * 建造道路（用于外矿）
     * @returns boolean - true 表示找到并正在建造，false 表示未找到
     */
    buildRoad(): boolean {
        const roadSites = this.room.find(FIND_CONSTRUCTION_SITES, {
            filter: (s) => s.structureType === STRUCTURE_ROAD
        });

        if (roadSites.length === 0) return false;

        const target = this.pos.findClosestByRange(roadSites);
        if (!target) return false;

        this.goBuild(target);
        return true;
    }

    /**
     * 维修道路
     * @param minHitsRatio 最小血量比例，低于此比例的道路需要维修
     * @returns boolean - true 表示找到并正在维修，false 表示未找到
     */
    repairRoad(minHitsRatio?: number): boolean {
        const ratio = minHitsRatio ?? 0.8;

        const roads = this.room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * ratio
        });

        if (roads.length === 0) return false;

        // 选择血量最低的道路
        const target = roads.reduce((a, b) => a.hits < b.hits ? a : b);

        this.goRepair(target);
        return true;
    }
}
