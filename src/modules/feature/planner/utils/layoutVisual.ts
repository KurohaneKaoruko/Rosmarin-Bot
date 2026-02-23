const structuresShape = {
	spawn: '◎',
	extension: 'ⓔ',
	link: '◈',
	road: '•',
	constructedWall: '▓',
	rampart: '⊙',
	storage: '▤',
	tower: '🔫',
	observer: '👀',
	powerSpawn: '❂',
	extractor: '⇌',
	terminal: '✡',
	lab: '☢',
	container: '□',
	nuker: '▲',
	factory: '☭'
};
const structuresColor = {
	spawn: 'cyan',
	extension: '#0bb118',
	link: 'yellow',
	road: '#fa6f6f',
	constructedWall: '#003fff',
	rampart: '#003fff',
	storage: 'yellow',
	tower: 'cyan',
	observer: 'yellow',
	powerSpawn: 'cyan',
	extractor: 'cyan',
	terminal: 'yellow',
	lab: '#d500ff',
	container: 'yellow',
	nuker: 'cyan',
	factory: 'yellow'
};

const LayoutVisual = {
    //线性同余随机数
    rnd(seed: number) {
        return (seed * 9301 + 49297) % 233280; //为何使用这三个数?
    },
    // seed 的随机颜色
    randomColor(s: string) {
        let seed = parseInt(s);
        const str = '12334567890ABCDEF';
        let out = '#';
        for (let i = 0; i < 6; i++) {
            seed = this.rnd(seed + (Game.time % 103));
            out += str[seed % str.length];
        }
        return out;
    },
    // 大概消耗1 CPU！ 慎用！
    showRoomStructures(roomName: string, structMap: { [x: string]: any[] }) {
        if (!structMap) return;
        const visual = new RoomVisual(roomName);
        if (!structMap['road']) structMap['road'] = [];

        // 将规划器里的结构 key 映射到 Screeps 结构常量。
        // 这里优先使用 RoomVisual 原型扩展提供的 structure() 来画“结构图形”，比字符更接近原生观感。
        const structToConstant: Record<string, StructureConstant | null> = {
            spawn: STRUCTURE_SPAWN,
            extension: STRUCTURE_EXTENSION,
            link: STRUCTURE_LINK,
            road: STRUCTURE_ROAD,
            constructedWall: STRUCTURE_WALL,
            rampart: STRUCTURE_RAMPART,
            storage: STRUCTURE_STORAGE,
            tower: STRUCTURE_TOWER,
            observer: STRUCTURE_OBSERVER,
            powerSpawn: STRUCTURE_POWER_SPAWN,
            // 当前 RoomVisual.structure() 未提供 extractor 的专门绘制逻辑，走文本回退。
            extractor: null,
            terminal: STRUCTURE_TERMINAL,
            lab: STRUCTURE_LAB,
            container: STRUCTURE_CONTAINER,
            nuker: STRUCTURE_NUKER,
            factory: STRUCTURE_FACTORY,
        };

        // 透明度策略：道路/墙体类淡一些，主体建筑更清晰，避免规划图过“糊”或过“亮”。
        const baseOpacity = 0.8;
        const roadOpacity = 0.4;
        const wallOpacity = 0.6;
        const rampartOpacity = 0.6;

        // 先把所有 road 点喂给 structure(STRUCTURE_ROAD)，RoomVisual 扩展会在内部缓存 roads，
        // 方便后面 connectRoads() 一次性做连线。
        const terrain = new Room.Terrain(roomName);
        const roadSet = new Set<string>();
        const roadList = structMap['road'] || [];
        for (let i = 0; i < roadList.length; i++) {
            const e = roadList[i];
            const x = e[0];
            const y = e[1];
            if (x < 0 || x > 49 || y < 0 || y > 49) continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
            roadSet.add(`${x}:${y}`);
            visual.structure(x, y, STRUCTURE_ROAD, { opacity: roadOpacity });
        }

        _.keys(CONTROLLER_STRUCTURES).forEach((struct) => {
            if (struct == 'road') return;

            if (!structMap[struct]) structMap[struct] = [];
            structMap[struct].forEach((e) => {
                const x = e[0];
                const y = e[1];
                const constant = structToConstant[struct];

                if (constant) {
                    const opacity =
                        struct === 'constructedWall' ? wallOpacity : struct === 'rampart' ? rampartOpacity : baseOpacity;
                    visual.structure(x, y, constant, { opacity });
                    return;
                }

                // 文本回退：对未适配 structure() 的类型，继续使用字符贴图。
                visual.text(structuresShape[struct], x, y + 0.25, {
                    color: structuresColor[struct],
                    opacity: 0.75,
                    font: 0.7
                });
            });
        });

        // 自动连通道路：替代原先 RoomArray 的邻域判断连线逻辑。
        const lineDirs: Array<[number, number]> = [[1, 0], [0, 1], [1, 1], [1, -1]];
        const lineStyle = { color: '#666', width: 0.35, opacity: roadOpacity };
        roadSet.forEach((key) => {
            const [xs, ys] = key.split(':');
            const x = Number(xs);
            const y = Number(ys);
            for (let i = 0; i < lineDirs.length; i++) {
                const dx = lineDirs[i][0];
                const dy = lineDirs[i][1];
                const nx = x + dx;
                const ny = y + dy;
                if (!roadSet.has(`${nx}:${ny}`)) continue;
                if (dx !== 0 && dy !== 0) {
                    const sideWallA = terrain.get(x + dx, y) === TERRAIN_MASK_WALL;
                    const sideWallB = terrain.get(x, y + dy) === TERRAIN_MASK_WALL;
                    if (sideWallA && sideWallB) continue;
                }
                visual.line(x, y, nx, ny, lineStyle);
            }
        });
    }
};

export default LayoutVisual;
