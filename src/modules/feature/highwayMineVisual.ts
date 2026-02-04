export class HighwayMineVisual {
    private static readonly MAP_DRAW_INTERVAL = 1;
    private static readonly POWER_STYLE = {
        stroke: '#ff4d4d',
        strokeWidth: 0.9,
        opacity: 0.75,
        lineStyle: 'solid' as const,
    };
    private static readonly DEPOSIT_STYLE = {
        stroke: '#4d79ff',
        strokeWidth: 0.8,
        opacity: 0.7,
        lineStyle: 'dashed' as const,
    };
    private static readonly BOTH_STYLE = {
        stroke: '#a020f0',
        strokeWidth: 0.9,
        opacity: 0.75,
        lineStyle: 'solid' as const,
    };

    private static enabled: Record<string, boolean> = {};
    private static globalEnabled = false;
    private static lastRunTick = -1;
    private static lastMapDrawTickByHome: Record<string, number> = {};

    static enable(homeRoom: string): void {
        this.enabled[homeRoom] = true;
    }

    static disable(homeRoom: string): void {
        delete this.enabled[homeRoom];
    }

    static enableAll(): void {
        this.globalEnabled = true;
    }

    static disableAll(): void {
        this.globalEnabled = false;
        this.enabled = {};
    }

    static toggle(homeRoom: string): boolean {
        this.enabled[homeRoom] = !this.enabled[homeRoom];
        return this.enabled[homeRoom] || false;
    }

    static run(): void {
        if (this.lastRunTick === Game.time) return;
        this.lastRunTick = Game.time;

        const homeRoomsToDraw = new Set<string>();

        if (this.globalEnabled || Game.flags['ALL/mineMapVisual']) {
            const outMineData = Memory['OutMineData'];
            if (outMineData) {
                for (const homeRoom in outMineData) {
                    const highway = outMineData[homeRoom]?.highway;
                    if (highway && highway.length > 0) homeRoomsToDraw.add(homeRoom);
                }
            }
        }

        for (const flagName in Game.flags) {
            const match = flagName.match(/^(.+)\/mineMapVisual$/);
            if (match) homeRoomsToDraw.add(match[1]);
        }

        for (const homeRoom in this.enabled) {
            if (this.enabled[homeRoom]) homeRoomsToDraw.add(homeRoom);
        }

        for (const homeRoom of homeRoomsToDraw) {
            const lastMap = this.lastMapDrawTickByHome[homeRoom] ?? -Infinity;
            if (Game.time - lastMap >= this.MAP_DRAW_INTERVAL) {
                this.lastMapDrawTickByHome[homeRoom] = Game.time;
                this.visualizeOnMap(homeRoom);
            }
        }
    }

    static visualizeOnMap(homeRoom: string): void {
        const powerEnabled = !!Memory['RoomControlData']?.[homeRoom]?.outminePower;
        const depositEnabled = !!Memory['RoomControlData']?.[homeRoom]?.outmineDeposit;
        if (!powerEnabled && !depositEnabled) return;

        const highway = Memory['OutMineData']?.[homeRoom]?.highway || [];
        if (highway.length === 0) return;

        const homeCenter = new RoomPosition(25, 25, homeRoom);
        Game.map.visual.circle(homeCenter, {
            radius: 1,
            fill: '#ffffff',
            opacity: 0.25,
            stroke: '#ffffff',
            strokeWidth: 0.15,
        });

        const bothEnabled = powerEnabled && depositEnabled;
        const targetDotColor = bothEnabled ? this.BOTH_STYLE.stroke : powerEnabled ? this.POWER_STYLE.stroke : this.DEPOSIT_STYLE.stroke;
        const lineStyle = bothEnabled ? this.BOTH_STYLE : powerEnabled ? this.POWER_STYLE : this.DEPOSIT_STYLE;

        for (const targetRoom of highway) {
            const targetCenter = new RoomPosition(25, 25, targetRoom);

            Game.map.visual.poly([homeCenter, targetCenter], lineStyle);

            Game.map.visual.circle(targetCenter, {
                radius: 1.2,
                fill: targetDotColor,
                opacity: 0.7,
                stroke: '#ffffff',
                strokeWidth: 0.25,
            });
        }
    }
}
