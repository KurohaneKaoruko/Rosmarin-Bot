import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import MoveFunction from "./function/moveFuntion"
import BoostFunction from "./function/boostFunction"
import WorkFunction from "./function/workFunction"
import SourceFunction from "./function/sourceFunction"
import DoubleAction from "./function/doubleAction"
import CollectFunction from "./function/collectFunction"
import CombatFunction from "./function/combatFunction"
import BuildFunction from "./function/buildFunction"
import HaulFunction from "./function/haulFunction"
import ControllerFunction from "./function/controllerFunction"
import CreepExecute from "./execute"

const plugins = [
    BaseFunction,
    MoveFunction,
    BoostFunction,
    WorkFunction,
    SourceFunction,
    DoubleAction,
    CollectFunction,
    CombatFunction,
    BuildFunction,
    HaulFunction,
    ControllerFunction,
    CreepExecute,
]

export default () => plugins.forEach(plugin => assignPrototype(Creep, plugin))
