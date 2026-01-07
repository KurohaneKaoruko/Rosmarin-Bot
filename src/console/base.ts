import { log } from "@/utils";

// 基础与杂项
const Base = {
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
            Memory.MissionPools[roomName][type] = [];
            log('', `已清空房间 ${roomName} 的 ${type} 任务`);
            return OK;
        },
        roomPath(roomName: string) {
            global.BetterMove.deletePathInRoom(roomName);
            log('', `已清空房间 ${roomName} 的路径缓存`);
            return OK;
        },
        boostTask(roomName: string) {
            const boostmem = Memory['StructControlData'][roomName];
            boostmem['boostRes'] = {};
            boostmem['boostQueue'] = {};
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
        Memory['OpenStats'] = !Memory['OpenStats'];
        log('', `信息统计功能已${Memory['OpenStats'] ? '开启' : '关闭'}`);  
        return OK;
    },

    avoidRoom(room: string): OK | Error {
        return global.BetterMove.addAvoidRooms(room);
    },

    log(text: string, ...args: any[]): OK | Error {
        log(`${global.BOT_NAME}`, `${text}`, ...args);
        return OK;
    },
}


export default Base;
