// @ts-nocheck

/**
 * 用法速查（按字段取用，不加 s）
 *
 * 多个实例（返回数组，可能为空）：
 * - room.spawn / room.extension / room.tower / room.link / room.lab / room.container
 * - room.road / room.rampart / room.constructedWall / room.powerBank
 *
 * 单个实例（返回对象或 undefined）：
 * - room.nuker / room.factory / room.powerSpawn / room.observer / room.extractor / room.invaderCore
 * - room.mineral（等同 room[LOOK_MINERALS]）
 *
 * 非结构对象（返回数组，可能为空）：
 * - room.source（等同 room[LOOK_SOURCES]）
 * - room.deposit（等同 room[LOOK_DEPOSITS]）
 * - room.constructionSite（等同 room[LOOK_CONSTRUCTION_SITES]）
 *
 * 聚合与统计：
 * - room.mass_stores：storage、terminal、factory、container 的数组（仅包含可见对象）
 * - room[RESOURCE_*]：mass_stores 中该资源的总量（按 tick 缓存）
 *
 * 状态字段：
 * - room.my：等同 room.controller?.my
 * - room.level：等同 room.controller?.level
 * - room.structures：本 tick 的 FIND_STRUCTURES 快照（按 tick 缓存）
 *
 * 便捷访问：
 * - room[id]：仅对 24 位 hex 字符串 id 生效，返回 Game.getObjectById(id)
 *
 * 缓存说明：
 * - 索引缓存存放在 local[room.name]（唯一建筑存 id，多建筑存 Set<id>）
 * - 拆除导致的失效 id 会在 getter 中自动剔除
 * - 新建筑/新对象需要调用 room.update() 刷新索引（项目默认每 10 tick 调用一次）
 */

/**
 * Room 建筑与对象缓存（structureCache）
 *
 * @remarks
 * 这是一个基于 `Room.prototype` 的“属性式缓存轮子”，把常用的查找操作封装成 `room.spawn / room.container / room.deposit ...` 这类 getter。
 *
 * 设计要点：
 * - **跨 tick 缓存**：以 `local[room.name]` 保存“结构类型 -> id/Set(id)”的索引；需要 `room.update()` 才会重建索引（项目默认每 10 tick 更新一次）。
 * - **同 tick 缓存**：getter 会把解析出的对象/数组缓存在 `room._<type>` 上，避免同 tick 重复 `Game.getObjectById`。
 * - **自动剔除失效 id**：当 `Game.getObjectById(id)` 为空时，会从 `Set` 中删除该 id，避免长期积累脏数据。
 *
 * @example
 * ```ts
 * // 结构数组（可能为空数组）
 * const towers = room.tower
 * const containers = room.container
 *
 * // 单体结构（可能为 undefined）
 * const factory = room.factory
 *
 * // 本 tick 的结构快照（按 tick 缓存）
 * const all = room.structures
 *
 * // 统计资源总量（按 tick 缓存）
 * const energy = room[RESOURCE_ENERGY]
 *
 * // 通过 id 取对象（仅对 24 位 hex id 生效）
 * const obj = room['65e4c3d8b1b7a1a2b3c4d5e6']
 * ```
 */

/**
 * 多个实例的结构类型集合：`room[type]` 返回数组。
 *
 * @remarks
 * 这里的 key 都是 `STRUCTURE_*` 常量（字符串）。对这些类型：
 * - local 缓存中保存 `Set<Id>`；
 * - getter 返回 `Structure[]`（同 tick 缓存为 `room._<type>`）。
 */
const multipleList = new Set([
	STRUCTURE_SPAWN,
	STRUCTURE_EXTENSION,
	STRUCTURE_ROAD,
	STRUCTURE_WALL,
	STRUCTURE_RAMPART,
	STRUCTURE_KEEPER_LAIR,
	STRUCTURE_PORTAL,
	STRUCTURE_LINK,
	STRUCTURE_TOWER,
	STRUCTURE_LAB,
	STRUCTURE_CONTAINER,
	STRUCTURE_POWER_BANK
]);

/**
 * 唯一实例或“单对象取用”的结构/对象类型集合：`room[type]` 返回单个对象或 undefined。
 *
 * @remarks
 * 这里既包含 `STRUCTURE_*`，也包含 `LOOK_MINERALS`：
 * - 对 `STRUCTURE_*`：local 缓存中保存单个 id；
 * - 对 `LOOK_MINERALS`：local 缓存中保存单个 mineral 的 id。
 */
