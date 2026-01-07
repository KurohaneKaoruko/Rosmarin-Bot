import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import MoveFunction from "./function/moveFuntion"
import WorkFunction from "./function/workFunction"
import DoubleAction from "./function/doubleAction"
import CreepExecute from "./execute"

const plugins = [
    BaseFunction,
    MoveFunction,
    WorkFunction,
    DoubleAction,
    CreepExecute,
]

export default () => plugins.forEach(plugin => assignPrototype(Creep, plugin))
