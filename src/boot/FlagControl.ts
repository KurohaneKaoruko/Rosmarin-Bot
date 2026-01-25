/**
 * 旗帜控制
 */
export const flagControl = function (flag: Flag) {
    if (flag.handleSetPositionFlag()) return;
    if (flag.handleNukeFlag()) return;
}
