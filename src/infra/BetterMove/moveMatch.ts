
/**
 *  用 SSP (Successive Shortest Paths) + SPFA 求解二分图最优匹配问题
 *
 *  作者：Scorpior
 *
 *  特点：
 *  1. 稀疏：图上的边尽量少，否则计算开销会大；
 *  2. 对称：要求 start 和 target 之间的评分（代价）是对称的；
 *  3. 一对多：允许按流量决定一个 start 匹配多个 target，一个 target 也可以匹配多个 source；
 *  4. 不完全：允许 start 总供给和 target 总需求不相等，求解后存在未被满足的元素；
 *  5. 静态：在匹配过程中，source 和 target 的评分不会改变；
 *  6. 最优：保证所有匹配的分数总和最大；
 * 
 *  算法流程：
 *  1. 从 startList 建图，直到相邻空地上所有 creep 都纳入图中
 *  2. 贪心预匹配：若 start 和 target 同时是彼此的最优选择，则匹配上；
 *  3. 对每个未匹配 start，用 SPFA 在残量图上找 score 最大增广路并翻转匹配；
 *  4. 返回所有 {start, target} 匹配对。
 *
 *  Warning：
 *  1. superTarget 最多占 9 个格子；
 *  2. 相同 creep 或相同 creep 小队以不同名字传入会导致求解失败；
 *  3. score 应在 [-1024, 1024] 之内；
 * 
 *  TODO：
 *  1. edgeArray.fill(0) 可以被优化掉
 * 
 *
 *  参考链接：
 *  1. https://blog.csdn.net/sidnee/article/details/106298615
 *  2. https://zhuanlan.zhihu.com/p/618507290
 *  3. https://blog.csdn.net/weixin_39668199/article/details/115909250
 *  4. https://blog.51cto.com/u_16213647/8033445
 *  5. https://blog.csdn.net/vict_wang/article/details/86584435
 *  6. https://brc2.com/the-algorithm-workshop/
 *
 */
export type MoveMatchWorldPos = number;

export type MoveMatchTargetScore = {
    target: MoveMatchWorldPos;
    score: number;
};

export type MoveMatchSuperTargetScore = {
    target: MoveMatchWorldPos[];
    score: number;
};

export type MoveMatchSingleEntry = {
    start: string;
    isSuper: false;
    targetList: MoveMatchTargetScore[];
};

export type MoveMatchSuperEntry = {
    start: number;
    isSuper: true;
    targetList: MoveMatchSuperTargetScore[];
};

export type MoveMatchEntry = MoveMatchSingleEntry | MoveMatchSuperEntry;

export type MoveMatchStartList = MoveMatchEntry[];

export type MoveMatchSingleResultEntry = {
    start: string;
    target: MoveMatchWorldPos;
};

export type MoveMatchSuperResultEntry = {
    start: number;
    target: MoveMatchWorldPos[];
};

export type MoveMatchResultEntry = MoveMatchSingleResultEntry | MoveMatchSuperResultEntry;

export type MoveMatchCheckNewSource = (targets: MoveMatchWorldPos[]) => MoveMatchSingleEntry[];

type MoveMatchIndexedObject = string | number | MoveMatchWorldPos[];


// 根据房间数量和 creep 总数初始化数组长度
let NUM_NODE = Math.max(64 * Object.keys(Game.rooms).length, 16 * Object.keys(Game.creeps).length, 512);
const MAX_NUM_SQUAD = 128;  // 同一 shard 小队最大数量，注意 puller+pullee 也算一队

/** 最高位 1 为有容量，0 为已匹配， & 0x7fff 为边另一端的顶点 idx，& 0x8000 取最高位 */
let edgeArray = new Uint16Array((NUM_NODE << 3) + NUM_NODE); // 内容为边另一端的顶点 idx，每个节点最多9条边
let weightArray = new Int16Array((NUM_NODE << 3) + NUM_NODE); // 内容为边权，每个节点最多9条边
/** 内容为 target 最优匹配的 start 索引, 需要转换索引 (targetIdx>>1) + 1 */
let targetBestStart = new Uint16Array(NUM_NODE >> 1); // 
/** 内容为 target 最优匹配的 start 的得分, 需要转换索引 (targetIdx>>1) + 1 */
let targetBestScore = new Int16Array(NUM_NODE >> 1); // 
/** 内容为 target 最优匹配正向边 idx, 需要转换索引 (targetIdx>>1) + 1 */
let targetBestEdge = new Uint16Array(NUM_NODE >> 1); // 
/** 已匹配的 start 和 target 被占用的正向边索引 */
let occupiedEdgeIdx = new Uint16Array(NUM_NODE);
let stack = new Uint16Array(NUM_NODE >> 1);     // 存放未在 Phase 2 中匹配的 start
let spfaQueue = new Uint16Array(NUM_NODE);
let spfaDist = new Int16Array(NUM_NODE);
let spfaPrev = new Uint16Array(NUM_NODE);
let spfaInQue = new Uint8Array(NUM_NODE);
let greedyStack = new Uint16Array(MAX_NUM_SQUAD);
let idxToObject: MoveMatchIndexedObject[] = new Array(NUM_NODE);
const startToIdx = new Map<string | number, number>();
const targetToIdx = new Map<MoveMatchWorldPos | MoveMatchWorldPos[], number>();
const matchedTarget = new Set<number>();
const addedTarget = new Set<number>();

function toResultEntry(startObject: MoveMatchIndexedObject, targetObject: MoveMatchIndexedObject): MoveMatchResultEntry | null {
    if (typeof startObject === 'string' && typeof targetObject === 'number') {
        return { start: startObject, target: targetObject };
    }
    if (typeof startObject === 'number' && Array.isArray(targetObject)) {
        return { start: startObject, target: targetObject };
    }
    return null;
}