const singleList = new Set([
	STRUCTURE_OBSERVER,
	STRUCTURE_POWER_SPAWN,
	STRUCTURE_EXTRACTOR,
	STRUCTURE_NUKER,
	STRUCTURE_FACTORY,
	STRUCTURE_INVADER_CORE,
	LOOK_MINERALS
	//STRUCTURE_TERMINAL,   STRUCTURE_STORAGE,
]);

/**
 * 额外对象集合（非 structures）：`room[type]` 返回数组。
 *
 * @remarks
 * - `LOOK_SOURCES` / `LOOK_DEPOSITS` / `LOOK_CONSTRUCTION_SITES`
 * - local 缓存中保存 `Set<Id>`；getter 返回对象数组（同 tick 缓存）。
 */
const additionalList = new Set([
	// room[LOOK_*]获取到数组
	LOOK_SOURCES,
	LOOK_DEPOSITS,
	LOOK_CONSTRUCTION_SITES
]);

/**
 * 跨 tick 的房间索引缓存。
 *
 * @remarks
 * 结构：
 * - `local[roomName][STRUCTURE_*] = id | Set<id>`
 * - `local[roomName][LOOK_*] = id | Set<id>`
 * - `local[roomName].mass_stores = Set<id>`
 *
 * 该对象仅存在于运行进程内（不写入 Memory）。
 */
const local = {};

/**
 * 清理 Room 对象上的“同 tick 缓存字段”，使得后续 getter 重新从 `local` 取数据。
 *
 * @remarks
 * `room.update()` 更新的是 `local`（跨 tick 索引），但 getter 会把值缓存到 `room._<type>`。
 * 若不清理，`room.update()` 后同 tick 内再次访问仍会拿到旧值。
 *
 * @param room - 需要清理缓存的房间对象
 * @param type - 指定清理某一个类型；不传则清理所有已定义的缓存字段
 */
function clearRoomTickCache(room: Room, type?: string) {
	if (!type) {
		for (const t of singleList) delete room['_' + t];
		for (const t of multipleList) delete room['_' + t];
		for (const t of additionalList) delete room['_' + t];
		delete room._mass_stores;
		delete (room as any)._resAmountCache;
		delete room._structures;
		delete room._structures_fetch_time;
		return;
	}
	delete room['_' + type];
	if (type === 'mass_stores') delete room._mass_stores;
	if (type === 'mass_stores') delete (room as any)._resAmountCache;
	if (type === 'structures') {
		delete room._structures;
		delete room._structures_fetch_time;
	}
}

/**
 * 为额外对象（sources/deposits/constructionSites）构建索引缓存。
 *
 * @remarks
 * 这里使用 `room.find(FIND_*)` 而不是 `lookForAtArea` 全图扫描，以降低 CPU。
 *
 * @param room - 目标房间
 * @param type - `LOOK_SOURCES` / `LOOK_DEPOSITS` / `LOOK_CONSTRUCTION_SITES`
 * @returns 若存在对象则返回 `Set<id>`，否则返回 `undefined`
 */
function buildAdditionalCache(room: Room, type: string) {
	if (type === LOOK_SOURCES) {
		const sources = room.find(FIND_SOURCES);
		return sources.length ? new Set(sources.map(s => s.id)) : undefined;
	}
	if (type === LOOK_DEPOSITS) {
		const deposits = room.find(FIND_DEPOSITS);
		return deposits.length ? new Set(deposits.map(d => d.id)) : undefined;
	}
	if (type === LOOK_CONSTRUCTION_SITES) {
		const sites = room.find(FIND_CONSTRUCTION_SITES);
		return sites.length ? new Set(sites.map(s => s.id)) : undefined;
	}
	return undefined;
}

/**
 * 房间索引缓存的构建器（跨 tick）。
 *
 * @remarks
 * 该构建器负责一次性建立：
 * - `singleList` 中各类型的单 id
 * - `multipleList` 中各类型的 id Set
 * - `additionalList` 中各类型的 id Set
 * - `mass_stores`（storage/terminal/factory/container 的 id 集合）
 *
 * 完成后写入 `local[room.name]`。
 */
function Hub(room: Room) {
	this.name = room.name;

	const structures = room.find(FIND_STRUCTURES);
	for (const s of structures) {
		const type = s.structureType;
		if (singleList.has(type)) {
			if (!this[type]) this[type] = s.id;
		} else if (multipleList.has(type)) {
			if (!this[type]) this[type] = new Set();
			this[type].add(s.id);
		}
	}
	for (const type of additionalList) {
		const cache = buildAdditionalCache(room, type);
		if (cache) this[type] = cache;
	}
	const minerals = room.find(FIND_MINERALS);
	if (minerals.length) {
		this[LOOK_MINERALS] = minerals[0].id;
	}

	this.mass_stores = new Set();
	if (room.storage) {
		this.mass_stores.add(room.storage.id);
	}
	if (room.terminal) {
		this.mass_stores.add(room.terminal.id);
	}
	if (this[STRUCTURE_FACTORY]) {
		this.mass_stores.add(this[STRUCTURE_FACTORY]);
	}
	if (this[STRUCTURE_CONTAINER]) {
		this[STRUCTURE_CONTAINER].forEach((id) => this.mass_stores.add(id));
	}

	local[room.name] = this;
}

