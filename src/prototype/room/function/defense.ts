export default class RoomDefense extends Room {
    activeDefense() {
        // 如果处于安全模式，则不进行后续处理
        if (this.controller.safeMode) return;

        // 处于防御时, 检查是否需要激活安全模式
        if (this.memory.defend) {
            let RuinCount = this.find(FIND_RUINS, {filter: (e: any) => e.structure.owner &&
                    e.structure.owner.username==this.controller.owner.username
                    &&e.structure.structureType!=STRUCTURE_ROAD
                    &&e.structure.structureType!=STRUCTURE_CONTAINER
                    &&e.structure.structureType!=STRUCTURE_WALL
                    &&e.structure.structureType!=STRUCTURE_RAMPART
                    &&e.structure.structureType!=STRUCTURE_EXTRACTOR
                    &&e.structure.structureType!=STRUCTURE_LINK
                    &&e.structure.ticksToDecay<=500
                }).length
            if (RuinCount && this.controller.safeModeAvailable &&
                !this.controller.safeModeCooldown &&
                !this.controller.upgradeBlocked
            ) {
                this.controller.activateSafeMode();
                return;
            }
        }

        // 关于主动防御的检查
        if (Game.time % 5) return;
        
        if (!Memory['whitelist']) Memory['whitelist'] = [];
        let hostiles = this.findEnemyCreeps({
            filter: c => c.owner.username != 'Invader'&&
                (this.level<7||c.body?.some(b=>b.boost))
        });
        let hostileCount = hostiles.filter(c => c.body.some(b=>b.type==HEAL)).length

        if(!hostileCount) {
            // 如果没有敌人，则退出防御状态
            this.memory.defend = false;
            return;
        } else {
            // 进入防御状态
            this.memory.defend = true;
        }

        // 如果房间等级小于4，则不进行主动防御
        if (this.level < 4) return;
        
        // 搜索有威胁的敌人
        hostiles = hostiles.filter(c => c.body.some(b =>
            b.type == ATTACK || b.type == RANGED_ATTACK ||
            b.type == WORK || b.type == HEAL)
        ) as any;
        let power_hostiles = this.find(FIND_HOSTILE_POWER_CREEPS, {
            filter: hostile => !hostile.isWhiteList()
        }) as any;
        hostiles = hostiles.concat(power_hostiles);
        if(!global.Hostiles) global.Hostiles = {};
        if (hostiles.length == 0) {
            global.Hostiles[this.name] = [];
            return;
        }

        /** --------主动防御孵化-------- */
        // 40A红球 或 40R蓝球
        global.Hostiles[this.name] = hostiles.map((hostile: Creep) => hostile.id);
        if (this.level == 8) {
            const attackDefender = Object.values(Game.creeps)
                .filter(creep => creep.room.name == this.name &&
                    creep.memory.role == 'defend-attack') as any;
            const rangedDefender = Object.values(Game.creeps)
                .filter(creep => creep.room.name == this.name &&
                    creep.memory.role == 'defend-ranged') as any;
            const SpawnMissionNum = this.getSpawnMissionNum() ?? {};
            let attackQueueNum = SpawnMissionNum['defend-attack'] || 0;
            let rangedQueueNum = SpawnMissionNum[this.name]?.['defend-ranged'] || 0;
            if (hostiles.some((c: Creep) => c.body.some(part => part.type == ATTACK) ||
                hostiles.some((c: Creep) => c.body.some(part => part.type == WORK))) &&
                (attackDefender.length + attackQueueNum) < 1) {
                let mustBoost = false;
                if (this['XUH2O'] >= 3000 && this['XZHO2'] >= 3000) {
                    mustBoost = true;
                }
                this.SpawnMissionAdd('', [], -1, 'defend-attack', {home: this.name, mustBoost} as any);
                if (mustBoost) {
                    this.AssignBoostTask('XUH2O', 1200);
                    this.AssignBoostTask('XZHO2', 300);
                }
            }
            if (hostiles.some((c: Creep) => c.body.some(part => part.type == RANGED_ATTACK)) &&
                (rangedDefender.length + rangedQueueNum < 1)) {
                let mustBoost = false;
                if (this['XKHO2'] >= 3000 && this['XZHO2'] >= 3000) {
                    mustBoost = true;
                }
                this.SpawnMissionAdd('', [], -1, 'defend-ranged', {home: this.name, mustBoost} as any);
                if (mustBoost) {
                    this.AssignBoostTask('XKHO2', 1200);
                    this.AssignBoostTask('XZHO2', 300);
                }
            }
        } else if (this.level == 7) {
            const attackDefender = Object.values(Game.creeps)
                .filter(creep => creep.room.name == this.name &&
                    creep.memory.role == 'defend-attack') as any;
            const SpawnMissionNum = this.getSpawnMissionNum() || {};
            let attackQueueNum = SpawnMissionNum[this.name]['defend-attack'] || 0;
            if (hostiles.length > 0 && (attackDefender.length + attackQueueNum) < 1) {
                let mustBoost = false;
                if (this['XUH2O'] >= 3000 && this['XZHO2'] >= 3000) {
                    mustBoost = true;
                }
                this.SpawnMissionAdd('', [], -1, 'defend-attack', {home: this.name, mustBoost} as any);
                if (mustBoost) {
                    this.AssignBoostTask('XUH2O', 1200);
                    this.AssignBoostTask('XZHO2', 300);
                }
            }
        } else {
            const attackDefender = Object.values(Game.creeps)
                .filter(creep => creep.room.name == this.name &&
                    creep.memory.role == 'defend-attack') as any;
            const SpawnMissionNum = this.getSpawnMissionNum() || {};
            let attackQueueNum = SpawnMissionNum[this.name]['defend-attack'] || 0;
            if (attackDefender.length + attackQueueNum < 1) {
                this.SpawnMissionAdd('', [], -1, 'defend-attack', {home: this.name} as any)
            }
        }
    }

    // 获取防御用CostMatrix
    // 做了相当多的优化, 消耗大约1~5CPU每次
    getDefenseCostMatrix(show: boolean = false): CostMatrix {
        if (!global.DefenseCostMatrix) global.DefenseCostMatrix = {};
        let dcm = global.DefenseCostMatrix[this.name];
        if (dcm && dcm.tick + 20 > Game.time) return dcm.costMatrix;
        global.DefenseCostMatrix[this.name] = {}; // 清空缓存

        const CPU_start = Game.cpu.getUsed();
        const costs = new PathFinder.CostMatrix();
        const avoidArea = new Uint8Array(3200); // 记录已经标记为不可通行的点位

        if (!global['ROOM_EXITS']) global['ROOM_EXITS'] = {};
        let cacheExits = global['ROOM_EXITS'][this.name];
        let exits = cacheExits || [];
        let visitedEXITS = !cacheExits ? {
            [LEFT]: new Uint8Array(50),
            [RIGHT]: new Uint8Array(50),
            [TOP]: new Uint8Array(50),
            [BOTTOM]: new Uint8Array(50)
        } : null;
        // 标记不可通过的地形, 并记录出入口点位
        const terrain = this.getTerrain();
        for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            let xy = (x << 6) + y;
            if (terrain.get(x, y) == TERRAIN_MASK_WALL) {
                costs.set(x, y, 255);
                avoidArea[xy] = 1;
                continue;
            }
            if (x > 0 && x < 49 && y > 0 && y < 49) continue;
            costs.set(x, y, 255);
            avoidArea[xy] = 1;
            if (cacheExits) continue;
            // 判断该出入口的前一个点位是否已经被标记过(已标记代表前一个点位也是出入口)
            let p = (x == 0) ? LEFT : (x == 49) ? RIGHT : (y == 0) ? TOP : BOTTOM;
            let p2 = (p == LEFT || p == RIGHT) ? y : x;
            visitedEXITS[p][p2] = 1;
            if (visitedEXITS[p][p2-1]) continue;
            exits.push([x, y]);
        }}
        if (!cacheExits) {
            global['ROOM_EXITS'][this.name] = exits;
            visitedEXITS = null; // 释放
        }
        
        // 使用建筑缓存
        let structs = [
            ...this[STRUCTURE_SPAWN], ...this[STRUCTURE_EXTENSION], ...this[STRUCTURE_TOWER],
            ...this[STRUCTURE_LINK], ...this[STRUCTURE_LAB], ...this[STRUCTURE_RAMPART],
            ...this[STRUCTURE_WALL], this[STRUCTURE_TERMINAL], this[STRUCTURE_STORAGE],
             this[STRUCTURE_NUKER], this[STRUCTURE_FACTORY], this[STRUCTURE_EXTRACTOR],
            this[STRUCTURE_OBSERVER], this[STRUCTURE_POWER_SPAWN]
        ].filter(s => s);
        const RAM_MIN_HITS = 1e6;
        // 标记不可通过的建筑
        structs.forEach(s => {
            if (s.structureType === STRUCTURE_RAMPART && s.my) {
                if (s.hits < RAM_MIN_HITS) return;
                if (costs.get(s.pos.x, s.pos.y) > 0) return;
                costs.set(s.pos.x, s.pos.y, 1); // 设置 rampart 为 1
            } else {
                let xy = (s.pos.x << 6) + s.pos.y;
                if (avoidArea[xy]) return; // 已标记则跳过
                costs.set(s.pos.x, s.pos.y, 255);
                avoidArea[xy] = 1;
            }
        });
        structs = null; // 释放

        const CPU_bfs = Game.cpu.getUsed();

        // BFS
        const barriers = [];
        let visited = new Uint8Array(3200);
        const queue = [...exits];
        let length = queue.length;
        for (let idx = 0; idx < length; idx++) {
            const p = queue[idx];
            const x = p[0], y = p[1];
            costs.set(x, y, 255);
            avoidArea[(x << 6) | y] = 1;
            for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx == 0 && dy == 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
                const nextXY = (nx << 6) | ny;
                // 访问过的, 则跳过
                if (visited[nextXY]) continue;
                // 如果此处大于0, 表示到达了不可移动的位置(255的墙或1的rampart)
                else if (avoidArea[nextXY] || costs.get(nx, ny)) barriers.push(nextXY);
                else { queue.push([nx, ny]); length++; }
                visited[nextXY] = 1;
            }}
        }

        for (let p of barriers) {
            const x = p >> 6, y = p & 0b111111;
            for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (dx == 0 && dy == 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 1 || nx > 48 || ny < 1 || ny > 48) continue;
                // 大于0时跳过
                if (costs.get(nx, ny)) continue;
                else costs.set(nx, ny, 10);
            }}
        }

        const CPU_ramBFS = Game.cpu.getUsed();
        // 对ram广搜, 将与安全区相邻的标记为安全, 否则为危险
        visited.fill(0);
        let ram_BFS_length = 0;
        const ramPos = [...this[STRUCTURE_RAMPART].map(r => [r.pos.x, r.pos.y])];
        for (let p of ramPos) {
            const xy = (p[0] << 6) | p[1];
            if (visited[xy]) continue;
            visited[xy] = 1;
            const queue = [[p[0], p[1]]];
            let safe = false;
            for (let idx = 0; idx < queue.length; idx++) {
                ram_BFS_length++;
                const p = queue[idx];
                const x = p[0], y = p[1];
                for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx == 0 && dy == 0) continue;
                    const nx = x + dx, ny = y + dy;
                    let nextXY = (nx << 6) | ny;
                    if (avoidArea[nextXY]) continue;
                    if (visited[nextXY]) continue;
                    if (costs.get(nx, ny) == 1) queue.push([nx, ny]);
                    else safe = true;
                    visited[nextXY] = 1;
                }}
            }
            if (!safe) queue.forEach(p => costs.set(p[0], p[1], 255));
        }

        const CPU_end = Game.cpu.getUsed();

        if (show) {
            console.log(`[${this.name}] DefenseCostMatrix生成开销:`);
            console.log('- 地形建筑开销:', (CPU_bfs - CPU_start).toFixed(2));
            console.log('- BFS开销:', (CPU_ramBFS - CPU_bfs).toFixed(2), '外部搜索量:', length);
            console.log('- RAM BFS开销:', (CPU_end - CPU_ramBFS).toFixed(2), 'RAM搜索量:', ram_BFS_length);
            console.log('- 总开销:', (CPU_end - CPU_start).toFixed(4));
        }
        
        global.DefenseCostMatrix[this.name] = {
            tick: Game.time,
            costMatrix: costs
        };
        return costs;
    }

    showDefenseCostMatrix() {
        if (!Game.flags[`${this.name}/SDCM`]) return;
        const costs = this.getDefenseCostMatrix(true);

        for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
            const cost = costs.get(x, y);

            // 根据不同的成本值绘制不同颜色
            if (cost >= 254) {
                // 红色：不可通行区域（建筑/外部区域）
                this.visual.circle(x, y, { fill: 'red', opacity: 0.25, radius: 0.5, stroke: 'red' });
            } else if (cost == 10) {
                // 黄色：rampart 内侧缓冲区
                this.visual.circle(x, y, { fill: 'yellow', opacity: 0.25, radius: 0.5, stroke: 'yellow' });
            } else if (cost == 1) {
                // 蓝色：rampart 位置
                this.visual.circle(x, y, { fill: 'blue', opacity: 0.25, radius: 0.5, stroke: 'blue' });
            } else if (cost == 0) {
                // 绿色：默认可通行区域
                this.visual.circle(x, y, { fill: 'green', opacity: 0.25, radius: 0.5, stroke: 'green' });
            } else {
                // 灰色：意外Cost区域
                this.visual.circle(x, y, { fill: 'gray', opacity: 0.25, radius: 0.5, stroke: 'gray' });
            }
        }}
    }
}