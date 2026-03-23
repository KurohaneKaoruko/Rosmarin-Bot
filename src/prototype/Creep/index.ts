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

/**
 * Creep 原型扩展插件列表。
 *
 * @remarks
 * 顺序即挂载顺序：基础能力 -> 行为能力 -> 执行器。
 */
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

/**
 * 挂载全部 creep 原型扩展。
 */
export default () => plugins.forEach(plugin => assignPrototype(Creep, plugin));
