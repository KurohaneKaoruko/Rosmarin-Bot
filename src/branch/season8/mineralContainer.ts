// 矿物专用 container 判定：排除与控制器/能量源共享的容器位，避免误判为矿物容器。
const CONTROLLER_SHARED_RANGE = 3;
const SOURCE_SHARED_RANGE = 1;
const MINERAL_CONTAINER_RANGE = 1;

const getRoomSources = (room: Room): Source[] => {
    const cached = (room as any).source as Source[] | undefined;
    if (cached && cached.length > 0) return cached;
    return room.find(FIND_SOURCES);
};

export const isSharedWithEnergyInfra = (room: Room, pos: RoomPosition): boolean => {
    const controller = room.controller;
    if (controller && pos.inRangeTo(controller.pos, CONTROLLER_SHARED_RANGE)) {
        return true;
    }

    const sources = getRoomSources(room);
    for (const source of sources) {
        if (pos.inRangeTo(source.pos, SOURCE_SHARED_RANGE)) {
            return true;
        }
    }

    return false;
};

export const isDedicatedMineralContainerPos = (room: Room, pos: RoomPosition): boolean => {
    const mineral = room.mineral || room.find(FIND_MINERALS)[0];
    if (!mineral) return false;
    if (!pos.inRangeTo(mineral.pos, MINERAL_CONTAINER_RANGE)) return false;
    if (isSharedWithEnergyInfra(room, pos)) return false;
    return true;
};

export const findDedicatedMineralContainer = (room: Room): StructureContainer | null => {
    const containers = room.container || [];
    for (const container of containers) {
        if (isDedicatedMineralContainerPos(room, container.pos)) {
            return container;
        }
    }
    return null;
};
