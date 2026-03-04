import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import AidSpawnFunction from "./function/aidSpawn"
import WarSpawnFunction from "./function/warSpawn"

const plugins = [
    BaseFunction,
    AidSpawnFunction,
    WarSpawnFunction,
]

export default () => plugins.forEach(plugin => assignPrototype(Flag, plugin))
