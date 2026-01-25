import mountCreep from './Creep'
import mountFlag from './Flag'
import mountRoom from './Room'
import mountPowerCreep from './PowerCreep'
import mountRoomPosition from './RoomPosition'
import mountRoomVisual from './RoomVisual'

/** 原型拓展 */
export const PrototypeExtension = function () {
    // 挂载全部拓展
    mountCreep();
    mountFlag();
    mountRoom();
    mountPowerCreep();
    mountRoomPosition();
    mountRoomVisual();
}
