export default class LinkControl extends Room {
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
}
