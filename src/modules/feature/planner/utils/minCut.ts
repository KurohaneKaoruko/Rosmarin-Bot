/**
 * Scorpior 算法
 *
 * 作者（原创）：Scorpior
 * 版本：1.0.0
 *
 * V8 极致优化版 最小顶点割（mincut）求解器
 * 适用于点数 <= 250 且每个顶点度数 <= 8 且边权为 1 的稀疏图
 * 求割点而不是割边。
 *
 * 比 Dinic 算法的最优实现快，比 OverMind 版实现快约1个数量级（约50+cpu:约7cpu）。
 *
 */

declare const TERRAIN_MASK_WALL: number;

const ROOM_SIZE = 50;
const MAX_DIST = 999;
const MIN_DIST = 3; // ram 离建筑最短距离，避免 rangeAttack

let numVertices = ROOM_SIZE * ROOM_SIZE;
let vertexDist = new Uint8Array(numVertices); // 记录每个顶点到源点的路程
let vertexNumChildren = new Uint8Array(numVertices);
let vertexParent = new Int16Array(numVertices); // 记录每个顶点的父顶点
let vertexChild = new Uint16Array(numVertices); // 在 increFlow 记录每个顶点的直接儿子
let vertexVisited = new Uint8Array(numVertices << 1);
let parentVisited = new Uint8Array(numVertices);
let bfsQueue = new Uint16Array(numVertices << 1);
let vertexAdjacentToTarget = new Uint16Array(ROOM_SIZE << 2); // 房屋边长4倍
let edgeArray = new Uint16Array(numVertices << 4); // numVertices *2 *8 倍，前 numVertices 作为入点，后 numVertices 作为出点
let distCappedEdgeArray = new Uint16Array(numVertices << 3); // numVertices*8 倍
let queueHead = 0, queueTail = 0;
let incBFSQueue = new Uint16Array(numVertices); // 用于增广时的 bfs，记录距离 target（exit）路程
let distToTarget = new Uint8Array(numVertices);
let dfsStack = new Uint16Array(ROOM_SIZE << 2);
let dfsCurEdgeIdx = new Uint16Array(ROOM_SIZE << 2); // 用于当前弧优化，数组长度大于可能的 stack 深度

interface Position {
	x: number;
	y: number;
}

interface TowerCandidatePoses {
	[x: number]: {
		[y: number]: number;
	};
}

interface MinCutResult {
	towerCandidatePoses: TowerCandidatePoses;
	enermyPoses: Position[];
	rampartGroups: Position[][];
}

interface VisitedAndDist {
	vertexVisited: Uint8Array;
	vertexDist: Uint8Array;
}

/**
 * 和 Dinic、ISAP 的 bfs 原理类似，但我只需要跑一次。
 *
 * 记录三个会被后续步骤用到的信息：
 *   1. vertexDist：记录每个顶点到源点的路程，是路径链条的基础，增广时遇到路径冲突时局部求解也会考虑 dist。
 *   2. vertexParent：记录每个顶点的父顶点（父顶点 dist 必定是子顶点 dist-1），形成路径链条，后续增广（increFlow）只需利用路径链条而不需要搜索。
 *   3. vertexAdjacentToTarget：记录触及汇（target）的点，后续增广（increFlow）只需从这些点往 parent 回溯。
 *
 * 特殊改进有二：
 *   1. "抢儿子"：对于 u，如果其相邻的 v 的 vDist 是 uDist+1，且 v 的父亲的儿子数比 u 的儿子数大2或以上，则 u 把 v 抢过来当自己的儿子。
 *   2. 记录摸到汇（target）的点，后续增广（increFlow）只需从这些点往 parent 回溯。
 *
 * @param terrain 房间地形
 * @param startPoses 源位置数组
 * @param targetPoses 汇位置数组
 * @param rv 房间可视化对象
 * @param maxDist 最大距离
 */
