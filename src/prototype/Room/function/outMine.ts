import { ExternalMine, ExternalMineTiming } from '@/modules/feature/externalMine';

/** 外矿采集模块 */
export default class OutMine extends Room {
    outMine() {
        const qosLevel = ExternalMine.prepareRoom(this);
        if (!qosLevel) return;

        if (qosLevel === 'normal' || global.qos.shouldRun({ every: 5, allowLevels: ['constrained'] })) {
            ExternalMine.runVisuals();
        }

        this.EnergyMine();
        this.CenterMine();
    }

    EnergyMine() { // 能量矿
        const roomMode = ExternalMine.getRoomMode(this);
        const timing: ExternalMineTiming = {
            normalInterval: roomMode === 'rush' ? 5 : roomMode === 'high' ? 10 : 20,
            constrainedInterval: roomMode === 'rush' ? 10 : roomMode === 'high' ? 20 : 40,
        };
        ExternalMine.runEnergy(this, timing);
    }

    CenterMine() { // 中央九房
        const roomMode = ExternalMine.getRoomMode(this);
        const timing: ExternalMineTiming = {
            normalInterval: roomMode === 'rush' ? 4 : roomMode === 'high' ? 5 : 10,
            constrainedInterval: roomMode === 'rush' ? 6 : roomMode === 'high' ? 10 : 20,
        };
        ExternalMine.runCenter(this, timing);
    }
}
