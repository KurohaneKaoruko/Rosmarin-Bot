import { VERSION } from '../constant/config';

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

const br = '<br>';
const line = (text = '────────────────────────────────────────────────') =>
    `<span style="color:#3b3b3b">${text}</span>`;
const title = (emoji: string, text: string) =>
    `<span style="color:#D0CAE0"><b>${emoji} ${text}</b></span>`;
const cmd = (text: string) => `<span style="color:#9CDCFE"><b>${text}</b></span>`;
const sub = (emoji: string, text: string) => `<span style="color:#C8C8C8"><b>${emoji} ${text}</b></span>`;

/** 帮助文本配置 */
const helpTexts: Record<string, string> = {
    help: [
        title('🚀', '启动流程'),
        `0) ${cmd('bot.start(roomName, layout?)')}：快速启动房间（一条指令执行完整流程）`,
        `- roomName：房间名；layout：布局名称(留空使用自动布局)；`,
        `- 如果有centerPos旗帜则会自动设置布局中心, 如果使用静态布局则必须要有这个旗帜`,
        `1) ${cmd('room.add(roomName, layout?, x?, y?)')}：添加房间到控制列表（列表中的房间才会自动运行）`,
        `2) ${cmd('layout.visual(roomName, layout?)')}：查看房间布局可视化预览`,
        `3) ${cmd('layout.build(roomName)')}：生成房间建筑位置并保存到 Memory`,
        `4) ${cmd('layout.auto(roomName)')}：开启房间自动建筑`,
        line(),
        title('📚', '指令列表'),
        `- ${cmd('helpRoom')}：房间相关指令`,
        `- ${cmd('helpLayout')}：布局相关指令`,
        `- ${cmd('helpInfo')}：信息相关指令`,
        `- ${cmd('helpOutmine')}：外矿相关指令`,
        `- ${cmd('helpMarket')}：市场交易指令`,
        `- ${cmd('helpLab')}：Lab 相关指令`,
        `- ${cmd('helpFactory')}：Factory 相关指令`,
        `- ${cmd('helpPower')}：Power 相关指令`,
        `- ${cmd('helpSpawn')}：孵化相关指令`,
        `- ${cmd('helpTerminal')}：Terminal 相关指令`,
        `- ${cmd('helpResource')}：资源管理指令`,
        `- ${cmd('helpOther')}：其他指令`,
        line(),
    ].join(br),

    helpRoom: [
        title('🏠', '房间指令列表'),
        line(),
        `${cmd('room.add(roomName, layout?, x?, y?)')}：添加房间到控制列表`,
        `- roomName：房间名；layout：布局；x,y：布局中心`,
        `- layout：使用的布局（留空则不使用）`,
        `- x,y：布局中心坐标（留空则不使用，如果有centerPos旗帜则会自动设置）`,
        `- 手动布局：需保证 storage / terminal / factory / 1 个 link 集中放置，与这四个建筑均相邻的点位为中心（中央搬运工位置）`,
        `${cmd('room.remove(roomName)')}：从控制列表删除房间`,
        `${cmd('room.list()')}：查看控制列表`,
        `${cmd('room.mode(roomName, mode)')}：设置房间运行模式（main / stop / low）`,
        `${cmd('room.setcenter(roomName, x, y)')}：设置房间布局中心`,
        `${cmd('room.defendmode(roomName, mode)')}：设置房间防御模式`,
        `${cmd('room.sign(roomName, text?)')}：设置房间签名`,
        `${cmd('room.setram(roomName, hits)')}：设置刷墙上限（比例 0-1 或具体血量）`,
        `${cmd('room.send(roomName, targetRoom, type, amount)')}：添加资源发送任务`,
        line(),
    ].join(br),

    helpLayout: [
        title('🗺️', '布局指令列表'),
        line(),
        `${cmd('layout.set(roomName, layout, x, y)')}：设置房间布局（rosemary / clover / hoho / tea）`,
        `${cmd('layout.auto(roomName)')}：开关房间自动建筑`,
        `${cmd('layout.remove(roomName)')}：删除指定房间布局 Memory`,
        `${cmd('layout.build(roomName)')}：生成建筑位置并保存到 Memory`,
        `- 静态布局：使用 centerPos 旗帜或手动设置来定位布局中心`,
        `- 未设置布局：将使用自动布局（63auto）`,
        `- 无房间视野：需要设置 flag：pc（控制器）、pm（矿）、pa/pb（能量源）`,
        `${cmd('layout.visual(roomName, layout?)')}：显示布局可视化`,
        `${cmd('layout.save(roomName, struct?)')}：将房间建筑保存到布局 Memory`,
        `${cmd('layout.ramhits(roomName)')}：查看 rampart 最小/最大血量`,
        `${cmd('layout.rampart(roomName, operate)')}：从 flag 添加/删除 rampart（layout-rampart；1 添加 / 0 删除）`,
        `${cmd('layout.wall(roomName, operate)')}：从 flag 添加/删除 wall（layout-wall）`,
        `${cmd('layout.ramwall(roomName, operate)')}：从 flag 添加/删除 rampart + wall（layout-ramwall）`,
        `${cmd('layout.ramarea(roomName, operate)')}：从区域添加/删除 rampart（layout-ramA / layout-ramB）`,
        line(),
    ].join(br),

    helpInfo: [
        title('ℹ️', '信息指令列表'),
        line(),
        `${cmd('info.room(roomName?)')}：查看房间工作状态（不填 roomName 显示所有房间）`,
        `${cmd('info.res()')}：查看所有资源储量`,
        `${cmd('info.roomres()')}：查看房间资源占用空间`,
        line(),
    ].join(br),

    helpMine: [
        title('⛏️', '外矿指令列表'),
        line(),
        `${cmd('mine.add(roomName, targetRoom)')}：添加外矿房间`,
        `- 普通房间：添加到 energy 列表`,
        `- 过道房间：添加到 highway 监控列表`,
        `- 中间房间：添加到 centerRoom 采矿列表`,
        `${cmd('mine.remove(roomName, targetRoom)')}：删除外矿房间`,
        `${cmd('mine.list(roomName)')}：查看外矿列表`,
        `${cmd('mine.clearRoad(roomName)')}：清空外矿 Road 缓存`,
        `${cmd('mine.auto(roomName, type)')}：开关自动采集（type: power / deposit）`,
        `${cmd('mine.power(roomName, targetRoom, num, boostLevel?, prNum?)')}：派出 Power 开采队（boostLevel: 0/1/2）`,
        `${cmd('mine.deposit(roomName, targetRoom, num)')}：派出 Deposit 开采队`,
        `${cmd('mine.cancel(roomName, targetRoom, type?)')}：取消开采任务`,
        `${cmd('road.help()')}：外矿造路规划相关`,
        line(),
    ].join(br),

    helpRoad: [
        title('🛣️', '外矿道路命令帮助'),
        line(),
        `${cmd('road.recalc(homeRoom, targetRoom)')}：重新计算指定路线`,
        `${cmd('road.recalcAll(homeRoom?)')}：重新计算所有外矿路线（不填则全部房间）`,
        `${cmd('road.clear(homeRoom, targetRoom)')}：清除指定路线`,
        `${cmd('road.clearAll(homeRoom)')}：清除所有路线`,
        `${cmd('road.stats(homeRoom)')}：显示统计信息`,
        `${cmd('road.validate(homeRoom)')}：验证数据完整性`,
        `${cmd('road.clearCache()')}：清除 CostMatrix 缓存`,
        `${cmd('road.health(homeRoom)')}：检查道路健康状态`,
        `${cmd('road.show(homeRoom, targetRoom?)')}：显示道路可视化`,
        `${cmd('road.hide(homeRoom)')}：隐藏道路可视化`,
        `${cmd('road.help()')}：显示此帮助`,
        line(),
    ].join(br),

    helpMarket: [
        title('💱', '市场交易指令列表'),
        line(),
        `${cmd('market.deal(orderId, maxAmount?, roomName?)')}：直接交易订单`,
        `${cmd('market.look(resType, orderType, roomName?, length?)')}：查看市场订单（ORDER_SELL 购买 / ORDER_BUY 出售）`,
        `${cmd('market.buy({roomName, type, amount, price?, maxPrice?})')}：创建求购订单`,
        `${cmd('market.sell({roomName, type, amount, price?, minPrice?})')}：创建出售订单`,
        `${cmd('market.dealBuy(roomName, type, amount, length?, price?)')}：直接购买资源`,
        `${cmd('market.dealSell(roomName, type, amount, length?, price?)')}：直接出售资源`,
        line(),
        sub('🤖', '自动交易'),
        `${cmd('market.auto.list(roomName?)')}：查看自动交易列表`,
        `${cmd('market.auto.remove(roomName, resourceType, orderType)')}：移除自动交易`,
        `${cmd('market.auto.buy(roomName, type, resourceType, amount, price?)')}：设置自动求购（type: create / deal）`,
        `${cmd('market.auto.sell(roomName, type, resourceType, amount, price?)')}：设置自动出售`,
        line(),
    ].join(br),

    helpLab: [
        title('⚗️', 'Lab 指令列表'),
        line(),
        `${cmd('lab.open(roomName)')}：开启 Lab 合成`,
        `${cmd('lab.stop(roomName)')}：关闭 Lab 合成`,
        `${cmd('lab.set(roomName, product, amount?)')}：设置 Lab 合成产物`,
        `- 放置 flag：labA / lab-A 与 labB / lab-B 设置底物 Lab`,
        line(),
        `${cmd('lab.setboost(roomName)')}：设置 Boost Lab`,
        `- 放置 flag：labset-{资源类型} 在对应 Lab 上`,
        `${cmd('lab.addboost(roomName, mineral, amount?)')}：添加 Boost 任务`,
        `${cmd('lab.removeboost(roomName, mineral)')}：移除 Boost 任务`,
        line(),
        sub('🤖', '自动合成'),
        `${cmd('lab.auto.set(roomName, product, amount?)')}：设置自动合成（amount: 合成限额，0 为无限制）`,
        `${cmd('lab.auto.remove(roomName, product)')}：移除自动合成`,
        `${cmd('lab.auto.list(roomName?)')}：查看自动合成列表`,
        line(),
    ].join(br),

    helpFactory: [
        title('🏭', 'Factory 指令列表'),
        line(),
        `${cmd('factory.open(roomName)')}：开启 Factory`,
        `${cmd('factory.stop(roomName)')}：关闭 Factory`,
        `${cmd('factory.set(roomName, product, amount?)')}：设置生产任务`,
        `${cmd('factory.setlevel(roomName, level)')}：设置 Factory 等级（0-5）`,
        line(),
        sub('🤖', '自动生产'),
        `${cmd('factory.auto.set(roomName, product, amount?)')}：设置自动生产`,
        `${cmd('factory.auto.remove(roomName, product)')}：移除自动生产`,
        `${cmd('factory.auto.list(roomName?)')}：查看自动生产列表`,
        line(),
    ].join(br),

    helpPower: [
        title('⚡', 'Power 指令列表'),
        line(),
        `${cmd('power.open(roomName)')}：开启烧 Power`,
        `${cmd('power.stop(roomName)')}：关闭烧 Power`,
        `${cmd('power.auto.set(roomName, energy, power)')}：设置自动烧 Power 阈值`,
        `${cmd('power.auto.remove(roomName)')}：移除自动烧 Power`,
        line(),
        sub('🧙', 'PowerCreep'),
        `${cmd('pc.spawn(pcname, roomName)')}：孵化 PowerCreep`,
        `${cmd('pc.set(pcname, roomName)')}：设置 PowerCreep 孵化房间`,
        line(),
    ].join(br),

    helpSpawn: [
        title('🐣', '孵化指令列表'),
        line(),
        `${cmd('spawn.creep(roomName, bodypart, role, memory?)')}：孵化指定体型的 Creep（bodypart: 体型字符串）`,
        `${cmd('spawn.role(roomName, role, memory?, num?)')}：孵化指定角色的 Creep（使用默认体型）`,
        `${cmd('spawn.sign(roomName, targetRoom, sign)')}：孵化 scout 进行签名`,
        line(),
    ].join(br),

    helpTerminal: [
        title('📦', 'Terminal 指令列表'),
        line(),
        `${cmd('terminal.send(room?, target, type, amount)')}：发送资源（room 为空时从所有房间发送）`,
        `${cmd('terminal.show({roomName?, type?})')}：显示终端资源（可选参数组合查看不同范围）`,
        line(),
    ].join(br),

    helpResource: [
        title('🧰', '资源管理指令列表'),
        line(),
        `${cmd('resource.manage.set(roomName, resource, {source, target})')}：设置资源供需`,
        `- source：供应阈值（超过则可供应）`,
        `- target：需求阈值（低于则需要补充）`,
        `${cmd('resource.manage.remove(roomName, resource)')}：移除资源设置`,
        `${cmd('resource.manage.clear(roomName)')}：清空房间资源设置`,
        `${cmd('resource.manage.show.all()')}：显示所有资源设置`,
        `${cmd('resource.manage.show.room(roomName)')}：显示房间资源设置`,
        `${cmd('resource.manage.show.res(resource)')}：显示指定资源设置`,
        line(),
        sub('📦', '搬运任务'),
        `${cmd('resource.transport.task(roomName, source, target, resource, amount)')}：添加搬运任务（source/target: storage / terminal / factory）`,
        line(),
    ].join(br),

    helpOther: [
        title('🧾', '其他指令列表'),
        line(),
        sub('✅', '白名单'),
        `${cmd('whitelist.add(id)')}：添加玩家到白名单`,
        `${cmd('whitelist.remove(id)')}：从白名单移除玩家`,
        `${cmd('whitelist.show()')}：显示白名单`,
        line(),
        sub('🧹', '清理'),
        `${cmd('clear.site(roomName)')}：清除房间建筑工地`,
        `${cmd('clear.flag(roomName)')}：清除房间旗子`,
        `${cmd('clear.mission(roomName, type)')}：清空房间任务池`,
        `${cmd('clear.roomPath(roomName)')}：清空房间路径缓存`,
        `${cmd('clear.boostTask(roomName)')}：清空房间 Boost 任务`,
        line(),
        sub('🎛️', '开关'),
        `${cmd('warmode()')}：开关全局战争模式`,
        `${cmd('pixel()')}：开关搓 Pixel 功能`,
        `${cmd('stats()')}：开关信息统计功能`,
        line(),
        sub('🧭', '其他'),
        `${cmd('avoidRoom(room)')}：添加房间到寻路回避列表`,
        line(),
        sub('💣', '核弹'),
        `${cmd('nuker.launch(...rooms)')}：发射核弹（放置 flag：nuke-{数量} 在目标位置）`,
        `${cmd('nuker.clear()')}：清除所有 nuke 发射标记`,
        line(),
    ].join(br),
};

/** 生成帮助命令配置 */
const createHelpCommand = (alias: string, withHead = false) => ({
    alias,
    exec: () => withHead ? `${head}${br}${helpTexts[alias]}` : helpTexts[alias],
});

export default [
    createHelpCommand('help', true),
    ...Object.keys(helpTexts)
        .filter(key => key !== 'help')
        .map(key => createHelpCommand(key)),
];
