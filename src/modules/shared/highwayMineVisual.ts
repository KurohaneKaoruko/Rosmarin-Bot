import { getOutMineData, getRoomData } from '@/modules/shared/memory';

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
    private static lastMapDrawTickBySource: Record<string, number> = {};

    static enable(sourceRoom: string): void {
        this.enabled[sourceRoom] = true;
    }

    static disable(sourceRoom: string): void {
        delete this.enabled[sourceRoom];
    }

    static enableAll(): void {
        this.globalEnabled = true;
    }

    static disableAll(): void {
        this.globalEnabled = false;
        this.enabled = {};
    }

    static toggle(sourceRoom: string): boolean {
        this.enabled[sourceRoom] = !this.enabled[sourceRoom];
        return this.enabled[sourceRoom] || false;
    }

    static run(): void {
        if (this.lastRunTick === Game.time) return;
        this.lastRunTick = Game.time;

        const qosLevel =
            (global as any).qos?.getQoS?.()?.level ||
            (global as any).QoS?.level ||
            'normal';
        const bucket = Number(Game.cpu.bucket || 0);
        if (qosLevel === 'emergency' || bucket < 1000) return;
        const drawInterval = (qosLevel === 'constrained' || bucket < 5000)
            ? Math.max(5, this.MAP_DRAW_INTERVAL)
            : this.MAP_DRAW_INTERVAL;

        const sourceRoomsToDraw = new Set<string>();

        if (this.globalEnabled || Game.flags['ALL/mineMapVisual']) {
            const outMineData = getOutMineData();
            for (const sourceRoom in outMineData) {
                const highway = outMineData[sourceRoom]?.highway;
                if (highway && highway.length > 0) sourceRoomsToDraw.add(sourceRoom);
            }
        }

        for (const flagName in Game.flags) {
            const match = flagName.match(/^(.+)\/mineMapVisual$/);
            if (match) sourceRoomsToDraw.add(match[1]);
        }

        for (const sourceRoom in this.enabled) {
            if (this.enabled[sourceRoom]) sourceRoomsToDraw.add(sourceRoom);
        }

        for (const sourceRoom of sourceRoomsToDraw) {
            const lastMap = this.lastMapDrawTickBySource[sourceRoom] ?? -Infinity;
            if (Game.time - lastMap >= drawInterval) {
                this.lastMapDrawTickBySource[sourceRoom] = Game.time;
                this.visualizeOnMap(sourceRoom);
            }
        }
    }

    static visualizeOnMap(sourceRoom: string): void {
        const powerEnabled = !!getRoomData()?.[sourceRoom]?.outminePower;
        const depositEnabled = !!getRoomData()?.[sourceRoom]?.outmineDeposit;
        if (!powerEnabled && !depositEnabled) return;

        const highway = getOutMineData()?.[sourceRoom]?.highway || [];
        if (highway.length === 0) return;

        const sourceCenter = new RoomPosition(25, 25, sourceRoom);
        Game.map.visual.circle(sourceCenter, {
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

            Game.map.visual.poly([sourceCenter, targetCenter], lineStyle);

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