function bfs(terrain: Uint8Array, startPoses: Position[], targetPoses: Position[], rv: RoomVisual | null, maxDist: number): number {
	let numVerticesAdjacentToTarget = 0;
	let u: number, v: number, vx: number, vParent: number, nextDist: number, edgeArrayIdx: number, uReachTarget: boolean;

	for (const pos of targetPoses) {
		vertexParent[pos.y * 50 + pos.x] = -1; // 方便判断是否抵达汇
	}

	queueHead = 0;
	queueTail = 0;
	let queueTailBeforeVisitU: number;
	for (const pos of startPoses) {
		u = pos.y * 50 + pos.x;
		bfsQueue[queueTail++] = u;
		vertexParent[u] = 1; // 代表是源点
		vertexDist[u] = 0;
	}

	while (queueHead < queueTail) {
		u = bfsQueue[queueHead++];
		queueTailBeforeVisitU = queueTail;
		uReachTarget = false;

		nextDist = vertexDist[u] + 1;
		edgeArrayIdx = u << 3; // 每个顶点最多 8 条边
		let curMinorDistIdx = u << 3; // distCappedEdgeArray
		for (let y = -ROOM_SIZE; y <= ROOM_SIZE; y += ROOM_SIZE) {
			for (let x = -1; x <= 1; x++) {
				v = u + x + y;
				// 墙或 v===u，跳过
				if (terrain[v] & TERRAIN_MASK_WALL || v === u) {
					continue;
				}
				vx = v % 50; // v 的 x 坐标
				// 房间最外围一圈，跳过
				if (vx == 0 || vx == 49 || v < 50 || v >= 2450) {
					continue;
				}

				edgeArray[edgeArrayIdx++] = v;
				vParent = vertexParent[v];
				// 未访问，正常加入队列
				if (vParent === 0) {
					// 太远了，视作汇
					if (nextDist >= maxDist) {
						vertexParent[v] = -1;
						if (!uReachTarget) {
							vertexAdjacentToTarget[numVerticesAdjacentToTarget++] = u;
							uReachTarget = true;
						}
					}
					// 其他的正常处理
					else {
						bfsQueue[queueTail++] = v;
						vertexParent[v] = u;
						vertexNumChildren[u]++;
						vertexDist[v] = nextDist;
					}
				}
				// v 是汇点，记录 u 为 v 的邻接顶点
				else if (vParent === -1 && !uReachTarget) {
					vertexAdjacentToTarget[numVerticesAdjacentToTarget++] = u;
					uReachTarget = true;
				}
				// v 是源点，跳过
				else if (vParent === 1) {
					continue;
				}
				// 从小端填充 distCappedEdgeArray
				else if (vertexDist[v] === nextDist - 2) {
					distCappedEdgeArray[curMinorDistIdx++] = v;
				}
			}
		}

		if (uReachTarget) {
			for (let i = queueTailBeforeVisitU; i < queueTail; i++) {
				v = bfsQueue[i];
				vertexParent[v] = 0;
				vertexDist[v] = 0;
			}
			queueTail = queueTailBeforeVisitU;
		} else {
			for (let i = u << 3; i < edgeArrayIdx; i++) {
				v = edgeArray[i];
				vParent = vertexParent[v];
				// 与 u 距离相同，从小端填充 distCappedEdgeArray
				// 即 distCappedEdgeArray 中先是所有 nextDist-2 的顶点，然后是 nextDist-1 的顶点
				if (vertexDist[v] === nextDist - 1) {
					distCappedEdgeArray[curMinorDistIdx++] = v;
				} else
					// 如果 v 处于 u 的下一级且 v 父亲出度大于 u 的出度加 1，则 u 可以作为 v 的父亲
					if (vertexNumChildren[vParent] > vertexNumChildren[u] + 1 && vertexDist[v] === nextDist) {
						vertexParent[v] = u;
						vertexNumChildren[u]++;
						vertexNumChildren[vParent]--;
					}
			}
		}
	}

	return numVerticesAdjacentToTarget;
}

