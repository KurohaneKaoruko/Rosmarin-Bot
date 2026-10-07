import { log } from '@/modules/utils';

/** 同 tick 同内容报错去重 */
const lastError = { tick: -1, msg: '' };

/**
 * 包一层 try/catch：异常经统一日志输出，同 tick 同内容去重防刷屏
 * @returns fn 的返回值；抛错时返回 undefined
 */
export function tryRun<T>(fn: () => T): T | undefined {
    try {
        return fn();
    } catch (err) {
        let e = err as Error;
        if (!(e instanceof Error)) {
            e = new Error(JSON.stringify(err));
        }
        const msg = `${e.message}\nStack: ${e.stack}`;
        if (lastError.tick === Game.time && lastError.msg === msg) return undefined;
        lastError.tick = Game.time;
        lastError.msg = msg;
        log(msg);
        return undefined;
    }
}
