export default class PowerSpawnControl extends Room {
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
