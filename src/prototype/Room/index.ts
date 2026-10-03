import { assignPrototype } from "@/modules/utils"
import BaseFunction from "./function/baseFunction"
import RoomDefense from "./feature/roomDefense"
import OutMine from "./feature/outMine"

import SpawnControl from "./structure/spawnControl"
import TowerControl from "./structure/towerControl"
import LabControl from "./structure/labControl"
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
import RaceVisual from "./feature/raceVisual"

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


const plugins = [
    BaseFunction,   // 基础函数
    RoomDefense,    // 房间防御
    OutMine,        // 外矿采集

    SpawnControl,   // 孵化控制
    LabControl,     // Lab控制
    TowerControl,   // 塔防控制
    LinkControl,    // Link控制
    TerminalControl,    // Terminal控制
    FactoryControl,     // Factory控制
    PowerSpawnControl,  // PowerSpawn控制
    NukerControl,       // Nuker控制
    ObserveControl,     // Observer控制
    
    AutoMarket,     // 自动市场交易
    AutoBuild,      // 自动建筑
    AutoLab,        // 自动Lab合成
    AutoFactory,    // 自动Factory生产
    AutoPowerSpawn, // 自动PowerSpawn
    RaceVisual,     // 冲级可视化

    Mission,        // 任务模块
    MissionPools,   // 任务池
    TransportTaskGetter, // 获取 transport 任务
    WorkTaskGetter, // 获取 build/repair/wall 任务
    ManageTaskGetter, // 获取 terminal 任务
    SpawnTaskGetter, // 获取孵化任务
    MissionSubmit,  // 提交任务
    SpawnMission,   // 孵化任务
    ManageMission,  // 管理任务
    WorkMission,    // 工作任务
    MineMission,    // 采矿任务
    BoostMission,   // 强化任务
    TransportMission,   // 运输任务
    

    RoomExecute,    // 房间执行
]

export default () => plugins.forEach(plugin => assignPrototype(Room, plugin))
