/**
 * rush 房间状态存取：每 tick 态（Room 实例天然逐 tick 重建，用 WeakMap 挂靠）、
 * 跨 tick 堆缓存（模块级 Map，等价 global 堆）、持久记忆字段的统一入口。
 */
import { RushMinHeap } from './minHeap';
import type { RushRoomHeap, RushRoomTickState, RushSpawnRequest } from './types';
/** 每 tick 态：以 Room 实例为键，无失效成本 */
const tickStates = new WeakMap<Room, RushRoomTickState>();

export const getRushTickState = (room: Room): RushRoomTickState => {
    let state = tickStates.get(room);
    if (!state) {
        state = {
            freeSpawns: [],
            numSpawns: 0,
            canSpawn: false,
            spawnBalanceAdded: false,
            spawnBalanceSubtracted: false,
            spawnQueue: new RushMinHeap<RushSpawnRequest>((request) => request.priority),
            creeps: {},
            creepsToFill: [],
        };
        tickStates.set(room, state);
    }
    return state;
};

/** 跨 tick 堆缓存：进程生命周期内复用，lastUsed 供清理 */
const roomHeaps = new Map<string, RushRoomHeap>();

export const getRushRoomHeap = (roomName: string): RushRoomHeap => {
    const hit = roomHeaps.get(roomName);
    if (hit) {
        hit.lastUsed = Game.time;
        return hit;
    }
    const fresh = { lastUsed: Game.time };
    roomHeaps.set(roomName, fresh);
    return fresh;
};

export const clearRushRoomHeap = (roomName: string): void => {
    roomHeaps.delete(roomName);
};

/** creep 级跨 tick 堆缓存（挂单/接力防抖等状态） */
const creepHeaps = new Map<string, Record<string, any>>();

export const getRushCreepHeap = (creepName: string): Record<string, any> => {
    let heap = creepHeaps.get(creepName);
    if (!heap) {
        heap = {};
        creepHeaps.set(creepName, heap);
    }
    return heap;
};

export const clearRushCreepHeap = (creepName: string): void => {
    creepHeaps.delete(creepName);
};
