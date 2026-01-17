export default class TerminalControl extends Room {
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
}
