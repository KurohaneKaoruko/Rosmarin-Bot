import AidModule from "./AidModule";
import ClaimModule from "./ClaimModule";

/**
 * Flag触发的孵化控制
 */
const FlagSpawn = {
    tick: function() {
        if (Game.time % 10) return;
        for (const flagName in Game.flags) {
            if (AidModule(flagName)) continue;
            if (ClaimModule(flagName)) continue;
        }
    }
}

export { FlagSpawn };