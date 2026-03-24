import { ensureEventApi, runEventPhase } from '../infra/event';

const EventModule: RuntimeModule = {
    init: () => {
        // 挂载全局事件 API，供项目任意位置调用 global.event.add(...)
        ensureEventApi();
    },
    start: () => {
        // 在 start 阶段执行对应生命周期事件
        runEventPhase('start');
    },
    tick: () => {
        // 在 tick 阶段执行对应生命周期事件
        runEventPhase('tick');
    },
    end: () => {
        // 在 end 阶段执行对应生命周期事件
        runEventPhase('end');
    },
};

export { EventModule };
