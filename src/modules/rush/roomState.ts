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

/** controller 容器（堆 id 由容器管理方 3.4 写入；未落地前为空） */
export const getControllerContainer = (room: Room): StructureContainer | undefined => {
    const id = getRushRoomHeap(room.name).controllerContainerId as string | undefined;
    return id ? (Game.getObjectById<StructureContainer>(id) ?? undefined) : undefined;
};

/** 交换两名 creep 的堆缓存（relay 换向：身份互换后状态跟着走） */
export const swapRushCreepHeap = (nameA: string, nameB: string): void => {
    const a = creepHeaps.get(nameA);
    const b = creepHeaps.get(nameB);
    creepHeaps.set(nameA, b);
    creepHeaps.set(nameB, a);
};
