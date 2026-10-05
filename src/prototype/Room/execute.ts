import { qos } from '@/modules/infra/qos';
import { getRoomData, getStructData } from '@/modules/shared/memory';
import { getRoomModeProfile } from '@/modules/shared/roomMode';
import { roomFeaturesOf, runRoomFeature } from './featureRegistry';

export default class RoomExecute extends Room {
    exec() {
        // 处理上一 tick 的 Observer 回调（stop 模式也要跑：回调清场不能欠账）
        this.ObserveCallbackTick();

        const mode = getRoomData()?.[this.name]?.mode;
        if (mode === 'stop') return;
        const profile = getRoomModeProfile(this);

        // 编排见 featureRegistry.ts：pre 段（保命面）→ QoS 门 → post 段（可延后面）
        for (const feature of roomFeaturesOf('pre')) {
            runRoomFeature(this, feature, profile);
        }

        if (!qos.shouldRun({ allowLevels: ['normal', 'constrained'] })) return;

        for (const feature of roomFeaturesOf('post')) {
            runRoomFeature(this, feature, profile);
        }
    }

    // 房间初始化
    init() {
        if (!this.my || !getRoomData()[this.name]) return;

        const structData = getStructData();
        if (!structData[this.name]) {
            structData[this.name] = {
                lab: true,
                factory: true,
                powerSpawn: true,
            } as any;
        }

        // 孵化队列数量由 room.getSpawnMissionNum() 按需统计

        this.initMissionPool(); // 初始化任务池
        this.update();  // 初始化建筑缓存
    }
}
