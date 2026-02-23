import { PriorityQueue, NewNode, ReclaimNode } from '@/modules/feature/planner/utils/priorityQueue'
import { UnionFind } from '@/modules/feature/planner/utils/unionFind'
import { RoomArray } from '@/modules/feature/planner/utils/roomArray'

type PlannerPoint = { x: number; y: number; roomName: string }
type XY = { x: number; y: number }
type XYTuple = [number, number]
type StructMap = Record<string, XYTuple[]>

const numAt = (arr: number[] | string[], idx: number): number => {
	const v = arr[idx];
	return typeof v === 'number' ? v : 0;
};

declare const Game: {
	flags?: Record<string, { pos: { x: number; y: number; roomName: string } }>
}
declare const Room: {
	Terrain: new (roomName: string) => { get: (x: number, y: number) => number }
}
declare const RoomPosition: new (x: number, y: number, roomName: string) => XY & { roomName: string }
declare const PathFinder: {
	search: (
		origin: XY & { roomName?: string },
		goal: { pos: XY & { roomName?: string }; range: number } | Array<{ pos: XY & { roomName?: string }; range: number }>,
		opts: { roomCallback: () => any; maxRooms: number; plainCost?: number; swampCost?: number }
	) => { path: XY[]; incomplete?: boolean }
	CostMatrix: new () => { set: (x: number, y: number, cost: number) => void; get: (x: number, y: number) => number }
}
declare const CONTROLLER_STRUCTURES: Record<string, number[]>
declare const OBSTACLE_OBJECT_TYPES: string[]
declare const TERRAIN_MASK_WALL: number
declare const TERRAIN_MASK_SWAMP: number

const minPlaneCnt = 160;

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
let objects: PlannerPoint[] = [];


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

const squareDistance = (x1: number, y1: number, x2: number, y2: number): number => {
	const dx = x1 - x2;
	const dy = y1 - y2;
	return dx * dx + dy * dy;
};

const findLabAnchorByTs = (manorArr: (number | string)[], storageX: number, storageY: number): XY => {
	let bestX = 0;
	let bestY = 0;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			const val = manorArr[x * 50 + y];
			if (typeof val !== 'number' || val < 2) continue;
			const distance = squareDistance(storageX - 1.5, storageY - 1.5, x, y);
			if (bestDistance <= distance) continue;
			let checkCnt = 0;
			let valid = true;
			for (let i = 0; i < 4 && valid; i++) {
				for (let j = 0; j < 4; j++) {
					const tx = x + i;
					const ty = y + j;
					const manorVal = tx >= 0 && tx < 50 && ty >= 0 && ty < 50 ? manorArr[tx * 50 + ty] : 0;
					if (typeof manorVal === 'number' && manorVal > 0 && Math.abs(tx - storageX) + Math.abs(ty - storageY) > 2) {
						checkCnt += 1;
					} else {
						valid = false;
						break;
					}
				}
			}
			if (checkCnt == 16) {
				bestDistance = distance;
				bestX = x;
				bestY = y;
			}
		}
	}

	return { x: bestX + 1, y: bestY + 1 };
};

type KernelResult = {
	parent: Int32Array
	size: Int16Array
}

const BORDER_INDEXES = (() => {
	const out: number[] = [];
	for (let y = 0; y < 50; y++) {
		out.push(y);
		out.push(49 * 50 + y);
	}
	for (let x = 1; x < 49; x++) {
		out.push(x * 50);
		out.push(x * 50 + 49);
	}
	return out;
})();

const kernelFind = (parent: Int32Array, x: number): number => {
	let root = x;
	while (parent[root] !== root) root = parent[root];
	let cur = x;
	while (parent[cur] !== cur) {
		const next = parent[cur];
		parent[cur] = root;
		cur = next;
	}
	return root;
};

const kernelUnion = (parent: Int32Array, a: number, b: number): number => {
	const ra = kernelFind(parent, a);
	const rb = kernelFind(parent, b);
	if (ra === rb) return ra;
	if (ra > rb) {
		parent[ra] = rb;
		return rb;
	}
	parent[rb] = ra;
	return ra;
};

const forEach4Index = (idx: number, fn: (nidx: number) => void) => {
	const x = (idx / 50) | 0;
	const y = idx % 50;
	for (let i = 0; i < 4; i++) {
		const nx = x + DIR4[i][0];
		const ny = y + DIR4[i][1];
		if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
		fn(nx * 50 + ny);
	}
};

const forEach8Index = (idx: number, fn: (nidx: number) => void) => {
	const x = (idx / 50) | 0;
	const y = idx % 50;
	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			if (!dx && !dy) continue;
			const nx = x + dx;
			const ny = y + dy;
			if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
			fn(nx * 50 + ny);
		}
	}
};

