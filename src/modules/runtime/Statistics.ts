/** 统计模块 */
export const Statistics = {
    end: function() {
        if (!Memory['OpenStats']) return;
        if (!Memory.stats) Memory.stats = {}

        updateCPUinfo();       // 统计 CPU 使用量

        if (Game.time % 20 !== 1) return;
        updateGclGpl();        // 统计 GCL / GPL 的升级百分比和等级
        updateGclGplSpeed();   // 统计 GCL / GPL 的升级速度
        updateRoomStats();     // 房间等级 & 房间能量储备
        updateRoomUpgradeTimeEstimate(); // 房间升级时间估计
        updateCreepCount();    // Creep 数量
        updateCreditInfo();    // credit变动情况
    }
}

function updateCPUinfo() {
    Memory.stats.cpu = Game.cpu.getUsed()   // 统计 CPU 总使用量
    // bucket 当前剩余量
    try { Memory.stats.bucket = Game.cpu.bucket; }
    catch (e) { Memory.stats.bucket = 0; };

    if(!Memory.stats.cpuUsed) Memory.stats.cpuUsed = { total: 0,count: 0 };

    Memory.stats.cpuUsed['total'] += Game.cpu.getUsed();
    Memory.stats.cpuUsed['count'] += 1;
    if (Memory.stats.cpuUsed['count'] >= 1000) {
        let total = Memory.stats.cpuUsed['total'];
        let count = Memory.stats.cpuUsed['count'];
        Memory.stats.AvgCpuUsed = total / count;
        Memory.stats.cpuUsed = { total: 0,count: 0 };
    }

}

function updateGclGpl() {
    // 统计 GCL / GPL 的升级百分比和等级
    Memory.stats.gcl = (Game.gcl.progress / Game.gcl.progressTotal) * 100
    Memory.stats.gclLevel = Game.gcl.level
    Memory.stats.gpl = (Game.gpl.progress / Game.gpl.progressTotal) * 100
    Memory.stats.gplLevel = Game.gpl.level
}

function updateGclGplSpeed() {
    // 统计 GCL / GPL 的升级速度
    if (Game.time % 100 !== 1) return;
    const timeDelta = (Date.now() - (Number(Memory.stats.previousTimestamp) || Date.now())) / 1000;    // 100tick时间差
    Memory.stats.previousTimestamp = Date.now();    // 记录当前时间戳
    Memory.stats.tickTime = timeDelta / 100;    // 每个tick的时间

    const gclIncrement = Game.gcl.progress - (Number(Memory.stats.GclProgress) || Game.gcl.progress);    // GCL 的进度增量
    const gclRemaining = Game.gcl.progressTotal - Game.gcl.progress;    // GCL 的剩余进度
    Memory.stats.GclProgress = Game.gcl.progress;   // GCL 的当前进度
    if (gclIncrement > 0) {
        Memory.stats.gclUpTick = ((gclRemaining / gclIncrement) * 100) || 0;    // GCL 升级所需的tick数
        Memory.stats.gclUpTime = ((gclRemaining / gclIncrement) * timeDelta) || 0;    // GCL 预计升级所需时间
    } else {
        Memory.stats.gclUpTick = 0;
        Memory.stats.gclUpTime = 0;
    }

    const gplIncrement = Game.gpl.progress - (Number(Memory.stats.GplProgress) || Game.gpl.progress);    // GPL 的进度增量
    const gplRemaining = Game.gpl.progressTotal - Game.gpl.progress;    // GPL 的剩余进度
    Memory.stats.GplProgress = Game.gpl.progress;    // GPL 的当前进度
    if (gplIncrement > 0) {
        Memory.stats.gplUpTick = ((gplRemaining / gplIncrement) * 100) || 0;    // GPL 升级所需的tick数
        Memory.stats.gplUpTime = ((gplRemaining / gplIncrement) * timeDelta) || 0;    // GPL 预计升级所需时间
    } else {
        Memory.stats.gplUpTick = 0;
        Memory.stats.gplUpTime = 0;
    }
}


