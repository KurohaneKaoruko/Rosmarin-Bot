import { ExternalMine, ExternalMineTiming } from '@/modules/features/external/externalMine';
import { getRoomModeProfile } from '@/modules/shared/roomMode';

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
        const timing: ExternalMineTiming = {
            normalInterval: getRoomModeProfile(this).remoteEnergyInterval.normal,
            constrainedInterval: getRoomModeProfile(this).remoteEnergyInterval.constrained,
        };
        ExternalMine.runEnergy(this, timing);
    }

    CenterMine() { // 中央九房
        const timing: ExternalMineTiming = {
            normalInterval: getRoomModeProfile(this).remoteCenterInterval.normal,
            constrainedInterval: getRoomModeProfile(this).remoteCenterInterval.constrained,
        };
        ExternalMine.runCenter(this, timing);
    }
}
