// @ts-nocheck
import { PriorityQueue, NewNode } from '@/modules/utils/priorityQueue'
import { RoomArray } from '@/modules/utils/roomArray'
import LayoutVisual from '@/modules/feature/planner/layoutVisual'
import {
	computeBlockByWasm,
	findLabAnchorByWasm,
	getBlockPutAbleCountByWasm,
	isComputeBlockWasmEnabled
} from '@/modules/utils/plannerKernelWasm'

class UnionFind {
	constructor(size) {
		this.size = size;
	}
	init() {
		if (!this.parent) this.parent = new Array(this.size);
		for (let i = 0; i < this.size; i++) {
			this.parent[i] = i;
		}
	}
	find(x) {
		let r = x;
		while (this.parent[r] != r) r = this.parent[r];
		while (this.parent[x] != x) {
			const t = this.parent[x];
			this.parent[x] = r;
			x = t;
		}
		return x;
	}
	union(a, b) {
		a = this.find(a);
		b = this.find(b);
		if (a > b) this.parent[a] = b;
		else if (a != b) this.parent[b] = a;
	}
	same(a, b) {
		return this.find(a) == this.find(b);
	}
}

global.UnionFind = UnionFind;
// global.NewNode = NewNode

const minPlaneCnt = 140; // 内部布局最小面积！ 试过了，140是 基本上最低配置了

let visited = new RoomArray();
let roomWalkable = new RoomArray();
let nearWall = new RoomArray();
let routeDistance = new RoomArray();
let roomObjectCache = new RoomArray();

let nearWallWithInterpolation = new RoomArray();
let interpolation = new RoomArray();

let queMin = new PriorityQueue(true);
let queMin2 = new PriorityQueue(true);
let startPoint = new PriorityQueue(true);

let unionFind = new UnionFind(50 * 50);

/**
 * controller mineral source posList
 */
let objects = [];

const wasmProfile = {
	// 收益相对稳定，保留
	computeBlock: true,
	// 该路径调用频率高，跨边界+拷贝成本可能反超，默认关闭
	putAbleCount: false,
	// 单次扫描规模较小，默认关闭
	labAnchor: false
};

const wasmBuf = {
	walkable: new Uint8Array(2500),
	score: new Float32Array(2500),
	route: new Int16Array(2500),
	blocked: new Uint8Array(2500),
	parent: new Int32Array(2500),
	manor: new Int16Array(2500)
};

let fastVisitStamp = new Uint16Array(2500);
let fastManorStamp = new Uint16Array(2500);
let fastQueue = new Int16Array(2500);
let fastStampToken = 1;
let nearMinCostCache = new Uint16Array(2500);
const DIR4 = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1]
];

