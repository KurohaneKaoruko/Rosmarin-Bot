import { log } from "@/utils";

export default class AutoPower extends Room {
    autoPower() {
        if (Game.time % 50) return;

        const BotMem =  Memory['AutoData']['AutoPowerData'][this.name];
        if (!BotMem) return;
        
        const energy = BotMem['energy'] ?? 100e3;
        const power = BotMem['power'] ?? 10e3;
        if (energy == 0 && power == 0) return;

        const BotMemStruct =  Memory['StructControlData'][this.name];
        if (BotMemStruct['powerSpawn'] &&
            (this[RESOURCE_ENERGY] < energy || this[RESOURCE_POWER] == 0)
        ) {
            BotMemStruct['powerSpawn'] = false;
            log('AutoPower', `${this.name}资源低于阈值, 已关闭PowerSpawn`);
        }

        if (!BotMemStruct['powerSpawn'] &&
            this[RESOURCE_ENERGY] >= energy + power * 50 &&
            this[RESOURCE_POWER] >= power
        ) {
            BotMemStruct['powerSpawn'] = true;
            log('AutoPower', `${this.name}资源高于阈值, 已开启PowerSpawn`);
        }
    }
}