/**
 * Scorpior 原创增广路算法。
 * 和 ISAP 的增广类似，但我不跑 deep-first-search，直接按 parent 和 dist 关系增广。
 * 此算法不保证最优解，但大部分情况下效果还不错。
 *
 * 按 bfs 找到的 vertexAdjacentToTarget 往 startPoses 回溯增加流量。
 * 根据 parent 传递关系，将每条从 start 通往 target 的路径上的边删除，代表流量已被用完。
 * 每条从 start 通往 target 的路径上的顶点拆分成入点和出点，出点的边放在 (numVertices+u) << 3 的位置，用于后续判断哪些点是 rampart。
 *
 * 核心增广逻辑：遇到两条路线交汇时，在 dist 相近的"横向"格子中 dfs 找到未被使用的格子，若找到则 dfs 路径上的所有路线往新格子方向改道
 *
 * @param numVertices 总顶点数，拆分后的出点放在 numVertices 到 numVertices+numVertices-1 之间
 * @param numVerticesAdjacentToTarget 汇点的邻接顶点数
 * @param rv 房间可视化对象
 * @param minDist 最小距离
 */
function increFlow(numVertices: number, numVerticesAdjacentToTarget: number, rv: RoomVisual | null, minDist: number): void {
	let u_in: number, u_out: number, uDist: number, uDistTarget: number, uParent: number, uChild: number, uParent_out: number, edgeArrayIdx: number, needToChangeParent: boolean;
	let incBFSHead = 0, incBFSTail = 0, stackTopIdx: number, u_stackTop: number, tempParent: number, v: number, vChild: number, vDist: number, w: number, j: number, k: number, noMinorDist: boolean;

	for (let i = 0; i < numVerticesAdjacentToTarget; i++) {
		u_in = vertexAdjacentToTarget[i];
		u_out = numVertices + u_in;
		edgeArrayIdx = u_in << 3;
		// 使用 TypedArray.set() 方法进行高效内存拷贝（类似 memcpy）
		// 将 u_in 的出边拷贝到 u_out (每个顶点最多 8 条边)
		// u_out 无需往回指到 u_in
		edgeArray.set(edgeArray.subarray(edgeArrayIdx, edgeArrayIdx + 8), u_out << 3);
		incBFSQueue[incBFSTail++] = u_in;
		edgeArray[edgeArrayIdx] = 0; // 0 代表其他边已删除
		distToTarget[u_in] = 1;
	}

	while (incBFSHead < incBFSTail) {
		u_in = incBFSQueue[incBFSHead++];
		u_out = numVertices + u_in;
		uDistTarget = distToTarget[u_in];
		uParent = vertexParent[u_in];

		if (uParent === 0) {
			console.log(`⭕ u_in=(${u_in % 50},${Math.floor(u_in / 50)}) has uParent=0`);
		}

		// uChild 只保留往 u_out 的边
		uChild = vertexChild[u_in];
		edgeArrayIdx = uChild << 3;
		edgeArray[edgeArrayIdx] = u_out;
		edgeArray[edgeArrayIdx + 1] = 0; // 0 代表其他边已删除

		/**
		 * 若 uParent_out 已因其他路线访问过 u_Parent 而设置过，尝试增广:
		 *  1. 采用 DFS 在 dist 相近的顶点中横向寻找增广路，首先将 u 压栈；
		 *  2. 访问栈顶顶点，将其访问次数+1，访问其相邻的 dist-1 的顶点 v：
		 *      2.1 若该顶点无 v_out ：
		 *          2.1.1 则记下当前顶点的 parent，将当前顶点的 parent 设为该顶点 v；
		 *          2.1.2 不断弹出栈，弹出时访问次数-1，将 parent 设为上一弹出顶点的 parent，直到栈为空；
		 *          2.1.3 将最外层 while 循环下一访问节点设为 v；
		 *      2.2 若该顶点已展开：
		 *          2.2.1 访问 v 的 children，若 children 有 out 且访问次数少于栈顶顶点，则将 children 压栈，进入下一轮循环；
		 *  3. 若栈顶顶点相邻的所有 dist-1 顶点 v 都有 out 且儿子都无 out，则访问栈顶顶点相邻的 dist 的顶点 v：
		 *      3.1 若该顶点无 v_out ：
		 *          3.1.1 记录栈顶顶点原始 parent，将 v 设为栈顶顶点父亲；
		 *          3.1.2 不断弹出栈，弹出时访问次数-1，将 parent 设为上一弹出顶点的 parent，直到栈为空；
		 *          3.1.3 将最外层 while 循环下一访问节点设为 v。
		 *
		 * vertexVisited[u]：0 代表周围可能有空闲 parent，1 代表值得 dfs，2 代表肯定没戏
		 *
		 */
		uParent_out = numVertices + uParent;
		if (edgeArray[uParent_out << 3]) {
			uDist = vertexDist[u_in];
			needToChangeParent = true;
			dfsCurEdgeIdx.fill(0);
			stackTopIdx = 0;
			dfsStack[stackTopIdx] = u_in;
			dfsCurEdgeIdx[stackTopIdx] = u_in << 3; // 每个顶点压栈时初始化

			while (stackTopIdx >= 0) {
				u_stackTop = dfsStack[stackTopIdx]; // 一开始是 u_in
				// 0 代表周围可能有空闲 parent
				if (vertexVisited[u_stackTop] === 0) {
					for (j = u_stackTop << 3; j < (u_stackTop + 1) << 3; j++) {
						v = distCappedEdgeArray[j];
						if (v === 0) break;
						// 若 v 已展开，跳过
						if (edgeArray[(v + numVertices) << 3]) {
							if (distToTarget[v] === 0) {
								console.log(`⛔ERROR: v(${v % 50},${Math.floor(v / 50)}) 已展开，distToTarget[v]=0, vChild=(${vertexChild[v] % 50},${Math.floor(vertexChild[v] / 50)})`);
							}
							continue;
						}
						// 若 v 和 u 同 dist，则只考虑周围有 dist-1 格子未展开的 v. 注释掉获得更优解
						if (vertexDist[v] === vertexDist[u_stackTop]) {
							vDist = vertexDist[v];
							noMinorDist = true;
							for (k = v << 3; k < (v + 1) << 3; k++) {
								w = distCappedEdgeArray[k];
								if (w === 0 || vertexDist[w] === vDist) break;
								if (!edgeArray[(w + numVertices) << 3]) {
									noMinorDist = false;
									break;
								}
							}
							if (noMinorDist) continue;
						}
						// 否则 v 可以作为 parent
						if (v < 2) {
							rv?.text('v<2', u_stackTop % 50, Math.floor(u_stackTop / 50), { color: '#00ff00', opacity: 1, font: 0.6 });
							console.log('⛔ERROR: v<2', u_stackTop % 50, Math.floor(u_stackTop / 50), v);
						}
						u_in = u_stackTop; // 供最外层把 uParent 入队时使用
						uParent = v; // 供最外层把 uParent 入队时使用
						uParent_out = numVertices + uParent; // 供最外层把 uParent 入队时使用

						// 弹出栈直到栈空
						do {
							tempParent = vertexParent[u_stackTop];
							vertexParent[u_stackTop] = v;
							vertexChild[v] = u_stackTop;
							distToTarget[v] = distToTarget[u_stackTop] + 1;

							v = tempParent;
							parentVisited[v] = 0; // 清空 parent 的访问次数，使其下次仍然可以被 bfs
							u_stackTop = dfsStack[--stackTopIdx];
						} while (stackTopIdx >= 0);
						break; // break 的是 for 循环
					}
					// 如果成功 change parent，则不再需要 dfs
					if (stackTopIdx < 0) {
						break; // break 的是 while (stackTopIdx >= 0)
					}
					// 否则 vertexVisited[u] 设为 1，代表周围不可能有空闲 parent
					vertexVisited[u_stackTop] = 1;
				}
				// 能走到这里意味着 vertexVisited[u] === 1，代表值得 dfs. vertexVisited[u] === 2 的不会入栈.
				if (vertexVisited[u_stackTop] !== 1) {
					rv?.text('visited>1', u_stackTop % 50, Math.floor(u_stackTop / 50), { color: '#00ff00', opacity: 1, font: 0.6 });
					console.log(`⛔ERROR: visited==${vertexVisited[u_stackTop]}>1 {x:${u_stackTop % 50}, y:${Math.floor(u_stackTop / 50)}}, stackTopIdx:${stackTopIdx}, u_in:{x:${u_in % 50}, y:${Math.floor(u_in / 50)}}`);
				}
				for (j = dfsCurEdgeIdx[stackTopIdx]; j < (u_stackTop + 1) << 3; j++) {
					v = distCappedEdgeArray[j];

					if (v === 0) break;
					if (parentVisited[v] === 1) continue;
					if (vertexParent[v] === u_stackTop) continue; // u 的儿子不能作为 u 父亲
					if (distToTarget[v] <= uDistTarget && vertexDist[v] >= uDist) continue; // 只允许与 u_in 同一层级的 vChild 入栈
					vChild = vertexChild[v];
					if (vChild === u_stackTop) {
						console.log(`‼️Error: vChild===u_stackTop {x:${vChild % 50}, y:${Math.floor(vChild / 50)}}, stackTopIdx:${stackTopIdx}, u_in:{x:${u_in % 50}, y:${Math.floor(u_in / 50)}}`);
					}
					// 若 v 的 child 可能有戏，压栈
					if (vertexVisited[vChild] <= 1) {
						parentVisited[v] = 1; // 作为 parent 被访问过，在同一次 bfs 中不会被重复访问
						dfsCurEdgeIdx[stackTopIdx] = j + 1; // 当前弧优化
						dfsStack[++stackTopIdx] = vChild;
						dfsCurEdgeIdx[stackTopIdx] = vChild << 3;
						break;
					}
				}
				// 肯定没戏
				if (v === 0 || j === (u_stackTop + 1) << 3) {
					vertexVisited[u_stackTop] = 2;
					stackTopIdx--;
				}
			}
		}
		// 正常把 uParent 入队
		if (!edgeArray[uParent_out << 3] && vertexDist[uParent] > minDist) {
			edgeArrayIdx = uParent << 3;
			edgeArray.set(edgeArray.subarray(edgeArrayIdx, edgeArrayIdx + 8), uParent_out << 3);
			edgeArray[edgeArrayIdx] = 0; // 0 代表其他边已删除
			incBFSQueue[incBFSTail++] = uParent;
			distToTarget[uParent] = uDistTarget + 1;
			vertexChild[uParent] = u_in;
		}
	}
}

