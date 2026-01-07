/**
 * 校正异常的堆栈信息
 * 
 * 由于 rollup 会打包所有代码到一个文件，所以异常的调用栈定位和源码的位置是不同的
 * 本模块就是用来将异常的调用栈映射至源代码位置
 * 
 * @see https://github.com/screepers/screeps-typescript-starter/blob/master/src/utils/ErrorMapper.ts
 */

import { SourceMapConsumer } from 'source-map'

// 缓存 SourceMap
let consumer = null

// 第一次报错时创建 sourceMap
const getConsumer = function () {
    if (consumer == null) {
        try {
            consumer = new SourceMapConsumer(require("main.js.map"))
        } catch (e) {
            console.log("无法加载 source map:", e)
            return null
        }
    }
    return consumer
}

// 缓存映射关系以提高性能
const cache = {}

/**
 * 使用源映射生成堆栈跟踪，并生成原始标志位
 * 警告 - global 重置之后的首次调用会产生很高的 cpu 消耗 (> 30 CPU)
 * 之后的每次调用会产生较低的 cpu 消耗 (~ 0.1 CPU / 次)
 *
 * @param {Error | string} error 错误或原始追踪栈
 * @returns {string} 映射之后的源代码追踪栈
 */
const sourceMappedStackTrace = function (error: Error | string): string {
    const stack = error instanceof Error ? error.stack : error
    // 有缓存直接用
    if (cache.hasOwnProperty(stack)) return cache[stack]

    const re = /^\s+at\s+(.+?\s+)?\(?([0-z._\-\\\/]+):(\d+):(\d+)\)?$/gm
    let match: RegExpExecArray
    let outStack = error.toString()
    console.log("ErrorMapper -> sourceMappedStackTrace -> outStack", outStack)

    const consumer = getConsumer()
    if (!consumer) return stack

    while ((match = re.exec(stack))) {
        // 解析完成
        if (match[2] !== "main") break
        
        // 获取追踪定位
        const pos = consumer.originalPositionFor({
            column: parseInt(match[4], 10),
            line: parseInt(match[3], 10)
        })

        // 无法定位
        if (!pos.line) {
            outStack += `\n    at ${match[2]}:${match[3]}:${match[4]}`
            continue
        }
        
        // 解析追踪栈
        if (pos.name) outStack += `\n    at ${pos.name} (${pos.source}:${pos.line}:${pos.column})`
        else {
            // 源文件没找到对应文件名，采用原始追踪名
            if (match[1]) outStack += `\n    at ${match[1]} (${pos.source}:${pos.line}:${pos.column})`
            // 源文件没找到对应文件名并且原始追踪栈里也没有，直接省略
            else outStack += `\n    at ${pos.source}:${pos.line}:${pos.column}`
        }
    }

    cache[stack] = outStack
    return outStack
}

/**
 * 错误追踪包装器
 * 用于把报错信息通过 source-map 解析成源代码的错误位置
 * 和原本 wrapLoop 的区别是，wrapLoop 会返回一个新函数，而这个会直接执行
 * 
 * @param next 玩家代码
 */
export const errorMapper = function (next: any, ...args: any) {
    try {
        // 执行玩家代码
        next(...args)
    }
    catch (e) {
        if (e instanceof Error) {
            // 渲染报错调用栈，沙盒模式用不了这个
            // @ts-ignore
            const errorMessage = Game.shard.name == 'sim' ?
                `沙盒模式无法使用 source-map - 显示原始追踪栈<br>${_.escape(e.stack)}` :
                `${_.escape(sourceMappedStackTrace(e))}`
            console.log(`<text style="color:#ef9a9a">${errorMessage}</text>`)
        } else {
            // 抛出原报错
            throw e
        }
    }
}
