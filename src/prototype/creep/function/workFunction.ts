export default class WorkFunction extends Creep {
    /**
     * 采集资源
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
     * 建造
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
     * 维修
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