/**
 * 先为解决交通堵塞问题编写。
 * start: creep,
 * target: 相邻的空地格子,
 * 数据特征：
 *   1. 主动移动的 creep，连通的 target 只有当前 pos 和下一步目标 pos 两个；
 *   2. 被动挡路的 creep，连通周围8个格子，按工作range计算代价；
 *   3. 初始 startList 只包括主动移动的 creep，被动挡路的 creep 通过 checkNewSource 加入；
 *   4. score 越大表示越优先，可以为负数；
 * 问题：
 *   1. 避免被动挡路的 creep 引入太多边，计算开销过大；
 * 
 * 步骤：
 *  1. 从 startList 建图，直到相邻空地上所有 creep 都纳入图中
 *  2. 贪心预匹配：若 start 和 target 同时是彼此的最优选择，则匹配上；
 *  3. 对每个未匹配 start，用 SPFA 在残量图上找 score 最大增广路并翻转匹配；
 *  4. 返回所有 {start, target} 匹配对。
 * 
 * 特别处理：
 * 1. creep 小队视为一个 superStart，它们被允许同时移动的每一组目标格子作为一个 superTarget，
 *    采用贪心预匹配和贪心回退：每个 superStart 摆在收益最大的 superTarget 上。
 *    对普通 start 每次 SPFA 后，仅当不回退 superStart 就无法找到空地情况下才回退 superStart,
 *    回退 superStart 时先贪心摆下所有受影响的 superStart，再用 SPFA 处理由于 superStart 回退
 *    而被拿起的普通 start。
 * 2. 为方便判断各顶点属于 start、target 还是 superTarget，编号规则如下：
 *    2.1. target 为奇数;
 *    2.2. start（从2开始），superTarget（从4开始）为偶数；
 *    2.3. superTarget 为4的倍数（不含0）；
 *    
 *  
 * 
 * TODO：用于其他问题时需支持流量 amount
 * 
 * @param {MoveMatchStartList} startList - 源列表，start 是 creep 名称或 squad 编号，target 是打包后的格子坐标
 * @param {MoveMatchCheckNewSource} checkNewSource - 检查 target 格子上是否有 creep，有则返回新的 start
 * @returns {MoveMatchResultEntry[]} 所有 start 的匹配结果
 */
