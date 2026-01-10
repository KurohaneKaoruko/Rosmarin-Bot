const VERSION = '1.5.5';

const head = `<span style="color: #D0CAE0;"><b>
——————————————————————————— 迷迭香 𝕽𝖔𝖘𝖒𝖆𝖗𝖎𝖓 ${VERSION} ———————————————————————————
 ######     #####     #####    ##   ##      ##     ######    ######   ##   ##  
  ##  ##   ##   ##   ##   ##   ### ###     ####     ##  ##     ##     ###  ##  
  ##  ##   ##   ##   ##        #######    ##  ##    ##  ##     ##     #### ##  
  #####    ##   ##    #####    ## # ##    ######    #####      ##     ## ####  
  ####     ##   ##        ##   ##   ##    ##  ##    ####       ##     ##  ###  
  ## ##    ##   ##   ##   ##   ##   ##    ##  ##    ## ##      ##     ##   ##  
 ###  ##    #####     #####    ##   ##    ##  ##   ###  ##   ######   ##   ##
—————————————————————————————— 半自动 Screeps AI ——————————————————————————————
</b></span>`;

/** 帮助文本配置 */
const helpTexts: Record<string, string> = {
    help: `###  指令列表  ###
helpStart: 查看启动流程
helpInfo: 查看信息相关指令
helpRoom: 查看房间相关指令
helpLayout: 查看布局相关指令
helpOutmine: 查看外矿相关指令
helpMarket: 查看市场交易指令
helpLab: 查看Lab相关指令
helpFactory: 查看Factory相关指令
helpPower: 查看Power相关指令
helpSpawn: 查看孵化相关指令
helpTerminal: 查看Terminal相关指令
helpResource: 查看资源管理指令
helpOther: 查看其他指令`,

    helpStart: `###  启动流程  ###
1. room.add(roomName, layout?, x?, y?): 添加房间到控制列表，列表中的房间才会自动运行。
2. layout.visual(roomName, layout?): 查看房间布局可视化预览。
3. layout.build(roomName): 生成房间建筑位置, 并保存在Memory中。
4. layout.auto(roomName): 开启房间自动建筑。`,

    helpRoom: `###  房间指令列表  ###
room.add(roomName, layout?, x?, y?): 添加房间到控制列表
 - roomName: 房间名 layout: 布局 x,y: 布局中心
 - 后面的参数可以为空。
 - layout: 使用的布局, 留空则不使用
 - x,y: 布局中心坐标, 留空则不使用
 -- 如果需要手动布局则留空。注意, 手动布局需要保证storage、terminal、factory与一个link集中放置, 与这四个建筑均相邻的点位即为中心, 是中央搬运工的位置, 手动布局需要将该点设置为布局中心。若不满足上述条件, 部分自动化功能将无法使用。
room.remove(roomName): 从控制列表删除房间
room.list(): 查看控制列表
room.mode(roomName, mode): 设置房间运行模式
 - mode: main(正常), stop(停止), low(低功耗)
room.setcenter(roomName, x, y): 设置房间布局中心
room.defendmode(roomName, mode): 设置房间防御模式
room.sign(roomName, text?): 设置房间签名
room.setram(roomName, hits): 设置刷墙上限
 - hits: 可以是比例(0-1)或具体血量
room.send(roomName, targetRoom, type, amount): 添加资源发送任务`,

    helpLayout: `###  布局指令列表  ###
layout.set(roomName, layout, x, y): 设置房间布局
 - 可用的布局有: rosemary、clover、hoho、tea
layout.auto(roomName): 开关房间自动建筑
layout.remove(roomName): 删除指定房间布局Memory
layout.build(roomName): 生成建筑位置并保存到Memory
 - 如果没有设置布局, 则会使用自动布局(63auto)
 - 如果没有房间视野, 需要设置flag: pc(控制器), pm(矿), pa/pb(能量源)
layout.visual(roomName, layout?): 显示布局可视化
layout.save(roomName, struct?): 将房间建筑保存到布局Memory
layout.ramhits(roomName): 查看rampart最小/最大血量
layout.rampart(roomName, operate): 从flag添加/删除rampart到布局
 - 放置flag: layout-rampart, operate: 1添加, 0删除
layout.wall(roomName, operate): 从flag添加/删除wall到布局
 - 放置flag: layout-wall
layout.ramwall(roomName, operate): 从flag添加/删除rampart和wall
 - 放置flag: layout-ramwall
layout.ramarea(roomName, operate): 从区域添加/删除rampart
 - 放置flag: layout-ramA 和 layout-ramB 标记区域`,

    helpInfo: `###  信息指令列表  ###
info.room(roomName?): 查看房间工作状态
 - 不填roomName则显示所有房间
info.allres(): 查看所有资源储量
info.roomres(): 查看房间资源占用空间`,

    helpOutmine: `###  外矿指令列表  ###
outmine.add(roomName, targetRoom): 添加外矿房间
 - 普通房间添加到energy列表
 - 过道房间添加到highway监控列表
 - 中间房间添加到centerRoom采矿列表
outmine.remove(roomName, targetRoom): 删除外矿房间
outmine.list(roomName): 查看外矿列表
outmine.clearRoad(roomName): 清空外矿Road缓存
outmine.auto(roomName, type): 开关自动采集
 - type: power 或 deposit
outmine.power(roomName, targetRoom, num, boostLevel?, prNum?): 派出Power开采队
 - boostLevel: 0/1/2 强化等级
outmine.deposit(roomName, targetRoom, num): 派出Deposit开采队
outmine.cancel(roomName, targetRoom, type?): 取消开采任务
road.help(): 外矿造路规划相关`,

    helpMarket: `###  市场交易指令列表  ###
market.deal(orderId, maxAmount?, roomName?): 直接交易订单
market.look(resType, orderType, roomName?, length?): 查看市场订单
 - orderType: ORDER_SELL(购买) 或 ORDER_BUY(出售)
market.buy({roomName, type, amount, price?, maxPrice?}): 创建求购订单
market.sell({roomName, type, amount, price?, minPrice?}): 创建出售订单
market.dealBuy(roomName, type, amount, length?, price?): 直接购买资源
market.dealSell(roomName, type, amount, length?, price?): 直接出售资源
--- 自动交易 ---
market.auto.list(roomName?): 查看自动交易列表
market.auto.remove(roomName, resourceType, orderType): 移除自动交易
market.auto.buy(roomName, type, resourceType, amount, price?): 设置自动求购
 - type: create(创建订单) 或 deal(直接交易)
market.auto.sell(roomName, type, resourceType, amount, price?): 设置自动出售`,

    helpLab: `###  Lab指令列表  ###
lab.open(roomName): 开启Lab合成
lab.stop(roomName): 关闭Lab合成
lab.set(roomName, product, amount?): 设置Lab合成产物
 - 放置flag: labA/lab-A 和 labB/lab-B 设置底物Lab
lab.setboost(roomName): 设置Boost Lab
 - 放置flag: labset-{资源类型} 在对应Lab上
lab.addboost(roomName, mineral, amount?): 添加Boost任务
lab.removeboost(roomName, mineral): 移除Boost任务
--- 自动合成 ---
lab.auto.set(roomName, product, amount?): 设置自动合成
 - amount: 合成限额, 0为无限制
lab.auto.remove(roomName, product): 移除自动合成
lab.auto.list(roomName?): 查看自动合成列表`,

    helpFactory: `###  Factory指令列表  ###
factory.open(roomName): 开启Factory
factory.stop(roomName): 关闭Factory
factory.set(roomName, product, amount?): 设置生产任务
factory.setlevel(roomName, level): 设置Factory等级(0-5)
--- 自动生产 ---
factory.auto.set(roomName, product, amount?): 设置自动生产
factory.auto.remove(roomName, product): 移除自动生产
factory.auto.list(roomName?): 查看自动生产列表`,

    helpPower: `###  Power指令列表  ###
power.open(roomName): 开启烧Power
power.stop(roomName): 关闭烧Power
power.auto.set(roomName, energy, power): 设置自动烧Power阈值
power.auto.remove(roomName): 移除自动烧Power
--- PowerCreep ---
pc.spawn(pcname, roomName): 孵化PowerCreep
pc.set(pcname, roomName): 设置PowerCreep孵化房间`,

    helpSpawn: `###  孵化指令列表  ###
spawn.creep(roomName, bodypart, role, memory?): 孵化指定体型的Creep
 - bodypart: 体型字符串
spawn.role(roomName, role, memory?, num?): 孵化指定角色的Creep
 - 使用默认体型
spawn.sign(roomName, targetRoom, sign): 孵化scout进行签名`,

    helpTerminal: `###  Terminal指令列表  ###
terminal.send(room?, target, type, amount): 发送资源
 - room为空时从所有房间发送
terminal.show({roomName?, type?}): 显示终端资源
 - 可选参数组合查看不同范围`,

    helpResource: `###  资源管理指令列表  ###
resource.manage.set(roomName, resource, {source, target}): 设置资源供需
 - source: 供应阈值(超过则可供应)
 - target: 需求阈值(低于则需要补充)
resource.manage.remove(roomName, resource): 移除资源设置
resource.manage.clear(roomName): 清空房间资源设置
resource.manage.show.all(): 显示所有资源设置
resource.manage.show.room(roomName): 显示房间资源设置
resource.manage.show.res(resource): 显示指定资源设置
--- 搬运任务 ---
resource.transport.task(roomName, source, target, resource, amount): 添加搬运任务
 - source/target: storage, terminal, factory`,

    helpOther: `###  其他指令列表  ###
--- 白名单 ---
whitelist.add(id): 添加玩家到白名单
whitelist.remove(id): 从白名单移除玩家
whitelist.show(): 显示白名单
--- 清理 ---
clear.site(roomName): 清除房间建筑工地
clear.flag(roomName): 清除房间旗子
clear.mission(roomName, type): 清空房间任务池
clear.roomPath(roomName): 清空房间路径缓存
clear.boostTask(roomName): 清空房间Boost任务
--- 开关 ---
warmode(): 开关全局战争模式
pixel(): 开关搓Pixel功能
stats(): 开关信息统计功能
--- 其他 ---
avoidRoom(room): 添加房间到寻路回避列表
--- 核弹 ---
nuker.launch(...rooms): 发射核弹
 - 放置flag: nuke-{数量} 在目标位置
nuker.clear(): 清除所有nuke发射标记`,
};

/** 生成帮助命令配置 */
const createHelpCommand = (alias: string, withHead = false) => ({
    alias,
    exec: () => withHead ? `${head}<br><b>${helpTexts[alias]}</b>` : helpTexts[alias],
});

export default [
    createHelpCommand('help', true),
    ...Object.keys(helpTexts)
        .filter(key => key !== 'help')
        .map(key => createHelpCommand(key)),
];