const ManagerPlanner = {
	/**
	 * https://www.bookstack.cn/read/node-in-debugging/2.2heapdump.md
	 * 防止内存泄漏！！！！
	 */
	init() {
		visited = new RoomArray();
		roomWalkable = new RoomArray();
		nearWall = new RoomArray();
		routeDistance = new RoomArray();

		nearWallWithInterpolation = new RoomArray();
		interpolation = new RoomArray();
		roomObjectCache = new RoomArray();

		queMin = new PriorityQueue(true);
		queMin2 = new PriorityQueue(true);
		startPoint = new PriorityQueue(true);

		unionFind = new UnionFind(50 * 50);

		visited.init();
		nearWall.init();
		routeDistance.init();
		roomWalkable.init();

		nearWallWithInterpolation.init();
		interpolation.init();
		roomObjectCache.init();
		unionFind.init();

		queMin.clear();
		queMin2.clear();
		startPoint.clear();
	},
	/**
	 * 防止内存泄漏！！！！
	 */
	dismiss() {
		visited = null;
		roomWalkable = null;
		nearWall = null;
		routeDistance = null;
		roomObjectCache = null;

		nearWallWithInterpolation = null;
		interpolation = null;

		queMin = null;
		queMin2 = null;
		startPoint = null;

		unionFind = null;
		objects = [];
	},

	createObjects() {
		if (!visited) visited = new RoomArray();
		if (!roomWalkable) roomWalkable = new RoomArray();
		if (!nearWall) nearWall = new RoomArray();
		if (!routeDistance) routeDistance = new RoomArray();
		if (!roomObjectCache) roomObjectCache = new RoomArray();
		if (!nearWallWithInterpolation) nearWallWithInterpolation = new RoomArray();
		if (!interpolation) interpolation = new RoomArray();
		if (!queMin) queMin = new PriorityQueue(true);
		if (!queMin2) queMin2 = new PriorityQueue(true);
		if (!startPoint) startPoint = new PriorityQueue(true);
		if (!unionFind) unionFind = new UnionFind(50 * 50);
	},
	/**
	 * 计算区块的最大性能指标 ，性能消耗的大头！
	 * 优化不动了
	 */
	getBlockPutAbleCnt(roomWalkable, visited, queMin, unionFind, tarRoot, putAbleCacheMap, AllCacheMap) {
		if (putAbleCacheMap[tarRoot]) return [putAbleCacheMap[tarRoot], AllCacheMap[tarRoot]];
		// let t = Game.cpu.getUsed() //这很吃性能，但是是必须的
		const roomManor = routeDistance;
		if (!roomManor) return;
		roomManor.init();
		const roomManorArr = roomManor.arr;
		const walkArr = roomWalkable.arr;
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				const idx = x * 50 + y;
				if (tarRoot == unionFind.find(idx)) roomManorArr[idx] = 1;
			}
		}
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				const idx = x * 50 + y;
				if (!roomManorArr[idx]) continue;
				let manorCnt = 0;
				let wallCnt = 0;
				for (let i = 0; i < 4; i++) {
					const dx = DIR4[i][0];
					const dy = DIR4[i][1];
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					const nidx = nx * 50 + ny;
					if (roomManorArr[nidx]) manorCnt += 1;
					if (!walkArr[nidx]) wallCnt += 1;
				}
				if (manorCnt == 1 && wallCnt == 0) roomManorArr[idx] = 0;
			}
		}
		const dfsMoreManor = function (x, y, val) {
			const idx = x * 50 + y;
			if (!val && walkArr[idx]) {
				let manorCnt = 0;
				let wallCnt = 0;
				for (let i = 0; i < 4; i++) {
					const dx = DIR4[i][0];
					const dy = DIR4[i][1];
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					const nidx = nx * 50 + ny;
					if (roomManorArr[nidx]) manorCnt += 1;
					if (!walkArr[nidx]) wallCnt += 1;
				}
				if (manorCnt >= 2 || (manorCnt == 1 && wallCnt >= 2)) {
					roomManorArr[idx] = 1;
					for (let i = 0; i < 4; i++) {
						const dx = DIR4[i][0];
						const dy = DIR4[i][1];
						const nx = x + dx;
						const ny = y + dy;
						if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
						dfsMoreManor(nx, ny, roomManorArr[nx * 50 + ny]);
					}
				}
			}
		};
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				dfsMoreManor(x, y, roomManorArr[x * 50 + y]);
			}
		}
		const clearBorderNear = (x, y) => {
			const idx = x * 50 + y;
			if (!walkArr[idx]) return;
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					roomManorArr[nx * 50 + ny] = 0;
				}
			}
			roomManorArr[idx] = 0;
		};
		for (let y = 0; y < 50; y++) {
			clearBorderNear(0, y);
			clearBorderNear(49, y);
		}
		for (let x = 1; x < 49; x++) {
			clearBorderNear(x, 0);
			clearBorderNear(x, 49);
		}

		const innerPutAbleList = [];
		const AllCacheList = [];

		visited.init();
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				const idx = x * 50 + y;
				if (!roomManorArr[idx]) {
					const val = walkArr[idx];
					queMin.push(NewNode(val ? -4 : -1, x, y));
					// visited.set(x,y,1) 这里不能设置visited 因为 -4 和-1 优先级不同 如果 -4距离和-1比较，-1会抢走-4 导致 rangeAttack打得到
				}
			}
		}

		// let t = Game.cpu.getUsed() //这很吃性能，真的优化不动了

		queMin.whileNoEmpty((nd) => {
			visited.set(nd.x, nd.y, 1);
			if (nd.k >= -1) {
				for (let i = 0; i < 4; i++) {
					const dx = DIR4[i][0];
					const dy = DIR4[i][1];
					const x = nd.x + dx;
					const y = nd.y + dy;
					if (x < 0 || x > 49 || y < 0 || y > 49) continue;
					const idx = x * 50 + y;
					const val = walkArr[idx];
					const item = NewNode(nd.k + 2, x, y);
					if (!visited.exec(x, y, 1)) {
						queMin.push(NewNode(nd.k + 1, x, y));
						if (roomManorArr[idx]) {
							if (nd.k + 1 >= 0 && val) {
								innerPutAbleList.push(item);
								// visual.text(nd.k+2, x,y+0.25, {color: 'red',opacity:0.99,font: 7})
							}
							if (val) AllCacheList.push(item);
						}
					}
				}
			} else {
				for (let dx = -1; dx <= 1; dx++) {
					for (let dy = -1; dy <= 1; dy++) {
						if (!dx && !dy) continue;
						const x = nd.x + dx;
						const y = nd.y + dy;
						if (x < 0 || x > 49 || y < 0 || y > 49) continue;
						const idx = x * 50 + y;
						const val = walkArr[idx];
						const item = NewNode(nd.k + 2, x, y);
						if (!visited.exec(x, y, 1)) {
							queMin.push(NewNode(nd.k + 1, x, y));
							if (roomManorArr[idx]) {
								if (nd.k + 1 >= 0 && val) {
									innerPutAbleList.push(item);
									// visual.text(nd.k+2, x,y+0.25, {color: 'red',opacity:0.99,font: 7})
								}
								if (val) AllCacheList.push(item);
							}
						}
					}
				}
			}
		});

		// console.log(Game.cpu.getUsed()-t)

		putAbleCacheMap[tarRoot] = innerPutAbleList;
		AllCacheMap[tarRoot] = AllCacheList;
		return [putAbleCacheMap[tarRoot], AllCacheMap[tarRoot]];
	},
	getBlockPutAbleCntCount(roomWalkable, unionFind, tarRoot, putAbleCacheMap, allCacheMap, putAbleCntCacheMap) {
		const root = Number(tarRoot);
		if (putAbleCntCacheMap[root] != null) return putAbleCntCacheMap[root];
		if (wasmProfile.putAbleCount && isComputeBlockWasmEnabled()) {
			const walkableU8 = wasmBuf.walkable;
			const parentI32 = wasmBuf.parent;
			const walkArr = roomWalkable.arr;
			const parentArr = unionFind.parent;
			for (let i = 0; i < 2500; i++) {
				walkableU8[i] = walkArr[i] ? 1 : 0;
				parentI32[i] = parentArr[i];
			}
			const wasmCount = getBlockPutAbleCountByWasm(walkableU8, parentI32, root);
			if (wasmCount >= 0) {
				putAbleCntCacheMap[root] = wasmCount;
				return wasmCount;
			}
		}
		const cnt = ManagerPlanner.getBlockPutAbleCnt(
			roomWalkable,
			visited,
			queMin2,
			unionFind,
			root,
			putAbleCacheMap,
			allCacheMap
		)[0].length;
		putAbleCntCacheMap[root] = cnt;
		return cnt;
	},
	/**
	 * 插值，计算区块的预处理和合并需求
	 * @param roomName
	 */
	computeBlock(roomName, blocked?) {
		ManagerPlanner.createObjects();
		const visual = new RoomVisual(roomName);

		roomWalkable.initRoomTerrainWalkAble(roomName);

		//计算距离山体要多远
		roomWalkable.forEach((x, y, val) => {
			if (!val) {
				queMin.push(NewNode(0, x, y));
				visited.set(x, y, 1);
			}
		});
		queMin.whileNoEmpty((nd) => {
			roomWalkable.for4Direction(
				(x, y, val) => {
					if (!visited.exec(x, y, 1) && val) {
						queMin.push(NewNode(nd.k + 1, x, y));
					}
				},
				nd.x,
				nd.y
			);
			nearWall.exec(nd.x, nd.y, nd.k);
		});

		//距离出口一格不能放墙
		roomWalkable.forBorder((x, y, val) => {
			if (val) {
				roomWalkable.forNear(
					(x, y, val) => {
						if (val) {
							// roomWalkable.set(x,y,0);
							nearWall.set(x, y, 50);
							queMin.push(NewNode(0, x, y));
							// visited.set(x,y,1)
						}
					},
					x,
					y
				);
				// roomWalkable.set(x,y,0);
				queMin.push(NewNode(0, x, y));
				nearWall.set(x, y, 50);
				// visited.set(x,y,1)
			}
		});

		const roomPutAble = routeDistance;
		roomPutAble.initRoomTerrainWalkAble(roomName);
		roomWalkable.forBorder((x, y, val) => {
			if (val) {
				roomWalkable.forNear(
					(x, y, val) => {
						if (val) {
							roomPutAble.set(x, y, 0);
						}
					},
					x,
					y
				);
				roomPutAble.set(x, y, 0);
			}
		});
		// 计算 控制器，矿物的位置
		const getObjectPos = function (x, y, struct) {
			let put = false;
			let finalX = 0;
			let finalY = 0;
			roomPutAble.for4Direction(
				(x, y, val) => {
					if (val && !put && !roomObjectCache.get(x, y)) {
						finalX = x;
						finalY = y;
						put = true;
					}
				},
				x,
				y
			);
			roomPutAble.forNear(
				(x, y, val) => {
					if (val && !put && !roomObjectCache.get(x, y)) {
						finalX = x;
						finalY = y;
						put = true;
					}
				},
				x,
				y
			);
			roomObjectCache.set(finalX, finalY, struct);
			return [finalX, finalY];
		};
		for (let i = 0; i < objects.length; i++) {
			const pos = objects[i];
			//container 位置
			const p = getObjectPos(pos.x, pos.y, 'container');

			// link 位置
			if (i != 1) {
				const linkPos = getObjectPos(p[0], p[1], 'link');
				roomObjectCache.link = roomObjectCache.link || [];
				roomObjectCache.link.push(linkPos); // link controller 然后是  source
			} else {
				roomObjectCache.extractor = [[pos.x, pos.y]];
			}
			roomObjectCache.container = roomObjectCache.container || [];
			if (i != 1) roomObjectCache.container.unshift(p); //如果是 mineral 最后一个
			else roomObjectCache.container.push(p);
		}

		//插值，这里用拉普拉斯矩阵，对nearWall 插值 成 nearWallWithInterpolation
		nearWall.forEach((x, y, val) => {
			let value = -4 * val;
			nearWall.for4Direction(
				(x, y, val) => {
					value += val;
				},
				x,
				y
			);
			interpolation.set(x, y, value);
			if (value > 0) value = 0;
			if (val && roomWalkable.get(x, y)) nearWallWithInterpolation.set(x, y, val + value * 0.1);
		});

		if (blocked) {
			blocked.forEach((x, y, val) => {
				if (val) nearWallWithInterpolation.set(x, y, 0);
			});
		}

		// 计算距离出口多远
		visited.init();
		routeDistance.init();
		queMin.whileNoEmpty((nd) => {
			roomWalkable.forNear(
				(x, y, val) => {
					if (!visited.exec(x, y, 1) && val) {
						queMin.push(NewNode(nd.k + 1, x, y));
					}
				},
				nd.x,
				nd.y
			);
			routeDistance.set(nd.x, nd.y, nd.k);
		});

		const putAbleCacheMap = {};
		const allCacheMap = {};
		const putAbleCntCacheMap = {};
		const sizeMap = {};
		if (wasmProfile.computeBlock && isComputeBlockWasmEnabled()) {
			const walkableU8 = wasmBuf.walkable;
			const scoreF32 = wasmBuf.score;
			const routeI16 = wasmBuf.route;
			const blockedU8 = blocked ? wasmBuf.blocked : undefined;
			const walkArr = roomWalkable.arr;
			const scoreArr = nearWallWithInterpolation.arr;
			const routeArr = routeDistance.arr;
			const blockedArr = blocked?.arr;
			for (let i = 0; i < 2500; i++) {
				walkableU8[i] = walkArr[i] ? 1 : 0;
				scoreF32[i] = scoreArr[i] || 0;
				routeI16[i] = routeArr[i] || 0;
				if (blockedU8) blockedU8[i] = blockedArr[i] ? 1 : 0;
			}
			const wasmResult = computeBlockByWasm(walkableU8, scoreF32, routeI16, blockedU8);
			if (wasmResult) {
				unionFind.parent = Array.from(wasmResult.parent);
				for (let i = 0; i < 2500; i++) {
					if (wasmResult.size[i] > 0) sizeMap[i] = wasmResult.size[i];
				}
				roomWalkable.forEach((x, y, val) => {
					if (typeof val === 'number' && val > 0 && sizeMap[unionFind.find(x * 50 + y)] > 0)
						visual.circle(x, y, {
							fill: LayoutVisual.randomColor(unionFind.find(x * 50 + y).toString()),
							radius: 0.5,
							opacity: 0.15
						});
				});
				return [unionFind, sizeMap, roomWalkable, nearWall, putAbleCacheMap, allCacheMap];
			}
		}

		// 对距离的格子插入到队列 ，作为分开的顺序
		routeDistance.forEach((x, y, val) => {
			if (!roomWalkable.get(x, y)) return;
			if (val) startPoint.push(NewNode(-val, x, y));
		});
		const posSeqMap = {};

		// 分块，将地图分成一小块一小块
		visited.init();
		for (let i = 0; i < 2500; i++) {
			if (startPoint.isEmpty()) break;
			let cnt = 0;
			// let color = randomColor(i)
			const nd = startPoint.pop();
			const currentPos = nd.x * 50 + nd.y;
			if (blocked && blocked.get(nd.x, nd.y)) {
				unionFind.union(currentPos, 0);
				continue;
			}
			const posSeq = [];

			// 迭代版 DFS：mode 0=up, 1=down; phase 0=pre, 1=post
			const stack = [[nd.x, nd.y, 0, 0]];
			while (stack.length) {
				const frame = stack.pop();
				const x = frame[0];
				const y = frame[1];
				const mode = frame[2];
				const phase = frame[3];
				if (!phase) {
					if (visited.exec(x, y, 1)) continue;
					const currentValue = nearWallWithInterpolation.get(x, y);
					stack.push([x, y, mode, 1]);
					if (!mode) {
						nearWallWithInterpolation.forNear(
							(x1, y1, val) => {
								if (val > currentValue && currentValue < 6) {
									//加了一点优化，小于时分裂更多
									stack.push([x1, y1, 0, 0]);
								} else if (val && val < currentValue) {
									stack.push([x1, y1, 1, 0]);
								}
							},
							x,
							y
						);
					} else {
						nearWallWithInterpolation.for4Direction(
							(x1, y1, val) => {
								if (val && val < currentValue) stack.push([x1, y1, 1, 0]);
							},
							x,
							y
						);
					}
					continue;
				}

				// post-order 阶段，保持与递归版一致的合并时机
				const pos = x * 50 + y;
				if (unionFind.find(pos) && unionFind.find(currentPos) && (!blocked || !blocked.get(x, y))) {
					unionFind.union(currentPos, pos);
					posSeq.push(pos);
					cnt++;
				} else if (blocked) {
					unionFind.union(pos, 0);
				}
			}

			//记录每一块的位置和大小 以 并查集的根节点 作为记录点
			if (cnt > 0) {
				const pos = unionFind.find(currentPos);
				// queMin.push({k:cnt,v:pos})
				queMin.push(NewNode(cnt, 0, 0, pos));
				sizeMap[pos] = cnt;
				posSeqMap[pos] = posSeq;
			}
		}

		// 将出口附近的块删掉
		roomWalkable.forBorder((x, y, val) => {
			if (val) {
				roomWalkable.forNear(
					(x, y, val) => {
						if (val) {
							const pos = unionFind.find(x * 50 + y);
							if (sizeMap[pos]) delete sizeMap[pos];
						}
					},
					x,
					y
				);
				const pos = unionFind.find(x * 50 + y);
				if (sizeMap[pos]) delete sizeMap[pos];
			}
		});
		delete sizeMap[0];

		// let i = 0
		// 合并小块成大块的
		queMin.whileNoEmpty((nd) => {
			const pos = nd.v;
			if (nd.k != sizeMap[pos]) return; // 已经被合并了
			// i++;

			visited.init();
			const nearCntMap = {};

			//搜索附近的块
			posSeqMap[pos].forEach((e) => {
				const y = e % 50;
				const x = (e - y) / 50; //Math.round
				roomWalkable.forNear(
					(x, y, val) => {
						if (val && !visited.exec(x, y, 1)) {
							const currentPos = unionFind.find(x * 50 + y);
							if (currentPos == pos) return;
							// if(i==104)
							// visual.text(parseInt(1*10)/10, x,y+0.25, {color: "cyan",opacity:0.99,font: 7})
							const currentSize = sizeMap[currentPos];
							if (currentSize < 300) {
								nearCntMap[currentPos] = (nearCntMap[currentPos] || 0) + 1;
							}
						}
					},
					x,
					y
				);
			});

			let targetPos = undefined;
			let nearCnt = 0;
			let maxRatio = 0;

			// 找出合并附近最优的块
			for (const currentPos in nearCntMap) {
				const currentRatio = nearCntMap[currentPos] / Math.sqrt(Math.min(sizeMap[currentPos], nd.k)); //实际/期望
				if (currentRatio == maxRatio ? sizeMap[currentPos] < sizeMap[targetPos] : currentRatio > maxRatio) {
					targetPos = currentPos;
					maxRatio = currentRatio;
					nearCnt = nearCntMap[currentPos];
				}
			}
			for (const currentPos in nearCntMap) {
				if (nearCnt < nearCntMap[currentPos]) {
					targetPos = currentPos;
					nearCnt = nearCntMap[currentPos];
				}
			}
			if (!targetPos) return;
			const minSize = sizeMap[targetPos];
			const cnt = nd.k + minSize;
			// let nearRatio =nearCntMap[targetPos]/allNearCnt;

			let targetBlockPutAbleCnt = 0;
			let ndkBlockPutAbleCnt = 0;
			if (minSize > minPlaneCnt)
				targetBlockPutAbleCnt = ManagerPlanner.getBlockPutAbleCntCount(
					roomWalkable,
					unionFind,
					targetPos,
					putAbleCacheMap,
					allCacheMap,
					putAbleCntCacheMap
				);
			if (nd.k > minPlaneCnt)
				ndkBlockPutAbleCnt = ManagerPlanner.getBlockPutAbleCntCount(
					roomWalkable,
					unionFind,
					nd.v,
					putAbleCacheMap,
					allCacheMap,
					putAbleCntCacheMap
				);

			// 合并
			if (targetPos && Math.max(targetBlockPutAbleCnt, ndkBlockPutAbleCnt) < minPlaneCnt) {
				unionFind.union(pos, targetPos);
				nd.v = unionFind.find(pos);

				if (pos != nd.v) delete sizeMap[pos];
				else delete sizeMap[targetPos];

				nd.k = cnt;
				sizeMap[nd.v] = cnt;
				const targetSeq = posSeqMap[targetPos];
				const currentSeq = posSeqMap[pos];
				const mergedSeq = new Array(targetSeq.length + currentSeq.length);
				let mergedIdx = 0;
				for (let i = 0; i < targetSeq.length; i++) mergedSeq[mergedIdx++] = targetSeq[i];
				for (let i = 0; i < currentSeq.length; i++) mergedSeq[mergedIdx++] = currentSeq[i];
				posSeqMap[nd.v] = mergedSeq;
				delete putAbleCacheMap[nd.v];
				delete putAbleCacheMap[targetPos];
				delete putAbleCntCacheMap[nd.v];
				delete putAbleCntCacheMap[targetPos];
				delete putAbleCntCacheMap[pos];
				if (pos != nd.v) delete posSeqMap[pos];
				else delete posSeqMap[targetPos];
				queMin.push(NewNode(nd.k, nd.x, nd.y, nd.v));
			}
		});
		// 打印结果

		roomWalkable.forEach((x, y, val) => {
			if (typeof val === 'number' && val > 0 && sizeMap[unionFind.find(x * 50 + y)] > 0)
				visual.circle(x, y, {
					fill: LayoutVisual.randomColor(unionFind.find(x * 50 + y).toString()),
					radius: 0.5,
					opacity: 0.15
				});
		});

		// 打印中间变量
		return [unionFind, sizeMap, roomWalkable, nearWall, putAbleCacheMap, allCacheMap];
	},
	/**
	 * 计算 分布图
	 * 计算建筑的位置
	 * @param roomName,
	 * @param points [flagController,flagMineral,flagSourceA,flagSourceB]
	 * @return result { roomName:roomName,storagePos:{x,y},labPos:{x,y},structMap:{ "rampart" : [[x1,y1],[x2,y2] ...] ...} }
	 */
	computeManor(roomName, points, fixedCenter?, blocked?) {
		ManagerPlanner.init();
		for (const p of points) {
			if (p && p.roomName == roomName) objects.push(p);
		}
		// const visual = new RoomVisual(roomName);
		const blockArray = ManagerPlanner.computeBlock(roomName, blocked);
		const unionFind = blockArray[0];
		const sizeMap = blockArray[1];
		const wallMap = {};
		const roomWalkable = blockArray[2];
		const nearWall = blockArray[3];
		const putAbleCacheMap = blockArray[4];
		const allCacheMap = blockArray[5];

		const roomManor = interpolation;
		const roomStructs = nearWallWithInterpolation;

		roomManor.init();
		roomStructs.init();

		// let closeToWall = new RoomArray()
		nearWall.init();

		// let queMin = new PriorityQueue(true)
		queMin.clear();
		// let visited = new RoomArray()

		let finalPos = undefined;
		let wallCnt = 1e9;
		let innerPutAbleList = [];

		let centerX = undefined;
		let centerY = undefined;

		let centerPos = fixedCenter;
		if (!centerPos && Game.flags.storagePos && Game.flags.storagePos.pos.roomName == roomName) {
			centerPos = { x: Game.flags.storagePos.pos.x, y: Game.flags.storagePos.pos.y };
		}

		for (const pos in sizeMap) {
			// if(sizeMap[pos]<150)return

			ManagerPlanner.getBlockPutAbleCnt(roomWalkable, visited, queMin, unionFind, pos, putAbleCacheMap, allCacheMap);
			const currentPutAbleList = putAbleCacheMap[pos];
			const allList = allCacheMap[pos];
			const currentPutAbleLen = currentPutAbleList.length;
			if (currentPutAbleLen < minPlaneCnt) continue;

			let hasCenterPos = !centerPos;
			let sumX = 0;
			let sumY = 0;
			let gt1Cnt = 0;
			const gt2List = [];
			for (let i = 0; i < currentPutAbleLen; i++) {
				const e = currentPutAbleList[i];
				const ex = e.x;
				const ey = e.y;
				sumX += ex;
				sumY += ey;
				if (!hasCenterPos && ex == centerPos.x && ey == centerPos.y) hasCenterPos = true;
				if (e.k > 1) gt1Cnt += 1;
				if (e.k > 2) gt2List.push(e);
			}
			if (!hasCenterPos) continue;

			wallMap[pos] = [];
			// 高频路径改为索引队列，避免 PriorityQueue + callback 额外开销
			fastStampToken += 1;
			if (fastStampToken >= 65530) {
				fastStampToken = 1;
				fastVisitStamp.fill(0);
				fastManorStamp.fill(0);
			}
			const stamp = fastStampToken;
			const walkArr = roomWalkable.arr;

			for (let i = 0; i < allList.length; i++) {
				const e = allList[i];
				fastManorStamp[e.x * 50 + e.y] = stamp;
			}

			let qHead = 0;
			let qTail = 0;
			const pushBorder = (x, y) => {
				const idx = x * 50 + y;
				if (walkArr[idx] && fastVisitStamp[idx] !== stamp) {
					fastVisitStamp[idx] = stamp;
					fastQueue[qTail++] = idx;
				}
			};
			for (let y = 0; y < 50; y++) {
				pushBorder(0, y);
				pushBorder(49, y);
			}
			for (let x = 1; x < 49; x++) {
				pushBorder(x, 0);
				pushBorder(x, 49);
			}

			while (qHead < qTail) {
				const cur = fastQueue[qHead++];
				if (fastManorStamp[cur] === stamp) continue;
				const cx = (cur / 50) | 0;
				const cy = cur % 50;
				for (let dx = -1; dx <= 1; dx++) {
					for (let dy = -1; dy <= 1; dy++) {
						if (!dx && !dy) continue;
						const nx = cx + dx;
						const ny = cy + dy;
						if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
						const nidx = nx * 50 + ny;
						if (!walkArr[nidx] || fastVisitStamp[nidx] === stamp) continue;
						fastVisitStamp[nidx] = stamp;
						if (fastManorStamp[nidx] === stamp) {
							wallMap[pos].push(NewNode(0, nx, ny));
						} else {
							fastQueue[qTail++] = nidx;
						}
					}
				}
			}

			// wallMap[pos].forEach(xy=>queMin.push(NewNode(0,xy.x,xy.y)))

			const currentInnerPutAbleList = currentPutAbleList;

			let maxDist = 0;
			if (gt2List.length < 30) {
				for (let i = 0; i < gt2List.length; i++) {
					const a = gt2List[i];
					for (let j = 0; j < gt2List.length; j++) {
						const b = gt2List[j];
						const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
						if (dist > maxDist) maxDist = dist;
					}
				}
			}

			const currentWallCnt = wallMap[pos].length;
			// {
			//     let y = pos%50
			//     let x = ((pos-y)/50)//Math.round
			//     visual.text(parseInt((allList.length)*10)/10, x,y, {color: "yellow",opacity:0.99,font: 7})
			//     visual.text(parseInt((currentPutAbleList.length)*10)/10, x,y+0.5, {color: "red",opacity:0.99,font: 7})
			//     visual.text(parseInt((currentInnerPutAbleList.length)*10)/10, x,y+1, {color: "red",opacity:0.99,font: 7})
			// }
			if (
				minPlaneCnt < currentPutAbleLen &&
				wallCnt > currentWallCnt &&
				(gt1Cnt > 30 || maxDist > 5)
			) {
				// putAbleList = currentPutAbleList;
				innerPutAbleList = currentInnerPutAbleList;
				wallCnt = currentWallCnt;
				finalPos = pos;
				if (centerPos) {
					centerX = centerPos.x;
					centerY = centerPos.y;
				} else {
					centerX = sumX / currentPutAbleLen;
					centerY = sumY / currentPutAbleLen;
				}
			}

			// allCacheMap[pos].forEach(t=>{
			//     visual.circle(t.x, t.y, {fill: randomColor(pos), radius: 0.5 ,opacity : 0.15})
			// })
		}

		if (!finalPos || !putAbleCacheMap[finalPos]) return;

		const walls = wallMap[finalPos];

		roomManor.init();
		allCacheMap[finalPos].forEach((e) => {
			roomManor.set(e.x, e.y, -1);
		});
		innerPutAbleList.forEach((e) => {
			roomManor.set(e.x, e.y, e.k);
		});

		// visited.init()
		// roomWalkable.forEach((x: number, y: number, val: number | string)=>{if(!roomManor.get(x,y)){queMin.push(NewNode(val?-3:-1,x,y));visited.set(x,y,1)}})

		let storageX = 0;
		let storageY = 0;
		let storageDistance = 100;

		// innerPutAbleList.forEach(e=>visual.text(e.k, e.x,e.y+0.25, {color: 'red',opacity:0.99,font: 7}))
		for (let i = 0; i < innerPutAbleList.length; i++) {
			const e = innerPutAbleList[i];
			if (e.k <= 2) continue;
			const x = e.x;
			const y = e.y;
			const detX = centerX - x;
			const detY = centerY - y;
			const distance = Math.sqrt(detX * detX + detY * detY);
			if (storageDistance > distance) {
				storageDistance = distance;
				storageX = x;
				storageY = y;
			}
		}

		if (centerPos) {
			storageX = centerPos.x;
			storageY = centerPos.y;
		}

		let labX = 0;
		let labY = 0;
		let labDistance = 1e5;
		// innerPutAbleList.filter(e=>e.k>4).forEach(e=>{
		//     let x =e.x
		//     let y =e.y
		//     let detX= centerX-x
		//     let detY= centerY-y
		//     let distance = Math.sqrt(detX*detX+detY*detY)
		//
		//     if(labDistance>distance&&Math.abs(x-storageX)+Math.abs(y-storageY)>5){
		//         labDistance = distance
		//         labX = x
		//         labY = y
		//     }
		// })

		let wasmLabDone = false;
		if (wasmProfile.labAnchor && isComputeBlockWasmEnabled()) {
			const manorI16 = wasmBuf.manor;
			const manorArr = roomManor.arr;
			for (let i = 0; i < 2500; i++) {
				const v = manorArr[i];
				manorI16[i] = typeof v === 'number' ? v : 0;
			}
			const labAnchor = findLabAnchorByWasm(manorI16, storageX, storageY);
			if (labAnchor) {
				labX = labAnchor.x;
				labY = labAnchor.y;
				wasmLabDone = true;
			}
		}
		if (!wasmLabDone) {
			roomManor.forEach((x, y, val) => {
				// LayoutVisual.showText(roomName,val,{x:x,y:y},"cyan",0.75)
				if (typeof val === 'number' && val >= 2) {
					// if(roomManor.get(x,y)>0&&Math.abs(x-storageX)+Math.abs(y-storageY)>2)
					// visual.text(val, x,y+0.25, {color: 'cyan',opacity:0.99,font: 7})
					const detX = storageX - x - 1.5;
					const detY = storageY - y - 1.5;
					const distance = Math.sqrt(detX * detX + detY * detY);
					if (labDistance <= distance) return;
					let checkCnt = 0;
					let valid = true;
					for (let i = 0; i < 4 && valid; i++) {
						for (let j = 0; j < 4; j++) {
							const tx = x + i;
							const ty = y + j;
							if ((roomManor.get(tx, ty)) > 0 && Math.abs(tx - storageX) + Math.abs(ty - storageY) > 2) {
								checkCnt += 1;
							} else {
								valid = false;
								break;
							}
						}
					}
					if (checkCnt == 16) {
						// LayoutVisual.showText(roomName,parseInt(distance*10),{x:x+1.5,y:y+1.5},"cyan",0.75)
						labDistance = distance;
						labX = x;
						labY = y;
					}
				}
			});
		}
		labX += 1;
		labY += 1;

		/**
		 * 这里开始计算布局！
		 * @type {{}}
		 */
		const structMap = {};
		for (const e in CONTROLLER_STRUCTURES) structMap[e] = [];

		// 资源点布局
		structMap['link'] = roomObjectCache.link;
		structMap['container'] = roomObjectCache.container;
		structMap['extractor'] = roomObjectCache.extractor;
		//中心布局
		structMap['storage'].push([storageX - 1, storageY]);
		structMap['terminal'].push([storageX, storageY + 1]);
		structMap['factory'].push([storageX + 1, storageY]);
		structMap['link'].push([storageX, storageY - 1]);
		for (let i = -1; i <= 1; i++) {
			for (let j = -1; j <= 1; j++) {
				structMap['road'].push([storageX + i + j, storageY + i - j]); //仿射变换 [sin,cos,cos,-sin]
			}
		}
		// 这里修改lab布局
		const labs = ['☢☢-☢', '☢-☢-', '-☢-☢', '☢-☢☢'];
		let labChangeDirection = false;
		if ((storageX - labX) * (storageY - labY) < 0) {
			labChangeDirection = true;
		}

		const vis = {};
		for (let i = 0; i < 2; i++) {
			for (let j = 0; j < 2; j++) {
				vis[i + '_' + j] = 1; // 优先放置中间的label
				const jj = labChangeDirection ? j : 1 - j;
				const structs = labs[i + 1].charAt(j + 1);
				if (structs == '☢') structMap['lab'].push([labX + i, labY + jj]);
				else structMap['road'].push([labX + i, labY + jj]);
			}
		}

		for (let i = -1; i < 3; i++) {
			for (let j = -1; j < 3; j++) {
				if (vis[i + '_' + j]) continue;
				const jj = labChangeDirection ? j : 1 - j;
				const structs = labs[i + 1].charAt(j + 1);
				if (structs == '☢') structMap['lab'].push([labX + i, labY + jj]);
				else structMap['road'].push([labX + i, labY + jj]);
			}
		}

		walls.forEach((e) => structMap['rampart'].push([e.x, e.y]));

		for (const struct in CONTROLLER_STRUCTURES) {
			structMap[struct].forEach((e) => roomStructs.set(e[0], e[1], struct));
		}

		structMap['road'].forEach((e) => roomStructs.set(e[0], e[1], 1));
		//设置权值，bfs联通路径！
		const setModel = function (xx, yy) {
			const checkAble = (x, y) =>
				x >= 0 && y >= 0 && x <= 49 && y <= 49 && (roomManor.get(x, y)) > 0 && !roomStructs.get(x, y);
			for (let i = -1; i <= 1; i++) {
				for (let j = -1; j <= 1; j++) {
					const x = xx + i + j;
					const y = yy + i - j;
					if (checkAble(x, y)) {
						if (i || j) {
							// structMap["road"] .push([x,y]) //仿射变换 [sin,cos,cos,-sin]
							roomStructs.set(x, y, 1);
						} else {
							// structMap["spawn"] .push([x,y])
							roomStructs.set(x, y, 12);
						}
					}
				}
			}
			for (const e of [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1]
			]) {
				const x = xx + e[0];
				const y = yy + e[1];
				if (checkAble(x, y)) {
					// structMap["extension"] .push([x,y])
					roomStructs.set(x, y, 8);
				}
			}
		};

		for (let i = 0; i < 50; i += 4) {
			for (let j = 0; j < 50; j += 4) {
				const x = (storageX % 4) + i;
				const y = (storageY % 4) + j;
				setModel(x, y);
				setModel(x + 2, y + 2);
			}
		}
		visited.init();
		visited.set(storageX, storageY, 1);

		queMin.push(NewNode(1, storageX, storageY));
		const costRoad = routeDistance; //重复使用
		costRoad.init();
		queMin.whileNoEmpty((nd) => {
			roomStructs.forNear(
				(x, y, val) => {
					if (!visited.exec(x, y, 1) && val > 0) {
						queMin.push(NewNode(nd.k + val, x, y));
					}
				},
				nd.x,
				nd.y
			);
			costRoad.set(nd.x, nd.y, nd.k);
			// visual.text(nd.k,nd.x,nd.y+0.25, {color: "pink",opacity:0.99,font: 7})
		});

		structMap['road'].forEach((e) => roomStructs.set(e[0], e[1], 'road')); //这里把之前的road覆盖上去防止放在之前里road上了
		const costArr = costRoad.arr;
		const roomStructArr = roomStructs.arr;
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				const idx = x * 50 + y;
				let minVal = 65535;
				for (let dx = -1; dx <= 1; dx++) {
					for (let dy = -1; dy <= 1; dy++) {
						if (!dx && !dy) continue;
						const nx = x + dx;
						const ny = y + dy;
						if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
						const nVal = costArr[nx * 50 + ny];
						if (nVal > 0 && minVal > nVal) minVal = nVal;
					}
				}
				nearMinCostCache[idx] = minVal === 65535 ? 0 : minVal;
			}
		}

		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				const idx = x * 50 + y;
				const val = costArr[idx];
				if (!val) continue;
				const minVal = nearMinCostCache[idx];
				if (!minVal) continue;
				for (let dx = -1; dx <= 1; dx++) {
					for (let dy = -1; dy <= 1; dy++) {
						if (!dx && !dy) continue;
						const nx = x + dx;
						const ny = y + dy;
						if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
						if (costArr[nx * 50 + ny] === minVal) {
							roomStructArr[nx * 50 + ny] = 'road';
						}
					}
				}
			}
		}

		let spawnPos = [];
		let extensionPos = [];
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				const idx = x * 50 + y;
				const val = roomStructArr[idx];
				if (!(val > 0)) continue;
				const dist = nearMinCostCache[idx] || 100;
				// let dist = Math.sqrt(Math.pow(x-storageX,2)+Math.pow(y-storageY,2))
				if (val == 12) {
					// 8 && 12 上面有写，注意！！！
					spawnPos.push([x, y, dist]);
				} else {
					extensionPos.push([x, y, dist]);
					// visual.text(dist,x, y+0.25, {color: "pink",opacity:0.99,font: 7})
				}
			}
		}
		const cmpFunc = (a, b) => (a[2] == b[2] ? (a[1] == b[1] ? a[0] - b[0] : a[1] - b[1]) : a[2] - b[2]);
		spawnPos = spawnPos.sort(cmpFunc);
		extensionPos = extensionPos.sort(cmpFunc);
		const putList = [];
		const structOrder = ['spawn', 'nuker', 'powerSpawn', 'tower', 'observer'];
		let spawnIdx = 0;
		let extIdx = 0;
		structOrder.forEach((struct) => {
			const cnt = CONTROLLER_STRUCTURES[struct][8];
			for (let i = 0; i < cnt; i++) {
				const e = spawnIdx < spawnPos.length ? spawnPos[spawnIdx++] : extensionPos[extIdx++];
				if (!e) continue;
				structMap[struct].push([e[0], e[1]]);
				putList.push([e[0], e[1], struct]);
			}
		});
		const remainPos = extensionPos.slice(extIdx);
		for (let i = spawnIdx; i < spawnPos.length; i++) remainPos.push(spawnPos[i]);
		extensionPos = remainPos.sort(cmpFunc);
		let extCnt = 60;
		extensionPos.forEach((e) => {
			if (extCnt > 0) {
				structMap['extension'].push([e[0], e[1]]);
				putList.push([e[0], e[1], 'extension']);
				extCnt -= 1;
			}
		});

		// 更新roads
		roomStructs.init();
		for (const struct in CONTROLLER_STRUCTURES) {
			structMap[struct].forEach((e) => roomStructs.set(e[0], e[1], struct));
		}
		visited.init();
		structMap['road'].forEach((e) => visited.set(e[0], e[1], 1));
		/**
		 * 更新最近的roads 但是可能有残缺
		 */
		putList.forEach((e) => {
			const x = e[0];
			const y = e[1];
			const minVal = nearMinCostCache[x * 50 + y];
			if (!minVal) return;
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (!dx && !dy) continue;
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					if (costArr[nx * 50 + ny] === minVal) {
						roomStructArr[nx * 50 + ny] = 'road';
					}
				}
			}
		});
		/**
		 * 再roads的基础上，对roads进行补全，将残缺的连起来
		 */
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				const idx = x * 50 + y;
				const val = roomStructArr[idx];
				if (val == 'link' || val == 'container') continue; // 资源点的不要 放路
				if (typeof val === 'number' && val > -1) continue; // 附近有建筑 ，并且不是road
				// visual.text(val,x, y+0.25, {color: "pink",opacity:0.99,font: 7})
				const minVal = nearMinCostCache[idx];
				if (!minVal) continue;
				for (let dx = -1; dx <= 1; dx++) {
					for (let dy = -1; dy <= 1; dy++) {
						if (!dx && !dy) continue;
						const nx = x + dx;
						const ny = y + dy;
						if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
						if (costArr[nx * 50 + ny] === minVal) {
							// 找到建筑最近的那个road
							if (!visited.exec(nx, ny, 1)) structMap['road'].push([nx, ny]);
						}
					}
				}
			}
		}

		//#region 新的连接外矿方式
		const costs = new PathFinder.CostMatrix();
		const terrain = new Room.Terrain(roomName);
		for (let i = 0; i < 50; i++) {
			for (let j = 0; j < 50; j++) {
				const te = terrain.get(i, j);
				costs.set(i, j, te == TERRAIN_MASK_WALL ? 255 : te == TERRAIN_MASK_SWAMP ? 4 : 2);
			}
		}
		for (const struct of OBSTACLE_OBJECT_TYPES) {
			if (structMap[struct]) {
				structMap[struct].forEach((e) => {
					costs.set(e[0], e[1], 255);
				});
			}
		}
		structMap['road'].forEach((e) => {
			costs.set(e[0], e[1], 1);
		});
		structMap['container'].sort((a, b) => {
			const adx = a[0] - storageX;
			const ady = a[1] - storageY;
			const bdx = b[0] - storageX;
			const bdy = b[1] - storageY;
			return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
		});
		const centerRoomPos = new RoomPosition(centerX, centerY, roomName);
		structMap['container'].forEach((e) => {
			const path = PathFinder.search(
				centerRoomPos,
				{ pos: new RoomPosition(e[0], e[1], roomName), range: 1 },
				{
					roomCallback: () => {
						return costs;
					},
					maxRooms: 1
				}
			).path;
			for (let i = 0; i < path.length; i++) {
				const pos = path[i];
				if (costs.get(pos.x, pos.y) != 1) {
					structMap['road'].push([pos.x, pos.y]);
					costs.set(pos.x, pos.y, 1);
				}
			}
		});
		ManagerPlanner.dismiss();

		return {
			roomName: roomName,
			structMap: structMap,
			centerPos: {x: storageX, y: storageY},
			labPos: {labX, labY},
		};
	}
};


export const autoPlanner = {
	name: 'auto',
	ManagerPlanner
};
