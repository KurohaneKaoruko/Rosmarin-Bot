/**
 * creep 工具库：工位打包、pull 搭车、路径与缓存工具。
 */

/** 体型造价（逐部件累加） */
export const getBodyCost = (body: BodyPartConstant[]): number =>
    body.reduce((sum, part) => sum + BODYPART_COST[part], 0);

export const fillSpaceWithCreeps = (_room: Room, _anchor: RoomPosition, _creeps: Creep[]): void => {};