const blockPutAbleCountKernel = (
	parent: Int32Array,
	root: number,
	walkable: Uint8Array,
	cache: Int16Array
): number => {
	const rootId = kernelFind(parent, root);
	if (cache[rootId] >= 0) return cache[rootId];

	const roomManor = new Uint8Array(2500);
	for (let i = 0; i < 2500; i++) {
		roomManor[i] = kernelFind(parent, i) === rootId ? 1 : 0;
	}

	for (let i = 0; i < 2500; i++) {
		if (!roomManor[i]) continue;
		let manorCnt = 0;
		let wallCnt = 0;
		forEach4Index(i, (n) => {
			if (roomManor[n]) manorCnt += 1;
			if (!walkable[n]) wallCnt += 1;
		});
		if (manorCnt === 1 && wallCnt === 0) roomManor[i] = 0;
	}

	const stack = new Int16Array(2500);
	for (let start = 0; start < 2500; start++) {
		let top = 0;
		stack[top++] = start;
		while (top > 0) {
			const idx = stack[--top];
			if (roomManor[idx] || !walkable[idx]) continue;
			let manorCnt = 0;
			let wallCnt = 0;
			forEach4Index(idx, (n) => {
				if (roomManor[n]) manorCnt += 1;
				if (!walkable[n]) wallCnt += 1;
			});
			if (manorCnt >= 2 || (manorCnt === 1 && wallCnt >= 2)) {
				roomManor[idx] = 1;
				forEach4Index(idx, (n) => {
					stack[top++] = n;
				});
			}
		}
	}

	for (let i = 0; i < BORDER_INDEXES.length; i++) {
		const b = BORDER_INDEXES[i];
		if (!walkable[b]) continue;
		roomManor[b] = 0;
		forEach8Index(b, (n) => {
			roomManor[n] = 0;
		});
	}

	const visited = new Uint8Array(2500);
	const queue = new PriorityQueue(true);
	for (let i = 0; i < 2500; i++) {
		if (!roomManor[i]) queue.push(NewNode(walkable[i] ? -4 : -1, 0, 0, i));
	}

	let innerCnt = 0;
	while (!queue.isEmpty()) {
		const nd = queue.pop() as { k: number; v: number } | undefined;
		if (!nd) break;
		const k = nd.k;
		const idx = nd.v;
		visited[idx] = 1;
		if (k >= -1) {
			forEach4Index(idx, (n) => {
				if (visited[n]) return;
				visited[n] = 1;
				queue.push(NewNode(k + 1, 0, 0, n));
				if (roomManor[n] && walkable[n] && k + 1 >= 0) innerCnt += 1;
			});
		} else {
			forEach8Index(idx, (n) => {
				if (visited[n]) return;
				visited[n] = 1;
				queue.push(NewNode(k + 1, 0, 0, n));
				if (roomManor[n] && walkable[n] && k + 1 >= 0) innerCnt += 1;
			});
		}
		ReclaimNode(nd);
	}

	cache[rootId] = innerCnt;
	return innerCnt;
};

