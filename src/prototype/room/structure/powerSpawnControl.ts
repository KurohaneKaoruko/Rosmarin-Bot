export default class PowerSpawnControl extends Room {
    PowerSpawnWork() {
        if (this.level < 8) return;
        const powerSpawn = this.powerSpawn;
        if (!powerSpawn) return;
        // 战争时不处理
        if (Memory['warmode']) return;
        const mem = Memory['StructControlData'][this.name];
        // 关停时不处理
        if(!mem?.powerSpawn) return;
        // 能量不足不处理
        const mode = mem?.powerSpawnMode ?? 'auto';
        if (mode === 'manual' && this.getResAmount(RESOURCE_ENERGY) < 50000) return;
        const store = powerSpawn.store;
        if(store[RESOURCE_ENERGY] < 50 || store[RESOURCE_POWER] < 1) return;
        powerSpawn.processPower();
    }
}
