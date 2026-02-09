/**
 * moveOptimization 模块类型声明
 * 声明需要扩展的类型和全局变量
 */

// 声明 cache 全局变量
declare const cache: {
    globalPathCache: any;
    pathCacheTimer: any;
    creepPathCache: any;
    creepMoveCache: any;
    costMatrixCache: any;
    costMatrixRevision: any;
    costMatrixCacheTimer: any;
    roomNameParseCache?: { [roomName: string]: any };
};

// 扩展全局接口
declare global {

    interface Memory {
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

    interface Creep {
        $move?(target: DirectionConstant | Creep): ScreepsReturnCode;
        $moveTo?(firstArg: number | RoomObject, secondArg?: number | MoveToOpts, opts?: MoveToOpts): ScreepsReturnCode;
        $flee?(targets: AnyCreep[], opts?: PathFinderOpts): ScreepsReturnCode;
        _bmMoveToDedup?: { tick: number; key: string; ret: ScreepsReturnCode };
    }

    interface RoomPosition {
        $findClosestByPath?: <T extends _HasId>(type: FIND, opts?: FindPathOpts & FilterOptions<T>) => T | null;
        $findSquadPathTo?(toPos: RoomPosition | { x: number; y: number; roomName?: string }, opts?: any): RoomPosition[];
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
}

// PathFinder 搜索结果类型
interface PathFinderResult {
    path: RoomPosition[];
    incomplete?: boolean;
}

// 导出以支持模块化
export { PathFinderResult, MoveCache, PathFinderOpts, SquadPathOpts };