/**
 * 在 edgeArray 上 bfs 找到所有被割开的顶点
 *
 * @param startPoses 源位置数组
 * @param numVerticesAdjacentToTarget 汇点的邻接顶点数
 */
function findCutVertices(startPoses: Position[], numVerticesAdjacentToTarget: number): Position[] {
	let u: number, v: number, u_in: number, uParent: number, edgeArrayIdx: number;

	// 标记从源点开始 bfs 访问到的顶点
	queueHead = 0;
	queueTail = 0;
	for (const pos of startPoses) {
		u = pos.y * 50 + pos.x;
		bfsQueue[queueTail++] = u;
		vertexVisited[u] = 1;
	}
	while (queueHead < queueTail) {
		u = bfsQueue[queueHead++];
		edgeArrayIdx = u << 3; // u 的出边在 edgeArray 中的起始位置
		for (let i = edgeArrayIdx; i < edgeArrayIdx + 8; i++) {
			v = edgeArray[i];
			// 0 代表不再有其他边
			if (v === 0) {
				break;
			}
			// 已访问，跳过
			if (vertexVisited[v]) {
				continue;
			}
			vertexVisited[v] = 1;
			bfsQueue[queueTail++] = v;
		}
	}

	// 从汇点开始找到所有被割开的顶点
	let cutVertices: Position[] = [];
	for (let i = 0; i < numVerticesAdjacentToTarget; i++) {
		u_in = vertexAdjacentToTarget[i];
		uParent = vertexParent[u_in];
		// 循环直到 u_in 为源点或 u_in 被其他路线访问过
		while (uParent !== 1) {
			vertexParent[u_in] = 1; // 标记 u_in 已被访问
			if (vertexVisited[u_in]) {
				cutVertices.push({ x: u_in % 50, y: Math.floor(u_in / 50) });
				break;
			}

			u_in = uParent;
			uParent = vertexParent[u_in];
		}
	}
	return cutVertices;
}

