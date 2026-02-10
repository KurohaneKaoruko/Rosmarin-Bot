import { log } from "@/utils";

export default class TerminalControl extends Room {
    TerminalWork() {
        if (Game.time % 30 !== 2) return;
        const terminal = this.terminal;
        if (!terminal || terminal.cooldown > 0) return;

        const task = this.getSendMission();
        if (!task) return;

        const sendData = task.data as SendTask;
        const { targetRoom, resourceType, amount } = sendData;
        if (!targetRoom || !resourceType || !amount || amount <= 0) {
            this.deleteMissionFromPool('terminal', task.id);
            return;
        }

        const resourceInTerminal = terminal.store[resourceType] || 0;
        const energyInTerminal = terminal.store[RESOURCE_ENERGY] || 0;

        let sendAmount = Math.min(amount, resourceInTerminal);
        if (sendAmount <= 0) return;

        let cost = 0;
        if (resourceType === RESOURCE_ENERGY) {
            // 能量发送：需要满足 send + cost(send) <= energyInTerminal
            // 用 sampleAmount 估算 cost/amount（ratio）来近似求解最大可发送量，减少试探/反复 calc
            if (energyInTerminal <= 0) return;
            const sampleAmount = 1000;
            const ratio = Game.market.calcTransactionCost(sampleAmount, this.name, targetRoom) / sampleAmount;
            sendAmount = Math.min(sendAmount, Math.floor(energyInTerminal / (1 + ratio)));
            if (sendAmount <= 0) return;
            cost = Game.market.calcTransactionCost(sendAmount, this.name, targetRoom);
            if (sendAmount + cost > energyInTerminal) return;
        } else {
            // 非能量发送：用 energyInTerminal 作为“手续费池”，不足则按比例缩小 sendAmount 并复算 cost
            if (energyInTerminal <= 0) return;
            cost = Game.market.calcTransactionCost(sendAmount, this.name, targetRoom);
            if (cost > energyInTerminal) {
                sendAmount = Math.floor(sendAmount * (energyInTerminal / cost));
                if (sendAmount <= 0) return;
                cost = Game.market.calcTransactionCost(sendAmount, this.name, targetRoom);
                if (cost > energyInTerminal) return;
            }
        }
        if (sendAmount <= 0) return;
        
        const result = terminal.send(resourceType, sendAmount, targetRoom);
        if (result === OK) {
            const remaining = amount - sendAmount;
            if (remaining > 0) {
                this.updateMissionPool('terminal', task.id, {data: {...sendData, amount: remaining}} as any);
            } else {
                this.deleteMissionFromPool('terminal', task.id);
            }
            log('资源发送', `${this.name} -> ${targetRoom}, ${sendAmount} ${resourceType}, 能量消耗: ${cost}`);
        } else {
            if (result === ERR_INVALID_ARGS) {
                this.deleteMissionFromPool('terminal', task.id);
            }
            log('资源发送', `${this.name} -> ${targetRoom}, ${sendAmount} ${resourceType} 失败，错误代码：${result}`);
        }
    }
}
