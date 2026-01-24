import { BASE_CONFIG } from '@/constant/config';

/**
 * 初始化Memory
 */
const MEMORY_VERSION = 1;
let MemoryDataInit = () => {
    if (global.lastMemoryInitTime === Game.time) return;
    if (Memory['version'] === undefined) {
        Memory['version'] = MEMORY_VERSION;
        console.log(`[System] Memory version initialized to ${MEMORY_VERSION}`);
    } else if (Memory['version'] !== MEMORY_VERSION) {
        console.log(`[System] Memory version mismatch! Expected ${MEMORY_VERSION}, got ${Memory['version']}`);
        Memory['version'] = MEMORY_VERSION;
    }
    if(!Memory['RoomControlData']) Memory['RoomControlData'] = {};
    if(!Memory['StructControlData']) Memory['StructControlData'] = {};
    if(!Memory['LayoutData']) Memory['LayoutData'] = {};
    if(!Memory['OutMineData']) Memory['OutMineData'] = {};
    if(!Memory['AutoData']) Memory['AutoData'] = {} as any;
    if(!Memory['AutoData']['AutoMarketData']) Memory['AutoData']['AutoMarketData'] = {};
    if(!Memory['AutoData']['AutoLabData']) Memory['AutoData']['AutoLabData'] = {};
    if(!Memory['AutoData']['AutoFactoryData']) Memory['AutoData']['AutoFactoryData'] = {};
    if(!Memory['AutoData']['AutoPowerData']) Memory['AutoData']['AutoPowerData'] = {};
    if(!Memory['ResourceManage']) Memory['ResourceManage'] = {};
    if(!Memory['MissionPools']) Memory['MissionPools'] = {};
    global.lastMemoryInitTime = Game.time;
}

export const MemoryInit = {
    init: MemoryDataInit,
    start: MemoryDataInit,
}

/**
 * 初始化global
 */
export const GlobalInit = {
    init() {
        // 基本配置信息
        global.BASE_CONFIG = BASE_CONFIG;
        global.BOT_NAME = BASE_CONFIG.BOT_NAME;
    },
}
