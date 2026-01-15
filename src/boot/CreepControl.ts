/**
 * Creep 工作控制
 */
export const creepControl = function (creep: Creep) {
    if (!creep || creep.spawning) return;
    if (!creep.memory.role) {
        creep.suicide();
        return;
    }

    // Creep工作
    creep.exec();
}