/**
 * 允许通过 `room[id]` 快速获取对象（仅对 24 位 hex id 生效）。
 *
 * @remarks
 * 这是一个“便利接口”，用来在 **已知 id** 时快速取对象，而不是为了替代正常属性访问。
 * 为了避免误触发（例如拼写错误/调试探测导致大量 `getObjectById`），这里限制：
 * - 只有当 key 是 24 位小写 hex 字符串时才调用 `Game.getObjectById`
 * - 其它 key 直接返回 undefined
 */
Room.prototype.__proto__ = new Proxy(
	{},
	{
		get(cache, id) {
			if (typeof id !== 'string') return undefined;
			if (!/^[0-9a-f]{24}$/.test(id)) return undefined;
			return Game.getObjectById(id);
		}
	}
);

/**
 * 为 `singleList` 中的类型定义 getter：返回单体结构/对象（或 undefined）。
 *
 * @remarks
 * - 本 tick 缓存字段名：`room._<type>`
 * - 跨 tick 索引字段：`local[room.name][type] = id`
 */
singleList.forEach((type) => {
	const bindstring = '_' + type;
	Object.defineProperty(Room.prototype, type, {
		get() {
			if (bindstring in this) {
				return this[bindstring];
			} else {
				const cache = local[this.name] ? local[this.name][type] : new Hub(this)[type];
				if (cache) {
					//console.log(type);
					return (this[bindstring] = Game.getObjectById(cache));
				} else {
					return (this[bindstring] = undefined);
				}
			}
		},
		set() {},
		enumerable: false,
		configurable: true
	});
});

/**
 * 为 `multipleList` 中的结构类型定义 getter：返回结构数组。
 *
 * @remarks
 * - 本 tick 缓存字段名：`room._<type>`
 * - 跨 tick 索引字段：`local[room.name][type] = Set<id>`
 * - 自动清理：若 `Game.getObjectById(id)` 返回空，会从 Set 中删除该 id
 */
multipleList.forEach((type) => {
	const bindstring = '_' + type;
	Object.defineProperty(Room.prototype, type, {
		get() {
			if (bindstring in this) {
				return this[bindstring];
			} else {
				/**@type {Set<string>} */
				const cache = local[this.name] ? local[this.name][type] : new Hub(this)[type];
				this[bindstring] = [];
				if (cache) {
					for (const id of cache) {
						const o = Game.getObjectById(id);
						if (o) {
							this[bindstring].push(o);
						} else {
							cache.delete(id);
						}
					}
				}
				return this[bindstring];
			}
		},
		set() {},
		enumerable: false,
		configurable: true
	});
});

/**
 * 为 `additionalList` 中的对象集合定义 getter：返回对象数组（source/deposit/site）。
 *
 * @remarks
 * - 本 tick 缓存字段名：`room._<type>`
 * - 跨 tick 索引字段：`local[room.name][type] = Set<id>`
 * - 自动清理：若 `Game.getObjectById(id)` 返回空，会从 Set 中删除该 id
 */
additionalList.forEach((type) => {
	const bindstring = '_' + type;
	Object.defineProperty(Room.prototype, type, {
		get() {
			////console.log('in add');
			if (bindstring in this) {
				return this[bindstring];
			} else {
				const cache = local[this.name] ? local[this.name][type] : new Hub(this)[type];
				this[bindstring] = [];
				if (cache) {
					//console.log(type);
					for (const id of cache) {
						const o = Game.getObjectById(id);
						if (o) {
							this[bindstring].push(o);
						} else {
							cache.delete(id);
						}
					}
				}
				return this[bindstring];
			}
		},
		set() {},
		enumerable: false,
		configurable: true
	});
});

/**
 * 更新房间索引缓存。
 *
 * @remarks
 * - 不传 `type`：重建整个房间的索引（等价 new Hub(room)）
 * - 传入 `type`：只更新单一类型索引
 * - 为了保证同 tick 读取到最新值，会同步清理对应的 `room._<type>` 缓存字段
 *
 * @param type - 可选。结构类型（`STRUCTURE_*`）、`LOOK_*`，或 `'mass_stores'`
 */
