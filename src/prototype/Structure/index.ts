import { extend } from '../registry'
import baseFunction from "./baseFunction"

/** Structure 原型扩展注册表 */
export default () => {
    extend(Structure, baseFunction)
}