function moveMatch(startList: MoveMatchStartList, checkNewSource: MoveMatchCheckNewSource): MoveMatchResultEntry[] {
    if (startList.length === 0) return [];

    /* ================================================================
     *  Phase 1 — 建图
     *
     *  将外部传入的 start / target 对象映射为整数索引，
     *  构建邻接表，记录最高 score。
     * ================================================================ */

    /** 下一个可选的 start 编号 */
    let startIdx = 2;
    /** 下一个可选的 target 编号 */
    let targetIdx = 1;
    /** 下一个可选的 superTarget 编号，不使用0号以便在 edge 中用0代表空值 */
    let superTargetIdx = 4;
    edgeArray.fill(0);                             // 初始化邻接表，所有边均不存在
    targetBestScore.fill(Number.MIN_SAFE_INTEGER); // 初始化 target 最优匹配的得分，所有 target 最优匹配的得分均为负无穷
    occupiedEdgeIdx.fill(0);                        // 初始化所有节点均未被匹配
    startToIdx.clear();                             // 清空 start 到索引的映射
    targetToIdx.clear();                            // 清空 target 到索引的映射
    matchedTarget.clear();                          // 清空已匹配的 target 索引集合


    const uncheckedTargets: MoveMatchWorldPos[] = []; // 尚未传入 checkNewSource 检查的 target 对象集合
    const allSuperStarts: Array<[number, number]> = []; // 用于全体 superStart 排序
    let edgeIdx = 0;
    let curStartIdx = 0;
    let targetEdgeIdx = 0;
    let curTargetIdx = 0;
    let curSuperTargetIdx = 0;
    let curEdgeIdx = 0;
    let score = 0;
    let bestScore = 0;
    let bestTargetIdx = 0;
    let bestEdgeIdx = 0;
    let superTarget: MoveMatchWorldPos[] = [];
    let target = 0;
    let superEdges: Array<[number, number]> = [];
    let idx = 0;
    let i = 0;
    let j = 0;
    let occupied = false;
    let totalScore = 0;
    let maxScore = 0;
    let maxEdgeIdx = 0;
    let superStartUnplaced = false;
    let jSuperStart = 0;
    let jSuperTarget = 0;
    let jTarget = 0;
    let kTarget = 0;
    let jEdgeIdx = 0;
    let kEdgeIdx = 0;
    let greedyStackTop = 0;
    let qHead = 0;
    let qTail = 0;

    /**
     * 将一批 StartList 条目加入图中。
     * 若 start 已存在则跳过（去重），新发现的 target 追加到 uncheckedTargets。
     * @param {MoveMatchStartList} entries
     */
    const addEntries = (entries: MoveMatchStartList) => {
        for (const entry of entries) {
            if (startToIdx.has(entry.start)) continue;       // 该 start 已在图中，跳过

            startToIdx.set(entry.start, startIdx);           // 记录 对象→索引 映射
            idxToObject[startIdx] = entry.start;              // 记录 索引→对象 反向映射
            edgeIdx = (startIdx << 3) + startIdx;            // 该 start 的出边起始索引, 每个 start 最多9条边

            if (entry.isSuper) { // superStart，target 都是一组格子
                const superEntry = entry as MoveMatchSuperEntry;
                superEdges = [];
                // 每个 start 只选其最优 target
                bestScore = Number.MIN_SAFE_INTEGER;
                bestTargetIdx = 1;

                // 对于 superTarget，总分放在 start → superTarget 边中，而 superTarget → target 边中0分
                for (const targetScore of superEntry.targetList) {
                    superTarget = targetScore.target;
                    score = targetScore.score * superTarget.length;
                    if (targetToIdx.has(superTarget)) {
                        curSuperTargetIdx = targetToIdx.get(superTarget)!;
                    } else {
                        curSuperTargetIdx = superTargetIdx;              // 为新 superTarget 分配递增索引
                        targetToIdx.set(superTarget, curSuperTargetIdx);      // 记录 对象→索引 映射
                        idxToObject[curSuperTargetIdx] = superTarget;         // 记录 索引→对象 反向映射
                        targetEdgeIdx = (curSuperTargetIdx << 3) + curSuperTargetIdx; // 该 superTarget 的出边起始索引, 每个节点最多9条边

                        for (target of superTarget) {
                            if (targetToIdx.has(target)) {
                                curTargetIdx = targetToIdx.get(target)!;
                            } else {
                                curTargetIdx = targetIdx;                   // 为新 target 分配递增索引
                                targetToIdx.set(target, curTargetIdx);      // 记录 对象→索引 映射
                                idxToObject[curTargetIdx] = target;         // 记录 索引→对象 反向映射
                                targetIdx += 2;                             // 下一个可选的 target 编号，每次跳2个

                                uncheckedTargets.push(target);              // 标记为待检查
                            }
                            edgeArray[targetEdgeIdx] = curTargetIdx | 0x8000;  // | 0x8000 表示有容量
                            weightArray[targetEdgeIdx++] = 0;          // 总分放在 start → superTarget 边中，而 superTarget → target 边中0分
                        }
                        superTargetIdx += 4;          // 下一个可选的 superTarget 编号，4、8、12...，每次跳4个
                    }
                    // 总分
                    superEdges.push([score, curSuperTargetIdx]);

                    if (score > bestScore) {
                        bestScore = score;
                        bestTargetIdx = curSuperTargetIdx;
                    }
                }
                // superStart → superTarget 边，按分数从大到小加入 edgeArray
                superEdges.sort((a, b) => b[0] - a[0]);
                for (const [superScore, superTargetNode] of superEdges) {
                    edgeArray[edgeIdx] = superTargetNode | 0x8000;   // | 0x8000 表示有容量
                    weightArray[edgeIdx++] = superScore;
                }

                // 将 superStart 收集起来，用于 Phase 2 排序后贪心放置
                allSuperStarts.push([bestScore, startIdx]);

            } else {  // 普通 start，target 都是单个格子
                const singleEntry = entry as MoveMatchSingleEntry;
                // 每个 start 只选其最优 target
                bestScore = Number.MIN_SAFE_INTEGER;
                bestTargetIdx = 1;
                bestEdgeIdx = 0;
                // target 都是单个格子
                for (const targetScore of singleEntry.targetList) {
                    target = targetScore.target;
                    score = targetScore.score;
                    if (targetToIdx.has(target)) {
                        curTargetIdx = targetToIdx.get(target)!;
                    } else {
                        curTargetIdx = targetIdx;                   // 为新 target 分配递增索引
                        targetToIdx.set(target, curTargetIdx);      // 记录 对象→索引 映射
                        idxToObject[curTargetIdx] = target;         // 记录 索引→对象 反向映射
                        targetIdx += 2;                             // 下一个可选的 target 编号，每次跳2个

                        uncheckedTargets.push(target);              // 标记为待检查
                    }
                    if (score > bestScore) {
                        bestScore = score;
                        bestTargetIdx = curTargetIdx;
                        bestEdgeIdx = edgeIdx;
                    }

                    // 写入边的 targetIndex，加上 0x8000 表示有容量
                    edgeArray[edgeIdx] = curTargetIdx | 0x8000;
                    weightArray[edgeIdx++] = score;                // 写入边的代价
                }
                curTargetIdx = (bestTargetIdx >> 1) + 1;
                if (bestScore > targetBestScore[curTargetIdx]) {
                    if (!matchedTarget.has(bestTargetIdx)) {
                        matchedTarget.add(bestTargetIdx);
                    }

                    targetBestScore[curTargetIdx] = bestScore;
                    targetBestStart[curTargetIdx] = startIdx;
                    targetBestEdge[curTargetIdx] = bestEdgeIdx;
                }
            }
            startIdx += 4;   // 下一个可选的 start 编号，2、6、10...，偶数且跳过 4 的倍数
        }  // end for (let entry of entries)
    } // end function addEntries

    // 迭代发现阻挡 creep：把新 target 交给 checkNewSource，
    // 若发现有 creep 占据这些 target，则作为新 start 加入图中，循环直到无新节点
    while (true) {
        addEntries(startList);
        if (uncheckedTargets.length) {
            startList = checkNewSource(uncheckedTargets);
            if (startList.length === 0) break;
            uncheckedTargets.length = 0;
        } else {
            break;
        }
    }

    // 图规模超过初始预估时，立即扩容并安全返回。
    // 否则在极端拥堵或大规模 squad 场景下会出现数组越界。
    if (startIdx >= NUM_NODE || superTargetIdx >= NUM_NODE || targetIdx >= NUM_NODE) {
        console.log(`Error: out of range ${NUM_NODE}: startIdx=${startIdx}, superTargetIdx=${superTargetIdx}, targetIdx=${targetIdx}`);
        NUM_NODE = ((Math.max(startIdx, superTargetIdx, targetIdx) >> 6) + 3) << 6;
        edgeArray = new Uint16Array((NUM_NODE << 3) + NUM_NODE);
        weightArray = new Int16Array((NUM_NODE << 3) + NUM_NODE);
        /** 内容为 target 最优匹配的 start 索引, 需要转换索引 (targetIdx>>1) + 1 */
        targetBestStart = new Uint16Array(NUM_NODE >> 1); // 
        /** 内容为 target 最优匹配的 start 的得分, 需要转换索引 (targetIdx>>1) + 1 */
        targetBestScore = new Int16Array(NUM_NODE >> 1); // 
        /** 内容为 target 最优匹配正向边 idx, 需要转换索引 (targetIdx>>1) + 1 */
        targetBestEdge = new Uint16Array(NUM_NODE >> 1); // 
        /** 已匹配的 start 和 target 被占用的正向边索引 */
        occupiedEdgeIdx = new Uint16Array(NUM_NODE);
        stack = new Uint16Array(NUM_NODE >> 1);
        spfaQueue = new Uint16Array(NUM_NODE);
        spfaDist = new Int16Array(NUM_NODE);
        spfaPrev = new Uint16Array(NUM_NODE);
        spfaInQue = new Uint8Array(NUM_NODE);
        greedyStack = new Uint16Array(Math.max(MAX_NUM_SQUAD, NUM_NODE >> 2));
        idxToObject = new Array(NUM_NODE);
        return [];
    }

    /* ================================================================
     *  Phase 2 — 贪心预匹配
     *
     *  1. 先为 superStart 排序，按分数从高到低，然后依次匹配。
     *  2. superStart 摆放完后，普通 start 在其最佳 target 是空闲时匹配：
     *    2.1. 若 start1 和 start2 的最佳 target 相同，则分数较高的 start 匹配上，另一悬空。
     *    2.2. 若 start1 的最佳 target 被 superStart 占用，则 start1 悬空。
     * 
     *  经过 Phase 2 后所有 superStart 都已被匹配，普通 start 可能悬空，在狭窄区域的悬空可能导致 superStart 需要回退。
     * ================================================================ */

    if (allSuperStarts.length) {
        allSuperStarts.sort((a, b) => a[0] - b[0]);
        greedyStackTop = 0;
        for (const [, superStartNode] of allSuperStarts) {
            greedyStack[greedyStackTop++] = superStartNode;
        }
        do {
            curStartIdx = greedyStack[--greedyStackTop];
            edgeIdx = (curStartIdx << 3) + curStartIdx;
            // edge 都通往 superTarget 且已按分数从大到小排序
            // 优先找空地放
            // 如果周围无空地，则回退收益最大的已摆放 superStart
            maxScore = -65536;
            maxEdgeIdx = 0;     // 从当前 superStart → superTarget 的边中选
            superStartUnplaced = true;
            for (idx = edgeIdx; idx < edgeIdx + 9; idx++) {
                curSuperTargetIdx = edgeArray[idx];
                if (curSuperTargetIdx === 0) break;
                if ((curSuperTargetIdx & 0x8000) === 0) continue;
                curSuperTargetIdx &= 0x7FFF;
                // 判断当前 superTarget 是否被占用
                occupied = false;
                addedTarget.clear();
                totalScore = 0;
                targetEdgeIdx = (curSuperTargetIdx << 3) + curSuperTargetIdx;
                for (i = targetEdgeIdx; i < targetEdgeIdx + 9; i++) {
                    curTargetIdx = edgeArray[i] & 0x7FFF;
                    if (curTargetIdx === 0) break;
                    if (occupiedEdgeIdx[curTargetIdx]) {
                        // 如果被占用，则记录得分最低的占用者
                        // 在这里已经被占用的，只能是被其他 superStart 占用
                        jSuperTarget = edgeArray[(curTargetIdx << 3) + curTargetIdx] & 0x7FFF;
                        // 对同一 superTarget 只计算一次
                        if (!addedTarget.has(jSuperTarget)) {
                            addedTarget.add(jSuperTarget);
                            // 当前占用这个格子的 superTarget 对应的 superStart → jSuperTarget 的边权
                            score = weightArray[occupiedEdgeIdx[jSuperTarget]];
                            totalScore += score;
                            occupied = true;
                        }
                    }
                }
                if (occupied) {
                    totalScore = weightArray[idx] - totalScore;  // 当前小队摆放过去 + 占用者回退（取反）
                    if (totalScore > maxScore) {
                        maxScore = totalScore;
                        maxEdgeIdx = idx;
                    }
                } else { // 如果找到空位置，设置匹配关系
                    // superStart → superTarget 之间的匹配关系
                    edgeArray[idx] &= 0x7FFF;   // 清除 0x8000 表示无容量
                    occupiedEdgeIdx[curStartIdx] = idx;
                    occupiedEdgeIdx[curSuperTargetIdx] = idx;

                    // superTarget → target 之间的匹配关系
                    for (i = targetEdgeIdx; i < targetEdgeIdx + 9; i++) {
                        curTargetIdx = edgeArray[i] & 0x7FFF;
                        if (curTargetIdx === 0) break;

                        edgeArray[i] = curTargetIdx;   // 清除 0x8000 表示无容量
                        occupiedEdgeIdx[curTargetIdx] = i;  // 记录已匹配
                        jEdgeIdx = (curTargetIdx << 3) + curTargetIdx;
                        edgeArray[jEdgeIdx] = curSuperTargetIdx | 0x8000; // 建立有容量的反向边
                        weightArray[jEdgeIdx] = 0;  // superTarget → target 之间的边权为 0
                    }
                    superStartUnplaced = false;
                    break;
                }
            }
            // 如果当前 superStart 放不下，回退 maxScore 对应的所有 superStart
            if (superStartUnplaced) {
                if (maxEdgeIdx === 0) {
                    console.log(`❌Error: superStart ${curStartIdx}: ${idxToObject[curStartIdx]} 放不下，回退失败`);
                    continue;
                }
                curSuperTargetIdx = edgeArray[maxEdgeIdx] & 0x7FFF;
                targetEdgeIdx = (curSuperTargetIdx << 3) + curSuperTargetIdx;
                for (idx = targetEdgeIdx; idx < targetEdgeIdx + 9; idx++) {
                    kTarget = edgeArray[idx] & 0x7FFF;
                    if (kTarget === 0) break;
                    kEdgeIdx = occupiedEdgeIdx[kTarget];  // 这个是 superTarget → target 的边
                    curEdgeIdx = (kTarget << 3) + kTarget;  // target → superTarget 的边
                    // 如果被占用，则回退该占用者
                    if (kEdgeIdx) {
                        // 占用 kTarget 的 superTarget
                        jSuperTarget = edgeArray[curEdgeIdx] & 0x7FFF;
                        jEdgeIdx = (jSuperTarget << 3) + jSuperTarget;
                        // 遍历 jSuperTarget 所有 target，将其设为未占用
                        for (j = jEdgeIdx; j < jEdgeIdx + 9; j++) {
                            jTarget = edgeArray[j];    // 容量已经被清除，不需要 & 0x7FFF
                            if (jTarget === 0) break;
                            if (jTarget & 0x8000) {
                                console.log(`❌Error: Phase 2 superTarget ${jSuperTarget}: ${idxToObject[jSuperTarget]} 已匹配的边仍有容量`);
                                jTarget &= 0x7FFF;
                            }

                            occupiedEdgeIdx[jTarget] = 0;  // 清除 target 记录的正向边
                            edgeArray[(jTarget << 3) + jTarget] = 0;  // 清除反向边
                            edgeArray[j] = jTarget | 0x8000;  // 恢复正向边容量
                        }
                        jSuperStart = occupiedEdgeIdx[jSuperTarget] / 9 | 0;    // 边除 9 取整得到节点 idx
                        // 不能恢复 superStart → superTarget 正向边容量，因为会导致 curStartIdx 无法放置
                        // edgeArray[occupiedEdgeIdx[jSuperStart]] |= 0x8000;  
                        // occupiedEdgeIdx[jSuperTarget] = 0;  // 清除 superTarget 记录的正向边
                        // occupiedEdgeIdx[jSuperStart] = 0;  // 清除 superStart 记录的正向边

                        greedyStack[greedyStackTop++] = jSuperStart;
                    }
                    // 让当前 curSuperTargetIdx 占用 kTarget
                    occupiedEdgeIdx[kTarget] = idx;    // 记录 target 的 superTarget → target 正向边
                    edgeArray[curEdgeIdx] = curSuperTargetIdx | 0x8000;  // 建立有容量的 target → superTarget 反向边
                    edgeArray[idx] = kTarget;  // 清除 superTarget → target 正向边容量
                }
                // 设置 superStart → superTarget 的匹配关系
                edgeArray[maxEdgeIdx] &= 0x7FFF;  // 清除 0x8000 表示无容量
                occupiedEdgeIdx[curSuperTargetIdx] = maxEdgeIdx;
                occupiedEdgeIdx[curStartIdx] = maxEdgeIdx;
            }
        } while (greedyStackTop);
    }

    for (curTargetIdx of matchedTarget) {
        targetEdgeIdx = (curTargetIdx << 3) + curTargetIdx;
        // target 未被 superStart 占用才考虑普通 start
        if (edgeArray[targetEdgeIdx] === 0) {
            jTarget = (curTargetIdx >> 1) + 1;
            curStartIdx = targetBestStart[jTarget];
            bestEdgeIdx = targetBestEdge[jTarget];
            // 设置反向边
            edgeArray[targetEdgeIdx] = curStartIdx | 0x8000;
            // 当前边设为被占用
            edgeArray[bestEdgeIdx] &= 0x7FFF;
            // 为该 target 登记已经被占用的正向边
            occupiedEdgeIdx[curTargetIdx] = bestEdgeIdx;
            // 为该 start 登记已经被占用的边
            occupiedEdgeIdx[curStartIdx] = bestEdgeIdx;
        } // else 已被 superStart 占用，occupiedEdgeIdx 已被设置为 superTarget → target 的边
    }

    /* ================================================================
     *  Phase 3 — SSP：对每个未匹配 start 跑 SPFA 寻找最大 score 增广路
     *
     *  经过 Phase 2 后所有 superStart 都已被匹配，普通 start 可能悬空，在狭窄区域的悬空可能导致 superStart 需要回退。
     *  SPFA 在残量图上寻找从「未匹配 start」到「未匹配 target」的 score 最大路径。
     *
     *  残量图的边：
     *    正向边 start→target：代价 = +score，仅当 (start, target) 未被匹配时最高位为 1 
     *    反向边 target→start：代价 = −score，仅当 (start, target) 已被匹配时存在
     *
     *  增广路交替经过正向边和反向边：
     *    unmatchedS ─+w₁→ T₁ ─−w₁'→ S₁ ─+w₂→ T₂ ─−w₂'→ … → unmatchedT
     *
     *  沿增广路翻转匹配状态后，总匹配数 +1，总代价增量 = 该路径的权重和（全局最大）。
     * 
     * 在本代码中的特殊化
     * 标准 SPFA 是在一个统一的图上跑。但我们的图是二分图，节点分为 start 和 target 两侧，增广路严格交替经过两侧。所以代码做了简化：
     * 1. 队列里只有 start 节点 — target 节点不入队，它们的距离在处理 start 时直接算出 
     * 2. "正向边 → 反向边"合并在一个循环里 — 从 start 出发走正向边到 target，如果 target 已匹配，立刻走反向边到达另一个 start，把那个 start 入队
     * 
     * 提示词：
     * @src/algorithm/moveMatch.js 帮我在 Phase 3 补充 SPFA 代码，注意：
     * 1. 所有边存放在 `edgeArray`，边权存放在 `weightArray`；
     * 2. 是否已匹配，可以检查 `occupiedEdgeIdx`；
     * 3. 对于普通 target，反向边存放在 `edgeArray[(targetIdx<<3)+targetIdx]`，反向边权为 `-weightArray[occupiedEdgeIdx[targetIdx]]`；
     * 4. 对于 superTarget，没有设置反向边，其 superStartIdx 可以通过 `occupiedEdgeIdx[superTargetIdx] / 9 | 0` 获得，反向边权类似普通 target；
     * 5. 每次从某一未匹配 start 出发，将父节点（superStart）仍有空闲边的 superTarget 和未匹配 target 都视为增广路终点。对于抵达 superTarget 的增广路，将该 superTarget 的反向边权加入增广路代价。
     * 6. 选取增广路优先级：先考虑终点为未匹配 target 的增广路，选 score 最高者；当无普通未匹配 target 的增广路时，才考虑 score 最高的以 superTarget 为终点的增广路。
     * 7. 增广逻辑：若是普通未匹配 target 增广路，正常将路径边翻转即可；若是以 superTarget 为终点增广路，则
     *   7.1. 取消从 superTarget 到其所有 target 的匹配关系，但不恢复 superStart → 该 superTarget 的边；
     *   7.2. 从未匹配源到 superTarget 前最末一个普通 target 的路径翻转；
     *   7.3 按 Phase 2 相同逻辑回退该 superStart，利用 greedyStack 处理，若其回退中需要迭代回退其他 superStart 则在 greedyStack 中解决，若整个逐级回退过程中需要回退普通 start，则将这些普通 start 加入 stack 由下一次 SPFA 解决。
     * 8. 对于 edgeArray 中每条边，`& 0x8000` 判断是否有容量，`& 0x7FFF` 获取节点 idx；对于节点 idx，`& 1` 判断是否为普通 target，`idx & 3 === 0` 判断是否为 superTarget；
     * 9. 考虑使用我现有变量和命名习惯，考虑在 V8 优化时的极致运行效率。

     * ================================================================ */

    let stackTop = 0;
    for (idx = 2; idx < startIdx; idx += 4) {
        if (occupiedEdgeIdx[idx] === 0) {
            stack[stackTop++] = idx;
        }
    }

    let maxNode = Math.max(startIdx, targetIdx, superTargetIdx);
    while (stackTop) {
        curStartIdx = stack[--stackTop];

        // --- SPFA 初始化 ---
        spfaDist.fill(-32768, 0, maxNode);
        spfaInQue.fill(0, 0, maxNode);
        spfaDist[curStartIdx] = 0;
        spfaPrev[curStartIdx] = 0;
        qHead = qTail = 0;
        spfaQueue[qTail++] = curStartIdx;
        spfaInQue[curStartIdx] = 1;

        bestScore = -32768;
        bestEdgeIdx = 0;
        maxScore = -32768;
        maxEdgeIdx = 0;
        bestTargetIdx = 0;

        // --- SPFA 主循环：队列中只有 start 节点 ---
        while (qHead !== qTail) {
            idx = spfaQueue[qHead++];
            if (qHead >= NUM_NODE) qHead = 0;
            spfaInQue[idx] = 0;

            edgeIdx = (idx << 3) + idx;
            for (i = edgeIdx; i < edgeIdx + 9; i++) {
                curTargetIdx = edgeArray[i];
                if (curTargetIdx === 0) break;
                if ((curTargetIdx & 0x8000) === 0) continue;
                curTargetIdx &= 0x7FFF;
                if (!(curTargetIdx & 1)) continue;  // target 是偶数，是 start 或 superTarget，不应该出现这种情况

                // target 是奇数，是普通 target
                score = spfaDist[idx] + weightArray[i];

                kEdgeIdx = occupiedEdgeIdx[curTargetIdx];
                if (kEdgeIdx) {
                    // 已匹配 target：沿反向边松弛
                    jTarget = edgeArray[(curTargetIdx << 3) + curTargetIdx] & 0x7FFF;
                    if (jTarget & 3) {
                        // 反向边指向普通 start
                        totalScore = score - weightArray[kEdgeIdx];
                        if (totalScore > spfaDist[jTarget]) {
                            spfaDist[jTarget] = totalScore;
                            spfaPrev[jTarget] = i;
                            if (!spfaInQue[jTarget]) {
                                spfaQueue[qTail++] = jTarget;
                                if (qTail >= NUM_NODE) qTail = 0;
                                spfaInQue[jTarget] = 1;
                            }
                        }
                    } else if (jTarget) {
                        // 反向边指向 superTarget，检查其 superStart 是否有空闲边
                        curSuperTargetIdx = jTarget;
                        jSuperStart = occupiedEdgeIdx[curSuperTargetIdx] / 9 | 0;
                        jEdgeIdx = (jSuperStart << 3) + jSuperStart;
                        for (j = jEdgeIdx; j < jEdgeIdx + 9; j++) {
                            if (edgeArray[j] === 0) break;
                            if (edgeArray[j] & 0x8000) {
                                totalScore = score - weightArray[occupiedEdgeIdx[curSuperTargetIdx]];
                                if (totalScore > maxScore) {
                                    maxScore = totalScore;
                                    maxEdgeIdx = i;
                                    bestTargetIdx = curSuperTargetIdx;
                                }
                                break;
                            }
                        }
                    }
                } else if (score > bestScore) {
                    // 未匹配 target，记录候选增广路终点
                    bestScore = score;
                    bestEdgeIdx = i;
                }
            }
        }

        // --- 增广（优先级：未匹配 target > superTarget）---
        if (bestEdgeIdx) {
            // ——— 普通增广路：翻转路径上所有匹配关系 ———
            curTargetIdx = edgeArray[bestEdgeIdx] & 0x7FFF;
            idx = bestEdgeIdx / 9 | 0;   // bestEdgeIdx 是通往未匹配 target 的正向边

            edgeArray[bestEdgeIdx] &= 0x7FFF;
            curEdgeIdx = (curTargetIdx << 3) + curTargetIdx;
            edgeArray[curEdgeIdx] = idx | 0x8000;
            occupiedEdgeIdx[curTargetIdx] = bestEdgeIdx;
            occupiedEdgeIdx[idx] = bestEdgeIdx;

            // idx 是逐级回溯的普通 start
            while (spfaPrev[idx]) {
                edgeIdx = spfaPrev[idx];    // edgeIdx 是 idx 原本匹配的 target 的回溯下一 start 的正向边
                curTargetIdx = edgeArray[edgeIdx] & 0x7FFF;
                edgeArray[occupiedEdgeIdx[curTargetIdx]] |= 0x8000;
                idx = edgeIdx / 9 | 0;      // 回溯的下一 start 
                edgeArray[edgeIdx] &= 0x7FFF;
                curEdgeIdx = (curTargetIdx << 3) + curTargetIdx;
                edgeArray[curEdgeIdx] = idx | 0x8000;
                occupiedEdgeIdx[curTargetIdx] = edgeIdx;
                occupiedEdgeIdx[idx] = edgeIdx;
            }

        } else if (maxEdgeIdx) {
            // ——— superTarget 增广路 ———

            // 7.1 取消 superTarget → 所有 target 的匹配关系（不恢复 superStart → superTarget 边）
            curSuperTargetIdx = bestTargetIdx;
            targetEdgeIdx = (curSuperTargetIdx << 3) + curSuperTargetIdx;
            for (i = targetEdgeIdx; i < targetEdgeIdx + 9; i++) {
                kTarget = edgeArray[i] & 0x7FFF;
                if (kTarget === 0) break;
                occupiedEdgeIdx[kTarget] = 0;
                edgeArray[(kTarget << 3) + kTarget] = 0;
                // edgeArray[i] = kTarget | 0x8000;     // 无需恢复该 superTarget→target 的边
            }

            // 7.2 翻转从未匹配源 curStartIdx 到 superTarget 前最末一个普通 target 的路径
            curTargetIdx = edgeArray[maxEdgeIdx] & 0x7FFF;
            idx = maxEdgeIdx / 9 | 0;

            // edgeArray[occupiedEdgeIdx[curTargetIdx]] |= 0x8000;  // 无需恢复该 target 原本 superTarget→target 的边
            edgeArray[maxEdgeIdx] &= 0x7FFF;
            curEdgeIdx = (curTargetIdx << 3) + curTargetIdx;
            edgeArray[curEdgeIdx] = idx | 0x8000;
            occupiedEdgeIdx[curTargetIdx] = maxEdgeIdx;
            occupiedEdgeIdx[idx] = maxEdgeIdx;

            while (spfaPrev[idx]) {
                edgeIdx = spfaPrev[idx];
                curTargetIdx = edgeArray[edgeIdx] & 0x7FFF;
                edgeArray[occupiedEdgeIdx[curTargetIdx]] |= 0x8000;
                idx = edgeIdx / 9 | 0;
                edgeArray[edgeIdx] &= 0x7FFF;
                curEdgeIdx = (curTargetIdx << 3) + curTargetIdx;
                edgeArray[curEdgeIdx] = idx | 0x8000;
                occupiedEdgeIdx[curTargetIdx] = edgeIdx;
                occupiedEdgeIdx[idx] = edgeIdx;
            }


            // 7.3 回退 superStart，利用 greedyStack 处理，以下是 Phase 2 代码抄了一遍
            jSuperStart = occupiedEdgeIdx[curSuperTargetIdx] / 9 | 0;
            greedyStackTop = 0;
            greedyStack[greedyStackTop++] = jSuperStart;

            do {
                curStartIdx = greedyStack[--greedyStackTop];
                edgeIdx = (curStartIdx << 3) + curStartIdx;
                maxScore = -65536;
                maxEdgeIdx = 0;
                superStartUnplaced = true;

                for (idx = edgeIdx; idx < edgeIdx + 9; idx++) {
                    curSuperTargetIdx = edgeArray[idx];
                    if (curSuperTargetIdx === 0) break;
                    if ((curSuperTargetIdx & 0x8000) === 0) continue;
                    curSuperTargetIdx &= 0x7FFF;

                    occupied = false;
                    addedTarget.clear();
                    totalScore = 0;
                    targetEdgeIdx = (curSuperTargetIdx << 3) + curSuperTargetIdx;
                    for (i = targetEdgeIdx; i < targetEdgeIdx + 9; i++) {
                        curTargetIdx = edgeArray[i] & 0x7FFF;
                        if (curTargetIdx === 0) break;
                        if (occupiedEdgeIdx[curTargetIdx]) {
                            jTarget = edgeArray[(curTargetIdx << 3) + curTargetIdx] & 0x7FFF;
                            if (jTarget) {
                                if ((jTarget & 3) === 0) {
                                    // 是 superTarget
                                    if (!addedTarget.has(jTarget)) {
                                        addedTarget.add(jTarget);
                                        score = weightArray[occupiedEdgeIdx[jTarget]];
                                        totalScore += score;
                                        occupied = true;
                                    }
                                } else {
                                    // 是普通 start 占用
                                    score = weightArray[occupiedEdgeIdx[curTargetIdx]];
                                    totalScore += score;
                                    occupied = true;
                                }
                            }
                        }
                    }

                    if (occupied) {
                        totalScore = weightArray[idx] - totalScore; // 当前小队摆放过去 + 占用者回退（取反）
                        if (totalScore > maxScore) {
                            maxScore = totalScore;
                            maxEdgeIdx = idx;
                        }
                    } else {  // 如果找到空位置，设置匹配关系
                        // superStart → superTarget 之间的匹配关系
                        edgeArray[idx] &= 0x7FFF;
                        occupiedEdgeIdx[curStartIdx] = idx;
                        occupiedEdgeIdx[curSuperTargetIdx] = idx;

                        // superTarget → target 之间的匹配关系
                        for (i = targetEdgeIdx; i < targetEdgeIdx + 9; i++) {
                            curTargetIdx = edgeArray[i] & 0x7FFF;
                            if (curTargetIdx === 0) break;
                            edgeArray[i] = curTargetIdx;
                            occupiedEdgeIdx[curTargetIdx] = i;
                            jEdgeIdx = (curTargetIdx << 3) + curTargetIdx;
                            edgeArray[jEdgeIdx] = curSuperTargetIdx | 0x8000;
                            weightArray[jEdgeIdx] = 0;
                        }
                        superStartUnplaced = false;
                        break;
                    }
                }

                // 如果当前 superStart 放不下，回退 maxScore 对应的所有 superStart、start
                if (superStartUnplaced) {
                    if (maxEdgeIdx === 0) {
                        console.log(`❌Error: SPFA 中 superStart ${curStartIdx}: ${idxToObject[curStartIdx]} 放不下，回退失败`);
                        continue;
                    }
                    curSuperTargetIdx = edgeArray[maxEdgeIdx] & 0x7FFF;
                    targetEdgeIdx = (curSuperTargetIdx << 3) + curSuperTargetIdx;
                    for (idx = targetEdgeIdx; idx < targetEdgeIdx + 9; idx++) {
                        kTarget = edgeArray[idx] & 0x7FFF;
                        if (kTarget === 0) break;
                        kEdgeIdx = occupiedEdgeIdx[kTarget];
                        curEdgeIdx = (kTarget << 3) + kTarget;  // 反向边
                        // 如果被占用，则回退该占用者
                        if (kEdgeIdx) {
                            jTarget = edgeArray[curEdgeIdx] & 0x7FFF;
                            if ((jTarget & 3) === 0) {
                                // 占用者是 superTarget
                                jSuperTarget = jTarget;
                                jEdgeIdx = (jSuperTarget << 3) + jSuperTarget;
                                for (j = jEdgeIdx; j < jEdgeIdx + 9; j++) {
                                    jTarget = edgeArray[j]; // 容量已经被清除，不需要 & 0x7FFF
                                    if (jTarget === 0) break;
                                    if (jTarget & 0x8000) {
                                        console.log(`❌Error: Phase 3 superTarget ${jSuperTarget}: ${idxToObject[jSuperTarget]} 已匹配的边仍有容量`);
                                        jTarget &= 0x7FFF;
                                    }

                                    occupiedEdgeIdx[jTarget] = 0;
                                    edgeArray[(jTarget << 3) + jTarget] = 0;
                                    edgeArray[j] = jTarget | 0x8000;
                                }
                                jSuperStart = occupiedEdgeIdx[jSuperTarget] / 9 | 0;
                                greedyStack[greedyStackTop++] = jSuperStart;
                            } else {
                                // 占用者是普通 start
                                occupiedEdgeIdx[jTarget] = 0;
                                edgeArray[kEdgeIdx] |= 0x8000;
                                stack[stackTop++] = jTarget;
                            }
                        }
                        // 让当前 curSuperTargetIdx 占用 kTarget
                        occupiedEdgeIdx[kTarget] = idx;
                        edgeArray[curEdgeIdx] = curSuperTargetIdx | 0x8000; // 建立有容量的 target → superTarget 反向边
                        edgeArray[idx] = kTarget;   // 清除 superTarget → target 正向边容量
                    }
                    // 设置 superStart → superTarget 的匹配关系
                    edgeArray[maxEdgeIdx] &= 0x7FFF;
                    occupiedEdgeIdx[curSuperTargetIdx] = maxEdgeIdx;
                    occupiedEdgeIdx[curStartIdx] = maxEdgeIdx;
                }
            } while (greedyStackTop);
        } else {
            console.log(`❌Error: idx ${curStartIdx}: ${idxToObject[curStartIdx]} 既找不到未匹配 target 也找不到可回退的 superTarget`);
        }
    }


    /* ================================================================
     *  Phase 4 — 收集结果
     * ================================================================ */

    const result: MoveMatchResultEntry[] = []; // 存放所有匹配对
    for (idx = 2; idx < startIdx; idx += 4) {
        if (occupiedEdgeIdx[idx]) {
            curTargetIdx = edgeArray[occupiedEdgeIdx[idx]];
            if (curTargetIdx & 0x8000) {
                console.log(`❌Error: idx ${idx}: ${idxToObject[idx]} 已匹配的边仍有容量`);
                curTargetIdx &= 0x7FFF;
            }
            const resultEntry = toResultEntry(idxToObject[idx], idxToObject[curTargetIdx]);
            if (resultEntry) {
                result.push(resultEntry);
            } else {
                console.log(`❌Error: idx ${idx}: ${idxToObject[idx]} 的匹配结果类型异常`);
            }
        } else {
            console.log(`❌Error: idx ${idx}: ${idxToObject[idx]} 没有匹配的 target`);
        }
    }
    return result;        // 返回所有匹配对
}

/**
 * @param {MoveMatchStartList} startList - 源列表，string 是 creep 名称，number 是 squad 编号
 * @param {MoveMatchCheckNewSource} checkNewSource - 检查 target 格子上是否有 creep，有则返回新的 start
 * @returns {MoveMatchResultEntry[]} 所有 start 的匹配结果
 */
export default moveMatch;
