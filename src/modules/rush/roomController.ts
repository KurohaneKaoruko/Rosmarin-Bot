/**
 * rush 房间主循环（孵化批）：roster/空闲池预处理 → 升级单 → 建造态与 builder 单 → 孵化消费。
 * source 链（miner/hauler 与收入记账）待 basePlan 落地后接入 manageSource。
 * 口径：房间级 CPU 熔断；numWork 由升级段清零、建造段累加（升级段先于建造段）。
 */
import { CPU_TERMINATE_ROOM_MANAGER } from './constants';
import { manageBuildSpawn, manageBuildState } from './manageBuild';
import { manageLogistics } from './manageLogistics';
import { manageSource } from './manageSource';
import { manageUpgradeSpawn } from './manageUpgrade';
import { getRushTickState } from './roomState';
import { getCreepsByRole, pretickSpawn, runSpawnManager } from './spawnManager';

export const runRushRoom = (room: Room): void => {
    // 房间级熔断：CPU 超线后本房整段跳过
    if (Game.cpu.getUsed() > CPU_TERMINATE_ROOM_MANAGER) {
        return;
    }

    pretickSpawn(room);

    const state = getRushTickState(room);

    const upgraders = getCreepsByRole(room, 'upgrader');
    const builders = getCreepsByRole(room, 'builder');

    manageUpgradeSpawn(room, upgraders, builders);

    // 建造态机：工地来自既有 autoBuild（rush 布局零改动）
    const constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES);
    const ramparts = room.find(FIND_STRUCTURES, {
        filter: { structureType: STRUCTURE_RAMPART },
    }) as StructureRampart[];
    manageBuildState(room, builders, constructionSites, ramparts);
    manageBuildSpawn(room, builders);

    // source 链：miner/hauler 编成与收入记账（升级预算与 porter 编制的输入）
    manageSource(room);

    // 物流：配送请求收集与搬运工匹配（relay 接力见 3.2）
    const haulers = getCreepsByRole(room, 'hauler');
    manageLogistics(room, haulers, state.creepsToFill);

    runSpawnManager(room);
};
