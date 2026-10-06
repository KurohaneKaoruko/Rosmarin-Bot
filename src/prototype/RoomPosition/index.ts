import { extend } from '../registry'
import BaseFunction from "./baseFunction"

/** RoomPosition 原型扩展注册表 */
export default () => {
    // createFlag 覆写引擎原生 API（包装 ROOMless 场景的建旗调用），声明 override 保留原实现于 previous
    extend(RoomPosition, BaseFunction, ['createFlag'])
}