function updateRoomStats() {
    // 房间等级 & 房间能量储备
    const stats = Memory.stats;
    stats.rcl = {};
    stats.rclLevel = {};
    stats.rclProgress = {};
    stats.energyHistory = stats.energy || {};
    stats.energy = {};
    stats.energyRise = {};
    stats.SpawnEnergy = {};
    let roomCount = 0;
    for (const room of Object.values(Game.rooms)) {
        if (!room.controller?.my) continue;
        roomCount++;
        const roomName = room.name;
        const controller = room.controller;
        // 等级信息
        stats.rclLevel[roomName] = controller.level;    // 房间等级
        if (controller.level < 8) {
            stats.rclProgress[roomName] = (controller.progress / controller.progressTotal) * 100;    // 房间升级百分比
            stats.rcl[roomName] = stats.rclLevel[roomName] + (stats.rclProgress[roomName]/100);    // 房间等级(浮点数)
        } else {
            stats.rclProgress[roomName] = 0;
            stats.rcl[roomName] = stats.rclLevel[roomName];
        }
        
        // 能量储备
        const storageEnergy = room.storage?.store[RESOURCE_ENERGY] || 0;
        const terminalEnergy = room.terminal?.store[RESOURCE_ENERGY] || 0;
        stats.energy[roomName] = storageEnergy + terminalEnergy;
        stats.energyRise[roomName] = stats.energy[roomName] - stats.energyHistory[roomName] || 0;
        stats.SpawnEnergy[roomName] = room.energyCapacityAvailable;
    }
    stats.roomCount = roomCount;
}

function updateRoomUpgradeTimeEstimate() {
    // 房间升级时间估计
    if (Game.time % 100 !== 1) return;
    const stats = Memory.stats;
    const lastProgress = stats.lastRclProgress || {};
    const timeDelta = (Date.now() - (Number(stats.lastUpgradeTimestamp) || Date.now())) / 1000;  // 时间差

    const myRooms = Object.values(Game.rooms).filter(room => room.controller?.my && room.controller.level < 8);

    stats.rclUpTime = {};
    stats.rclUpTick = {};

    for (const room of myRooms) {
        const roomName = room.name;
        const controller = room.controller;
    
        const progressIncrement = controller.progress - (lastProgress[roomName] || controller.progress);    // 进度增量
        const progressRemaining = controller.progressTotal - controller.progress;    // 剩余进度
        if (progressIncrement > 0) {
            const timeToUpgrade = progressRemaining / progressIncrement;
            stats.rclUpTime[roomName] = timeToUpgrade * timeDelta;
            stats.rclUpTick[roomName] = timeToUpgrade * 100;
        } else {
            stats.rclUpTime[roomName] = 0;
            stats.rclUpTick[roomName] = 0;
        }
        
        lastProgress[roomName] = controller.progress;
    }

    stats.lastRclProgress = lastProgress;
    stats.lastUpgradeTimestamp = Date.now();
}


function updateCreepCount() {
    // Creep 数量
    Memory.stats.creeps = {};
    let creepCount = 0;
    for (const { memory: { role } } of Object.values(Game.creeps)) {
        Memory.stats.creeps[role] = (Memory.stats.creeps[role] || 0) + 1;
        creepCount++;}  // 统计所有 creep 的数量
    Memory.stats.creepCount = creepCount;
}

function updateCreditInfo() {
    Memory.stats.credit = Game.market.credits;

    if(Game.time % 100 !== 1) return;
    const cr = Game.market.credits;
    Memory.stats.creditChanges = cr - (Number(Memory.stats.lastCredit) || cr)
    Memory.stats.lastCredit = cr;

    // 能量前十求购均价
    const orders = Game.market.getAllOrders({type: ORDER_BUY, resourceType: RESOURCE_ENERGY});
    if (!orders || orders.length === 0) {
        Memory.stats.energyAveragePrice = 0;
    } else {
        const topOrders = orders.sort((a, b) => b.price - a.price).slice(0, 10);
        const averagePrice = topOrders.reduce((sum, order) => sum + order.price, 0) / topOrders.length;
        Memory.stats.energyAveragePrice = averagePrice;
    }

    // 能量前十出售均价
    const sellOrders = Game.market.getAllOrders({type: ORDER_SELL, resourceType: RESOURCE_ENERGY});
    if (!sellOrders || sellOrders.length === 0) {
        Memory.stats.energyAverageSellPrice = 0;
    } else {
        const topSellOrders = sellOrders.sort((a, b) => a.price - b.price).slice(0, 10);
        const averageSellPrice = topSellOrders.reduce((sum, order) => sum + order.price, 0) / topSellOrders.length;
        Memory.stats.energyAverageSellPrice = averageSellPrice;
    }
    
}

