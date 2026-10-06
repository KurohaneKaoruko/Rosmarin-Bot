import { extend } from '../registry'
import RoomVisualExtension from "./roomVisual"

/** RoomVisual 原型扩展注册表 */
export default () => {
    extend(RoomVisual, RoomVisualExtension)
}