/**
 * 主函数：最小割算法
 *
 * @param terrain 房间地形
 * @param startPoses 源位置数组
 * @param targetPoses 汇位置数组
 * @param rv 房间可视化对象
 * @param minDist 最小距离
 * @param maxDist 最大距离
 */
export function minCut(terrain: Uint8Array, startPoses: Position[], targetPoses: Position[], rv: RoomVisual | null = null, minDist: number = MIN_DIST, maxDist: number = MAX_DIST): Position[] {
	minDist = minDist || MIN_DIST;
	maxDist = maxDist || MAX_DIST;

	vertexParent.fill(0);
	vertexChild.fill(0);
	vertexNumChildren.fill(0);
	vertexAdjacentToTarget.fill(0);
	edgeArray.fill(0);
	vertexDist.fill(0);
	distCappedEdgeArray.fill(0);
	parentVisited.fill(0);
	vertexVisited.fill(0);
	distToTarget.fill(0);

	let numVerticesAdjacentToTarget = bfs(terrain, startPoses, targetPoses, rv, maxDist);
	increFlow(numVertices, numVerticesAdjacentToTarget, rv, minDist);

	vertexVisited.fill(0); // 重置访问标记
	let cutVertices = findCutVertices(startPoses, numVerticesAdjacentToTarget);

	return cutVertices;
}

