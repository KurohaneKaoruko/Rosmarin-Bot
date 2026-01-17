# Rosmarin-Bot / 迷迭香Bot

![version](https://img.shields.io/badge/version-1.9.2-orange)
![language-typescript](https://img.shields.io/badge/language-typescript-3178c6)
![screeps](https://img.shields.io/badge/game-Screeps-green)
![license](https://img.shields.io/badge/license-MIT-blue)

```
 ######     #####     #####    ##   ##      ##     ######    ######   ##   ##  
  ##  ##   ##   ##   ##   ##   ### ###     ####     ##  ##     ##     ###  ##  
  ##  ##   ##   ##   ##        #######    ##  ##    ##  ##     ##     #### ##  
  #####    ##   ##    #####    ## # ##    ######    #####      ##     ## ####  
  ####     ##   ##        ##   ##   ##    ##  ##    ####       ##     ##  ###  
  ## ##    ##   ##   ##   ##   ##   ##    ##  ##    ## ##      ##     ##   ##  
 ###  ##    #####     #####    ##   ##    ##  ##   ###  ##   ######   ##   ##
```

一个用于 [Screeps](https://screeps.com/) 的半自动 Bot，使用 TypeScript 开发。

> 🌿 **设计理念**：不同于全自动 Bot，本项目采用半自动设计——功能需要手动配置参数才能启动，因此大部分功能都支持自定义调整，如 Lab/Factory 的合成阈值、Market 的买卖价格限制等。这种设计让玩家保持对游戏的掌控感，同时减少重复性操作。

## ✨ 功能特性

### 🏠 房间运营
- 常驻 Creep 自动孵化与能量/资源填充
- 能量矿与元素矿自动采集
- 自动升级、建造、维修
- 预设布局自动放置工地（支持多种布局：`rosemary`、`clover`、`hoho`、`tea`）
- 多种房间运行模式：正常 / 停止 / 低功耗
- 自动刷墙，支持设置血量上限

### 📋 任务系统
- 基于任务池的 Creep 工作管理
- 支持搬运、建造、维修、孵化等任务类型
- Boost 任务控制的 Creep 强化

### ⛏️ 外矿采集
- 相邻房间能量自动采集（支持中央九房）
- 过道房间 PowerBank / Deposit 自动监控与采集
- 外矿道路自动建造与维护
- 支持多级 Boost 强化的采集队伍

### 🧪 生产系统
- **Lab**: 自动化合物合成，支持预设方案与自定义配方，可设定触发阈值和限额
- **Factory**: 自动化商品生产，支持多级商品供应链（0-5 级）
- **Power**: 自动烧 Power，支持阈值设置

### 💰 资源与交易
- 跨房间资源自动调度（供需阈值设置）
- 市场自动挂单与 Deal 交易
- 支持自动求购/出售功能
- Terminal 资源发送管理

### ⚔️ 战斗模块
- 四人小队协同作战
- 战争模式切换
- 房间防御模式设置
- 核弹发射控制

### 🔧 其他功能
- PowerCreep 管理与孵化
- 白名单系统
- Pixel 生成
- 信息统计
- 寻路回避房间设置

## 🚀 快速开始

### 环境要求
- Node.js 16+
- npm 或 yarn

### 安装

```bash
# 克隆项目
git clone https://github.com/KurohaneKaoruko/Rosmarin-Bot.git
cd Rosmarin-Bot

# 安装依赖
npm install
```

### 配置

创建 `.secret.json` 文件（已在 `.gitignore` 中忽略）：

```json
{
    "main": {
        "token": "你的Screeps Token",
        "protocol": "https",
        "hostname": "screeps.com",
        "port": 443,
        "path": "/",
        "branch": "main"
    },
    "sim": {
        "token": "你的Screeps Token",
        "protocol": "https",
        "hostname": "screeps.com",
        "port": 443,
        "path": "/",
        "branch": "sim"
    },
    "local": {
        "copyPath": "本地客户端代码路径"
    }
}
```

> 💡 **Token 获取**：登录 [Screeps 官网](https://screeps.com/) → Account → Auth Tokens → Generate Token

### 构建命令

| 命令 | 说明 |
|------|------|
| `npm run build` | 仅构建，输出到 `dist/` 目录 |
| `npm run push` | 构建并上传到 main 分支 |
| `npm run sim` | 构建并上传到 sim 分支（模拟器测试） |
| `npm run local` | 构建并复制到本地客户端 |
| `npm run count` | 统计代码行数 |
| `npm run ver` | 更新版本号 |

### 游戏内启动

**快速启动（一条指令完成下面的全部步骤）**
```javascript
// 使用自动布局一键完成
bot.add('W1N1')
// 使用静态布局
bot.add('W1N1', 布局名)
// 需要放置旗帜 centerPos 来指定布局中心
```



**第一步：添加房间**
```javascript
room.add('W1N1', 'rosemary', 25, 25)
// 参数: 房间名, 布局名(可选), 中心X(可选), 中心Y(可选)
```

**第二步：预览布局**
```javascript
layout.visual('W1N1')
// 可选指定布局: layout.visual('W1N1', 'clover')
// 如果通过room.add或layout.set设置了布局名称, 则可以不输入
// 使用静态布局需要设置中心, 如果没有设置也可以放置名为centerPos的旗帜
```

**第三步：生成建筑位置**
```javascript
layout.build('W1N1')
// 将建筑位置保存到 Memory
```

**第四步：开启自动建筑**
```javascript
layout.auto('W1N1')
// 开启后会自动放置工地
```

## 📖 控制台指令

在游戏控制台输入 `help` 查看完整指令列表：

| 指令 | 说明 |
|------|------|
| `help` | 显示帮助 |
| `helpRoom` | 房间管理指令 |
| `helpLayout` | 布局设置指令 |
| `helpInfo` | 信息查看指令 |
| `helpOutmine` | 外矿采集指令 |
| `helpMarket` | 市场交易指令 |
| `helpLab` | Lab 合成指令 |
| `helpFactory` | Factory 生产指令 |
| `helpPower` | Power 相关指令 |
| `helpSpawn` | 孵化控制指令 |
| `helpTerminal` | Terminal 操作指令 |
| `helpResource` | 资源管理指令 |
| `helpOther` | 其他功能指令 |

### 常用指令示例

```javascript
// 查看房间状态
info.room('W1N1')

// 查看所有资源储量
info.res()

// 设置 Lab 自动合成 (合成 XGH2O，限额 10000)
lab.auto.set('W1N1', 'XGH2O', 10000)

// 设置 Factory 自动生产
factory.auto.set('W1N1', 'battery', 5000)

// 添加外矿
mine.add('W1N1', 'W2N1')

// 设置自动交易
market.auto.sell('W1N1', 'deal', 'XGH2O', 10000, 50)

// 设置资源供需
resource.manage.set('W1N1', 'energy', {source: 500000, target: 100000})
```

## 📁 项目结构

```
rosmarin-bot/
├── plugins/                 # Rollup 插件
│   └── rollup-plugin-screeps.js
├── scripts/                 # 开发脚本
│   ├── countFiles.js        # 统计代码量
│   ├── submit.js            # 提交代码到游戏
│   └── updateVersion.js     # 更新版本号
├── src/
│   ├── boot/                # 启动控制模块
│   │   ├── CreepControl.ts  # Creep 控制
│   │   ├── FlagControl.ts   # Flag 控制
│   │   ├── PowerControl.ts  # Power 控制
│   │   └── RoomControl.ts   # 房间控制
│   ├── console/             # 控制台命令
│   │   ├── base.ts          # 基础命令
│   │   ├── help.ts          # 帮助文本
│   │   ├── function/        # 功能命令
│   │   └── structure/       # 建筑命令
│   ├── constant/            # 常量配置
│   │   ├── config.ts        # 全局配置
│   │   ├── CreepConstant.ts # Creep 常量
│   │   └── ...
│   ├── framework/           # 框架核心
│   │   ├── createApp.ts     # 应用创建
│   │   └── errorMapper.ts   # 错误映射
│   ├── interface/           # TypeScript 类型定义
│   ├── modules/             # 功能模块
│   │   ├── flagSpawn/       # Flag 触发孵化
│   │   ├── function/        # 功能模块 (清理/Pixel/统计)
│   │   ├── planner/         # 布局规划
│   │   ├── team/            # 小队战斗
│   │   ├── utils/           # 工具函数
│   │   ├── wheel/           # 轮子 (寻路/缓存/Profiler)
│   │   ├── ResourceManage.ts # 资源管理
│   │   └── WarModule.ts     # 战争模块
│   ├── prototype/           # 原型扩展
│   ├── main.ts              # 入口文件
│   └── utils.ts             # 通用工具
├── package.json
├── rollup.config.js         # Rollup 配置
└── tsconfig.json            # TypeScript 配置
```

## 🔧 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| TypeScript | 5.x | 主要开发语言 |
| Rollup | 4.x | 模块打包 |
| Terser | 5.x | 代码压缩 |

## 🎨 可用布局

| 布局名 | 说明 |
|--------|------|
| `rosemary` | 迷迭香布局 |
| `clover` | 三叶草布局 |
| `hoho` | hoho 布局 |
| `tea` | tea布局 |

> 💡 如果不指定布局，会使用自动布局

## 📝 注意事项

### 首次使用
- 首次切换分支后如果报错，再执行一次 `npm run push` 即可
- 建议先在 sim 分支测试：`npm run sim`

### 布局相关
- 手动布局时需确保 **Storage、Terminal、Factory 与一个 Link 集中放置**
- 与这四个建筑均相邻的点位即为中心，是中央搬运工的位置
- 手动布局需要将该点设置为布局中心，否则部分自动化功能将无法使用
- 使用 `layout.setcenter(roomName, x, y)` 设置布局中心

### 外矿相关
- 外矿道路建造需要房间达到对应等级
  - 普通能量矿：4 级
  - 中央九房：6 级

### Lab 设置
- 放置 Flag `labA` 和 `labB` 设置底物 Lab
- 放置 Flag `labset-{资源类型}` 设置 Boost Lab

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

[MIT](LICENSE)

---

<p align="center">
  <i>🌿 Rosmarin BOT </i>
</p>
