import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import RoomDefense from "./function/roomDefense"
import OutMine from "./function/outMine"

import SpawnControl from "./structure/spawnControl"
import TowerControl from "./structure/towerControl"
import LabControl from "./structure/labControl"
import LinkControl from "./structure/linkControl"
import TerminalControl from "./structure/terminalControl"
import FactoryControl from "./structure/factoryControl"
import PowerSpawnControl from "./structure/powerSpawnControl"
import NukerControl from "./structure/nukerControl"

import AutoMarket from "./auto/autoMarket"
import AutoBuild from "./auto/autoBuild"
import AutoLab from "./auto/autoLab"
import AutoFactory from "./auto/autoFactory"
import AutoPowerSpawn from "./auto/autoPowerSpawn"

import Mission from "./mission"
import MissionPools from "./mission/pool/MissionPools"
import MissionGet from "./mission/pool/MissionGet"
import MissionSubmit from "./mission/pool/MissionSubmit"

import SpawnMission from "./mission/update/spawnMission"
import ManageMission from "./mission/update/manageMission"
import WorkMission from "./mission/update/workMission"
import MineMission from "./mission/update/mineMission"
import BoostMission from "./mission/update/boostMission"
import TransportMission from "./mission/update/transportMission"

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
    
    AutoMarket,     // 自动市场交易
    AutoBuild,      // 自动建筑
    AutoLab,        // 自动Lab合成
    AutoFactory,    // 自动Factory生产
    AutoPowerSpawn, // 自动PowerSpawn
    
    Mission,        // 任务模块
    MissionPools,   // 任务池
    MissionGet,     // 获取任务
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
