import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import MoveFunction from "./function/moveFuntion"
import WorkFunction from "./function/workFunction"
import SourceFunction from "./function/sourceFunction"
import DoubleAction from "./function/doubleAction"
import CollectFunction from "./function/collectFunction"
import CombatFunction from "./function/combatFunction"
import BuildFunction from "./function/buildFunction"
import CreepExecute from "./execute"

const plugins = [
    BaseFunction,
    MoveFunction,
    WorkFunction,
    SourceFunction,
    DoubleAction,
    CollectFunction,
    CombatFunction,
    BuildFunction,
    CreepExecute,
]

export default () => plugins.forEach(plugin => assignPrototype(Creep, plugin))