const computeBlockKernel = (
	walkable: Uint8Array,
	score: Float32Array,
	routeDist: Int16Array,
	blocked?: Uint8Array
): KernelResult => {
	const parent = new Int32Array(2500);
	for (let i = 0; i < 2500; i++) parent[i] = i;
	const sizeMap = new Int16Array(2500);
	const visited = new Uint8Array(2500);
	const posSeqMap: number[][] = Array.from({ length: 2500 }, () => []);

	const startPoints: number[] = [];
	for (let i = 0; i < 2500; i++) {
		if (walkable[i] && routeDist[i] > 0) startPoints.push(i);
	}
	startPoints.sort((a, b) => routeDist[b] - routeDist[a]);

	for (let si = 0; si < startPoints.length; si++) {
		const currentPos = startPoints[si];
		if (blocked && blocked[currentPos]) {
			kernelUnion(parent, currentPos, 0);
			continue;
		}
		if (visited[currentPos]) continue;

		let cnt = 0;
		const posSeq: number[] = [];
		const stack: number[] = [currentPos, 0, 0];

		while (stack.length) {
			const mode = stack.pop() as number;
			const phase = stack.pop() as number;
			const idx = stack.pop() as number;
			if (phase === 0) {
				if (visited[idx]) continue;
				visited[idx] = 1;
				stack.push(idx, 1, mode);
				const currentValue = score[idx];
				if (mode === 0) {
					forEach8Index(idx, (n) => {
						const v = score[n];
						if (v > currentValue && currentValue < 6) stack.push(n, 0, 0);
						else if (v > 0 && v < currentValue) stack.push(n, 0, 1);
					});
				} else {
					forEach4Index(idx, (n) => {
						const v = score[n];
						if (v > 0 && v < currentValue) stack.push(n, 0, 1);
					});
				}
				continue;
			}

			const blockedHere = blocked ? !!blocked[idx] : false;
			const fi = kernelFind(parent, idx);
			const fc = kernelFind(parent, currentPos);
			if (fi !== 0 && fc !== 0 && !blockedHere) {
				kernelUnion(parent, currentPos, idx);
				posSeq.push(idx);
				cnt += 1;
			} else if (blocked) {
				kernelUnion(parent, idx, 0);
			}
		}

		if (cnt > 0) {
			const root = kernelFind(parent, currentPos);
			sizeMap[root] = cnt;
			posSeqMap[root] = posSeq;
		}
	}

	for (let i = 0; i < BORDER_INDEXES.length; i++) {
		const b = BORDER_INDEXES[i];
		if (!walkable[b]) continue;
		const p = kernelFind(parent, b);
		sizeMap[p] = 0;
		forEach8Index(b, (n) => {
			if (!walkable[n]) return;
			const pn = kernelFind(parent, n);
			sizeMap[pn] = 0;
		});
	}
	sizeMap[0] = 0;

	const queue = new PriorityQueue(true);
	for (let p = 0; p < 2500; p++) {
		if (sizeMap[p] > 0) queue.push(NewNode(sizeMap[p], 0, 0, p));
	}
	const putAbleCache = new Int16Array(2500);
	putAbleCache.fill(-1);

	while (!queue.isEmpty()) {
		const nd = queue.pop() as { k: number; v: number } | undefined;
		if (!nd) break;
		const k = nd.k;
		const pos = nd.v;
		if (sizeMap[pos] !== k) {
			ReclaimNode(nd);
			continue;
		}

		const seq = posSeqMap[pos];
		if (!seq || seq.length === 0) {
			ReclaimNode(nd);
			continue;
		}

		const visited2 = new Uint8Array(2500);
		const nearCntMap = new Int16Array(2500);
		for (let i = 0; i < seq.length; i++) {
			const e = seq[i];
			forEach8Index(e, (n) => {
				if (!walkable[n] || visited2[n]) return;
				visited2[n] = 1;
				const cp = kernelFind(parent, n);
				if (cp === pos) return;
				const cs = sizeMap[cp];
				if (cs > 0 && cs < 300) nearCntMap[cp] += 1;
			});
		}

		let targetPos = -1;
		let nearCnt = 0;
		let maxRatio = 0;
		for (let currentPos = 0; currentPos < 2500; currentPos++) {
			const near = nearCntMap[currentPos];
			if (near <= 0) continue;
			const currentSize = sizeMap[currentPos];
			if (currentSize <= 0) continue;
			const ratio = near / Math.sqrt(Math.min(currentSize, k));
			const better = ratio === maxRatio ? targetPos < 0 || currentSize < sizeMap[targetPos] : ratio > maxRatio;
			if (better) {
				targetPos = currentPos;
				maxRatio = ratio;
				nearCnt = near;
			}
		}
		for (let currentPos = 0; currentPos < 2500; currentPos++) {
			const near = nearCntMap[currentPos];
			if (near > nearCnt) {
				targetPos = currentPos;
				nearCnt = near;
			}
		}
		if (targetPos < 0) {
			ReclaimNode(nd);
			continue;
		}

		const minSize = sizeMap[targetPos];
		if (minSize <= 0) {
			ReclaimNode(nd);
			continue;
		}

		const targetPutAble = minSize > 140 ? blockPutAbleCountKernel(parent, targetPos, walkable, putAbleCache) : 0;
		const posPutAble = k > 140 ? blockPutAbleCountKernel(parent, pos, walkable, putAbleCache) : 0;
		if (Math.max(targetPutAble, posPutAble) < 140) {
			const mergedRoot = kernelUnion(parent, pos, targetPos);
			const cnt = (k + minSize) | 0;
			if (pos !== mergedRoot) sizeMap[pos] = 0;
			else sizeMap[targetPos] = 0;
			sizeMap[mergedRoot] = cnt;
			const merged = new Array(posSeqMap[targetPos].length + posSeqMap[pos].length);
			let mergedIdx = 0;
			for (let i = 0; i < posSeqMap[targetPos].length; i++) merged[mergedIdx++] = posSeqMap[targetPos][i];
			for (let i = 0; i < posSeqMap[pos].length; i++) merged[mergedIdx++] = posSeqMap[pos][i];
			posSeqMap[mergedRoot] = merged;
			if (pos !== mergedRoot) posSeqMap[pos] = [];
			else posSeqMap[targetPos] = [];
			putAbleCache[mergedRoot] = -1;
			putAbleCache[targetPos] = -1;
			putAbleCache[pos] = -1;
			queue.push(NewNode(cnt, 0, 0, mergedRoot));
		}

		ReclaimNode(nd);
	}

	for (let i = 0; i < 2500; i++) {
		parent[i] = kernelFind(parent, i);
	}
	return { parent, size: sizeMap };
};

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
	getBlockPutAbleCnt(
		roomWalkable: RoomArray,
		visited: RoomArray,
		queMin: PriorityQueue,
		unionFind: UnionFind,
		tarRoot: number,
		putAbleCacheMap: Record<number, any[]>,
		AllCacheMap: Record<number, any[]>,
		rootMembers?: Record<number, number[]>
	) {
		if (putAbleCacheMap[tarRoot]) return [putAbleCacheMap[tarRoot], AllCacheMap[tarRoot]];
		const roomManor = routeDistance;
		if (!roomManor) return;
		roomManor.init();
		const roomManorArr = roomManor.arr;
		const walkArr = roomWalkable.arr as number[];
		const memberList = rootMembers ? rootMembers[tarRoot] : undefined;
		if (memberList) {
			for (let i = 0; i < memberList.length; i++) {
				roomManorArr[memberList[i]] = 1;
			}
			for (let i = 0; i < memberList.length; i++) {
				const idx = memberList[i];
				if (!roomManorArr[idx]) continue;
				const x = (idx / 50) | 0;
				const y = idx % 50;
				let manorCnt = 0;
				let wallCnt = 0;
				for (let j = 0; j < 4; j++) {
					const dx = DIR4[j][0];
					const dy = DIR4[j][1];
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					const nidx = nx * 50 + ny;
					if (roomManorArr[nidx]) manorCnt += 1;
					if (!walkArr[nidx]) wallCnt += 1;
				}
				if (manorCnt == 1 && wallCnt == 0) roomManorArr[idx] = 0;
			}
		} else {
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
		}
		// 迭代扩张 manor，减少递归与重复扫描
		fastStampToken += 1;
			if (fastStampToken >= 65530) {
				fastStampToken = 1;
				fastVisitStamp.fill(0);
				fastManorStamp.fill(0);
			}
			const stamp = fastStampToken;
			let qHead = 0;
			let qTail = 0;
			for (let x = 0; x < 50; x++) {
				for (let y = 0; y < 50; y++) {
					const idx = x * 50 + y;
					if (!roomManorArr[idx] && walkArr[idx]) {
						fastVisitStamp[idx] = stamp;
						fastQueue[qTail++] = idx;
					}
				}
			}
			while (qHead < qTail) {
				const idx = fastQueue[qHead++];
				fastVisitStamp[idx] = 0;
				if (roomManorArr[idx] || !walkArr[idx]) continue;
				const x = (idx / 50) | 0;
				const y = idx % 50;
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
					const nidx = nx * 50 + ny;
					if (!roomManorArr[nidx] && walkArr[nidx] && fastVisitStamp[nidx] !== stamp) {
						fastVisitStamp[nidx] = stamp;
						fastQueue[qTail++] = nidx;
					}
				}
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
				}
			}
		}

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
								}
								if (val) AllCacheList.push(item);
							}
						}
					}
				}
			}
		});

		putAbleCacheMap[tarRoot] = innerPutAbleList;
		AllCacheMap[tarRoot] = AllCacheList;
		return [putAbleCacheMap[tarRoot], AllCacheMap[tarRoot]];
	},
	getBlockPutAbleCntCount(
		roomWalkable: RoomArray,
		unionFind: UnionFind,
		tarRoot: number,
		putAbleCacheMap: Record<number, any[]>,
		allCacheMap: Record<number, any[]>,
		putAbleCntCacheMap: Record<number, number>,
		rootMembers?: Record<number, number[]>
	) {
		const root = Number(tarRoot);
		if (putAbleCntCacheMap[root] != null) return putAbleCntCacheMap[root];
		const cnt = ManagerPlanner.getBlockPutAbleCnt(
			roomWalkable,
			visited,
			queMin2,
			unionFind,
			root,
			putAbleCacheMap,
			allCacheMap,
			rootMembers
		)[0].length;
		putAbleCntCacheMap[root] = cnt;
		return cnt;
	},
	/**
	 * 插值，计算区块的预处理和合并需求
	 * @param roomName
	 */
	computeBlock(
		roomName: string,
		blocked?: RoomArray
	): [UnionFind, Record<number, number>, RoomArray, RoomArray, Record<number, any[]>, Record<number, any[]>] {
		ManagerPlanner.createObjects();

		roomWalkable.initRoomTerrainWalkAble(roomName);
		const walkArr = roomWalkable.arr as number[];
		const blockedArr = blocked?.arr as number[] | undefined;

		// 计算距离山体要多远（均匀权重 BFS 用数组队列，避免堆开销）
		visited.init();
		nearWall.init();
		const visitedArr = visited.arr as number[];
		const nearWallArr = nearWall.arr as number[];
		let qHead = 0;
		let qTail = 0;
		for (let idx = 0; idx < 2500; idx++) {
			if (!walkArr[idx]) {
				visitedArr[idx] = 1;
				nearWallArr[idx] = 0;
				fastQueue[qTail++] = idx;
			}
		}
		while (qHead < qTail) {
			const idx = fastQueue[qHead++];
			const x = (idx / 50) | 0;
			const y = idx % 50;
			const ndk = numAt(nearWallArr, idx);
			for (let i = 0; i < 4; i++) {
				const dx = DIR4[i][0];
				const dy = DIR4[i][1];
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
				const nidx = nx * 50 + ny;
				if (walkArr[nidx] && !visitedArr[nidx]) {
					visitedArr[nidx] = 1;
					nearWallArr[nidx] = ndk + 1;
					fastQueue[qTail++] = nidx;
				}
			}
		}

		// 距离出口一格不能放墙
		const pushBorderSeed = (x: number, y: number) => {
			const idx = x * 50 + y;
			if (!walkArr[idx]) return;
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (!dx && !dy) continue;
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					const nidx = nx * 50 + ny;
					if (!walkArr[nidx]) continue;
					nearWallArr[nidx] = 50;
					queMin.push(NewNode(0, nx, ny));
				}
			}
			nearWallArr[idx] = 50;
			queMin.push(NewNode(0, x, y));
		};
		for (let y = 0; y < 50; y++) {
			pushBorderSeed(0, y);
			pushBorderSeed(49, y);
		}
		for (let x = 1; x < 49; x++) {
			pushBorderSeed(x, 0);
			pushBorderSeed(x, 49);
		}

		const roomPutAble = routeDistance;
		roomPutAble.initRoomTerrainWalkAble(roomName);
		const roomPutAbleArr = roomPutAble.arr as number[];
		const clearPutAbleNearBorder = (x: number, y: number) => {
			const idx = x * 50 + y;
			if (!walkArr[idx]) return;
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (!dx && !dy) continue;
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					const nidx = nx * 50 + ny;
					if (walkArr[nidx]) roomPutAbleArr[nidx] = 0;
				}
			}
			roomPutAbleArr[idx] = 0;
		};
		for (let y = 0; y < 50; y++) {
			clearPutAbleNearBorder(0, y);
			clearPutAbleNearBorder(49, y);
		}
		for (let x = 1; x < 49; x++) {
			clearPutAbleNearBorder(x, 0);
			clearPutAbleNearBorder(x, 49);
		}
		// 计算 控制器，矿物的位置
			const getObjectPos = function (x, y, struct): XYTuple | null {
				let finalX = 0;
				let finalY = 0;
				let put = false;
				const tryPick = (nx: number, ny: number, requirePutAble: boolean): boolean => {
					if (put) return true;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) return false;
					const idx = nx * 50 + ny;
					if (!walkArr[idx]) return false;
					if (requirePutAble && !roomPutAbleArr[idx]) return false;
					if (roomObjectCache.get(nx, ny)) return false;
					finalX = nx;
					finalY = ny;
					put = true;
					return true;
				};

				for (let i = 0; i < 4 && !put; i++) {
					const dx = DIR4[i][0];
					const dy = DIR4[i][1];
					tryPick(x + dx, y + dy, true);
				}
				for (let dx = -1; dx <= 1 && !put; dx++) {
					for (let dy = -1; dy <= 1 && !put; dy++) {
						if (!dx && !dy) continue;
						tryPick(x + dx, y + dy, true);
					}
				}

				// border/地形极端场景兜底：允许使用可行走但不在 putAble 集合内的位置，避免回落到 (0,0)
				for (let dx = -1; dx <= 1 && !put; dx++) {
					for (let dy = -1; dy <= 1 && !put; dy++) {
						if (!dx && !dy) continue;
						tryPick(x + dx, y + dy, false);
					}
				}
				for (let radius = 2; radius <= 4 && !put; radius++) {
					for (let dx = -radius; dx <= radius && !put; dx++) {
						for (let dy = -radius; dy <= radius && !put; dy++) {
							if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
							tryPick(x + dx, y + dy, false);
						}
					}
				}

				if (!put) return null;
				roomObjectCache.set(finalX, finalY, struct);
				return [finalX, finalY];
			};
			for (let i = 0; i < objects.length; i++) {
				const pos = objects[i];
				//container 位置
				const p = getObjectPos(pos.x, pos.y, 'container');
				if (!p) continue;

				// link 位置
				if (i != 1) {
					const linkPos = getObjectPos(p[0], p[1], 'link');
					if (linkPos) {
						roomObjectCache.link = roomObjectCache.link || [];
						roomObjectCache.link.push(linkPos);
					} // link controller 然后是  source
				} else {
					roomObjectCache.extractor = [[pos.x, pos.y]];
			}
			roomObjectCache.container = roomObjectCache.container || [];
			if (i != 1) roomObjectCache.container.unshift(p); //如果是 mineral 最后一个
			else roomObjectCache.container.push(p);
		}

		// 插值：热点路径改为数组直访，减少 forEach/for4Direction 回调开销
		const interpolationArr = interpolation.arr as number[];
		const nearWallWithInterpolationArr = nearWallWithInterpolation.arr as number[];
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				const idx = x * 50 + y;
				const val = numAt(nearWallArr, idx);
				let value = -4 * val;
				for (let i = 0; i < 4; i++) {
					const dx = DIR4[i][0];
					const dy = DIR4[i][1];
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					value += numAt(nearWallArr, nx * 50 + ny);
				}
				interpolationArr[idx] = value;
				if (value > 0) value = 0;
				nearWallWithInterpolationArr[idx] = val && walkArr[idx] ? val + value * 0.1 : 0;
			}
		}

		if (blockedArr) {
			for (let idx = 0; idx < 2500; idx++) {
				if (blockedArr[idx]) nearWallWithInterpolationArr[idx] = 0;
			}
		}

		// 计算距离出口多远
		visited.init();
		routeDistance.init();
		const routeArr = routeDistance.arr as number[];
		const routeVisitArr = visited.arr as number[];
		let routeHead = 0;
		let routeTail = 0;
		// border 阶段已经写入 queMin，这里转成数组队列做统一权重 BFS
		while (!queMin.isEmpty()) {
			const seed = (queMin.pop() as unknown) as { x: number; y: number } | undefined;
			if (!seed) break;
			const idx = seed.x * 50 + seed.y;
			if (!routeVisitArr[idx]) {
				routeVisitArr[idx] = 1;
				routeArr[idx] = 0;
				fastQueue[routeTail++] = idx;
			}
			ReclaimNode(seed);
		}
		queMin.clear();
		while (routeHead < routeTail) {
			const idx = fastQueue[routeHead++];
			const x = (idx / 50) | 0;
			const y = idx % 50;
			const base = numAt(routeArr, idx);
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (!dx && !dy) continue;
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					const nidx = nx * 50 + ny;
					if (walkArr[nidx] && !routeVisitArr[nidx]) {
						routeVisitArr[nidx] = 1;
						routeArr[nidx] = base + 1;
						fastQueue[routeTail++] = nidx;
					}
				}
			}
		}

			const putAbleCacheMap = {};
			const allCacheMap = {};
			const putAbleCntCacheMap = {};
			const sizeMap = {};
			const walkableU8 = new Uint8Array(2500);
			const scoreF32 = new Float32Array(2500);
			const routeI16 = new Int16Array(2500);
			const blockedU8 = blockedArr ? new Uint8Array(2500) : undefined;
			const scoreArr = nearWallWithInterpolation.arr;
			for (let i = 0; i < 2500; i++) {
				walkableU8[i] = walkArr[i] ? 1 : 0;
				scoreF32[i] = numAt(scoreArr, i);
				routeI16[i] = numAt(routeArr, i);
				if (blockedU8) blockedU8[i] = blockedArr && numAt(blockedArr, i) ? 1 : 0;
			}
			const kernelResult = computeBlockKernel(walkableU8, scoreF32, routeI16, blockedU8);
			if (kernelResult) {
				unionFind.parent = Array.from(kernelResult.parent);
				for (let i = 0; i < 2500; i++) {
					if (kernelResult.size[i] > 0) sizeMap[i] = kernelResult.size[i];
				}
				return [unionFind, sizeMap, roomWalkable, nearWall, putAbleCacheMap, allCacheMap];
			}
			// 对距离的格子插入到队列 ，作为分开的顺序
		for (let idx = 0; idx < 2500; idx++) {
			if (!walkArr[idx]) continue;
			const nVal = numAt(routeArr, idx);
			if (nVal) {
				const x = (idx / 50) | 0;
				const y = idx % 50;
				startPoint.push(NewNode(-nVal, x, y));
			}
		}
		const posSeqMap: Record<number, number[]> = {};

		// 分块，将地图分成一小块一小块
		visited.init();
		for (let i = 0; i < 2500; i++) {
			if (startPoint.isEmpty()) break;
			let cnt = 0;
			// let color = randomColor(i)
			const nd = (startPoint.pop() as unknown) as { k: number; x: number; y: number; v?: number } | undefined;
			if (!nd) break;
			const currentPos = nd.x * 50 + nd.y;
			if (blockedArr && blockedArr[currentPos]) {
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
					const currentValue = numAt(nearWallWithInterpolation.arr, x * 50 + y);
					stack.push([x, y, mode, 1]);
					if (!mode) {
						for (let dx = -1; dx <= 1; dx++) {
							for (let dy = -1; dy <= 1; dy++) {
								if (!dx && !dy) continue;
								const x1 = x + dx;
								const y1 = y + dy;
								if (x1 < 0 || x1 > 49 || y1 < 0 || y1 > 49) continue;
								const v = numAt(nearWallWithInterpolationArr, x1 * 50 + y1);
								if (v > currentValue && currentValue < 6) {
									//加了一点优化，小于时分裂更多
									stack.push([x1, y1, 0, 0]);
								} else if (v && v < currentValue) {
									stack.push([x1, y1, 1, 0]);
								}
							}
						}
					} else {
						for (let i = 0; i < 4; i++) {
							const dx = DIR4[i][0];
							const dy = DIR4[i][1];
							const x1 = x + dx;
							const y1 = y + dy;
							if (x1 < 0 || x1 > 49 || y1 < 0 || y1 > 49) continue;
							const v = numAt(nearWallWithInterpolationArr, x1 * 50 + y1);
							if (v && v < currentValue) stack.push([x1, y1, 1, 0]);
						}
					}
					continue;
				}

				// post-order 阶段，保持与递归版一致的合并时机
				const pos = x * 50 + y;
				const posRoot = unionFind.find(pos);
				if (posRoot && (!blockedArr || !blockedArr[pos])) {
					unionFind.union(currentPos, pos);
					posSeq.push(pos);
					cnt++;
				} else if (blockedArr) {
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

		// 将出口附近的块删掉（改为数组邻域扫描）
		const pruneBorderNear = (x: number, y: number) => {
			const idx = x * 50 + y;
			if (!walkArr[idx]) return;
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
					const nidx = nx * 50 + ny;
					if (!walkArr[nidx]) continue;
					const pos = unionFind.find(nidx);
					if (sizeMap[pos]) delete sizeMap[pos];
				}
			}
		};
		for (let y = 0; y < 50; y++) {
			pruneBorderNear(0, y);
			pruneBorderNear(49, y);
		}
		for (let x = 1; x < 49; x++) {
			pruneBorderNear(x, 0);
			pruneBorderNear(x, 49);
		}
		delete sizeMap[0];

		// let i = 0
		// 合并小块成大块的
		queMin.whileNoEmpty((nd) => {
			const pos = nd.v;
			if (nd.k != sizeMap[pos]) return; // 已经被合并了
			// i++;

			visited.init();
			const nearCntMap = {};

			// 搜索附近的块（改为数组邻域扫描）
			const mergeVisitedArr = visited.arr as number[];
			const seq = posSeqMap[pos];
			for (let si = 0; si < seq.length; si++) {
				const e = seq[si];
				const x = (e / 50) | 0;
				const y = e % 50;
				for (let dx = -1; dx <= 1; dx++) {
					for (let dy = -1; dy <= 1; dy++) {
						if (!dx && !dy) continue;
						const nx = x + dx;
						const ny = y + dy;
						if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
						const nidx = nx * 50 + ny;
						if (!walkArr[nidx] || mergeVisitedArr[nidx]) continue;
						mergeVisitedArr[nidx] = 1;
						const currentPos = unionFind.find(nidx);
						if (currentPos == pos) continue;
						const currentSize = sizeMap[currentPos];
						if (currentSize < 300) {
							nearCntMap[currentPos] = (nearCntMap[currentPos] || 0) + 1;
						}
					}
				}
			}

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
					putAbleCntCacheMap,
					posSeqMap
				);
			if (nd.k > minPlaneCnt)
				ndkBlockPutAbleCnt = ManagerPlanner.getBlockPutAbleCntCount(
					roomWalkable,
					unionFind,
					nd.v,
					putAbleCacheMap,
					allCacheMap,
					putAbleCntCacheMap,
					posSeqMap
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
		return [unionFind, sizeMap, roomWalkable, nearWall, putAbleCacheMap, allCacheMap];
	},
	/**
	 * 计算 分布图
	 * 计算建筑的位置
	 * @param roomName,
	 * @param points [flagController,flagMineral,flagSourceA,flagSourceB]
	 * @return result { roomName:roomName,storagePos:{x,y},labPos:{x,y},structMap:{ "rampart" : [[x1,y1],[x2,y2] ...] ...} }
	 */
	computeManor(roomName: string, points: PlannerPoint[], fixedCenter?: XY, blocked?: RoomArray) {
		ManagerPlanner.init();
		for (const p of points) {
			if (p && p.roomName == roomName) objects.push(p);
		}
		const blockArray = ManagerPlanner.computeBlock(roomName, blocked);
		const unionFind = blockArray[0];
		const sizeMap = blockArray[1];
		const wallMap = {};
		const rootMembers = {};
		for (let i = 0; i < 2500; i++) {
			const root = unionFind.find(i);
			if (sizeMap[root] > 0) {
				if (!rootMembers[root]) rootMembers[root] = [];
				rootMembers[root].push(i);
			}
		}
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
		// 兜底方案：记录不检查阈值的备选
		let fallbackPos = undefined;
		let fallbackWallCnt = 1e9;
		let fallbackWalls = null;

		let centerX = undefined;
		let centerY = undefined;

		let centerPos = fixedCenter;
		if (!centerPos && Game.flags.storagePos && Game.flags.storagePos.pos.roomName == roomName) {
			centerPos = { x: Game.flags.storagePos.pos.x, y: Game.flags.storagePos.pos.y };
		}

		for (const pos in sizeMap) {
			const posNum = Number(pos);
			// if(sizeMap[pos]<150)return

				ManagerPlanner.getBlockPutAbleCnt(
					roomWalkable,
					visited,
					queMin,
					unionFind,
				posNum,
				putAbleCacheMap,
				allCacheMap,
				rootMembers
			);
			const currentPutAbleList = putAbleCacheMap[posNum];
			const allList = allCacheMap[posNum];
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

			const currentInnerPutAbleList = currentPutAbleList;

			let maxDist = 0;
			if (gt2List.length < 30) {
				for (let i = 0; i < gt2List.length; i++) {
					const a = gt2List[i];
					for (let j = i + 1; j < gt2List.length; j++) {
						const b = gt2List[j];
						const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
						if (dist > maxDist) maxDist = dist;
					}
				}
			}

			let currentWallCnt = 0;
			let currentWalls = null;
			const walls = [];
			if (gt1Cnt > 30 || maxDist > 5) {
				// 高频路径改为索引队列/数组标记，避免 PriorityQueue + callback 额外开销
				fastStampToken += 1;
				if (fastStampToken >= 65530) {
					fastStampToken = 1;
					fastVisitStamp.fill(0);
					fastManorStamp.fill(0);
				}
				const stamp = fastStampToken;
				const walkArr = roomWalkable.arr as number[];
				for (let i = 0; i < allList.length; i++) {
					const e = allList[i];
					fastManorStamp[e.x * 50 + e.y] = stamp;
				}
				// 直接扫描 manor 边界，避免整图 flood-fill
				for (let i = 0; i < allList.length; i++) {
					const e = allList[i];
					const x = e.x;
					const y = e.y;
					const idx = x * 50 + y;
					if (!walkArr[idx]) continue;
					let isBoundary = false;
					for (let dx = -1; dx <= 1 && !isBoundary; dx++) {
						for (let dy = -1; dy <= 1; dy++) {
							if (!dx && !dy) continue;
							const nx = x + dx;
							const ny = y + dy;
							if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
							const nidx = nx * 50 + ny;
							if (walkArr[nidx] && fastManorStamp[nidx] !== stamp) {
								isBoundary = true;
								break;
							}
						}
					}
					if (isBoundary && fastVisitStamp[idx] !== stamp) {
						fastVisitStamp[idx] = stamp;
						walls.push(NewNode(0, x, y));
					}
				}
				currentWallCnt = walls.length;
				currentWalls = walls;
				// 阈值检查：墙体数量过少或比例过高时跳过造墙方案
				const MIN_WALL_CNT = 12;
				const MAX_WALL_RATIO = 0.3;
				const wallRatio = currentWallCnt / currentPutAbleLen;
				if (currentWallCnt < MIN_WALL_CNT || wallRatio > MAX_WALL_RATIO) {
					currentWalls = null;
				}
			}
			if (minPlaneCnt < currentPutAbleLen && wallCnt > currentWallCnt && currentWalls) {
				// putAbleList = currentPutAbleList;
				innerPutAbleList = currentInnerPutAbleList;
				wallCnt = currentWallCnt;
				finalPos = posNum;
				wallMap[posNum] = currentWalls;
				if (centerPos) {
					centerX = centerPos.x;
					centerY = centerPos.y;
				} else {
					centerX = sumX / currentPutAbleLen;
					centerY = sumY / currentPutAbleLen;
				}
			}
			// 兜底方案：记录墙体最少的方案（不检查阈值）
			if (minPlaneCnt < currentPutAbleLen && walls && fallbackWallCnt > walls.length) {
				fallbackPos = posNum;
				fallbackWallCnt = walls.length;
				fallbackWalls = walls;
			}

		}

		// 兜底：如果没有满足阈值的方案，使用备选方案
		if (!finalPos && fallbackPos) {
			finalPos = fallbackPos;
			wallCnt = fallbackWallCnt;
			wallMap[finalPos] = fallbackWalls;
			// 重新计算 innerPutAbleList
			ManagerPlanner.getBlockPutAbleCnt(
				roomWalkable,
				visited,
				queMin,
				unionFind,
				finalPos,
				putAbleCacheMap,
				allCacheMap,
					rootMembers
				);
				innerPutAbleList = putAbleCacheMap[finalPos];
				if (centerPos) {
					centerX = centerPos.x;
					centerY = centerPos.y;
				} else if (innerPutAbleList && innerPutAbleList.length) {
					let sumX = 0;
					let sumY = 0;
					for (let i = 0; i < innerPutAbleList.length; i++) {
						const e = innerPutAbleList[i];
						sumX += e.x;
						sumY += e.y;
					}
					centerX = sumX / innerPutAbleList.length;
					centerY = sumY / innerPutAbleList.length;
				}
			}

		if (!finalPos || !putAbleCacheMap[finalPos]) return;

		const walls = wallMap[finalPos];

		roomManor.init();
		const finalAllCache = allCacheMap[finalPos];
		for (let i = 0; i < finalAllCache.length; i++) {
			const e = finalAllCache[i];
			roomManor.set(e.x, e.y, -1);
		}
		for (let i = 0; i < innerPutAbleList.length; i++) {
			const e = innerPutAbleList[i];
			roomManor.set(e.x, e.y, e.k);
		}


		let storageX = 0;
		let storageY = 0;
		let storageDistance = Number.POSITIVE_INFINITY;

		for (let i = 0; i < innerPutAbleList.length; i++) {
			const e = innerPutAbleList[i];
			if (e.k <= 2) continue;
			const x = e.x;
			const y = e.y;
			const distance = squareDistance(centerX, centerY, x, y);
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

		const manorArr = roomManor.arr as (number | string)[];
		const labAnchor = findLabAnchorByTs(manorArr, storageX, storageY);
		const labX = labAnchor.x;
		const labY = labAnchor.y;

		/**
		 * 这里开始计算布局！
		 * @type {{}}
		 */
			const structMap: StructMap = {};
			for (const e in CONTROLLER_STRUCTURES) structMap[e] = [];
			if (!structMap['road']) structMap['road'] = [];
			const walkableArr = roomWalkable.arr as number[];
			const roadSet = new Uint8Array(2500);
			const pushRoad = (x: number, y: number) => {
				if (x < 0 || x > 49 || y < 0 || y > 49) return;
				const idx = x * 50 + y;
				if (!walkableArr[idx]) return;
				if (roadSet[idx]) return;
				roadSet[idx] = 1;
				structMap['road'].push([x, y]);
			};

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
				pushRoad(storageX + i + j, storageY + i - j); //仿射变换 [sin,cos,cos,-sin]
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
				else pushRoad(labX + i, labY + jj);
			}
		}

		for (let i = -1; i < 3; i++) {
			for (let j = -1; j < 3; j++) {
				if (vis[i + '_' + j]) continue;
				const jj = labChangeDirection ? j : 1 - j;
				const structs = labs[i + 1].charAt(j + 1);
				if (structs == '☢') structMap['lab'].push([labX + i, labY + jj]);
				else pushRoad(labX + i, labY + jj);
			}
		}

		for (let i = 0; i < walls.length; i++) {
			const e = walls[i];
			structMap['rampart'].push([e.x, e.y]);
		}

		for (const struct in CONTROLLER_STRUCTURES) {
			const arr = structMap[struct];
			for (let i = 0; i < arr.length; i++) {
				const e = arr[i];
				roomStructs.set(e[0], e[1], struct);
			}
		}

		const roads = structMap['road'];
		for (let i = 0; i < roads.length; i++) {
			const e = roads[i];
			roomStructs.set(e[0], e[1], 1);
		}
		//设置权值，bfs联通路径！
		const roomManorArrForModel = roomManor.arr as (number | string)[];
		const roomStructsArrForModel = roomStructs.arr as (number | string)[];
		const setModel = function (xx, yy) {
			const checkAble = (x, y) => {
				if (x < 0 || y < 0 || x > 49 || y > 49) return false;
				const idx = x * 50 + y;
				const manorVal = roomManorArrForModel[idx];
				return typeof manorVal === 'number' && manorVal > 0 && !roomStructsArrForModel[idx];
			};
			for (let i = -1; i <= 1; i++) {
				for (let j = -1; j <= 1; j++) {
					const x = xx + i + j;
					const y = yy + i - j;
					if (checkAble(x, y)) {
						const idx = x * 50 + y;
						if (i || j) {
							// structMap["road"] .push([x,y]) //仿射变换 [sin,cos,cos,-sin]
							roomStructsArrForModel[idx] = 1;
						} else {
							// structMap["spawn"] .push([x,y])
							roomStructsArrForModel[idx] = 12;
						}
					}
				}
			}
			for (let i = 0; i < 4; i++) {
				const x = xx + DIR4[i][0];
				const y = yy + DIR4[i][1];
				if (checkAble(x, y)) {
					// structMap["extension"] .push([x,y])
					roomStructsArrForModel[x * 50 + y] = 8;
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
		const visitedArrForPath = visited.arr as number[];
		visitedArrForPath[storageX * 50 + storageY] = 1;

		queMin.push(NewNode(1, storageX, storageY));
		const costRoad = routeDistance; //重复使用
		costRoad.init();
		const roomStructArrForPath = roomStructs.arr as (number | string)[];
		const costRoadArrForPath = costRoad.arr as number[];
		queMin.whileNoEmpty((nd) => {
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (!dx && !dy) continue;
					const x = nd.x + dx;
					const y = nd.y + dy;
					if (x < 0 || x > 49 || y < 0 || y > 49) continue;
					const nidx = x * 50 + y;
					const nValRaw = roomStructArrForPath[nidx];
					const nVal = typeof nValRaw === 'number' ? nValRaw : 0;
					if (!visitedArrForPath[nidx] && nVal > 0) {
						visitedArrForPath[nidx] = 1;
						queMin.push(NewNode(nd.k + nVal, x, y));
					}
				}
			}
			costRoadArrForPath[nd.x * 50 + nd.y] = nd.k;
		});

		for (let i = 0; i < structMap['road'].length; i++) {
			const e = structMap['road'][i];
			roomStructs.set(e[0], e[1], 'road'); //这里把之前的road覆盖上去防止放在之前里road上了
		}
		const costArr = costRoad.arr as number[];
		const roomStructArr = roomStructs.arr as (number | string)[];
		nearMinCostCache.fill(65535);
		const getNearMinCost = (x, y, idx) => {
			const cached = nearMinCostCache[idx];
			if (cached !== 65535) return cached;
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
			const res = minVal === 65535 ? 0 : minVal;
			nearMinCostCache[idx] = res;
			return res;
		};

		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				const idx = x * 50 + y;
				const val = costArr[idx];
				if (!val) continue;
				const minVal = getNearMinCost(x, y, idx);
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
				if (typeof val !== 'number' || val <= 0) continue;
				const dist = getNearMinCost(x, y, idx) || 100;
				// let dist = Math.sqrt(Math.pow(x-storageX,2)+Math.pow(y-storageY,2))
				if (val == 12) {
					// 8 && 12 上面有写，注意！！！
					spawnPos.push([x, y, dist]);
				} else {
					extensionPos.push([x, y, dist]);
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
		for (let si = 0; si < structOrder.length; si++) {
			const struct = structOrder[si];
			const cnt = CONTROLLER_STRUCTURES[struct][8];
			for (let i = 0; i < cnt; i++) {
				const e = spawnIdx < spawnPos.length ? spawnPos[spawnIdx++] : extensionPos[extIdx++];
				if (!e) continue;
				structMap[struct].push([e[0], e[1]]);
				putList.push([e[0], e[1], struct]);
			}
		}
		const remainPos = extensionPos.slice(extIdx);
		for (let i = spawnIdx; i < spawnPos.length; i++) remainPos.push(spawnPos[i]);
		extensionPos = remainPos.sort(cmpFunc);
		let extCnt = 60;
		for (let i = 0; i < extensionPos.length; i++) {
			const e = extensionPos[i];
			if (extCnt > 0) {
				structMap['extension'].push([e[0], e[1]]);
				putList.push([e[0], e[1], 'extension']);
				extCnt -= 1;
			}
		}

		// 更新roads
		roomStructs.init();
			for (const struct in CONTROLLER_STRUCTURES) {
				const arr = structMap[struct];
				for (let i = 0; i < arr.length; i++) {
					const e = arr[i];
					roomStructs.set(e[0], e[1], struct);
				}
			}
			visited.init();
			for (let i = 0; i < structMap['road'].length; i++) {
				const e = structMap['road'][i];
				visited.set(e[0], e[1], 1);
			}
			for (let i = 0; i < putList.length; i++) {
				const e = putList[i];
				const x = e[0];
				const y = e[1];
				let minVal = 50;
				costRoad.forNear(
					(x1, y1, val) => {
						if (minVal > val && val > 0) minVal = val;
					},
					x,
					y
				);
				costRoad.forNear(
					(x1, y1, val) => {
						if (minVal == val && val > 0) {
							roomStructs.set(x1, y1, 'road');
						}
					},
					x,
					y
				);
			}
			roomStructs.forEach((x, y, val) => {
				if (val == 'link' || val == 'container') return;
				if (typeof val === 'number' && val > -1) return;
				let minVal = 50;
				costRoad.forNear(
					(x1, y1, nVal) => {
						if (minVal > nVal && nVal > 0) {
							minVal = nVal;
						}
					},
					x,
					y
				);
				costRoad.forNear(
					(x1, y1, nVal) => {
						if (minVal == nVal && nVal > 0) {
							if (!visited.exec(x1, y1, 1)) pushRoad(x1, y1);
						}
					},
					x,
					y
				);
			});

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
					const arr = structMap[struct];
					for (let i = 0; i < arr.length; i++) {
						const e = arr[i];
						costs.set(e[0], e[1], 255);
					}
				}
			}
			for (let i = 0; i < structMap['road'].length; i++) {
				const e = structMap['road'][i];
				costs.set(e[0], e[1], 1);
			}
			structMap['container'].sort((a, b) => {
				const adx = a[0] - storageX;
				const ady = a[1] - storageY;
				const bdx = b[0] - storageX;
				const bdy = b[1] - storageY;
				return adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
			});
			for (let i = 0; i < structMap['container'].length; i++) {
				const e = structMap['container'][i];
				const result = PathFinder.search(
					new RoomPosition(centerX, centerY, roomName),
					{ pos: new RoomPosition(e[0], e[1], roomName), range: 1 },
					{
						roomCallback: () => costs,
						maxRooms: 1
					}
				);
				const path = result.path || [];
				for (let j = 0; j < path.length; j++) {
					const pos = path[j];
					if (costs.get(pos.x, pos.y) != 1) {
						pushRoad(pos.x, pos.y);
						costs.set(pos.x, pos.y, 1);
					}
				}
			}
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










