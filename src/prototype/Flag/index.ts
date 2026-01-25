import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"

const plugins = [
    BaseFunction,
]

export default () => plugins.forEach(plugin => assignPrototype(Flag, plugin))

