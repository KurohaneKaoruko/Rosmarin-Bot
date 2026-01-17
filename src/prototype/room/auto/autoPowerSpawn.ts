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
        if (!BotMemStruct) return;
        
        const mode = BotMemStruct['powerSpawnMode'] ?? 'auto';
        if (mode === 'manual') return;

        const totalEnergy = this.getResAmount(RESOURCE_ENERGY);
        const totalPower = this.getResAmount(RESOURCE_POWER);

        const powerSpawnEnabled = !!BotMemStruct['powerSpawn'];
        let nextEnabled = powerSpawnEnabled;
        let reason = '';

        if (powerSpawnEnabled) {
            if (energy > 0 && totalEnergy < energy) {
                nextEnabled = false;
                reason = `能量低于阈值(${totalEnergy}/${energy})`;
            }
            else if (power > 0 && totalPower < 1) {
                nextEnabled = false;
                reason = `Power不足(${totalPower})`;
            }
        } else {
            const requiredEnergy = (energy > 0 ? energy : 0) + (power > 0 ? power * 50 : 0);
            const powerOk = power == 0 || totalPower >= power;
            if (totalEnergy >= requiredEnergy && powerOk) {
                nextEnabled = true;
            }
        }

        if (nextEnabled !== powerSpawnEnabled) {
            BotMemStruct['powerSpawn'] = nextEnabled;
            if (nextEnabled) log('AutoPower', `${this.name}资源高于阈值, 已开启PowerSpawn`);
            else log('AutoPower', `${this.name}${reason ? reason + ', ' : ''}已关闭PowerSpawn`);
        }
    }
}
