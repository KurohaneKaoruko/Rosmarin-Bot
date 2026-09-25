import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import AidSpawnFunction from "./spawns/aidSpawn"
import ClaimSpawnFunction from "./spawns/claimSpawn"
import WarSpawnFunction from "./spawns/warSpawn"
import UpSpawnFunction from "./spawns/upSpawn"
import LayoutVisualFunction from "./function/layoutVisual"

const plugins = [
    BaseFunction,
    ClaimSpawnFunction,
    AidSpawnFunction,
    WarSpawnFunction,
    UpSpawnFunction,
    LayoutVisualFunction,
]

export default () => plugins.forEach(plugin => assignPrototype(Flag, plugin))
