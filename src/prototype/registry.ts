/**
 * 原型扩展：把插件（类或方法包）的方法挂到引擎原型上。
 *
 * @remarks
 * - 声明在 overrides 里的方法视为覆写：原实现挂到 `方法.previous` 供增强逻辑调用；
 * - 未声明 overrides 的同名覆写会打告警并维持后挂覆盖；
 * - 挂载用 getOwnPropertyDescriptor 原样迁移，getter/setter 不触发取值副作用。
 */
type Plugin = Record<string, any>;
type Constructor<T = any> = new (...args: any[]) => T;

export function extend(ctor: Function, plugin: Plugin | Constructor, overrides: string[] = []): void {
    const proto = (ctor as { prototype: Record<string, any> }).prototype;
    // 类 → 实例方法在其 prototype 上；字面量方法包 → 自身即方法集
    // （直接对类取描述符会拿到 length/name/prototype 等静态属性，完全错误）
    const source = typeof plugin === 'function' ? plugin.prototype : plugin;
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(source))) {
        if (name === 'constructor') continue;
        if (name in proto && overrides.includes(name) && typeof descriptor.value === 'function') {
            descriptor.value.previous = proto[name];
        }
        if (name in proto && !overrides.includes(name)) {
            console.warn(`[prototype] 覆盖告警: ${ctor.name}.${name} 未声明 override（维持后挂覆盖语义）`);
        }
        Object.defineProperty(proto, name, descriptor);
    }
}
