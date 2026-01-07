import { log } from "@/utils";

/**
 * PowerCreep 工作控制
 */
export const powerControl = function (pc: PowerCreep) {
    if (!pc) return;
    if (!pc.ticksToLive) {
        if (Game.time % 20) return; // 每20tick检查一次
        if (pc.spawnCooldownTime > Date.now()) return;
        const pcMem = pc.memory;
        const powerSpawn = Game.rooms[pcMem['spawnRoom']]?.powerSpawn;
        if (powerSpawn) {
            const result = pc.spawn(powerSpawn);
            if (result === OK) {
                log('PowerCreep', `PowerCreep ${pc.name} 在 ${pcMem['spawnRoom']} 孵化`);
            } else {
                log('PowerCreep', `PowerCreep ${pc.name} 在 ${pcMem['spawnRoom']} 孵化失败: ${result}`);
            }
        }
        return;
    }


    if (pc.exec) return pc.exec()
}