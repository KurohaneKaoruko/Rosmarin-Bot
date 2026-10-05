import { qos } from '@/modules/infra/qos';
import { ExternalMine, ExternalMineAnalysis, ExternalMineTiming } from '@/modules/features/external/externalMine';
import { getRoomModeProfile } from '@/modules/shared/roomMode';
import { registerRemoteIncomeProvider } from '@/modules/shared/roomWorkforce';

// 外矿真实收入富口径注册：升级定编（estimateRoomEnergyIncome）由此读到
// 「净收入 × min(采集比, 搬运比)」的瓶颈口径——采集断档/运力不足时，
// 升级吞吐目标随真实到账收缩，不再孵出喂不饱的升级工。
// 本文件只在游戏运行时加载，单测的最小桩环境不 import 这里，
// roomWorkforce 保持零游戏依赖（未注册时回退人数估算口径）。
// 收入提供方注册：由组合根显式调用（registerOutMineIncomeProvider），
// 本文件不再在 import 期注册。externalMine 主模块随本文件加载。
export const registerOutMineIncomeProvider = (): void => {
    registerRemoteIncomeProvider((room) => ExternalMineAnalysis.getRoomRemoteIncome(room));
};

/** 外矿采集模块 */
export default class OutMine extends Room {
    outMine() {
        const qosLevel = ExternalMine.prepareRoom(this);
        if (!qosLevel) return;

        if (qosLevel === 'normal' || qos.shouldRun({ every: 5, allowLevels: ['constrained'] })) {
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
