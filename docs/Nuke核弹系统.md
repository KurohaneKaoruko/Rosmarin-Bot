# Nuke 核弹系统

## 基本信息
- 功能定位：提供从“核弹请求”到“自动建旗发射”的闭环能力，并统一管理发射条件校验。
- 设计模式：请求队列（`NukerData.requests`）、命令转旗帜（request -> `nuke-*` flag）、能力校验门（资源/冷却/射程/RCL）。
- 运行节奏：`NukeModule.tick` 每 10 tick（受 QoS 与 bucket 限制）处理请求队列。
- 数据边界：核弹请求与落点时间记录在 `Memory.RosmarinBot.NukerData`。

## 处理链路
1. 控制台提交请求（`nuker.request/...`）写入 `NukerData.requests`。
2. `NukeModule` 轮询请求：为请求创建或维护对应 `nuke-*` flag。
3. 旗帜逻辑尝试寻找可发射房间并调用 `NukerLaunchTo` 发射。
4. 发射成功后记录 `landTime[targetRoom] = Game.time + NUKE_LAND_TIME`。

## 发射条件校验（`NukerControl`）
- nuker 存在且归我、激活、无冷却。
- 资源满足：`300000 energy + 5000 ghodium`。
- 射程满足：目标房线性距离 <= 10。

## 关键设计细节
- 请求有 TTL，过期自动清理，避免陈旧任务堆积。
- 请求支持指定候选发射房间列表，便于多房协同发射。
- `NukeModule` 只负责“请求转旗帜”，实际发射由旗帜执行链与结构控制完成。

## 当前实现边界
- 仍依赖目标房可见性与旗帜流程，不是纯后台无感发射。
- 发射房选择为规则匹配，不含路径风险与战局收益评分。
