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

    creep.randomSing();

    const sayText = creep.memory.sayText;
    if (!sayText) return;
    if (typeof sayText === 'string') {
        creep.say(sayText, true);
    } else if (Array.isArray(sayText)) {
        const text = creep.memory.sayText.shift();
        if(text) creep.say(text, true);
        else creep.memory.sayText = null;
    } else creep.memory.sayText = null;
}