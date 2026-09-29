/**
 * 控制台参数推断工具：让常用指令「能不传的参数就不传」。
 *
 * 房间名推断优先级（与快速启动 room.start 保持一致）：
 * 1. 显式传入的合法房间名
 * 2. centerPos / storagePos 旗帜所在房间（启动流程的自然锚点）
 * 3. 唯一「已拥有但尚未托管」的房间（新占领房一键接管）
 * 4. 唯一己方房间（单房玩家零输入）
 * 5. 唯一已托管房间
 * 无法唯一确定时返回带候选列表的 Error，提示补参数。
 */
import { getRoomData } from '@/modules/shared/memory';

export const ROOM_NAME_PATTERN = /^[EW][0-9]+[NS][0-9]+$/;

export const isValidRoomName = (name?: string | null): name is string =>
    !!name && ROOM_NAME_PATTERN.test(name);

export type RoomNameSource = 'explicit' | 'flag' | 'uncontrolled' | 'owned' | 'controlled';

export type RoomNameResolution = {
    roomName: string | null;
    source: RoomNameSource | null;
    error?: Error;
};

/** 当前有视野且控制器属于自己的房间名列表 */
export const getOwnedRoomNames = (): string[] =>
    Object.values(Game.rooms)
        .filter(room => room && room.controller && room.controller.my)
        .map(room => room.name);

/** centerPos / storagePos 旗帜所在的房间名（启动流程的定位锚点） */
export const getFlagAnchorRoomName = (): string | null => {
    const flag = Game.flags.centerPos || Game.flags.storagePos;
    return flag?.pos?.roomName ?? null;
};

const listText = (rooms: string[]) => rooms.join('、');

/**
 * 统一房间名推断入口。
 * 显式传入时只做格式校验（不要求有视野，便于提前配置未占领房间）。
 */
export const resolveRoomName = (explicit?: string | null): RoomNameResolution => {
    if (explicit) {
        if (!isValidRoomName(explicit)) {
            return {
                roomName: null,
                source: null,
                error: Error(`房间名 ${explicit} 格式不正确，应为形如 W1N1 / E23S4 的房间名。`),
            };
        }
        return { roomName: explicit, source: 'explicit' };
    }

    const flagRoom = getFlagAnchorRoomName();
    if (flagRoom) return { roomName: flagRoom, source: 'flag' };

    const owned = getOwnedRoomNames();
    if (owned.length === 0) {
        return {
            roomName: null,
            source: null,
            error: Error('未找到可用的己方房间：请先占领房间，或显式传入房间名。'),
        };
    }

    const uncontrolled = owned.filter(name => !getRoomData(name));
    if (uncontrolled.length === 1) return { roomName: uncontrolled[0], source: 'uncontrolled' };
    if (owned.length === 1) return { roomName: owned[0], source: 'owned' };

    const controlled = Object.keys(getRoomData()).filter(name => owned.includes(name));
    if (controlled.length === 1) return { roomName: controlled[0], source: 'controlled' };

    return {
        roomName: null,
        source: null,
        error: Error(
            `无法唯一确定目标房间，请显式传入房间名。候选：${listText(uncontrolled.length ? uncontrolled : owned)}` +
            `（也可以放置 centerPos 旗帜来自动定位）`,
        ),
    };
};

/** 房间名推断来源的友好描述（用于日志提示用户“参数是从哪来的”） */
export const ROOM_NAME_SOURCE_TEXT: Record<RoomNameSource, string> = {
    explicit: '手动指定',
    flag: 'centerPos/storagePos 旗帜定位',
    uncontrolled: '唯一未托管己方房间',
    owned: '唯一己方房间',
    controlled: '唯一已托管房间',
};
