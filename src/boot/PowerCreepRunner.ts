import { log } from "@/utils";

/**
 * PowerCreep 工作控制
 */
export const powerCreepRunner = function (pc: PowerCreep) {
    if (!pc) return;
    if (!pc.ticksToLive) {
        if (Game.time % 10) return;
        if (pc.spawnCooldownTime > Date.now()) return;
        const flag = Game.flags[`${pc.name}-idle`];
        const room = flag?.room;
        const powerSpawn = room?.powerSpawn;
        if (powerSpawn) {
            const result = pc.spawn(powerSpawn);
            if (result === OK) {
                log('PowerCreep', `PowerCreep ${pc.name} 在 ${room.name} 孵化`);
            } else {
                log('PowerCreep', `PowerCreep ${pc.name} 在 ${room.name} 孵化失败: ${result}`);
            }
        }
        return;
    }


    if (pc.exec) return pc.exec()
}