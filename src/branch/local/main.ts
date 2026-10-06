/**
 * 本地私服验证入口：加载主代码（共享树全量），在 xxscreeps race 服上验证重构。
 * compat 垫片必须保持首个 import（私服缺 Power 等模块时补占位类，防止初始化期 ReferenceError）。
 */
import './compat';
import { loop } from '@/main';

export { loop };
