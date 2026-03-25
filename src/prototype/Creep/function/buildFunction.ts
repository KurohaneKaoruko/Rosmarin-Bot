export default class BuildFunction extends Creep {
    /**
     * 查找并立即对最佳工地执行建造动作。
     *
     * @param options 建造目标筛选条件。
     * @returns `true` 表示已找到目标并执行 `goBuild`；`false` 表示当前没有可建造工地。
     *
     * @remarks
     * 具体目标选择逻辑统一委托给 `findBuildTarget`，
     * 这样角色层、测试层与原型层只需要维护一套优先级语义。
     */
    findAndBuild(options?: {
        priority?: StructureConstant[];
        range?: number;
    }): boolean {
        const targetSite = this.findBuildTarget(options);
        if (!targetSite) return false;
        this.goBuild(targetSite);
        return true;
    }

    /**
     * 查找并立即对最佳目标执行维修动作。
     *
     * @param options 维修目标筛选条件。
     * @returns `true` 表示已找到目标并执行 `goRepair`；`false` 表示当前没有合格维修目标。
     *
     * @remarks
     * 这里同样只保留“动作调度”职责，
     * 具体筛选逻辑统一走 `findRepairTarget`，避免历史上 WorkFunction / BuildFunction 双实现漂移。
     */
    findAndRepair(options?: {
        maxHits?: number;
        maxHitsRatio?: number;
        excludeTypes?: StructureConstant[];
        range?: number;
    }): boolean {
        const target = this.findRepairTarget(options);
        if (!target) return false;
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
