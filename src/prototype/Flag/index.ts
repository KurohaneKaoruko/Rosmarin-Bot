import { extend } from '../registry'
import BaseFunction from "./function/baseFunction"
import AidSpawnFunction from "./spawns/aidSpawn"
import ClaimSpawnFunction from "./spawns/claimSpawn"
import WarSpawnFunction from "./spawns/warSpawn"
import UpSpawnFunction from "./spawns/upSpawn"
import LayoutVisualFunction from "./function/layoutVisual"

/** Flag 原型扩展注册表（顺序即挂载顺序） */
export default () => {
    extend(Flag, BaseFunction)
    extend(Flag, ClaimSpawnFunction)
    extend(Flag, AidSpawnFunction)
    extend(Flag, WarSpawnFunction)
    extend(Flag, UpSpawnFunction)
    extend(Flag, LayoutVisualFunction)
}
