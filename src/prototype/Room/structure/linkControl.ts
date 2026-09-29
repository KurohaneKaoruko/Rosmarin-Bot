import { isRoomTickAligned } from '@/modules/shared/roomPhase';

/**
 * Link 能量网络（每 10 tick，房间相位错峰）。
 *
 * 角色分区（source / controller / manage / normal）与 400 阈值路由保持原语义；
 * 在此基础上增加**整脉冲直发**：source link 将满（free≤100）且 controller link **为空**时
 * 整笔直发——接收端为空才能让一次 transfer 把 800 全额落地，
 * 不浪费这一个 cooldown（15t）的吞吐。
 * 只认「空」接收端是刻意的：非空接收端由下方 400 阈值路由按需补，两边互不抢跑。
 *
 * QoS 门禁：bucket<2000（emergency）整段跳过——link 传输出错可以由下一个周期自愈，
 * 而 CPU 自激振荡会拖垮全房（兑现 docs/Link能量网络.md 的 QoS 化承诺）。
 */
export default class LinkControl extends Room {
    LinkWork() {
        if (this.level < 5) return;  // 只有在房间等级达到 5 时才启用 Link 能量传输
        if (this.link.length < 2) return;  // 至少需要两个 Link

        if (!isRoomTickAligned(this.name, 10)) return;
        if (!global.qos.shouldRun({ minBucket: 2000 })) return;

        const centerPos = this.getCenter();

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
            if(link.pos.inRangeTo(centerPos, 1)) {
                manageLink = link;
                continue;
            }
            normalLink.push(link);
        }

        if(!controllerLink && !manageLink) return;

        const transferOK = {} as any;

        for (let sourceLink of sourceLinks) {
            if(sourceLink.cooldown != 0) continue;  // 如果 Link 在冷却中，则跳过

            // —— 将满的 source link 优先向「空」controller link 整脉冲直发 ——
            if (sourceLink.store.getFreeCapacity(RESOURCE_ENERGY) <= 100
                && controllerLink && !transferOK.controllerLink
                && (controllerLink.store[RESOURCE_ENERGY] || 0) === 0) {
                sourceLink.transferEnergy(controllerLink);
                transferOK.controllerLink = true;
                continue;
            }

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
