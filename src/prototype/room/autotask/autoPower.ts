export default class AutoPower extends Room {
    autoPower() {
        if (Game.time % 50) return;

        const BotMem =  Memory['AutoData']['AutoPowerData'][this.name];
        if (!BotMem) return;
        if (!BotMem['energy'] || !BotMem['power']) return;

        const BotMemStruct =  Memory['StructControlData'][this.name];

        if (BotMemStruct['powerSpawn'] &&
            (this[RESOURCE_ENERGY] < BotMem['energy'] ||
            this[RESOURCE_POWER] <= 0)
        ) {
            BotMemStruct['powerSpawn'] = false;
            global.log(`[自动PowerSpawn] ${this.name}资源低于阈值, 已关闭PowerSpawn`);
        }

        if (!BotMemStruct['powerSpawn'] &&
            this[RESOURCE_ENERGY] >= BotMem['energy'] + BotMem['power'] * 50 &&
            this[RESOURCE_POWER] >= BotMem['power']
        ) {
            BotMemStruct['powerSpawn'] = true;
            global.log(`[自动PowerSpawn] ${this.name}资源高于阈值, 已开启PowerSpawn`);
        }
    }
}