Room.prototype.update = function (type: string) {
	if (!type || !local[this.name]) {
		// 更新全部
		new Hub(this);
		clearRoomTickCache(this);
	} else if (type) {
		// 指定更新一种建筑
		const cache = local[this.name];
		if (additionalList.has(type)) {
			cache[type] = buildAdditionalCache(this, type);
			clearRoomTickCache(this, type);
		} else if (type == 'mass_stores') {
			this.update(STRUCTURE_CONTAINER);
			this.update(STRUCTURE_FACTORY);
			cache.mass_stores = new Set();
			if (this.storage) {
				cache.mass_stores.add(this.storage.id);
			}
			if (this.terminal) {
				cache.mass_stores.add(this.terminal.id);
			}
			if (this[STRUCTURE_FACTORY]) {
				cache.mass_stores.add(this[STRUCTURE_FACTORY].id);
			}
			if (this[STRUCTURE_CONTAINER].length) {
				this[STRUCTURE_CONTAINER].forEach((cont) => {
					cache.mass_stores.add(cont.id);
				});
			}
			clearRoomTickCache(this, 'mass_stores');
		} else {
			const objects = this.find(FIND_STRUCTURES, {
				filter: (s) => s.structureType == type
			});
			if (objects.length) {
				if (singleList.has(type)) {
					cache[type] = objects[0].id;
				} else {
					cache[type] = new Set(
						objects.map((s) => {
							return s.id;
						})
					);
				}
			} else {
				cache[type] = undefined;
			}
			clearRoomTickCache(this, type);
		}
	}
};

/**
 * 获取房间本 tick 的全部结构数组（按 tick 缓存）。
 *
 * @remarks
 * - 缓存字段：`room._structures` + `room._structures_fetch_time`
 * - 用途：减少业务层重复 `room.find(FIND_STRUCTURES)` 的 CPU 开销
 */
Object.defineProperty(Room.prototype, 'structures', {
	get() {
		if (this._structures_fetch_time === Game.time) return this._structures;
		this._structures = this.find(FIND_STRUCTURES);
		this._structures_fetch_time = Game.time;
		return this._structures;
	},
	set() {},
	enumerable: false,
	configurable: true
});

/**
 * 获取房间内用于存储资源的建筑集合（storage/terminal/factory/container）。
 *
 * @remarks
 * - 返回数组按 `Game.getObjectById` 可见性过滤（不可见/已拆除会被剔除）
 * - 索引由 `room.update('mass_stores')` 或 `room.update()` 构建
 */
Object.defineProperty(Room.prototype, 'mass_stores', {
	get() {
		if ('_mass_stores' in this) {
			return this._mass_stores;
		} else {
			const cache = local[this.name] ? local[this.name].mass_stores : new Hub(this).mass_stores;
			this._mass_stores = [];
			for (const id of cache) {
				const o = Game.getObjectById(id);
				if (o) {
					this._mass_stores.push(o);
				} else {
					cache.delete(id);
				}
			}
			return this._mass_stores;
		}
	},
	set() {},
	enumerable: false,
	configurable: true
});

/**
 * `room.my`：是否为己方房间（等同 `room.controller?.my`）。
 */
Object.defineProperty(Room.prototype, 'my', {
	get() {
		return this.controller && this.controller.my;
	},
	set() {},
	enumerable: false,
	configurable: true
});

/**
 * `room.level`：房间控制器等级（等同 `room.controller?.level`）。
 */
Object.defineProperty(Room.prototype, 'level', {
	get() {
		return this.controller && this.controller.level;
	},
	set() {},
	enumerable: false,
	configurable: true
});

/**
 * 为每一种资源类型定义 `room[RESOURCE_*]` getter：统计 mass_stores 中该资源总量（按 tick 缓存）。
 *
 * @remarks
 * - 统计范围：`room.mass_stores`（storage/terminal/factory/container）
 * - 缓存粒度：每个资源类型各自维护一个 `sum`，在同一个 tick 内重复访问不会重复计算
 */
for (const type of RESOURCES_ALL) {
	Object.defineProperty(Room.prototype, type, {
		get() {
			const cache = (this as any)._resAmountCache ?? ((this as any)._resAmountCache = {});
			const entry = cache[type];
			if (!entry || entry.time !== Game.time) {
				const sum = this.mass_stores.reduce((temp_sum, s) => {
					const used = s.store.getUsedCapacity(type) || 0;
					return temp_sum + used;
				}, 0);
				cache[type] = { time: Game.time, value: sum };
			}
			return cache[type].value;
		},
		set(amount) {
			const cache = (this as any)._resAmountCache ?? ((this as any)._resAmountCache = {});
			cache[type] = { time: Game.time, value: amount };
		},
		enumerable: false,
		configurable: true
	});
}
