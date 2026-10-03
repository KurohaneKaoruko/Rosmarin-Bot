import { assignPrototype } from "@/modules/utils"
import RoomVisualExtension from "./roomVisual"

const plugins = [
    RoomVisualExtension,
]

export default () => plugins.forEach(plugin => assignPrototype(RoomVisual, plugin))
