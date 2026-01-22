import { RoomArray } from '@/modules/utils/roomArray'

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
        const roomStructs = new RoomArray().init();
        const visual = new RoomVisual(roomName);
        if (!structMap['road']) structMap['road'] = [];
        structMap['road'].forEach((e) => roomStructs.set(e[0], e[1], 'road'));
        _.keys(CONTROLLER_STRUCTURES).forEach((struct) => {
            if (struct == 'road') {
                structMap[struct].forEach((e) => {
                    roomStructs.forNear(
                        (x: number, y: number, val: string) => {
                            if (val == 'road' && ((e[0] >= x && e[1] >= y) || (e[0] > x && e[1] < y)))
                                visual.line(x, y, e[0], e[1], { color: structuresColor[struct] });
                        },
                        e[0],
                        e[1]
                    );
                    visual.text(structuresShape[struct], e[0], e[1] + 0.25, {
                        color: structuresColor[struct],
                        opacity: 0.75,
                        font: 0.7
                    });
                });
            } else {
                if (!structMap[struct]) structMap[struct] = [];
                structMap[struct].forEach((e) =>
                    visual.text(structuresShape[struct], e[0], e[1] + 0.25, {
                        color: structuresColor[struct],
                        opacity: 0.75,
                        font: 0.7
                    })
                );
            }
        });
    }
};

export default LayoutVisual;