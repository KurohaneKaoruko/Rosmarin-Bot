// season8 控制台命令：开关 / 推挤目标 / 策略 / 安全冲刺 / 托管模式 / 报告。
// 另挂 helpSeason8（共享 help.ts 不认识赛季命令，帮助文本随变体走）。
import { ensureRoomData, getRoomData } from '@/modules/shared/memory';
import { getSeason8Data } from './memory';
import { getSectorLevel, getTickScore } from './scoring';

const ROOM_NAME_REG = /^[WE]\d+[NS]\d+$/;
const POLICY_SET = new Set(['aggressive', 'balanced', 'safe']);

const isRoomName = (roomName: string) => ROOM_NAME_REG.test(String(roomName || ''));

const season8Commands = {
    season8: {
        enable(roomName: string, on?: boolean) {
            if (!isRoomName(roomName)) return ERR_INVALID_ARGS;
            const cfg = ensureRoomData(roomName) as any;
            const next = on === undefined ? !cfg.season8Enabled : !!on;
            cfg.season8Enabled = next;
            if (next) {
                cfg.season8Policy = cfg.season8Policy || 'aggressive';
                if (cfg.season8SafeRush === undefined) cfg.season8SafeRush = true;
                if (cfg.season8ManagedMode === undefined) cfg.season8ManagedMode = true;
            }
            console.log(`[Season8] ${roomName} ${next ? 'enabled' : 'disabled'}`);
            return OK;
        },

        target(roomName: string, targetRoom?: string) {
            if (!isRoomName(roomName)) return ERR_INVALID_ARGS;
            const cfg = ensureRoomData(roomName) as any;
            if (!targetRoom) {
                delete cfg.season8PushTarget;
                console.log(`[Season8] ${roomName} push target cleared`);
                return OK;
            }
            if (!isRoomName(targetRoom)) return ERR_INVALID_ARGS;
            const level = getSectorLevel(targetRoom);
            if (!level) {
                console.log(`[Season8] warning: ${targetRoom} is out of scoring bands`);
            }
            cfg.season8PushTarget = targetRoom;
            console.log(`[Season8] ${roomName} push target -> ${targetRoom} (L${level || 0}, +${getTickScore(targetRoom)}/tick)`);
            return OK;
        },

        policy(roomName: string, policy: 'aggressive' | 'balanced' | 'safe') {
            if (!isRoomName(roomName)) return ERR_INVALID_ARGS;
            if (!POLICY_SET.has(String(policy))) return ERR_INVALID_ARGS;
            const cfg = ensureRoomData(roomName) as any;
            cfg.season8Policy = policy;
            cfg.season8Enabled = true;
            if (cfg.season8ManagedMode === undefined) cfg.season8ManagedMode = true;
            console.log(`[Season8] ${roomName} policy -> ${policy}`);
            return OK;
        },

        safeRush(roomName: string, on?: boolean) {
            if (!isRoomName(roomName)) return ERR_INVALID_ARGS;
            const cfg = ensureRoomData(roomName) as any;
            const next = on === undefined ? !cfg.season8SafeRush : !!on;
            cfg.season8SafeRush = next;
            cfg.season8Enabled = true;
            console.log(`[Season8] ${roomName} safeRush -> ${next}`);
            return OK;
        },

        managedMode(roomName: string, on?: boolean) {
            if (!isRoomName(roomName)) return ERR_INVALID_ARGS;
            const cfg = ensureRoomData(roomName) as any;
            const next = on === undefined ? !cfg.season8ManagedMode : !!on;
            cfg.season8ManagedMode = next;
            cfg.season8Enabled = true;
            console.log(`[Season8] ${roomName} managedMode -> ${next}`);
            return OK;
        },

        report(roomName?: string) {
            const roomData = getRoomData() as any;
            const seasonData = getSeason8Data();
            const roomNames = roomName
                ? [roomName]
                : Object.keys(roomData).filter((name) => roomData[name]?.season8Enabled);

            if (roomNames.length <= 0) {
                console.log('[Season8] no enabled rooms');
                return OK;
            }

            const totalTickScore = Number(seasonData.totalTickScore || 0);
            const controlledRooms = Number(seasonData.controlledRooms || 0);
            const cpuBudget = seasonData.cpuBudget || {};
            console.log(`[Season8] totalTickScore=${totalTickScore} controlled=${controlledRooms} cpu=${cpuBudget.level || 'unknown'} bucket=${cpuBudget.bucket || 0}`);

            for (let i = roomNames.length; i--;) {
                const name = roomNames[i];
                const cfg = roomData[name];
                if (!cfg) continue;

                const snap = seasonData.rooms?.[name];
                const liveRoom = Game.rooms[name];
                const sectorLevel = snap?.sectorLevel ?? getSectorLevel(name);
                const tickScore = snap?.tickScore ?? ((liveRoom?.controller?.my) ? getTickScore(name) : 0);
                const rcl = snap?.rcl ?? (liveRoom?.controller?.level ?? 0);
                const safeMode = snap?.safeMode ?? (liveRoom?.controller?.safeMode || 0);
                const policy = cfg.season8Policy || 'aggressive';
                const target = cfg.season8PushTarget || '-';
                const frontier = seasonData.frontier?.[name];
                const plan = frontier?.planId || '-';
                const planStatus = frontier?.planStatus || '-';

                console.log(
                    `[Season8][${name}] L${sectorLevel} +${tickScore}/tick RCL${rcl} safe=${safeMode} mode=${cfg.mode || 'high'} policy=${policy} target=${target} plan=${plan} status=${planStatus}`
                );
            }

            return OK;
        }
    }
};

export default season8Commands;

const HELP_TEXT = [
    '🏁 Season8 冲分指令',
    '',
    'season8.enable(roomName, on?)：开关房间 Season8 调度',
    'season8.target(roomName, targetRoom?)：设置/清除推进目标房间',
    "season8.policy(roomName, 'aggressive'|'balanced'|'safe')：设置推进策略",
    'season8.safeRush(roomName, on?)：开关 SafeMode 冲 RCL4 策略',
    'season8.managedMode(roomName, on?)：开关 Season8 自动 mode 档位管理',
    'season8.report(roomName?)：查看总分、CPU 档位、房间快照与计划状态',
].join('\n');

/** 在 ConsoleExtension 之后调用：挂 season8.* 命令与 helpSeason8（与共享 console/index.ts 同法）。 */
export const mountSeason8Console = (): void => {
    _.assign(global, season8Commands);
    if (!(global as any).helpSeason8) {
        (global as any).helpSeason8 = () => console.log(HELP_TEXT);
    }
};
