import { BASE_CONFIG } from '@/constant/config';
import { log } from '@/utils';
import { getMissionPools, getStructData } from "@/modules/utils/memory";

// 基础与杂项
const Base = {
    bot: {
        // 快速开始
        start(roomName: string, layout?: string) {
            // 添加房间
            if (!layout) global.room.add(roomName);
            else {
                const centerPos = Game.flags['centerPos']?.pos;
                if (!centerPos || centerPos.roomName !== roomName) {
                    return Error('未设置中心, 请将centerPos放置到需要设置的布局中心位置。')
                } else {
                    global.room.add(roomName, layout);
                }
            }
            // 构建布局
            global.layout.build(roomName);
            // 开启自动建造
            global.layout.auto(roomName, true);
            return OK;
        },
    },
    whitelist: {
        add(id: string): OK | Error {
            if(!Memory['whitelist']) Memory['whitelist'] = [];
            if(Memory['whitelist'].includes(id)) return Error("白名单中已存在, 无法添加");
            Memory['whitelist'].push(id);
            return OK;
        },
        remove(id: string): OK | Error {
            if(!Memory['whitelist']) return Error("白名单不存在");
            if(!Memory['whitelist'].includes(id)) return Error("白名单中不存在, 无法移除");
            Memory['whitelist'].splice(Memory['whitelist'].indexOf(id), 1);
            return OK;
        },
        show(): string[] {
            return Memory['whitelist'] || [];
        }
    },

    clear: {
        site(roomName: string) {
            const room = Game.rooms[roomName];
            if(!room) {
                return Error(`无房间视野`);
            }
            const site = room.find(FIND_MY_CONSTRUCTION_SITES);
            if(site.length === 0) {
                return Error(`无建筑工地`);
            } else {
                for(const s of site) {
                    s.remove();
                }
                return OK;
            }
        },
        flag(roomName: string) {
            const room = Game.rooms[roomName];
            if(!room) {
                return Error(`无房间视野`);
            }
            const flag = room.find(FIND_FLAGS);
            if(flag.length === 0) {
                return Error(`无旗子`);
            } else {
                for(const f of flag) {
                    f.remove();
                }
                return OK;
            }
        },
        mission(roomName: string, type: string) {
            const pools = getMissionPools();
            if (!pools[roomName]) return Error(`房间 ${roomName} 任务池不存在`);
            pools[roomName][type] = [];
            log('', `已清空房间 ${roomName} 的 ${type} 任务`);
            return OK;
        },
        boostTask(roomName: string) {
            const boostmem = getStructData(roomName);
            if (boostmem?.boostLabs) {
                for (const labId of Object.keys(boostmem.boostLabs)) {
                    if (boostmem.boostLabs[labId]?.mode === 'task') delete boostmem.boostLabs[labId];
                }
            }
            log('', `已清空房间 ${roomName} 的 boost 任务`);
            return OK;
        }
    },
    
    // 开关全局战争模式
    warmode() {
        Memory['warmode'] = !Memory['warmode'];
        log('', `战争模式已${Memory['warmode'] ? '开启' : '关闭'}`);
        return OK;
    },

    pixel() {
        Memory['GenPixel'] = !Memory['GenPixel'];
        log('', `搓Pixel功能已${Memory['GenPixel'] ? '开启' : '关闭'}`);
        return OK;
    },

    stats() {
        const flagName = 'ALL/stats';
        const flag = Game.flags[flagName];
        if (flag) {
            flag.remove();
            log('', `信息统计功能已关闭 (Removed ${flagName})`);
        } else {
            const room = Object.values(Game.rooms).find(r => r.controller && r.controller.my);
            if (room) {
                room.createFlag(room.controller!.pos.x, room.controller!.pos.y + 1, flagName);
                log('', `信息统计功能已开启 (Created ${flagName} in ${room.name})`);
            } else {
                return Error('未找到己方房间，无法创建统计旗帜');
            }
        }
        return OK;
    },

    log(text: string, ...args: any[]): OK | Error {
        log(`${BASE_CONFIG.BOT_NAME}`, `${text}`, ...args);
        return OK;
    },
}


export default Base;
