// @ts-nocheck

global.RES_COLOR_MAP = {"empty":"rgba(0,0,0,0)","energy":"rgb(255,242,0)","battery":"rgb(255,242,0)","Z":"rgb(247, 212, 146)","L":"rgb(108, 240, 169)","U":"rgb(76, 167, 229)","K":"rgb(218, 107, 245)","X":"rgb(255, 192, 203)","G":"rgb(255,255,255)","zynthium_bar":"rgb(247, 212, 146)","lemergium_bar":"rgb(108, 240, 169)","utrium_bar":"rgb(76, 167, 229)","keanium_bar":"rgb(218, 107, 245)","purifier":"rgb(255, 192, 203)","ghodium_melt":"rgb(255,255,255)","power":"rgb(224,90,90)","ops":"rgb(224,90,90)","composite":"#ccc","crystal":"#ccc","liquid":"#ccc","device":"rgb(76, 167,229)","circuit":"rgb(76, 167,229)","microchip":"rgb(76, 167,229)","transistor":"rgb(76, 167,229)","switch":"rgb(76, 167,229)","wire":"rgb(76, 167,229)","silicon":"rgb(76, 167,229)","machine":"rgb(247,212,146)","hydraulics":"rgb(247,212,146)","frame":"rgb(247,212,146)","fixtures":"rgb(247,212,146)","tube":"rgb(247,212,146)","alloy":"rgb(247,212,146)","metal":"rgb(247,212,146)","essence":"rgb(218,107,245)","emanation":"rgb(218,107,245)","spirit":"rgb(218,107,245)","extract":"rgb(218,107,245)","concentrate":"rgb(218,107,245)","condensate":"rgb(218,107,245)","mist":"rgb(218,107,245)","organism":"rgb(108,240,169)","organoid":"rgb(108,240,169)","muscle":"rgb(108,240,169)","tissue":"rgb(108,240,169)","phlegm":"rgb(108,240,169)","cell":"rgb(108,240,169)","biomass":"rgb(108,240,169)","OH":"#ccc","ZK":"#ccc","UL":"#ccc","UH":"rgb(76, 167,229)","UH2O":"rgb(76, 167,229)","XUH2O":"rgb(76, 167,229)","UO":"rgb(76, 167,229)","UHO2":"rgb(76, 167,229)","XUHO2":"rgb(76, 167,229)","ZH":"rgb(247,212,146)","ZH2O":"rgb(247,212,146)","XZH2O":"rgb(247,212,146)","ZO":"rgb(247,212,146)","ZHO2":"rgb(247,212,146)","XZHO2":"rgb(247,212,146)","KH":"rgb(218,107,245)","KH2O":"rgb(218,107,245)","XKH2O":"rgb(218,107,245)","KO":"rgb(218,107,245)","KHO2":"rgb(218,107,245)","XKHO2":"rgb(218,107,245)","LH":"rgb(108,240,169)","LH2O":"rgb(108,240,169)","XLH2O":"rgb(108,240,169)","LO":"rgb(108,240,169)","LHO2":"rgb(108,240,169)","XLHO2":"rgb(108,240,169)","GH":"rgb(255,255,255)","GH2O":"rgb(255,255,255)","XGH2O":"rgb(255,255,255)","GO":"rgb(255,255,255)","GHO2":"rgb(255,255,255)","XGHO2":"rgb(255,255,255)","H":"#ccc","O":"#ccc","oxidant":"#ccc","reductant":"#ccc"};
global.RES_TREE = {"POWER资源":{"POWER资源":["power","ops"]},"基础资源":{"能量":["energy","battery"],"原矿":["U","L","K","Z","X","O","H","G"],"压缩":["utrium_bar","lemergium_bar","keanium_bar","zynthium_bar","purifier","oxidant","reductant","ghodium_melt"]},"商品资源":{"无色":["liquid","crystal","composite"],"蓝色":["silicon","wire","switch","transistor","microchip","circuit","device"],"黄色":["metal","alloy","tube","fixtures","frame","hydraulics","machine"],"紫色":["mist","condensate","concentrate","extract","spirit","emanation","essence"],"绿色":["biomass","cell","phlegm","tissue","muscle","organoid","organism"]},"LAB资源":{"蓝色":["UH","UH2O","XUH2O","UO","UHO2","XUHO2"],"黄色":["ZH","ZH2O","XZH2O","ZO","ZHO2","XZHO2"],"紫色":["KH","KH2O","XKH2O","KO","KHO2","XKHO2"],"绿色":["LH","LH2O","XLH2O","LO","LHO2","XLHO2"],"白色":["GH","GH2O","XGH2O","GO","GHO2","XGHO2"]},"empty":{"empty":["empty"]}};

