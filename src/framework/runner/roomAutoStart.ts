/**
 * 房间自动开局提供方（解耦倒置）：framework 的 RoomRunner 在首个己方房间落地时
 * 需要「开局」能力，但开局流程属 console（人机指令层）——此处只定义接口与注册点，
 * 实现由组合根的 console 扩展注册，消除 framework→console 反向依赖。
 */
import type { RoomModeName } from '@/modules/shared/roomMode';

export type RoomAutoStartConfig = {
    layout?: string;
    mode?: RoomModeName;
};

export type RoomAutoStartProvider = {
    /** 落地自启：按默认参数静默启动首个己方房间 */
    startFirstRoom: (roomName: string) => void;
    /** 按 RoomAutoStart 配置落地：add + mode + 布局构建 + 布局自动档 */
    applyAutoStart: (roomName: string, autoStart: RoomAutoStartConfig) => void;
};

let provider: RoomAutoStartProvider | null = null;

/** 组合根（console 扩展）注册实现；须先于首次 RoomRunner 运行 */
export const registerRoomAutoStartProvider = (p: RoomAutoStartProvider): void => {
    provider = p;
};

/** 未注册时返回 null（RoomRunner 跳过自动开局，行为等价于「无可开局动作」） */
export const getRoomAutoStartProvider = (): RoomAutoStartProvider | null => provider;
