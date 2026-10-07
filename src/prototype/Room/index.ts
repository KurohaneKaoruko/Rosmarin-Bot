import { extend } from '../registry'
import BaseFunction from "./function/baseFunction"
import RoomDefense from "./feature/roomDefense"
import OutMine from "./feature/outMine"

import SpawnControl from "./structure/spawnControl"
import LabControl from "./structure/labControl"
import TowerControl from "./structure/towerControl"
import LinkControl from "./structure/linkControl"
import TerminalControl from "./structure/terminalControl"
import FactoryControl from "./structure/factoryControl"
import PowerSpawnControl from "./structure/powerSpawnControl"
import NukerControl from "./structure/nukerControl"
import ObserveControl from "./structure/observeControl"

import AutoMarket from "./feature/autoMarket"
import AutoBuild from "./feature/autoBuild"
import AutoLab from "./feature/autoLab"
import AutoFactory from "./feature/autoFactory"
import AutoPowerSpawn from "./feature/autoPowerSpawn"

import Mission from "./mission"
import MissionPools from "./mission/pool/MissionPools"
import MissionSubmit from "./mission/pool/MissionSubmit"
import SpawnMission, { SpawnTaskGetter } from "./mission/updaters/spawnMission"
import ManageMission, { ManageTaskGetter } from "./mission/updaters/manageMission"
import WorkMission, { WorkTaskGetter } from "./mission/updaters/workMission"
import MineMission from "./mission/updaters/mineMission"
import BoostMission from "./mission/updaters/boostMission"
import TransportMission, { TransportTaskGetter } from "./mission/updaters/transportMission"

import RoomExecute from "./execute"

/**
 * Room 原型扩展注册表（顺序即挂载顺序）
 */
export default () => {
    extend(Room, BaseFunction)             // 基础工具
    extend(Room, RoomDefense)              // 防御相关
    extend(Room, OutMine)                  // 外矿采集

    extend(Room, SpawnControl)             // 孵化控制
    extend(Room, LabControl)               // Lab 控制
    extend(Room, TowerControl)             // 塔类控制
    extend(Room, LinkControl)              // Link 控制
    extend(Room, TerminalControl)          // Terminal 控制
    extend(Room, FactoryControl)           // Factory 控制
    extend(Room, PowerSpawnControl)        // PowerSpawn 控制
    extend(Room, NukerControl)             // Nuker 控制
    extend(Room, ObserveControl)           // Observer 控制

    extend(Room, AutoMarket)               // 自动市场行为
    extend(Room, AutoBuild)                // 自动建造
    extend(Room, AutoLab)                  // 自动 Lab 合成
    extend(Room, AutoFactory)              // 自动 Factory 行为
    extend(Room, AutoPowerSpawn)           // 自动 PowerSpawn

    extend(Room, Mission)                  // 任务模块
    extend(Room, MissionPools)             // 任务池
    extend(Room, TransportTaskGetter)      // 获取 transport 任务
    extend(Room, WorkTaskGetter)           // 获取 build/repair/wall 任务
    extend(Room, ManageTaskGetter)         // 获取 terminal 任务
    extend(Room, SpawnTaskGetter)          // 获取孵化任务
    extend(Room, MissionSubmit)            // 提交任务
    extend(Room, SpawnMission)             // 孵化任务
    extend(Room, ManageMission)            // 管理任务
    extend(Room, WorkMission)              // 工作任务
    extend(Room, MineMission)              // 采矿任务
    extend(Room, BoostMission)             // 强化任务
    extend(Room, TransportMission)         // 运输任务

    extend(Room, RoomExecute)              // 房间执行
}
