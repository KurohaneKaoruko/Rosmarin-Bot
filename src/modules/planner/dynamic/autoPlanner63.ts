// @ts-nocheck
import { PriorityQueue, NewNode } from '@/modules/utils/priorityQueue'
import { RoomArray } from '@/modules/utils/roomArray'
import HelperVisual from '@/modules/planner/helperVisual'

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
		roomManor.forEach((x, y) => {
			if (tarRoot == unionFind.find(x * 50 + y)) {
				roomManor.set(x, y, 1);
			}
		});
		roomManor.forEach((x, y, val) => {
			if (val) {
				let manorCnt = 0;
				let wallCnt = 0;
				roomManor.for4Direction(
					(x1, y1, val1) => {
						if (val1) manorCnt += 1;
						if (!roomWalkable.get(x1, y1)) wallCnt += 1;
					},
					x,
					y
				);
				if (manorCnt == 1 && wallCnt == 0) roomManor.set(x, y, 0);
			}
		});
		const dfsMoreManor = function (x, y, val) {
			if (!val && roomWalkable.get(x, y)) {
				let manorCnt = 0;
				let wallCnt = 0;
				roomManor.for4Direction(
					(x1, y1, val1) => {
						if (val1) manorCnt += 1;
						if (!roomWalkable.get(x1, y1)) wallCnt += 1;
					},
					x,
					y
				);
				if (manorCnt >= 2 || (manorCnt == 1 && wallCnt >= 2)) {
					roomManor.set(x, y, 1);
					roomManor.for4Direction(
						(x1, y1, val1) => {
							dfsMoreManor(x1, y1, val1);
						},
						x,
						y
					);
				}
			}
		};
		roomManor.forEach((x, y, val) => {
			dfsMoreManor(x, y, val);
		});
		roomWalkable.forBorder((x, y, val) => {
			if (val) {
				roomManor.forNear(
					(x, y) => {
						roomManor.set(x, y, 0);
					},
					x,
					y
				);
				roomManor.set(x, y, 0);
			}
		});

		const innerPutAbleList = [];
		const AllCacheList = [];

		visited.init();

		roomWalkable.forEach((x, y, val) => {
			if (!roomManor.get(x, y)) {
				queMin.push(NewNode(val ? -4 : -1, x, y));
				// visited.set(x,y,1) 这里不能设置visited 因为 -4 和-1 优先级不同 如果 -4距离和-1比较，-1会抢走-4 导致 rangeAttack打得到
			}
		});

		// let t = Game.cpu.getUsed() //这很吃性能，真的优化不动了

		queMin.whileNoEmpty((nd) => {
			const func = function (x, y, val) {
				const item = NewNode(nd.k + 2, x, y);
				if (!visited.exec(x, y, 1)) {
					queMin.push(NewNode(nd.k + 1, x, y));
					if (roomManor.get(x, y)) {
						if (nd.k + 1 >= 0 && val) {
							innerPutAbleList.push(item);
							// visual.text(nd.k+2, x,y+0.25, {color: 'red',opacity:0.99,font: 7})
						}
						if (val) AllCacheList.push(item);
					}
				}
			};
			visited.set(nd.x, nd.y, 1);
			if (nd.k >= -1) roomWalkable.for4Direction(func, nd.x, nd.y);
			else roomWalkable.forNear(func, nd.x, nd.y);
		});

		// console.log(Game.cpu.getUsed()-t)

		putAbleCacheMap[tarRoot] = innerPutAbleList;
		AllCacheMap[tarRoot] = AllCacheList;
		return [putAbleCacheMap[tarRoot], AllCacheMap[tarRoot]];
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

		// 对距离的格子插入到队列 ，作为分开的顺序
		routeDistance.forEach((x, y, val) => {
			if (!roomWalkable.get(x, y)) return;
			if (val) startPoint.push(NewNode(-val, x, y));
		});

		const sizeMap = {};
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

			//搜索分块
			const dfsFindDown = function (roomArray, x, y) {
				const currentValue = roomArray.get(x, y);
				if (!visited.exec(x, y, 1)) {
					roomArray.for4Direction(
						(x1, y1, val) => {
							if (val && (x1 == x || y1 == y) && val < currentValue) {
								dfsFindDown(roomArray, x1, y1);
							}
						},
						x,
						y
					);
					// visual.circle(x,y, {fill: color, radius: 0.5 ,opacity : 0.5})
					const pos = x * 50 + y;
					if (unionFind.find(pos) && unionFind.find(currentPos) && (!blocked || !blocked.get(x, y))) {
						unionFind.union(currentPos, pos);
						posSeq.push(pos);
						cnt++;
					} else if (blocked) unionFind.union(pos, 0);
				}
			};

			// 跑到最高点
			const dfsFindUp = function (roomArray, x, y) {
				const currentValue = roomArray.get(x, y);
				if (!visited.exec(x, y, 1)) {
					roomArray.forNear(
						(x1, y1, val) => {
							if (val > currentValue && currentValue < 6) {
								//加了一点优化，小于时分裂更过
								dfsFindUp(roomArray, x1, y1);
							} else if (val && val < currentValue) {
								dfsFindDown(roomArray, x1, y1);
							}
						},
						x,
						y
					);
					// visual.circle(x,y, {fill: color, radius: 0.5 ,opacity : 0.5})
					const pos = x * 50 + y;
					if (unionFind.find(pos) && unionFind.find(currentPos) && (!blocked || !blocked.get(x, y))) {
						unionFind.union(currentPos, pos);
						posSeq.push(pos);
						cnt++;
					} else if (blocked) unionFind.union(pos, 0);
				}
			};
			dfsFindUp(nearWallWithInterpolation, nd.x, nd.y);

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

		const putAbleCacheMap = {};
		const allCacheMap = {};
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
			_.keys(nearCntMap).forEach((currentPos) => {
				const currentRatio = nearCntMap[currentPos] / Math.sqrt(Math.min(sizeMap[currentPos], nd.k)); //实际/期望
				if (currentRatio == maxRatio ? sizeMap[currentPos] < sizeMap[targetPos] : currentRatio > maxRatio) {
					targetPos = currentPos;
					maxRatio = currentRatio;
					nearCnt = nearCntMap[currentPos];
				}
			});
			_.keys(nearCntMap).forEach((currentPos) => {
				if (nearCnt < nearCntMap[currentPos]) {
					targetPos = currentPos;
					nearCnt = nearCntMap[currentPos];
				}
			});
			const minSize = sizeMap[targetPos];
			const cnt = nd.k + minSize;
			// let nearRatio =nearCntMap[targetPos]/allNearCnt;

			let targetBlockPutAbleCnt = 0;
			let ndkBlockPutAbleCnt = 0;
			if (minSize > minPlaneCnt)
				targetBlockPutAbleCnt = ManagerPlanner.getBlockPutAbleCnt(
					roomWalkable,
					visited,
					queMin2,
					unionFind,
					targetPos,
					putAbleCacheMap,
					allCacheMap
				)[0].length;
			if (nd.k > minPlaneCnt)
				ndkBlockPutAbleCnt = ManagerPlanner.getBlockPutAbleCnt(
					roomWalkable,
					visited,
					queMin2,
					unionFind,
					nd.v,
					putAbleCacheMap,
					allCacheMap
				)[0].length;

			// 合并
			if (targetPos && Math.max(targetBlockPutAbleCnt, ndkBlockPutAbleCnt) < minPlaneCnt) {
				unionFind.union(pos, targetPos);
				nd.v = unionFind.find(pos);

				if (pos != nd.v) delete sizeMap[pos];
				else delete sizeMap[targetPos];

				nd.k = cnt;
				sizeMap[nd.v] = cnt;
				posSeqMap[nd.v] = posSeqMap[targetPos].concat(posSeqMap[pos]);
				delete putAbleCacheMap[nd.v];
				delete putAbleCacheMap[targetPos];
				if (pos != nd.v) delete posSeqMap[pos];
				else delete posSeqMap[targetPos];
				queMin.push(NewNode(nd.k, nd.x, nd.y, nd.v));
			}
		});
		// 打印结果

		roomWalkable.forEach((x, y, val) => {
			if (typeof val === 'number' && val > 0 && sizeMap[unionFind.find(x * 50 + y)] > 0)
				visual.circle(x, y, {
					fill: HelperVisual.randomColor(unionFind.find(x * 50 + y).toString()),
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
	computeManor(roomName, points, blocked?) {
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
		_.keys(sizeMap).forEach((pos) => {
			// if(sizeMap[pos]<150)return

			ManagerPlanner.getBlockPutAbleCnt(roomWalkable, visited, queMin, unionFind, pos, putAbleCacheMap, allCacheMap);
			const currentPutAbleList = putAbleCacheMap[pos];
			const allList = allCacheMap[pos];
			if (currentPutAbleList.length < minPlaneCnt) return;
			if (
				Game.flags.storagePos &&
				!currentPutAbleList.find((e) => e.x == Game.flags.storagePos.pos.x && e.y == Game.flags.storagePos.pos.y)
			)
				return;

			wallMap[pos] = [];

			visited.init();
			roomWalkable.forBorder((x, y, val) => {
				if (val) {
					queMin.push(NewNode(0, x, y));
					visited.set(x, y, 1);
				}
			});

			const roomManor = routeDistance; //当前的Manor
			roomManor.init();
			allList.forEach((e) => {
				roomManor.set(e.x, e.y, 1);
			});
			// currentPutAbleList.forEach(e=>visual.text(e.k, e.x,e.y+0.25, {color: 'red',opacity:0.99,font: 1}))

			queMin.whileNoEmpty((nd) => {
				if (!roomManor.get(nd.x, nd.y))
					roomWalkable.forNear(
						(x, y, val) => {
							if (!visited.exec(x, y, 1) && val) {
								if (!roomManor.get(x, y)) queMin.push(NewNode(nd.k + 1, x, y));
								else {
									wallMap[pos].push(NewNode(0, x, y));
									// visual.text('X', x,y+0.25, {color: 'red',opacity:0.99,font: 7})
								}
							}
						},
						nd.x,
						nd.y
					);
			});

			// wallMap[pos].forEach(xy=>queMin.push(NewNode(0,xy.x,xy.y)))

			const currentInnerPutAbleList = currentPutAbleList;

			let maxDist = 0;
			const filter2 = currentInnerPutAbleList.filter((e) => e.k > 2);
			if (filter2.length < 30) {
				filter2.forEach((a) => {
					filter2.forEach((b) => {
						maxDist = Math.max(maxDist, Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
					});
				});
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
				minPlaneCnt < currentPutAbleList.length &&
				wallCnt > currentWallCnt &&
				(currentInnerPutAbleList.filter((e) => e.k > 1).length > 30 || maxDist > 5)
			) {
				// putAbleList = currentPutAbleList;
				innerPutAbleList = currentInnerPutAbleList;
				wallCnt = currentWallCnt;
				finalPos = pos;
				if (Game.flags.storagePos) {
					centerX = Game.flags.storagePos.pos.x;
					centerY = Game.flags.storagePos.pos.y;
				} else {
					centerX = currentPutAbleList.map((e) => e.x).reduce((a, b) => a + b) / currentPutAbleList.length;
					centerY = currentPutAbleList.map((e) => e.y).reduce((a, b) => a + b) / currentPutAbleList.length;
				}
			}

			// allCacheMap[pos].forEach(t=>{
			//     visual.circle(t.x, t.y, {fill: randomColor(pos), radius: 0.5 ,opacity : 0.15})
			// })
		});

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
		innerPutAbleList
			.filter((e) => e.k > 2)
			.forEach((e) => {
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
			});

		if (Game.flags.storagePos) {
			storageX = Game.flags.storagePos.pos.x;
			storageY = Game.flags.storagePos.pos.y;
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

		roomManor.forEach((x, y, val) => {
			// HelperVisual.showText(roomName,val,{x:x,y:y},"cyan",0.75)
			if (typeof val === 'number' && val >= 2) {
				// if(roomManor.get(x,y)>0&&Math.abs(x-storageX)+Math.abs(y-storageY)>2)
				// visual.text(val, x,y+0.25, {color: 'cyan',opacity:0.99,font: 7})
				const distance = Math.sqrt(Math.pow(storageX - x - 1.5, 2) + Math.pow(storageY - y - 1.5, 2));
				if (labDistance <= distance) return;
				let checkCnt = 0;
				const check = function (x, y) {
					if ((roomManor.get(x, y)) > 0 && Math.abs(x - storageX) + Math.abs(y - storageY) > 2) {
						checkCnt += 1;
					}
				};
				for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) check(x + i, y + j);
				if (checkCnt == 16) {
					// HelperVisual.showText(roomName,parseInt(distance*10),{x:x+1.5,y:y+1.5},"cyan",0.75)
					labDistance = distance;
					labX = x;
					labY = y;
				}
			}
		});
		labX += 1;
		labY += 1;

		// visual.text("C", centerX,centerY+0.25, {color: 'green',opacity:0.99,font: 7})
		// visual.text("S", storageX,storageY+0.25, {color: 'blue',opacity:0.99,font: 7})
		// visual.text("L", labX+0.5,labY+0.75, {color: 'blue',opacity:0.99,font: 7})
		// clog(roomName)

		// clog(roomName,storageX,storageY,labX,labY,innerPutAbleList.length,wallCnt,finalPos)
		// clog(innerPutAbleList.filter(e=>e.k==1).length)

		// _.keys(sizeMap).forEach(e=>{
		//     let y = e%50
		//     let x = ((e-y)/50)//Math.round
		//     let color = "red"
		//     if(sizeMap[e]>0)visual.text(parseInt(sizeMap[e]*10)/10, x,y+1+0.25, {color: color,opacity:0.99,font: 7})
		// })

		// CONTROLLER_STRUCTURES: {
		//     "spawn": {0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 3},
		//     "extension": {0: 0, 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60},
		//     "link": {1: 0, 2: 0, 3: 0, 4: 0, 5: 2, 6: 3, 7: 4, 8: 6},
		//     "road": {0: 2500, 1: 2500, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500},
		//     "constructedWall": {1: 0, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500},
		//     "rampart": {1: 0, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500},
		//     "storage": {1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1},
		//     "tower": {1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 6},
		//     "observer": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1},
		//     "powerSpawn": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1},
		//     "extractor": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1},
		//     "terminal": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1},
		//     "lab": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 3, 7: 6, 8: 10},
		//     "container": {0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5},
		//     "nuker": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1},
		//     "factory": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 1, 8: 1}
		// }

		// nearWall.forEach((x: number, y: number, val: number | string)=>{if(val>2&&finalPos==unionFind.find(x*50+y))visual.text(nearWall.get(x,y),x, y+0.5, {color: "red",opacity:0.99,font: 7})})

		/**
		 * 这里开始计算布局！
		 * @type {{}}
		 */
		const structMap = {};
		_.keys(CONTROLLER_STRUCTURES).forEach((e) => (structMap[e] = []));

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

		_.keys(CONTROLLER_STRUCTURES).forEach((struct) =>
			structMap[struct].forEach((e) => roomStructs.set(e[0], e[1], struct))
		);

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

		costRoad.forEach((x, y, val) => {
			if (!val) return;
			let minVal = 50;
			// let finalX = 0;
			// let finalY = 0;
			costRoad.forNear(
				(x1, y1, val) => {
					if (minVal > val && val > 0) {
						minVal = val;
						// finalX = x1
						// finalY = y1
					}
				},
				x,
				y
			);
			// 方案2 没那么密集
			costRoad.forNear(
				(x1, y1, val) => {
					if (minVal == val && val > 0) {
						// structMap["road"].push([x1,y1])
						roomStructs.set(x1, y1, 'road');
					}
				},
				x,
				y
			);
			// 方案1 密集
			// structMap["road"].push([finalX,finalY])
			// roomStructs.set(finalX,finalY,"road")
		});

		let spawnPos = [];
		let extensionPos = [];
		roomStructs.forEach((x, y, val) => {
			if (val > 0) {
				let dist = 100;
				costRoad.forNear(
					(x, y, val) => {
						if (val) dist = Math.min(dist, val);
					},
					x,
					y
				);
				// let dist = Math.sqrt(Math.pow(x-storageX,2)+Math.pow(y-storageY,2))
				if (val == 12) {
					// 8 && 12 上面有写，注意！！！
					spawnPos.push([x, y, dist]);
				} else {
					extensionPos.push([x, y, dist]);
					// visual.text(dist,x, y+0.25, {color: "pink",opacity:0.99,font: 7})
				}
			}
		});
		const cmpFunc = (a, b) => (a[2] == b[2] ? (a[1] == b[1] ? a[0] - b[0] : a[1] - b[1]) : a[2] - b[2]);
		spawnPos = spawnPos.sort(cmpFunc);
		extensionPos = extensionPos.sort(cmpFunc);
		const oriStruct = [];
		const putList = [];
		['spawn', 'nuker', 'powerSpawn', 'tower', 'observer'].forEach((struct) => {
			for (let i = 0; i < CONTROLLER_STRUCTURES[struct][8]; i++) {
				oriStruct.push(struct);
			}
		});
		oriStruct.forEach((struct) => {
			let e = spawnPos.shift();
			if (!e) e = extensionPos.shift();
			structMap[struct].push([e[0], e[1]]);
			putList.push([e[0], e[1], struct]);
		});
		extensionPos.push(...spawnPos);
		extensionPos = extensionPos.sort(cmpFunc);
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
		_.keys(CONTROLLER_STRUCTURES).forEach((struct) =>
			structMap[struct].forEach((e) => roomStructs.set(e[0], e[1], struct))
		);
		visited.init();
		structMap['road'].forEach((e) => visited.set(e[0], e[1], 1));
		/**
		 * 更新最近的roads 但是可能有残缺
		 */
		putList.forEach((e) => {
			const x = e[0];
			const y = e[1];
			let minVal = 50;
			costRoad.forNear(
				(x1, y1, val) => {
					if (minVal > val && val > 0) {
						minVal = val;
					}
				},
				x,
				y
			);
			// 方案2 没那么密集
			costRoad.forNear(
				(x1, y1, val) => {
					if (minVal == val && val > 0) {
						// 找到建筑最近的那个road
						roomStructs.set(x1, y1, 'road');
					}
				},
				x,
				y
			);
		});
		/**
		 * 再roads的基础上，对roads进行补全，将残缺的连起来
		 */
		roomStructs.forEach((x, y, val) => {
			if (val == 'link' || val == 'container') return; // 资源点的不要 放路
			if (typeof val === 'number' && val > -1) return; // 附近有建筑 ，并且不是road
			// visual.text(val,x, y+0.25, {color: "pink",opacity:0.99,font: 7})
			let minVal = 50;
			costRoad.forNear(
				(x1, y1, val) => {
					if (minVal > val && val > 0) {
						minVal = val;
					}
				},
				x,
				y
			);
			// 方案2 没那么密集
			costRoad.forNear(
				(x1, y1, val) => {
					if (minVal == val && val > 0) {
						// 找到建筑最近的那个road
						if (!visited.exec(x1, y1, 1)) structMap['road'].push([x1, y1]);
					}
				},
				x,
				y
			);
		});

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
		structMap['container'].sort((e) =>
			Math.sqrt((e[0] - storageX) * (e[0] - storageX) + (e[1] - storageY) * (e[1] - storageY))
		);
		structMap['container'].forEach((e) => {
			PathFinder.search(
				new RoomPosition(centerX, centerY, roomName),
				{ pos: new RoomPosition(e[0], e[1], roomName), range: 1 },
				{
					roomCallback: () => {
						return costs;
					},
					maxRooms: 1
				}
			).path.forEach(pos=>{
                if(costs.get(pos.x,pos.y) != 1){
                    structMap['road'].push([pos.x,pos.y])
                    costs.set(pos.x,pos.y,1)
                }
            })
		});
		ManagerPlanner.dismiss();

		return {
			roomName: roomName,
			structMap: structMap,
			storagePos: {storageX, storageY},
			labPos: {labX, labY},
		};
	}
};

global.HelperVisual = HelperVisual;
global.ManagerPlanner = ManagerPlanner;

export const autoPlanner63 = {
	ManagerPlanner: ManagerPlanner,
	HelperVisual: HelperVisual
};
