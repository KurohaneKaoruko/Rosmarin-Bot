import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import AidSpawnFunction from "./manualSpawn/aidSpawn"
import WarSpawnFunction from "./manualSpawn/warSpawn"

const plugins = [
    BaseFunction,
    AidSpawnFunction,
    WarSpawnFunction,
]

export default () => plugins.forEach(plugin => assignPrototype(Flag, plugin))
