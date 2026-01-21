import { assignPrototype } from "@/utils"
import RoomVisualExtension from "./roomVisual"

const plugins = [
    RoomVisualExtension,
]

export default () => plugins.forEach(plugin => assignPrototype(RoomVisual, plugin))
