/**
 * 旗帜控制
 */
export const flagControl = function (flag: Flag) {
    // 移动旗帜
    if (flag.memory['setPosition']) {
        let [x, y, roomName] = flag.memory['setPosition'].split('/');
        x = +x%50, y = +y%50;
        if (!(x>=0&&x<=49&&y>=0&&y<=49)) { x=25, y=25; }
        let reg = /^[EW]\d+[NS]\d+$/;
        if (!reg.test(roomName) || flag.pos.roomName === roomName) {
            delete flag.memory['setPosition'];
        } else {
            flag.setPosition(new RoomPosition(x, y, roomName));
        }
        return;
    }

    

    
}