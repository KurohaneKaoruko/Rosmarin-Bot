import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import PowerCreepDoubleAction from "./function/doubleAction"
import PowerCreepUsePower from "./function/usePower"
import PowerCreepExecute from "./execute"


const plugins = [
    BaseFunction,
    PowerCreepDoubleAction,
    PowerCreepUsePower,
    PowerCreepExecute
]


export default () => plugins.forEach(plugin => assignPrototype(PowerCreep, plugin))
