/**
 * 旗帜控制
 */
export const flagRunner = function (flag: Flag) {
    if (flag.handleSetPositionFlag()) return;
    if (flag.handleNukeFlag()) return;
    if (flag.handleWarSpawnFlag()) return;
    if (flag.handleAidSpawnFlag()) return;
}
