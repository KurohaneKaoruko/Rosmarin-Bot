import { assignPrototype } from "@/utils"
import BaseFunction from "./function/baseFunction"
import RoomDefense from "./function/defense"
import OutMine from "./function/outMine"

import StructureWork from "./structure/structureWork"
import SpawnControl from "./structure/spawnControl"
import TowerControl from "./structure/towerControl"
import LabControl from "./structure/labControl"

import AutoMarket from "./autotask/autoMarket"
import AutoBuild from "./autotask/autoBuild"
import AutoLab from "./autotask/autoLab"
import AutoFactory from "./autotask/autoFactory"
import AutoPower from "./autotask/autoPower"

import Mission from "./mission"
import MissionPools from "./mission/pool/MissionPools"
import MissionAdd from "./mission/pool/MissionAdd"
import MissionGet from "./mission/pool/MissionGet"
import MissionSubmit from "./mission/pool/MissionSubmit"

import RoomExecute from "./execute"


const plugins = [
    BaseFunction,   // 基础函数
    RoomDefense,    // 房间防御
    OutMine,        // 外矿采集

    StructureWork,  // 建筑物工作
    SpawnControl,   // 孵化控制
    LabControl,     // Lab控制
    TowerControl,   // 塔防控制
    
    AutoMarket,     // 自动市场交易
    AutoBuild,      // 自动建筑
    AutoLab,        // 自动Lab合成
    AutoFactory,    // 自动Factory生产
    AutoPower,      // 自动PowerSpawn
    
    MissionPools,   // 任务池
    MissionAdd,     // 添加任务
    MissionGet,     // 获取任务
    MissionSubmit,  // 提交任务
    Mission,        // 任务模块

    RoomExecute,    // 房间执行
]

export default () => plugins.forEach(plugin => assignPrototype(Room, plugin))


