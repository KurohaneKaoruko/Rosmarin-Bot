import { mountDD, checkDDMessages, ddTools } from '../infra/ddcomm'

/**
 * DD 通信运行时模块。
 *
 * @remarks
 * - `init` 挂载全局通信 API；
 * - `start` 在每 tick 开始时轮询并处理 DD 消息。
 */
export const DDModule = {
    /**
     * 初始化 DD 通信环境并注入全局工具。
     */
    init: () => {
        mountDD();
        global.dd = ddTools;
    },
    /**
     * tick 开始阶段处理 DD 消息。
     */
    start: () => {
        checkDDMessages()
    },
};
