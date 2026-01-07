const head ='<span style="color: #D0CAE0; "><b>' +
            '—————————————————————————————— 迷迭香 𝕽𝖔𝖘𝖒𝖆𝖗𝖎𝖓 ——————————————————————————————\n' +
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
                '</b>'
        }
    },
    {
        alias: 'helpStart',
        exec: function () {
            return '###  启动流程  ###\n' +
                '1. room.add(roomName, layout?, x?, y?): 添加房间到控制列表，列表中的房间才会自动运行。\n' +
                '2. layout.visual(roomName, layout?): 查看房间布局可视化预览,\n' +
                '3. layout.build(roomName, layout?): 生成房间建筑位置, 并保存在Memory中。\n' +
                '4. layout.auto(roomName): 开启房间自动建筑。\n'
        }
    },
    {
        alias: 'helpRoom',
        exec: function () {
            return '###  房间指令列表  ###\n' +
                'room.add(roomName, layout?, x?, y?): 添加房间到控制列表，列表中的房间才会自动运行。\n' +
                ' - roomName: 房间名 layout: 布局 x,y: 布局中心\n' +
                ' - 后面的参数可以为空。\n' +
                ' - layout: 使用的布局, 留空则不使用\n' +
                ' - x,y: 布局中心坐标, 留空则不使用\n' +
                ' -- 如果需要手动布局则留空。注意, 手动布局需要保证storage、terminal、factory与一个link集中放置, 与这四个建筑均相邻的点位即为中心, 是中央搬运工的位置, 手动布局需要将该点设置为布局中心。若不满足上述条件, 部分自动化功能将无法使用。\n' +
                'helpLayout: 查看布局帮助\n' +
                'room.remove(roomName): 从控制列表删除房间\n' +
                'room.list(): 查看控制列表\n'
        }
    },
    {
        alias: 'helpLayout',
        exec: function () {
            return '###  布局指令列表  ###\n' +
                    'layout.set(roomName, layout, x, y): 设置房间布局\n' +
                    ' - roomName: 房间名 layout: 静态布局名称 x,y: 布局中心\n' +
                    ' - 可用的布局有: rosemary、clover、hoho、tea\n' +
                    'layout.auto(roomName): 开关房间自动建筑, 需要设置布局\n' +
                    'layout.remove(roomName): 删除指定房间布局Memory\n' +
                    ' - 如果重新设置布局, 就需要用这个手动删除\n' +
                    'layout.build(roomName): 使用设置的布局生成各个建筑的位置, 并保存在Memory中。\n' +
                    ' - 如果没有设置布局, 则会使用自动布局。\n' +
                    ' - 如果有对应房间视野，那么会自动获取 能量源、控制器、元素矿 的位置。\n' +
                    ' - 如果没有对应房间视野, 那么需要设置4个flag, 分别为对应房间的\n' +
                    '       pc 控制器, pm 矿, pa pb 能量源。\n' +
                    ' - 运行后会自动设置房间布局名称为 "auto", 并且会自动保存布局Memory\n' +
                    'layout.visual(rooName): 在地图上显示布局可视化\n' +
                    ' - 能将布局Memory中的建筑位置可视化, 方便查看布局是否正确。\n' +
                    ' - layout.build运行成功后就会有布局Memory,。\n'
        }
    },
    {
        alias: 'helpInfo',
        exec: function () {
            return '###  房间、资源信息指令列表  ###\n' +
                    'info.room(roomName): 查看房间信息\n' +
                    'info.allres(roomName): 查看所有资源信息\n' +
                    'info.roomres(roomName): 查看房间资源信息\n'
        }
    }
]
