/**
 * 旗帜控制
 */
export const flagRunner = function (flag: Flag) {
    if (flag.handleSetPositionFlag()) return;
    if (flag.handleNukeFlag()) return;
}