global.roomResSvg=(res, allCnt, len)=>{
    let r = Object.entries(res).sort((a,b)=>b[1]-a[1])
    let left = 0;
    let svgs = r.map(e=>{
        if (e[0] == "empty") return;
        let t = `<rect x="${left/allCnt*len}" width="${e[1]/allCnt*len}" height="12" fill="${RES_COLOR_MAP[e[0]]}"/>`
        left+=e[1];
        return t;
    }).join("")
    
    let percentText = `<text x="${len + 10}" y="10" font-size="10" fill="#e0e0e0">${(left/allCnt*100).toFixed(1)}%</text>`
    let capacityText = `<text x="${len + 60}" y="10" font-size="10" fill="#a0a0a0">${(allCnt/1000000).toFixed(1)}M</text>`
    
    let exist = allCnt ? 
        `<rect width="${len}" height="12" fill="rgba(30,35,48,0.8)" rx="2" ry="2"/>
         ${svgs}
         ${percentText}
         ${capacityText}` : "";
         
    return `<svg width="${len + 100}" height="12" style="vertical-align: middle;"> 
              ${exist} 
            </svg>`
}
global.roomResEcharts=()=>{
    // <div id="${divName}" style="height: 600px;width:600px;color:#000"/>
return `
<script>
function gotoRoom(roomName){window.location.href = window.location.href.substring(0,window.location.href.lastIndexOf("/")+1)+roomName;}
colorMap = ${JSON.stringify(RES_COLOR_MAP)};
eval($.ajax({url:"https://fastly.jsdelivr.net/npm/echarts@5/dist/echarts.min.js",async:false}).responseText);
function showRoomResEcharts(ori,roomName ,divName){
var bgColor = '#2b2b2b';
var chartDom = document.getElementById(divName);
var myChart = echarts.init(chartDom, 'dark');
var option;

colorMap["商品资源"] = "#ccc";
colorMap["LAB资源"] = "#ccc";
colorMap["基础资源"] = "#ccc";
colorMap["压缩"] = "#ccc";
colorMap["原矿"] = "#ccc";

var tree = ${JSON.stringify(RES_TREE)};

function buildTree(node){
    let arr = [];
    if(node[0]){
        for(let resType of node){
            arr.push({
                name: resType,
                value: ori[resType],
                itemStyle: {
                    color: colorMap[resType]
                },
            })
        }
    }else{
        for(let resType in node){
            let children = buildTree(node[resType]);
            if(children.length)
                arr.push({
                    name: resType,
                    itemStyle: {
                        color: colorMap[resType]?colorMap[resType]:children[0].itemStyle.color
                    },
                    children:children
                });
        }
    }
    return arr;
}
var data =buildTree(tree);
option = {
    title: {
        text: roomName
    },
    tooltip: {
    },
    series: {
        itemStyle: {
            borderColor: "#1b1b1b",
            borderWidth: 1
        },
        type: 'sunburst',
        data: data,
        radius: [0, '95%'],
        sort: null,
        emphasis: {
            focus: 'ancestor'
        },
    }
};


option.backgroundColor= bgColor;
myChart.setOption(option);
};
</script>
`
    .replace(/[\r\n]/g, "")
    // .replace("script>","c>")
}

function roomResTips(roomName, data){
    let divName = "a-"+roomName + Game.time;
    let divNameShow = "a-"+roomName + Game.time+"-";
return`
    <t class="${divName}" onclick="gotoRoom('${roomName}')" style="color:#7c97ff;cursor:pointer;font-weight:bold;padding:2px 4px;border-radius:3px;background:rgba(43,43,43,0.6);">[${roomName}]</t><script>
    (() => {
        const button = document.querySelector(".${divName}");
        let tip;
        button.addEventListener("pointerenter", () => {
            if(tip)return;
            tip = document.createElement("div");
                tip.style.backgroundColor = "rgba(30,35,48,0.95)"; 
                tip.style.border = "1px solid #3d5174";
                tip.style.borderRadius = "8px";
            tip.style.position = "absolute";
            tip.style.zIndex=10;
                tip.style.color = "#e0e0e0";
            tip.style.marginLeft = "0px";
                tip.style.boxShadow = "0 4px 6px rgba(0,0,0,0.3)";
                tip.innerHTML = '<div id="${divNameShow}" onclick="" style="height: 600px;width:600px;color:#e0e0e0"/>';
            button.append(tip);
            showRoomResEcharts(${JSON.stringify(data)},"${roomName}","${divNameShow}");
            document.getElementById("${divNameShow}").onclick =function(e) {e.stopPropagation();return false;};
        });
        button.addEventListener("pointerleave", () => {tip && (tip.remove(), tip = undefined);});
    })();
</script>
`.replace(/[\r\n]/g, "");
}

