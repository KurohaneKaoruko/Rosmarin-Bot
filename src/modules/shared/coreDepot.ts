import { decompress } from '@/modules/shared/compress';
import { getLayoutData } from '@/modules/shared/memory';

export const CORE_DEPOT_KINDS = ['storage', 'terminal'] as const;

export type CoreDepotKind = typeof CORE_DEPOT_KINDS[number];

type LayoutMemoryLike = Record<string, number[] | undefined> | null | undefined;

type PosLike = {
    x: number;
    y: number;
};

export function getCoreDepotPointFromLayout(
    layoutMemory: LayoutMemoryLike,
    roomName: string,
    kind: CoreDepotKind
): { x: number; y: number; roomName: string } | null {
    const points = layoutMemory?.[kind];
    if (!points || points.length === 0) return null;

    const [x, y] = decompress(points[0]);
    if (x < 0 || x > 49 || y < 0 || y > 49) return null;
    return { x, y, roomName };
}

export function getCoreDepotPoint(roomName: string, kind: CoreDepotKind) {
    return getCoreDepotPointFromLayout(getLayoutData(roomName) as LayoutMemoryLike, roomName, kind);
}

export function getCoreDepotKindAtPos(
    roomName: string,
    pos: PosLike,
    layoutMemory?: LayoutMemoryLike
): CoreDepotKind | null {
    const memory = layoutMemory ?? (getLayoutData(roomName) as LayoutMemoryLike);
    for (const kind of CORE_DEPOT_KINDS) {
        const point = getCoreDepotPointFromLayout(memory, roomName, kind);
        if (point && point.x === pos.x && point.y === pos.y) return kind;
    }
    return null;
}

export function isCoreDepotContainer(
    room: Room,
    container: StructureContainer,
    kind?: CoreDepotKind
): boolean {
    if (!container || container.structureType !== STRUCTURE_CONTAINER) return false;
    if (kind) {
        const point = getCoreDepotPoint(room.name, kind);
        return !!point && point.x === container.pos.x && point.y === container.pos.y;
    }
    return !!getCoreDepotKindAtPos(room.name, container.pos);
}

export function getCoreDepotContainer(room: Room, kind: CoreDepotKind): StructureContainer | null {
    const point = getCoreDepotPoint(room.name, kind);
    if (!point) return null;
    return room.container.find((container) =>
        container &&
        container.pos.x === point.x &&
        container.pos.y === point.y
    ) || null;
}

export function getCoreDepotTarget(room: Room, kind: CoreDepotKind): AnyStoreStructure | null {
    if (kind === 'storage') return room.storage || getCoreDepotContainer(room, kind);
    return room.terminal || getCoreDepotContainer(room, kind);
}

/**
 * 该核心库种类的真建筑在当前 RCL 已可建但尚未建成。
 *
 * 此时占位 container 处于「排空换位」阶段：存入侧停止投料（见
 * haulFunction 的 canAutoStore / findBestStoreTarget），存量交给
 * spawn/塔填充等自然取用耗尽，随后 planner 拆除占位、落真建筑工地——
 * 避免整箱能量砸在地上腐烂，也避免「先拆后建」期间的枢纽缓冲断档。
 */
export function isCoreDepotSwapPending(room: Room, kind: CoreDepotKind): boolean {
    if (kind === 'storage' ? !!room.storage : !!room.terminal) return false;
    const buildMax = (CONTROLLER_STRUCTURES as any)?.[kind]?.[room.level] ?? 0;
    return buildMax > 0;
}

/** 该 container 是否为「排空中」的核心库占位（真建筑可建未建）。 */
export function isCoreDepotContainerDraining(room: Room, target: AnyStoreStructure | null | undefined): boolean {
    if (!target || target.structureType !== STRUCTURE_CONTAINER) return false;
    const kind = getCoreDepotKindAtPos(room.name, target.pos);
    if (!kind) return false;
    return isCoreDepotSwapPending(room, kind);
}

export function hasCoreDepotTarget(room: Room): boolean {
    return !!getCoreDepotTarget(room, 'storage') || !!getCoreDepotTarget(room, 'terminal');
}
