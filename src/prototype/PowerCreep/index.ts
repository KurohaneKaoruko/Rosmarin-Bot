import { extend } from '../registry'
import BaseFunction from "./function/baseFunction"
import PowerCreepDoubleAction from "./function/doubleAction"
import PowerCreepUsePower from "./function/usePower"
import PowerCreepExecute from "./execute"

/** PowerCreep 原型扩展注册表（顺序即挂载顺序） */
export default () => {
    extend(PowerCreep, BaseFunction)
    extend(PowerCreep, PowerCreepDoubleAction)
    extend(PowerCreep, PowerCreepUsePower)
    extend(PowerCreep, PowerCreepExecute)
}
