/**
 * Observer 控制模块
 * 统一管理房间内 Observer 的调用，提供队列管理和回调功能
 */

const observerQueueByRoom: Record<string, ObserveTask[]> = {};
const observerCallbackQueue: ObserveCallback[] = [];

export default class ObserveControl extends Room {
    /**
     * 房间的 Observer 任务队列
     */
    private get observerQueue(): ObserveTask[] {
        return observerQueueByRoom[this.name] || (observerQueueByRoom[this.name] = []);
    }

    /**
     * Observer 回调结果缓存 (在 observe 成功的下一 tick 执行)
     */
    private get observerCallbacks(): ObserveCallback[] {
        return observerCallbackQueue;
    }

    /**
     * 处理 Observer 回调
     * 在房间tick开始时调用
     */
    ObserveCallbackTick() {
        // 处理上一 tick 的回调
        const callbacks = this.observerCallbacks;
        const currentTime = Game.time;

        // 找出需要执行的回调
        const toExecute: ObserveCallback[] = [];
        for (let i = callbacks.length - 1; i >= 0; i--) {
            if (callbacks[i].tick <= currentTime) {
                toExecute.push(callbacks.splice(i, 1)[0]);
            }
        }

        // 执行回调
        for (const cb of toExecute) {
            for (const callback of cb.callbacks) {
                try {
                    callback();
                } catch (e) {
                    console.log(`[ObserveControl] Callback error: ${e}`);
                }
            }
        }
    }

    /**
     * 使用 Observer 观察指定房间
     * @param targetRoomName 目标房间名
     * @param callback 可选的回调函数，在 observe 成功的下一 tick 执行
     * @returns 是否成功加入队列
     */
    observeRoom(targetRoomName: string, callback?: () => void | void): boolean {
        // 没有 observer 时返回 false
        if (!this.observer) return false;

        // 获取房间的 observer
        const observer = this.observer;

        // 检查是否已经在本 tick 观察过该房间
        const queue = this.observerQueue;
        const existingIndex = queue.findIndex(t => t.roomName === targetRoomName);

        if (existingIndex !== -1) {
            // 如果已存在，更新回调（合并多个回调）
            if (callback) {
                queue[existingIndex].callbacks.push(callback);
            }
            return true;
        }

        // 加入队列
        queue.push({
            roomName: targetRoomName,
            observerId: observer.id,
            callbacks: callback ? [callback] : [],
            addTime: Game.time
        });

        return true;
    }

    /**
     * 执行 Observer 任务
     * 在房间tick结束时调用
     */
    ObserveWork() {
        const queue = this.observerQueue;
        if (queue.length === 0) return;

        // 获取房间的 observer
        const observer = this.observer;
        if (!observer) {
            queue.length = 0;
            return;
        }

        // 执行队列中的任务（每 tick 只执行一个）
        const task = queue.shift();
        if (!task) return;

        // 执行 observeRoom
        const code = observer.observeRoom(task.roomName);

        if (code === OK) {
            // 观察成功，注册下一 tick 的回调
            if (task.callbacks.length > 0) {
                this.observerCallbacks.push({
                    roomName: task.roomName,
                    callbacks: task.callbacks,
                    tick: Game.time + 1
                });
            }
        } else {
            // 观察失败，记录日志（可选）
            console.log(`[ObserveControl] ${this.name} observe ${task.roomName} failed: ${code}`);
        }
    }

    /**
     * 获取队列状态（用于调试）
     */
    getObserveQueueStatus(): { queueLength: number; pendingCallbacks: number } {
        return {
            queueLength: this.observerQueue.length,
            pendingCallbacks: this.observerCallbacks.filter(cb => cb.tick > Game.time).length
        };
    }

    /**
     * 清空队列（用于特殊情况）
     */
    clearObserveQueue() {
        this.observerQueue.length = 0;
    }
}

/**
 * Observer 任务
 */
interface ObserveTask {
    roomName: string;           // 目标房间名
    observerId: string;         // 使用的 observer ID
    callbacks: (() => void)[];  // 回调函数列表
    addTime: number;             // 加入队列的时间
}

/**
 * Observer 回调
 */
interface ObserveCallback {
    roomName: string;           // 被观察的房间名
    callbacks: (() => void)[];  // 回调函数列表
    tick: number;                // 执行的 tick
}
