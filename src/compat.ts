/**
 * 服务器环境兼容垫片（必须保持为 main.ts 的首个 import）。
 *
 * 部分私服（如升级竞速服）不加载 Power 玩法模块——相关**常量**仍被注册
 * （FIND/LOOK_POWER_CREEPS 等查询返回空集），但 `PowerCreep` 全局类不存在。
 * 原型挂载（prototype/PowerCreep）与 BetterMove 的移动包装在模块初始化期
 * 就会访问 `PowerCreep.prototype`，缺类会直接炸掉整个主循环。
 *
 * 这些服务器上 `Game.powerCreeps` 本身是空对象，占位类不会有任何实例化路径，
 * 仅保证 prototype 操作不抛 ReferenceError。
 */

const ensureGlobalClass = (name: string): void => {
    if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
        (globalThis as Record<string, unknown>)[name] = class Placeholder { };
    }
};

ensureGlobalClass('PowerCreep');
