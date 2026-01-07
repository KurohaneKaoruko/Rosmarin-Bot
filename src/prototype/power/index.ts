import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import PowerCreepUsePower from "./function/usePower"
import PowerCreepExecute from "./execute"


const plugins = [
    BaseFunction,
    PowerCreepUsePower,
    PowerCreepExecute
]


export default () => plugins.forEach(plugin => assignPrototype(PowerCreep, plugin))