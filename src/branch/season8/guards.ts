// 赛季终端限制：Season8 开启（global.Season8Active）时，终端只允许向己方终端发送。
// 复用共享 console 的 terminal.send（不复制实现，只在其外层加一道赛季闸）。
import { getRoomData } from '@/modules/shared/memory';

const canSendToTargetInSeason = (targetRoom: string): boolean => {
    const visible = Game.rooms[targetRoom];
    if (visible?.controller?.my && visible.terminal) return true;
    return !!getRoomData(targetRoom);
};

/** 在 ConsoleExtension 之后调用：包装 global.terminal.send。 */
export const installSeason8Guards = (): void => {
    const terminal = (global as any).terminal;
    if (!terminal || typeof terminal.send !== 'function') return;

    const rawSend = terminal.send;
    terminal.send = function (room?: string, target?: string, type?: any, amount?: number) {
        if (target && (global as any).Season8Active === true && !canSendToTargetInSeason(target)) {
            return Error(`Season8 模式仅允许向己方终端发送，目标 ${target} 不合法。`);
        }
        return rawSend.call(this, room, target, type, amount);
    };
};
