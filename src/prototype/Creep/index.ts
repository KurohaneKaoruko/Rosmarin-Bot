import { extend } from '../registry'
import BaseFunction from "./function/baseFunction"
import CacheFunction from "./function/cacheFunction"
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
import CreepExecute from "./runtime/execute"

/**
 * Creep 原型扩展注册表
 *
 * @remarks
 * 顺序即挂载顺序：基础设施 -> 行为扩展 -> 执行器
 */
export default () => {
    extend(Creep, BaseFunction)
    extend(Creep, CacheFunction)
    extend(Creep, MoveFunction)
    extend(Creep, BoostFunction)
    extend(Creep, WorkFunction)
    extend(Creep, SourceFunction)
    extend(Creep, DoubleAction)
    extend(Creep, CollectFunction)
    extend(Creep, CombatFunction)
    extend(Creep, BuildFunction)
    extend(Creep, HaulFunction)
    extend(Creep, ControllerFunction)
    extend(Creep, CreepExecute)
}
