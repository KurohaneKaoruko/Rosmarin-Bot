/**
 * 模块生命周期接口
 * 定义了模块在游戏循环中各阶段的钩子函数
 */
interface RuntimeModule {
    /**
     * 初始化函数
     * 在模块首次加载时调用一次，用于初始化模块状态、注册事件等
     */
    init?: Function;

    /**
     * 启动函数
     * 在每个 tick 开始时调用，用于准备本 tick 所需的数据和状态
     */
    start?: Function;

    /**
     * 主循环函数
     * 在每个 tick 的主要执行阶段调用，用于执行模块的核心逻辑
     */
    tick?: Function;

    /**
     * 结束函数
     * 在每个 tick 结束时调用，用于清理临时数据、统计信息等收尾工作
     */
    end?: Function;
}