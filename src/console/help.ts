const head ='<span style="color: #D0CAE0; "><b>' +
            '———————————————————————————— 迷迭香 𝕽𝖔𝖘𝖒𝖆𝖗𝖎𝖓 v1.5.3 ———————————————————————————\n' +
            ' ######     #####     #####    ##   ##      ##     ######    ######   ##   ##  \n' +
            '  ##  ##   ##   ##   ##   ##   ### ###     ####     ##  ##     ##     ###  ##  \n' +
            '  ##  ##   ##   ##   ##        #######    ##  ##    ##  ##     ##     #### ##  \n' +
            '  #####    ##   ##    #####    ## # ##    ######    #####      ##     ## ####  \n' +
            '  ####     ##   ##        ##   ##   ##    ##  ##    ####       ##     ##  ###  \n' +
            '  ## ##    ##   ##   ##   ##   ##   ##    ##  ##    ## ##      ##     ##   ##  \n' +
            ' ###  ##    #####     #####    ##   ##    ##  ##   ###  ##   ######   ##   ##  \n' +
            '—————————————————————————————— 半自动 Screeps AI ——————————————————————————————' +
            '</b></span>\n';


export default [
    {
        alias: 'help',
        exec: function () {
            return head + '<b>' +
                '###  指令列表  ###\n' +
                'helpStart: 查看启动流程\n' +
                'helpInfo: 查看信息相关指令\n' +
                'helpRoom: 查看房间相关指令\n' +
                'helpLayout: 查看布局相关指令\n' +
                'helpOutmine: 查看外矿相关指令\n' +
                'helpMarket: 查看市场交易指令\n' +
                'helpLab: 查看Lab相关指令\n' +
                'helpFactory: 查看Factory相关指令\n' +
                'helpPower: 查看Power相关指令\n' +
                'helpSpawn: 查看孵化相关指令\n' +
                'helpTerminal: 查看Terminal相关指令\n' +
                'helpResource: 查看资源管理指令\n' +
                'helpOther: 查看其他指令\n' +
                '</b>'
        }
    },
    {
        alias: 'helpStart',
        exec: function () {
            return '###  启动流程  ###\n' +
                '1. room.add(roomName, layout?, x?, y?): 添加房间到控制列表，列表中的房间才会自动运行。\n' +
                '2. layout.visual(roomName, layout?): 查看房间布局可视化预览。\n' +
                '3. layout.build(roomName): 生成房间建筑位置, 并保存在Memory中。\n' +
                '4. layout.auto(roomName): 开启房间自动建筑。\n'
        }
    },
    {
        alias: 'helpRoom',
        exec: function () {
            return '###  房间指令列表  ###\n' +
                'room.add(roomName, layout?, x?, y?): 添加房间到控制列表\n' +
                ' - roomName: 房间名 layout: 布局 x,y: 布局中心\n' +
                ' - 后面的参数可以为空。\n' +
                ' - layout: 使用的布局, 留空则不使用\n' +
                ' - x,y: 布局中心坐标, 留空则不使用\n' +
                ' -- 如果需要手动布局则留空。注意, 手动布局需要保证storage、terminal、factory与一个link集中放置, 与这四个建筑均相邻的点位即为中心, 是中央搬运工的位置, 手动布局需要将该点设置为布局中心。若不满足上述条件, 部分自动化功能将无法使用。\n' +
                'room.remove(roomName): 从控制列表删除房间\n' +
                'room.list(): 查看控制列表\n' +
                'room.mode(roomName, mode): 设置房间运行模式\n' +
                ' - mode: main(正常), stop(停止), low(低功耗)\n' +
                'room.setcenter(roomName, x, y): 设置房间布局中心\n' +
                'room.defendmode(roomName, mode): 设置房间防御模式\n' +
                'room.sign(roomName, text?): 设置房间签名\n' +
                'room.setram(roomName, hits): 设置刷墙上限\n' +
                ' - hits: 可以是比例(0-1)或具体血量\n' +
                'room.send(roomName, targetRoom, type, amount): 添加资源发送任务\n'
        }
    },
    {
        alias: 'helpLayout',
        exec: function () {
            return '###  布局指令列表  ###\n' +
                'layout.set(roomName, layout, x, y): 设置房间布局\n' +
                ' - 可用的布局有: rosemary、clover、hoho、tea\n' +
                'layout.auto(roomName): 开关房间自动建筑\n' +
                'layout.remove(roomName): 删除指定房间布局Memory\n' +
                'layout.build(roomName): 生成建筑位置并保存到Memory\n' +
                ' - 如果没有设置布局, 则会使用自动布局(63auto)\n' +
                ' - 如果没有房间视野, 需要设置flag: pc(控制器), pm(矿), pa/pb(能量源)\n' +
                'layout.visual(roomName, layout?): 显示布局可视化\n' +
                'layout.save(roomName, struct?): 将房间建筑保存到布局Memory\n' +
                'layout.ramhits(roomName): 查看rampart最小/最大血量\n' +
                'layout.rampart(roomName, operate): 从flag添加/删除rampart到布局\n' +
                ' - 放置flag: layout-rampart, operate: 1添加, 0删除\n' +
                'layout.wall(roomName, operate): 从flag添加/删除wall到布局\n' +
                ' - 放置flag: layout-wall\n' +
                'layout.ramwall(roomName, operate): 从flag添加/删除rampart和wall\n' +
                ' - 放置flag: layout-ramwall\n' +
                'layout.ramarea(roomName, operate): 从区域添加/删除rampart\n' +
                ' - 放置flag: layout-ramA 和 layout-ramB 标记区域\n'
        }
    },
    {
        alias: 'helpInfo',
        exec: function () {
            return '###  信息指令列表  ###\n' +
                'info.room(roomName?): 查看房间工作状态\n' +
                ' - 不填roomName则显示所有房间\n' +
                'info.allres(): 查看所有资源储量\n' +
                'info.roomres(): 查看房间资源占用空间\n'
        }
    },
    {
        alias: 'helpOutmine',
        exec: function () {
            return '###  外矿指令列表  ###\n' +
                'outmine.add(roomName, targetRoom): 添加外矿房间\n' +
                ' - 普通房间添加到energy列表\n' +
                ' - 过道房间添加到highway监控列表\n' +
                ' - 中间房间添加到centerRoom采矿列表\n' +
                'outmine.remove(roomName, targetRoom): 删除外矿房间\n' +
                'outmine.list(roomName): 查看外矿列表\n' +
                'outmine.clearRoad(roomName): 清空外矿Road缓存\n' +
                'outmine.auto(roomName, type): 开关自动采集\n' +
                ' - type: power 或 deposit\n' +
                'outmine.power(roomName, targetRoom, num, boostLevel?, prNum?): 派出Power开采队\n' +
                ' - boostLevel: 0/1/2 强化等级\n' +
                'outmine.deposit(roomName, targetRoom, num): 派出Deposit开采队\n' +
                'outmine.cancel(roomName, targetRoom, type?): 取消开采任务\n' +
                'road.help(): 外矿造路规划相关'
        }
    },
    {
        alias: 'helpMarket',
        exec: function () {
            return '###  市场交易指令列表  ###\n' +
                'market.deal(orderId, maxAmount?, roomName?): 直接交易订单\n' +
                'market.look(resType, orderType, roomName?, length?): 查看市场订单\n' +
                ' - orderType: ORDER_SELL(购买) 或 ORDER_BUY(出售)\n' +
                'market.buy({roomName, type, amount, price?, maxPrice?}): 创建求购订单\n' +
                'market.sell({roomName, type, amount, price?, minPrice?}): 创建出售订单\n' +
                'market.dealBuy(roomName, type, amount, length?, price?): 直接购买资源\n' +
                'market.dealSell(roomName, type, amount, length?, price?): 直接出售资源\n' +
                '--- 自动交易 ---\n' +
                'market.auto.list(roomName?): 查看自动交易列表\n' +
                'market.auto.remove(roomName, resourceType, orderType): 移除自动交易\n' +
                'market.auto.buy(roomName, type, resourceType, amount, price?): 设置自动求购\n' +
                ' - type: create(创建订单) 或 deal(直接交易)\n' +
                'market.auto.sell(roomName, type, resourceType, amount, price?): 设置自动出售\n'
        }
    },
    {
        alias: 'helpLab',
        exec: function () {
            return '###  Lab指令列表  ###\n' +
                'lab.open(roomName): 开启Lab合成\n' +
                'lab.stop(roomName): 关闭Lab合成\n' +
                'lab.set(roomName, product, amount?): 设置Lab合成产物\n' +
                ' - 放置flag: labA/lab-A 和 labB/lab-B 设置底物Lab\n' +
                'lab.setboost(roomName): 设置Boost Lab\n' +
                ' - 放置flag: labset-{资源类型} 在对应Lab上\n' +
                'lab.addboost(roomName, mineral, amount?): 添加Boost任务\n' +
                'lab.removeboost(roomName, mineral): 移除Boost任务\n' +
                '--- 自动合成 ---\n' +
                'lab.auto.set(roomName, product, amount?): 设置自动合成\n' +
                ' - amount: 合成限额, 0为无限制\n' +
                'lab.auto.remove(roomName, product): 移除自动合成\n' +
                'lab.auto.list(roomName?): 查看自动合成列表\n'
        }
    },
    {
        alias: 'helpFactory',
        exec: function () {
            return '###  Factory指令列表  ###\n' +
                'factory.open(roomName): 开启Factory\n' +
                'factory.stop(roomName): 关闭Factory\n' +
                'factory.set(roomName, product, amount?): 设置生产任务\n' +
                'factory.setlevel(roomName, level): 设置Factory等级(0-5)\n' +
                '--- 自动生产 ---\n' +
                'factory.auto.set(roomName, product, amount?): 设置自动生产\n' +
                'factory.auto.remove(roomName, product): 移除自动生产\n' +
                'factory.auto.list(roomName?): 查看自动生产列表\n'
        }
    },
    {
        alias: 'helpPower',
        exec: function () {
            return '###  Power指令列表  ###\n' +
                'power.open(roomName): 开启烧Power\n' +
                'power.stop(roomName): 关闭烧Power\n' +
                'power.auto.set(roomName, energy, power): 设置自动烧Power阈值\n' +
                'power.auto.remove(roomName): 移除自动烧Power\n' +
                '--- PowerCreep ---\n' +
                'pc.spawn(pcname, roomName): 孵化PowerCreep\n' +
                'pc.set(pcname, roomName): 设置PowerCreep孵化房间\n'
        }
    },
    {
        alias: 'helpSpawn',
        exec: function () {
            return '###  孵化指令列表  ###\n' +
                'spawn.creep(roomName, bodypart, role, memory?): 孵化指定体型的Creep\n' +
                ' - bodypart: 体型字符串\n' +
                'spawn.role(roomName, role, memory?, num?): 孵化指定角色的Creep\n' +
                ' - 使用默认体型\n' +
                'spawn.sign(roomName, targetRoom, sign): 孵化scout进行签名\n'
        }
    },
    {
        alias: 'helpTerminal',
        exec: function () {
            return '###  Terminal指令列表  ###\n' +
                'terminal.send(room?, target, type, amount): 发送资源\n' +
                ' - room为空时从所有房间发送\n' +
                'terminal.show({roomName?, type?}): 显示终端资源\n' +
                ' - 可选参数组合查看不同范围\n'
        }
    },
    {
        alias: 'helpResource',
        exec: function () {
            return '###  资源管理指令列表  ###\n' +
                'resource.manage.set(roomName, resource, {source, target}): 设置资源供需\n' +
                ' - source: 供应阈值(超过则可供应)\n' +
                ' - target: 需求阈值(低于则需要补充)\n' +
                'resource.manage.remove(roomName, resource): 移除资源设置\n' +
                'resource.manage.clear(roomName): 清空房间资源设置\n' +
                'resource.manage.show.all(): 显示所有资源设置\n' +
                'resource.manage.show.room(roomName): 显示房间资源设置\n' +
                'resource.manage.show.res(resource): 显示指定资源设置\n' +
                '--- 搬运任务 ---\n' +
                'resource.transport.task(roomName, source, target, resource, amount): 添加搬运任务\n' +
                ' - source/target: storage, terminal, factory\n'
        }
    },
    {
        alias: 'helpOther',
        exec: function () {
            return '###  其他指令列表  ###\n' +
                '--- 白名单 ---\n' +
                'whitelist.add(id): 添加玩家到白名单\n' +
                'whitelist.remove(id): 从白名单移除玩家\n' +
                'whitelist.show(): 显示白名单\n' +
                '--- 清理 ---\n' +
                'clear.site(roomName): 清除房间建筑工地\n' +
                'clear.flag(roomName): 清除房间旗子\n' +
                'clear.mission(roomName, type): 清空房间任务池\n' +
                'clear.roomPath(roomName): 清空房间路径缓存\n' +
                'clear.boostTask(roomName): 清空房间Boost任务\n' +
                '--- 开关 ---\n' +
                'warmode(): 开关全局战争模式\n' +
                'pixel(): 开关搓Pixel功能\n' +
                'stats(): 开关信息统计功能\n' +
                '--- 其他 ---\n' +
                'avoidRoom(room): 添加房间到寻路回避列表\n' +
                '--- 核弹 ---\n' +
                'nuker.launch(...rooms): 发射核弹\n' +
                ' - 放置flag: nuke-{数量} 在目标位置\n' +
                'nuker.clear(): 清除所有nuke发射标记\n'
        }
    }
]
