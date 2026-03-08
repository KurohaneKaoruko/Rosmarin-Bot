import { decompress } from '@/modules/utils/compress';
import { getLayoutData } from '@/modules/utils/memory';

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

export function hasCoreDepotTarget(room: Room): boolean {
    return !!getCoreDepotTarget(room, 'storage') || !!getCoreDepotTarget(room, 'terminal');
}
