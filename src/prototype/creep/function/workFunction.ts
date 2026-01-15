export default class WorkFunction extends Creep {
    /**
     * 采集资源
     * @param target - 要采集的目标 (Source 或 Mineral)
     * @returns true 表示正在采集或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goHaverst(target: Source | Mineral) {
        if (!target) return null;
        let result = this.harvest(target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 1
            });
            return false;
        } else return true;
    }
    /**
     * 从指定结构中提取资源
     * @param target - 提取目标 (Structure, Tombstone, Ruin 等)
     * @param resourceType - (可选) 要提取的资源类型，默认为目标存储中的第一种资源
     * @param args - (可选) 其他传递给 withdraw 的参数
     * @returns true 表示正在提取或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goWithdraw(target: any, resourceType?: ResourceConstant, ...args: any[]): boolean {
        if (!target) return null;
        if (!resourceType) resourceType = Object.keys(target.store)[0] as ResourceConstant;
        let result = this.withdraw(target, resourceType, ...args);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 1
            });
            return false;
        } else return true;
    }
    /**
     * 向指定结构转移资源
     * @param target - 转移目标 (Creep 或 Structure)
     * @param resoureType - (可选) 要转移的资源类型，默认为自身存储中的第一种资源
     * @param amount - (可选) 转移数量
     * @returns true 表示正在转移或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goTransfer(target: AnyCreep | Structure, resoureType?: ResourceConstant, amount?: number): boolean {
        if (!target) return null; // 如果没有目标，返回 null
        if (!resoureType) resoureType = Object.keys(this.store)[0] as ResourceConstant;
        let result = this.transfer(target, resoureType, amount);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffffff' },
                maxRooms: 1,
                range: 1
            });
            return false;
        } else return true;
    }
    /**
     * 拾取掉落资源
     * @param target - 掉落的资源对象
     * @returns true 表示正在拾取或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goPickup(target: Resource): boolean {
        if (!target) return null; // 如果没有目标，返回 false
        let result = this.pickup(target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 1
            });
            return false;
        } else return true;
    }
    /**
     * 建造建筑
     * @param target - 建筑工地 (ConstructionSite)
     * @returns true 表示正在建造或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goBuild(target: ConstructionSite) {
        if (!target) return null;
        let result = this.build(target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 3
            });
            return false;
        } else return true;
    }
    /**
     * 维修建筑
     * @param target - 需要维修的建筑
     * @returns true 表示正在维修、已满血或已在范围内，false 表示正在移动中，null 表示目标不存在
     */
    goRepair(target: Structure) {
        if (!target) return null;
        if (target.hits === target.hitsMax) return true;

        let result = this.repair(target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, {
                visualizePathStyle: { stroke: '#ffaa00' },
                maxRooms: 1,
                range: 3
            });
            return false;
        } else return true;
    }
}