/**
 * 参数 rampartPos 必须是最近一次 minCut 产生的。
 * 利用尚未删除的 minCut 过程中信息，快速得到所有可能的塔放位置、敌人位置、rampart 分组。
 *
 * @param rampartPos rampart 位置数组
 * @param rv 房间可视化对象
 */
export function getTowerCandidatePoses(rampartPos: Position[], rv: RoomVisual | null = null): MinCutResult {
	let towerCandidatePoses: TowerCandidatePoses = {}, enermyPoses: Position[] = [], rampartGroups: Position[][] = [];
	let x: number, y: number, u: number, u_in: number, u_out: number, v_in: number, vx: number, vy: number, i: number, j: number, towerCount = 0;
	let nextDist: number, lastDist: number, edgeArrayIdx: number;

	for (let x = 0; x <= 49; x++) {
		towerCandidatePoses[x] = {};
	}

	/**
	 * 从 rampartPos 向内找 tower 位置
	 * vertexVisited 是 findCutVertices() 留下的，被 rampart 围住的区域以及 rampartPos 是 1， 外侧是 0
	 */
	queueHead = 0;
	queueTail = 0;
	vertexDist.fill(0);
	for (const pos of rampartPos) {
		x = pos.x;
		y = pos.y;
		u_in = y * 50 + x;
		vertexVisited[u_in] = 3;
		bfsQueue[queueTail++] = u_in;
	}
	lastDist = 0;
	while (queueHead < queueTail) {
		u = bfsQueue[queueHead++];
		nextDist = vertexDist[u] + 1;
		if (nextDist !== lastDist && nextDist >= 6) {
			if (towerCount >= 12) {
				// 保留2倍的可选位置
				break;
			}
			lastDist = nextDist;
		}
		edgeArrayIdx = edgeArray[(u + numVertices) << 3] ? (u + numVertices) << 3 : u << 3;
		for (i = edgeArrayIdx; i < edgeArrayIdx + 8; i++) {
			v_in = edgeArray[i];
			if (v_in === 0) {
				break;
			}
			if (v_in > numVertices) {
				console.log(`❌Error: edgeArray u:${u}, v_in:${v_in}`);
				v_in -= numVertices;
			}
			if (vertexVisited[v_in] === 1) {
				vertexVisited[v_in] = 2;
				bfsQueue[queueTail++] = v_in;
				vertexDist[v_in] = nextDist;
				if (nextDist >= 4) {
					towerCount++;
					vx = v_in % 50;
					vy = Math.floor(v_in / 50);
					towerCandidatePoses[vx][vy] = 1;
				}
			}
		}
	}

	/**
	 * 从每个未访问的 rampartPos 开始 BFS，找到所有与它相连的 rampartPos，实现分组
	 */
	for (const pos of rampartPos) {
		x = pos.x;
		y = pos.y;
		u_in = y * 50 + x;
		if (vertexVisited[u_in] === 3) {
			queueHead = 0;
			queueTail = 0;
			bfsQueue[queueTail++] = u_in + numVertices;
			vertexVisited[u_in] = 4;
			let curGroup: Position[] = [];
			curGroup.push(pos);
			while (queueHead < queueTail) {
				u_out = bfsQueue[queueHead++];
				for (i = u_out << 3; i < (u_out + 1) << 3; i++) {
					v_in = edgeArray[i];
					if (v_in === 0) {
						break;
					}
					if (v_in > numVertices) {
						console.log(`❌Error: edgeArray u_out:${u_out}, v_in:${v_in}`);
						v_in -= numVertices;
					}
					if (vertexVisited[v_in] === 3) {
						vertexVisited[v_in] = 4;
						bfsQueue[queueTail++] = v_in + numVertices;
						curGroup.push({ x: v_in % 50, y: Math.floor(v_in / 50) });
					}
				}
			}
			rampartGroups.push(curGroup);
		}
		// 不管有没有被 bfs 访问，都要找它的外围点作为 enemyPos
		v_in = vertexChild[u_in];
		if (vertexChild[u_in] === 0) {
			// 直接接触到房间出口的情况，直接指定外围点
			if (x == 2) {
				v_in = u_in - 1;
			} else if (x == 47) {
				v_in = u_in + 1;
			} else if (y == 2) {
				v_in = u_in - 50;
			} else if (y == 47) {
				v_in = u_in + 50;
			}
		}
		if (v_in !== 0) {
			vx = v_in % 50;
			vy = Math.floor(v_in / 50);
			enermyPoses.push({ x: vx, y: vy });
		}
	}

	let filteredEnermyPoses: Position[] = [];
	enermyPoses.sort((a, b) => a.x - b.x || a.y - b.y);
	vx = vy = -10;
	for (const pos of enermyPoses) {
		x = pos.x;
		y = pos.y;
		if (x - vx < 3 && vx - x < 3 && y - vy < 3 && vy - y < 3) {
			continue;
		}
		filteredEnermyPoses.push(pos);
		vx = x;
		vy = y;
	}
	enermyPoses = [];
	filteredEnermyPoses.sort((a, b) => a.y - b.y || a.x - b.x);
	vx = vy = -10;
	for (const pos of filteredEnermyPoses) {
		x = pos.x;
		y = pos.y;
		if (x - vx < 3 && vx - x < 3 && y - vy < 3 && vy - y < 3) {
			continue;
		}
		enermyPoses.push(pos);
		vx = x;
		vy = y;
	}

	return { towerCandidatePoses, enermyPoses, rampartGroups };
}

export function getVisitedAndDist(): VisitedAndDist {
	return { vertexVisited, vertexDist };
}
