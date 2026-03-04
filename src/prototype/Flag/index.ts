import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import AidSpawnFunction from "./manualspawn/aidSpawn"
import WarSpawnFunction from "./manualspawn/warSpawn"

const plugins = [
    BaseFunction,
    AidSpawnFunction,
    WarSpawnFunction,
]

export default () => plugins.forEach(plugin => assignPrototype(Flag, plugin))
