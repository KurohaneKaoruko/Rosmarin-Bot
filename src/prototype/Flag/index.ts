import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import AidSpawnFunction from "./function/aidSpawn"
import WarSpawnFunction from "./function/warSpawn"
import UpSpawnFunction from "./function/upSpawn"

const plugins = [
    BaseFunction,
    AidSpawnFunction,
    WarSpawnFunction,
    UpSpawnFunction,
]

export default () => plugins.forEach(plugin => assignPrototype(Flag, plugin))