function allResTips(text, tipStrArray, id, left){
    left = left-1;
    left*=100;
    let showCore = tipStrArray.map(e=>`<div style="padding:3px 6px;margin:2px;background:rgba(50,60,80,0.5);border-radius:3px;"><t onclick="goto('${e}')" style="cursor:pointer;"> ${e} </t></div>`.replace(/[\\"]/g,'%')).join("")
    let time = Game.time;
    return `<t class="a${id}-a${time}" style="cursor:pointer;padding:2px 8px;border-radius:3px;transition:all 0.2s;">${text}</t><script>
    function goto(e){
        let roomName = e.split(":")[0].replace(/\\s+/g, "");
        window.location.href = window.location.href.substring(0,window.location.href.lastIndexOf("/")+1)+roomName;
    }(() => {
        const button = document.querySelector(".a${id}-a${time}");
        let tip;
        button.addEventListener("pointerenter", () => {
                button.style.background = "rgba(50,60,80,0.5)";
            tip = document.createElement("div");
                tip.style.backgroundColor = "rgba(30,35,48,0.95)"; 
                tip.style.border = "1px solid #3d5174";
                tip.style.borderRadius = "8px";
                tip.style.padding = "8px";
            tip.style.position = "absolute";
            tip.style.zIndex=10;
                tip.style.color = "#e0e0e0";
            tip.style.marginLeft = "${left}px";
                tip.style.maxHeight = "400px";
                tip.style.maxWidth = "350px";
                tip.style.overflow = "auto";
                tip.style.boxShadow = "0 4px 6px rgba(0,0,0,0.3)";
                tip.innerHTML = "${showCore}".replace(/[\\%]/g,'"'); 
                button.append(tip);
        });
            button.addEventListener("pointerleave", () => {
                button.style.background = "transparent";
                tip && (tip.remove(), tip = undefined);
            });
    })()
</script>
`.replace(/[\r\n]/g, "");
}

// 获取资源图标
function getResourceIcon(resourceType) {
    const iconMap = {
        energy: '⚡',
        power: '🟥',
        ops: '🟥',
        U: '🔵',
        L: '🟢',
        K: '🟣',
        Z: '🟡',
        X: '🔴',
        G: '⚪',
        H: '⚪',
        O: '⚪',
        empty: '🔄'
    };
    
    return iconMap[resourceType] || '🔷';
}

let pro = {

    getStorageTerminalRes (room){
        let store = {};
        if(room.storage)pro.addStore(store,room.storage.store)
        if(room.terminal)pro.addStore(store,room.terminal.store)
        if(room.factory)pro.addStore(store,room.factory.store)
        return store
    },
    addStore:(store,b)=> {for(let v in b) if(b[v]>0)store[v]=(store[v]||0)+b[v];return store},
    
    showAllRes(){
        let time = Game.cpu.getUsed()

        let rooms = _.values(Game.rooms).filter(e=>e.controller&&e.controller.my&&(e.storage||e.terminal));
        let roomResAll = rooms.map(e=>[e.name,pro.getStorageTerminalRes(e)]).reduce((map,entry)=>{map[entry[0]] = entry[1];return map},{})

        let all = rooms.reduce((all, room)=> pro.addStore(all,roomResAll[room.name]),{});

        // 资源类别定义...
        let base = [RESOURCE_ENERGY,"U","L","K","Z","X","O","H","G",RESOURCE_POWER,RESOURCE_OPS]
        let bars = [RESOURCE_BATTERY,RESOURCE_UTRIUM_BAR,RESOURCE_LEMERGIUM_BAR,RESOURCE_KEANIUM_BAR,RESOURCE_ZYNTHIUM_BAR,RESOURCE_PURIFIER,RESOURCE_OXIDANT,RESOURCE_REDUCTANT,RESOURCE_GHODIUM_MELT]
        let c_grey =[RESOURCE_COMPOSITE,RESOURCE_CRYSTAL,RESOURCE_LIQUID]
        let c_blue = [RESOURCE_DEVICE,RESOURCE_CIRCUIT,RESOURCE_MICROCHIP,RESOURCE_TRANSISTOR,RESOURCE_SWITCH,RESOURCE_WIRE,RESOURCE_SILICON].reverse()
        let c_yellow=[RESOURCE_MACHINE,RESOURCE_HYDRAULICS,RESOURCE_FRAME,RESOURCE_FIXTURES,RESOURCE_TUBE,RESOURCE_ALLOY,RESOURCE_METAL].reverse()
        let c_pink = [RESOURCE_ESSENCE,RESOURCE_EMANATION,RESOURCE_SPIRIT,RESOURCE_EXTRACT,RESOURCE_CONCENTRATE,RESOURCE_CONDENSATE,RESOURCE_MIST].reverse()
        let c_green =[RESOURCE_ORGANISM,RESOURCE_ORGANOID,RESOURCE_MUSCLE,RESOURCE_TISSUE,RESOURCE_PHLEGM,RESOURCE_CELL,RESOURCE_BIOMASS].reverse()
        let b_grey =["OH","ZK","UL","G"]
        let gent =  (r)=> [r+"H",r+"H2O","X"+r+"H2O",r+"O",r+"HO2","X"+r+"HO2"]
        let b_blue = gent("U")
        let b_yellow=gent("Z")
        let b_pink = gent("K")
        let b_green =gent("L")
        let b_withe =gent("G")

        let formatNumber=function (n) {
            var b = parseInt(n).toString();
            var len = b.length;
            if (len <= 3) { return b; }
            var r = len % 3;
            return r > 0 ? b.slice(0, r) + "," + b.slice(r, len).match(/\d{3}/g).join(",") : b.slice(r, len).match(/\d{3}/g).join(",");
        }

        let html = `
        <div style="white-space: normal; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: rgba(30,35,48,0.8); padding: 15px; border-radius: 8px; margin-top: 10px; color: #e0e0e0; box-shadow: 0 4px 8px rgba(0,0,0,0.3);">
            <div style="font-size: 18px; color: #e0e0e0; font-weight: bold; border-bottom: 1px solid #3d5174; padding-bottom: 5px;">
                💎资源总览
            </div>
        `;
        
        let id = 0
        let categoryStyle = 'background: linear-gradient(135deg, #324868 0%, #1f2737 100%); color: #e0e0e0; font-weight: bold; padding: 8px 12px; border-radius: 4px; margin: 10px 0 5px 0; display: block;';
        
        // 创建资源单元格
        let createResourceCell = function(resType, amount) {
            const icon = getResourceIcon(resType);
            const bgColor = amount > 0 ? 'rgba(45,55,72,0.5)' : 'rgba(45,55,72,0.2)';
            const textColor = amount > 0 ? RES_COLOR_MAP[resType] || '#ccc' : '#666';
            
            let arr = [];
            for(let roomName in roomResAll){
                if(roomResAll[roomName][resType] && roomResAll[roomName][resType] > 0) {
                    arr.push(_.padLeft(roomName, 6) + ": " + _.padLeft(formatNumber(roomResAll[roomName][resType]), 9));
                }
            }
            
            id++;
            
            const tipContent = arr.length > 0 ? 
                allResTips(`<span style="color: ${RES_COLOR_MAP[resType] || '#ccc'};">${icon} ${resType}</span>`, arr, id, 1) : 
                `<span style="color: ${RES_COLOR_MAP[resType] || '#ccc'};">${icon} ${resType}</span>`;
            
            return `
                <div style="background-color: ${bgColor}; border-radius: 4px; padding: 5px 8px; display: flex; justify-content: space-between; align-items: center;">
                    <div>${tipContent}</div>
                    <div style="color: ${textColor}; font-weight: 500; text-align: right; min-width: 60px;">${formatNumber(amount)}</div>
                </div>
            `;
        };
        
        // 为每个资源类别创建表格式布局
        let addResourceTable = function(resourceList, title) {
            html += `<div style="${categoryStyle}">${title}</div>`;
            
            // 过滤掉数量为0的资源，减少显示项
            const filteredList = resourceList.filter(type => all[type] > 0);
            
            // 如果某个类别所有资源数量都为0，显示一个简化的提示
            if (filteredList.length === 0) {
                html += `
                <div style="padding: 10px; text-align: center; color: #a0a0a0; font-style: italic; background-color: rgba(45,55,72,0.2); border-radius: 4px; margin-bottom: 15px;">
                    此类别暂无资源
                </div>`;
                return;
            }
            
            // 确定每行显示多少个资源
            const itemsPerRow = 4; // 每行显示4个资源
            
            html += `<div style="margin-bottom: 15px;">`;
            
            // 将资源按行分组显示
            for (let i = 0; i < filteredList.length; i += itemsPerRow) {
                html += `<div style="display: grid; grid-template-columns: repeat(${itemsPerRow}, 1fr); gap: 8px; margin-bottom: 8px;">`;
                
                // 添加当前行的资源
                for (let j = i; j < i + itemsPerRow && j < filteredList.length; j++) {
                    const resType = filteredList[j];
                    const amount = all[resType] || 0;
                    html += createResourceCell(resType, amount);
                }
                
                html += `</div>`;
            }
            
            html += `</div>`;
        };
        
        // 基础和常用资源使用完整显示
        addResourceTable(base, "基础资源");
        addResourceTable(bars, "压缩资源");
        
        // 其他资源类别使用表格视图显示
        // 创建详细表格布局，所有资源共用，按照分类和Tab切换
        html += `
        <div style="${categoryStyle}">商品资源</div>
        <div style="margin-bottom: 15px;">
            <div style="display: flex; margin-bottom: 8px; border-bottom: 1px solid #2d3850; padding-bottom: 5px;">
                <div style="flex: 1; text-align: center; color: #ccc;">无色</div>
                <div style="flex: 1; text-align: center; color: #76a9e0;">蓝色</div>
                <div style="flex: 1; text-align: center; color: #e0c676;">黄色</div>
                <div style="flex: 1; text-align: center; color: #d68aee;">紫色</div>
                <div style="flex: 1; text-align: center; color: #8aee8a;">绿色</div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;">
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    ${c_grey.map(type => createResourceCell(type, all[type] || 0)).join('')}
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    ${c_blue.map(type => createResourceCell(type, all[type] || 0)).join('')}
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    ${c_yellow.map(type => createResourceCell(type, all[type] || 0)).join('')}
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    ${c_pink.map(type => createResourceCell(type, all[type] || 0)).join('')}
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    ${c_green.map(type => createResourceCell(type, all[type] || 0)).join('')}
                </div>
            </div>
        </div>
        
        <div style="${categoryStyle}">强化资源</div>
        <div style="margin-bottom: 15px;">
            <div style="display: flex; margin-bottom: 8px; border-bottom: 1px solid #2d3850; padding-bottom: 5px;">
                <div style="flex: 1; text-align: center; color: #ccc;">基础</div>
                <div style="flex: 1; text-align: center; color: #76a9e0;">蓝色(U)</div>
                <div style="flex: 1; text-align: center; color: #e0c676;">黄色(Z)</div>
                <div style="flex: 1; text-align: center; color: #d68aee;">紫色(K)</div>
                <div style="flex: 1; text-align: center; color: #8aee8a;">绿色(L)</div>
                <div style="flex: 1; text-align: center; color: #e0e0e0;">白色(G)</div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px;">
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    ${b_grey.map(type => createResourceCell(type, all[type] || 0)).join('')}
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    ${b_blue.map(type => createResourceCell(type, all[type] || 0)).join('')}
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    ${b_yellow.map(type => createResourceCell(type, all[type] || 0)).join('')}
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    ${b_pink.map(type => createResourceCell(type, all[type] || 0)).join('')}
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    ${b_green.map(type => createResourceCell(type, all[type] || 0)).join('')}
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    ${b_withe.map(type => createResourceCell(type, all[type] || 0)).join('')}
                </div>
            </div>
        </div>`;
        
        html += `</div>`;
        
        console.log(html.replace(/[\r\n]/g, ""));
        return `CPU用时: ${(Game.cpu.getUsed() - time).toFixed(2)}`;
    },
    
    showRoomRes(){
        let time = Game.cpu.getUsed()
        
        // 获取房间数据并排序
        const roomData = _.values(Game.rooms)
            .filter(e => e.my)
            .map(room => {
            let res = pro.getStorageTerminalRes(room)
                let storageCap = room.storage ? room.storage.store.getCapacity(RESOURCE_ENERGY) : 0
                let terminalCap = room.terminal ? room.terminal.store.getCapacity(RESOURCE_ENERGY) : 0
                let storageFreeCap = room.storage ? room.storage.store.getFreeCapacity() : 0
                let terminalFreeCap = room.terminal ? room.terminal.store.getFreeCapacity() : 0
                
                if(storageFreeCap || terminalFreeCap) res["empty"] = storageFreeCap + terminalFreeCap;

                let storage = room.storage ? room.storage.store : {};
                let terminal = room.terminal ? room.terminal.store : {};
                
                // 计算总资源数量
                const totalResources = Object.entries(res).reduce((sum, [type, amount]) => {
                    if (type !== 'empty') return sum + amount;
                    return sum;
                }, 0);
                
                return {
                    room: room,
                    name: room.name,
                    res: res,
                    storage: storage,
                    terminal: terminal,
                    storageCap: storageCap,
                    terminalCap: terminalCap,
                    freeRatio: (storageCap + terminalCap) ? (storageFreeCap + terminalFreeCap) / (storageCap + terminalCap) : 0,
                    totalResources: totalResources
                };
            })
            .sort((a, b) => a.freeRatio - b.freeRatio);
            

        let html = roomResEcharts() + `
        <div style="white-space: normal; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: rgba(30,35,48,0.8); padding: 15px; border-radius: 8px; margin-top: 10px; color: #e0e0e0; box-shadow: 0 4px 8px rgba(0,0,0,0.3);">
            <div style="font-size: 18px; margin-bottom: 15px; color: #e0e0e0; font-weight: bold; border-bottom: 1px solid #3d5174; padding-bottom: 5px;">
                🏠房间资源概览
            </div>
        `;
        
        // 为每个房间创建卡片
        roomData.forEach(data => {
            const getRoomLevelIcon = (level) => {
                if (!level) return '';
                // 使用Unicode字符代替数字，避免偏移问题
                const levelSymbols = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
                
                // 创建带颜色的徽章
                const colors = {
                    1: '#717171', // 灰色
                    2: '#717171',
                    3: '#717171',
                    4: '#5D80B2', // 蓝色
                    5: '#5D80B2',
                    6: '#5D80B2',
                    7: '#B29E6F', // 金色
                    8: '#B29E6F'
                };
                
                const color = colors[level] || '#717171';
                
                return `<span style="color: ${color}; font-weight: bold; margin-right: 5px; font-size: 16px;">${levelSymbols[level]}</span>`;
            };
            
            const roomLevelIcon = getRoomLevelIcon(data.room.controller?.level);
                
            html += `
            <div style="background-color: rgba(45,55,72,0.5); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center;">
                        ${roomLevelIcon}
                        ${roomResTips(data.name, data.res)}
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <div>
                            <span style="color: #a0a0a0; font-size: 12px;">总资源: </span>
                            <span style="color: #e0e0e0;">${(data.totalResources/1000).toFixed(1)}K</span>
                        </div>
                        <div>
                            <span style="color: #a0a0a0; font-size: 12px;">剩余: </span>
                            <span style="color: ${data.freeRatio > 0.3 ? '#06D6A0' : (data.freeRatio > 0.1 ? '#FFD166' : '#EF476F')};">${(data.freeRatio * 100).toFixed(1)}%</span>
                        </div>
                    </div>
                </div>
                <div>
                    <div style="display: flex; align-items: center; margin-bottom: 6px;">
                        <span style="width: 70px; color: #a0a0a0; font-size: 12px;">Storage: </span>
                        ${roomResSvg(data.storage, data.storageCap, 500)}
                    </div>
                    <div style="display: flex; align-items: center;">
                        <span style="width: 70px; color: #a0a0a0; font-size: 12px;">Terminal: </span>
                        ${roomResSvg(data.terminal, data.terminalCap, 500)}
                    </div>
                </div>
            </div>
            `;
        });
        
        // 添加页脚
        html += `
            </div>
            <div style="font-size: 11px; color: #a0a0a0; text-align: right; margin-top: 15px; padding-top: 10px; border-top: 1px solid #2d3850;">
                房间数量: ${roomData.length} | 最后更新: ${new Date().toLocaleString()} | CPU用时: ${(Game.cpu.getUsed() - time).toFixed(2)}
            </div>
        </div>
        `;

        console.log(html.replace(/[\r\n]/g, ""));
        return "房间资源信息已输出";
    }
}

global.HelperRoomResource=pro