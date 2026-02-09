/**
 * MoveOptimization 模块类型增强
 */

// 扩展 Memory 类型
interface MoveOptimizationMemory {
    bypassRooms?: string[];
    _bmRoomBounce?: {
        lastRoom: string;
        prevRoom: string;
        prev2Room: string;
        lastSwitch: number;
        prevSwitch: number;
        blockUntil: number;
        blockFrom: string;
        blockTo: string;
    };
    _bmDetourCooldownUntil?: number;
    _bmSameRoomDetour?: {
        lastRoom: string;
        lastTick: number;
        leftTick: number;
    };
    _lpv?: number;
    _lpt?: number;
    dontPullMe?: boolean;
}

declare global {
    interface Memory {
        bypassRooms?: string[];
        _bmRoomBounce?: MoveOptimizationMemory['_bmRoomBounce'];
        _bmDetourCooldownUntil?: number;
        _bmSameRoomDetour?: MoveOptimizationMemory['_bmSameRoomDetour'];
        _lpv?: number;
        _lpt?: number;
        dontPullMe?: boolean;
    }

    interface Creep {
        $move?: (target: DirectionConstant | Creep) => ScreepsReturnCode;
        $moveTo?: (firstArg: number | RoomObject, secondArg?: number | MoveToOpts, opts?: MoveToOpts) => ScreepsReturnCode;
        $flee?: (targets: AnyCreep[], opts?: PathFinderOpts) => ScreepsReturnCode;
    }

    interface RoomPosition {
        $findClosestByPath?: <T extends _HasId>(type: FIND, opts?: FindPathOpts & FilterOptions<T>) => T | null;
        $findSquadPathTo?: (toPos: RoomPosition | { x: number; y: number; roomName?: string }, opts?: SquadPathOpts) => RoomPosition[];
    }

    interface Global {
        BetterMove?: {
            setChangeMove: (bool: boolean) => ScreepsReturnCode;
            creepPathCache: { [creepName: string]: any };
            setChangeMoveTo: (bool: boolean) => ScreepsReturnCode;
            setChangeFindClostestByPath: (bool: boolean) => ScreepsReturnCode;
            setPathClearDelay: (number: number | undefined) => ScreepsReturnCode;
            setHostileCostMatrixClearDelay: (number: number | undefined) => ScreepsReturnCode;
            deleteCostMatrix: (roomName: string) => ScreepsReturnCode;
            getAvoidRoomsMap: () => { [roomName: string]: number };
            addAvoidRooms: (roomName: string) => ScreepsReturnCode;
            deleteAvoidRooms: (roomName: string) => ScreepsReturnCode;
            getClosestExitPos: (fromPos: RoomPosition, toRoomName: string) => RoomPosition | null;
            setEnableSquadPath: (bool: boolean) => ScreepsReturnCode;
            setEnableFlee: (bool: boolean) => ScreepsReturnCode;
            getConfig: () => any;
            setConfig: (partial: any) => ScreepsReturnCode;
            deletePathInRoom: (roomName: string) => ScreepsReturnCode;
            addAvoidExits: (fromRoomName: string, toRoomName: string) => ScreepsReturnCode;
            deleteAvoidExits: (fromRoomName: string, toRoomName: string) => ScreepsReturnCode;
            print: () => string;
            clear: () => void;
        };
    }

    interface PathFinder {
        CostMatrix: new () => CostMatrix;
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface CostMatrix {}
}

export {};
