

/**
 * 管理建筑物的工作
 */
export default class StructureWork extends Room {
    StructureWork() {
        // 管理房间中的建筑物
        this.SpawnWork();
        this.TowerWork();
        this.LinkWork();
        this.LabWork();
        this.TerminalWork();
        this.FactoryWork();
        this.PowerSpawnWork();
    }

    SpawnWork() {
        // 没有spawn时不处理
        if (!this.spawn) return;

        // 可视化孵化状态
        this.VisualSpawnInfo();

        // 孵化creep
        this.SpawnCreep();
        
    }
    
    // 处理 Tower 防御和修复逻辑
    TowerWork() {
        // 没有tower时不处理
        if (!this.tower || this.tower.length == 0) return;

        // 攻击敌人
        if (this.TowerAttackEnemy()) return;

        // 攻击NPC
        if (this.TowerAttackNPC()) return;

        // 治疗己方单位
        if (this.TowerHealCreep()) return;

        // 修复建筑物
        if (this.TowerTaskRepair()) return;
    }
    
    LinkWork() {
        if (this.level < 5) return;  // 只有在房间等级达到 5 时才启用 Link 能量传输
        if (this.link.length < 2) return;  // 至少需要两个 Link

        if (Game.time % 10 != 0) return;
        
        let center = Memory['RoomControlData'][this.name]?.center
        let centerPos: RoomPosition;
        if (center) centerPos = new RoomPosition(center.x, center.y, this.name);

        let sourceLinks = []
        let controllerLink = null;
        let manageLink = null;
        let normalLink = [];
        for(const link of this.link) {
            if(this.source.some(source => link.pos.inRangeTo(source, 2))) {
                sourceLinks.push(link);
                continue;
            }
            if(link.pos.inRangeTo(this.controller, 2)) {
                controllerLink = link;
                continue;
            }
            if(centerPos && link.pos.inRangeTo(centerPos, 1)) {
                manageLink = link;
                continue;
            }
            normalLink.push(link);
        }

        if(!controllerLink && !manageLink) return;

        const transferOK = {} as any;
    
        for (let sourceLink of sourceLinks) {
            if(sourceLink.cooldown != 0) continue;  // 如果 Link 在冷却中，则跳过
            if(sourceLink.store[RESOURCE_ENERGY] < 400) continue;  // 如果 Link 的能量不足，则跳过

            if (controllerLink && controllerLink.store[RESOURCE_ENERGY] < 400 && !transferOK.controllerLink) {
                sourceLink.transferEnergy(controllerLink);  // 传输能量
                transferOK.controllerLink = true;
                continue;
            }

            const nlink = normalLink.find(link => link.store[RESOURCE_ENERGY] < 400 && !transferOK[link.id]);
            if (nlink) {
                sourceLink.transferEnergy(nlink);  // 传输能量
                transferOK[nlink.id] = true;
                continue;
            }

            if (manageLink && manageLink.store[RESOURCE_ENERGY] < 400 && !transferOK.manageLink) {
                sourceLink.transferEnergy(manageLink);  // 传输能量
                transferOK.manageLink = true;
                continue;
            }

            break;
        }

        if (controllerLink && controllerLink.store[RESOURCE_ENERGY] < 400 && !transferOK.controllerLink){ // 如果控制器Link能量不足400
            if(!manageLink || manageLink.cooldown != 0) return;
            if(manageLink && manageLink.store[RESOURCE_ENERGY] > 400){  // 如果中心Link能量大于400
                manageLink.transferEnergy(controllerLink);  // 传输能量
                return;
            }
        }
        if (manageLink && manageLink.cooldown == 0 && manageLink.store[RESOURCE_ENERGY] > 400){
            const nlink = normalLink.find(link => link.store[RESOURCE_ENERGY] < 400 && !transferOK[link.id]);
            if (nlink) {
                manageLink.transferEnergy(nlink);  // 传输能量
                return;
            }
        }
    }

    TerminalWork() {
        if (Game.time % 30 !== 2) return;
        const terminal = this.terminal;
        if (!terminal || terminal.cooldown !== 0) return;

        const task = this.getSendMission();
        if (!task) return;

        const { targetRoom, resourceType, amount } = task.data;
        if(amount <= 0) {
            this.deleteMissionFromPool('terminal', task.id);
            return;
        }

        let sendAmount = Math.min(amount, terminal.store[resourceType]);
        let cost = Game.market.calcTransactionCost(sendAmount, this.name, targetRoom);
        if (resourceType === RESOURCE_ENERGY) {
            sendAmount = Math.min(sendAmount, terminal.store[resourceType] - cost);
        }
        else if (cost > terminal.store[RESOURCE_ENERGY]) {
            sendAmount = Math.floor(sendAmount * (terminal.store[RESOURCE_ENERGY] / cost));
        }
        if (sendAmount <= 0) return;
        
        const result = terminal.send(resourceType, sendAmount, targetRoom);
        if (result === OK) {
            if(amount - sendAmount > 0) {
                this.updateMissionPool('terminal', task.id, {data: {amount: amount - sendAmount}});
            } else {
                this.deleteMissionFromPool('terminal', task.id);
            }
            cost = Game.market.calcTransactionCost(sendAmount, this.name, targetRoom);
            global.log(`[资源发送] ${this.name} -> ${targetRoom}, ${sendAmount} ${resourceType}, 能量消耗: ${cost}`);
        } else {
            global.log(`[资源发送] ${this.name} -> ${targetRoom}, ${sendAmount} ${resourceType} 失败，错误代码：${result}`);
        }
    }

    LabWork() {
        // 没有lab不处理
        if (!this.lab) return;

        // 可视化
        this.VisualLabInfo();

        if (Memory['warmode']) return;
        
        // 反应
        this.RunReaction();
    }

    FactoryWork() {
        const factory = this.factory;
        // 工厂不存在时不处理
        if (!factory) return;
        // 冷却时不处理
        if (factory.cooldown != 0) return;
        if (Memory['warmode']) return;

        const memory =  Memory['StructControlData'][this.name];
        // 关停时不处理
        if (!memory || !memory.factory) return;
        // 没有任务时不处理
        const product = memory.factoryProduct;
        if (!product) return;

        // 原料
        const components = COMMODITIES[product as CommodityConstant]?.components;
        // 原料不足时不处理
        if (!components || Object.keys(components).some((c: any) => factory.store[c] < components[c])) return;

        let result = factory.produce(product as CommodityConstant);
        
        if (Game.time % 100 == 0 || result != OK){
            if(factory.store[product] > 0) {
                this.ManageMissionAdd('f', 's', product, factory.store[product]);
            }
        }
    }

    PowerSpawnWork() {
        if (this.level < 8) return;
        const powerSpawn = this.powerSpawn;
        if (!powerSpawn) return;
        if (Memory['warmode']) return;

        // 关停时不处理
        if(!Memory['StructControlData'][this.name]?.powerSpawn) return;
        // 能量不足不处理
        if(this.getResAmount(RESOURCE_ENERGY) < 50000) return;
        
        const store = powerSpawn.store;
        if(store[RESOURCE_ENERGY] < 50 || store[RESOURCE_POWER] < 1) return;
        powerSpawn.processPower();
    }


}
