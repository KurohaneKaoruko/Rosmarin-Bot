import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import FlagSpawnFunction from "./function/flagSpawnFuncion"

const plugins = [
    BaseFunction,
    FlagSpawnFunction,
]

export default () => plugins.forEach(plugin => assignPrototype(Flag, plugin))
