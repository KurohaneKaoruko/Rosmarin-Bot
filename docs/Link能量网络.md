# Link 能量网络

## 基本信息
- 功能定位：在房间内部用 Link 构建能源快速转发网络，降低搬运链路压力。
- 设计模式：角色分区（source/controller/manage/normal link）、优先级路由、阈值驱动传输。
- 运行节奏：`LinkWork()` 每 10 tick 执行一次（叠加房间相位错峰，QoS emergency 档跳过）。
- 数据边界：纯运行时判定，不依赖长期内存状态。

## 节点分类
- `sourceLinks`：靠近 source（2 格内），作为供给源。
- `controllerLink`：靠近 controller（2 格内），优先保障升级供能。
- `manageLink`：靠近中心位（1 格内），作为中枢缓冲。
- `normalLink`：其他 link，作为次级转发/缓冲点。

## 路由优先级
1. source → controller（controller 能量不足优先补）
2. source → normal（填补普通缓冲）
3. source → manage（中心补能）
4. manage → controller（兜底）
5. manage → normal（溢出回流）

## 关键规则
- 只有 `RCL>=5` 且 link 数量至少 2 才启用。
- source link 必须具备足够能量（当前阈值 400）才触发发送。
- **整脉冲直发**：source link 将满（free≤100）且 controller link **为空**时，
  优先整笔直发——空接收端保证一次 transfer 把 800 全额落地，不浪费这个 cooldown 的吞吐；
  非空接收端仍走 400 阈值路由，两边互不抢跑。
- 通过 `transferOK` 标记避免同一轮重复指向同目标。

## 当前实现边界
- 阈值与优先级为固定规则，不根据房间负载动态学习。
- 已接入 QoS 门禁（`shouldRun({ minBucket: 2000 })`）：bucket<2000（emergency）整段跳过，
  由下一个 10 tick 周期自愈；周期判定叠加房间相位错峰（`isRoomTickAligned`）。
