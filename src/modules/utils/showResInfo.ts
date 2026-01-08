export const showRoomInfo = (rooms: string[]) => {
    // 创建表格样式和辅助函数
    const styles = {
        table: 'text-align: center; border-collapse: collapse; width: 100%; box-shadow: 0 4px 8px rgba(0,0,0,0.3); border-radius: 8px; overflow: hidden; margin-top: 10px;',
        header: 'background: linear-gradient(135deg, #324868 0%, #1f2737 100%); color: #e0e0e0; font-weight: bold;',
        th: 'padding: 12px 8px; text-align: center; border-bottom: 2px solid #2d3850;',
        tr: 'border-bottom: 1px solid #2d3850;',
        td: 'padding: 10px 8px; color: #e0e0e0;',
        title: 'font-size: 18px; margin-bottom: 8px; display: block; color: #e0e0e0; font-weight: bold;',
        odd: 'background-color: rgba(45, 55, 72, 0.6);',
        even: 'background-color: rgba(39, 48, 63, 0.8);',
        footer: 'background-color: #1f2737; font-size: 11px; color: #a0a0a0; padding: 8px; text-align: right;'
    };
    
    // 表头数据
    const headSpan = (text: string) => `<span style="display:flex;align-items:center;justify-content:center;">${text}</span>`
    const headers = [
        '房间', 
        headSpan('Spawn'), 
        headSpan('Storage'), 
        headSpan('Terminal'), 
        headSpan('Lab'), 
        headSpan('Factory'), 
        headSpan('PowerSpawn'), 
        headSpan('Nuker'), 
        headSpan('Energy')
    ];

    // 构建房间数据行
    const roomRows = rooms
        .map((name, index) => rowInfo(name, styles, index))
        .filter(row => row)
        .join('');

    // 构建HTML
    const th = (text: string) => `<th style="${styles.th}">${text}</th>`;
    let html = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 15px; border-radius: 2px;">
            <b style="${styles.title}">🏠房间信息</b>
            <table style="${styles.table}">
                <thead>
                    <tr style="${styles.header}">
                        ${headers.map(header => th(header)).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${roomRows}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="${headers.length}" style="${styles.footer}">
                            最后更新: ${new Date().toLocaleString()} (游戏时间: ${Game.time})
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;

    // 移除不必要的换行符使其成为一行
    html = html.replace(/\n\s+/g, '');
    return html;
}


const colorText = function (text: string, color: string) {
    return `<span style="color: ${color}; font-weight: 500;">${text}</span>`;
}

const rowInfo = function (roomName: string, styles: any, rowIndex: number) {
    const room = Game.rooms[roomName];
    if(!room || !room.my) return '';
    const roomMem = Memory['RoomControlData'][roomName];
    const structMem = Memory['StructControlData'][roomName];

    // 根据行号确定样式（奇偶行不同颜色）
    const rowStyle = rowIndex % 2 === 0 ? styles.even : styles.odd;
    
    const td = (text: string) => `<td style="${styles.td}">${text}</td>`;
    
    // 状态图标映射
    const statusIcons = {
        good: '✅',
        warning: '⚠️',
        danger: '❌',
        neutral: '⚪',
        building: '🔨'
    };

    // 构建行
    let cells: string[] = [];
    
    // 房间名 - 添加小图标显示房间等级
    const getRoomLevelIcon = (level?: number) => {
        if (!level) return '';
        // 等级字符
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
    
    cells.push(td(`${getRoomLevelIcon(room.controller?.level)}<b style="color: #e0e0e0;">${roomName}</b>`));
    
    // Spawn
    if (room.spawn && room.spawn.length > 0) {
        const spawnCount = room.spawn.length;
        const missionCount = room.getMissionNumInPool('spawn');
        const icon = missionCount > 0 ? statusIcons.warning : statusIcons.good;
        const color = missionCount > 0 ? '#FFD166' : '#06D6A0';
        cells.push(td(colorText(`${icon} ${missionCount} / ${spawnCount}`, color)));
    } else {
        cells.push(td(colorText(`${statusIcons.neutral} 未建造`, '#a0a0a0')));
    }

    // Storage
    if (room.storage) {
        const UsedCapacity = room.storage.store.getUsedCapacity() / 1e6;
        const Capacity = room.storage.store.getCapacity() / 1e6;
        const store = UsedCapacity / Capacity;
        const content = `${UsedCapacity.toFixed(2)}M/${Capacity.toFixed(2)}M`;
        
        let icon: string, color: string;
        if (store < 0.5) {
            icon = statusIcons.good;
            color = '#06D6A0';
        } else if (store < 0.8) {
            icon = statusIcons.good;
            color = '#06D6A0';
        } else if (store < 1) {
            icon = statusIcons.warning;
            color = '#FFD166';
        } else {
            icon = statusIcons.danger;
            color = '#EF476F';
        }
        
        // 添加进度条
        const progressBar = `
            <div style="background-color: rgba(255,255,255,0.1); height: 5px; width: 100%; margin-top: 3px; border-radius: 2px;">
                <div style="background-color: ${color}; height: 100%; width: ${Math.min(store,1) * 100}%; border-radius: 2px;"></div>
            </div>
        `;
        
        cells.push(td(`${colorText(`${icon} ${content}`, color)}${progressBar}`));
    } else {
        cells.push(td(colorText(`${statusIcons.neutral} 未建造`, '#a0a0a0')));
    }

    // Terminal
    if (room.terminal) {
        const store = room.terminal.store.getUsedCapacity() / room.terminal.store.getCapacity();
        const content = `${(store*100).toFixed(0)}%`;
        
        let icon: string, color: string;
        if (store < 0.5) {
            icon = statusIcons.good;
            color = '#06D6A0';
        } else if (store < 0.8) {
            icon = statusIcons.good;
            color = '#06D6A0';
        } else if (store < 1) {
            icon = statusIcons.warning;
            color = '#FFD166';
        } else {
            icon = statusIcons.danger;
            color = '#EF476F';
        }
        
        // 添加进度条
        const progressBar = `
            <div style="background-color: rgba(255,255,255,0.1); height: 5px; width: 100%; margin-top: 3px; border-radius: 2px;">
                <div style="background-color: ${color}; height: 100%; width: ${Math.min(store,1) * 100}%; border-radius: 2px;"></div>
            </div>
        `;
        
        cells.push(td(`${colorText(`${icon} ${content}`, color)}${progressBar}`));
    } else {
        cells.push(td(colorText(`${statusIcons.neutral} 未建造`, '#a0a0a0')));
    }

    // Lab
    if (room.lab && room.lab.length > 0) {
        if (!structMem['lab']) {
            cells.push(td(colorText(`${statusIcons.danger} 已关闭`, '#EF476F')));
        } else if (!structMem['labAtype'] || !structMem['labBtype']) {
            cells.push(td(colorText(`${statusIcons.warning} 闲置中`, '#FFD166')));
        } else {
            const labAtype = structMem['labAtype'];
            const labBtype = structMem['labBtype'];
            const product = REACTIONS[labAtype][labBtype];
            cells.push(td(colorText(`${statusIcons.good} ${labAtype} + ${labBtype} → ${product}`, '#06D6A0')));
        }
    } else {
        cells.push(td(colorText(`${statusIcons.neutral} 未建造`, '#a0a0a0')));
    }

    // Factory
    if (room.factory) {
        if (!structMem['factory']) {
            cells.push(td(colorText(`${statusIcons.danger} 已关闭`, '#EF476F')));
        } else if (!structMem['factoryProduct']) {
            cells.push(td(colorText(`${statusIcons.warning} 闲置中`, '#FFD166')));
        } else {
            const product = structMem['factoryProduct'];
            cells.push(td(colorText(`${statusIcons.good} ${product}`, '#06D6A0')));
        }
    } else {
        cells.push(td(colorText(`${statusIcons.neutral} 未建造`, '#a0a0a0')));
    }
    
    // PowerSpawn
    if (room.powerSpawn) {
        const powerSpawn = room.powerSpawn;
        const effect = powerSpawn.effects?.find(e => e.effect == PWR_OPERATE_POWER);
        let speed = 1 + effect?.['level'] || 1;
    
        if (!structMem['powerSpawn']) {
            cells.push(td(colorText(`${statusIcons.danger} 已关闭`, '#EF476F')));
        } else if (
            room.powerSpawn.store[RESOURCE_ENERGY] < 50 ||
            room.powerSpawn.store[RESOURCE_POWER] < 1) {
            cells.push(td(colorText(`${statusIcons.warning} 资源不足`, '#FFD166')));
        } else {
            cells.push(td(colorText(`${statusIcons.good} ${speed}速工作中`, '#06D6A0')));
        }
    } else {
        cells.push(td(colorText(`${statusIcons.neutral} 未建造`, '#a0a0a0')));
    }

    // Nuker
    if (room.nuker) {
        if (room.nuker.cooldown) {
            cells.push(td(colorText(`${statusIcons.warning} 冷却中(${room.nuker.cooldown})`, '#FFD166')));
        } else if (room.nuker.store['energy'] < 300e3 || room.nuker.store['G'] < 5000) {
            cells.push(td(colorText(`${statusIcons.warning} 资源不足`, '#FFD166')));
        } else {
            cells.push(td(colorText(`${statusIcons.good} ☢已就绪☢`, '#06D6A0')));
        }
    } else {
        cells.push(td(colorText(`${statusIcons.neutral} 未建造`, '#a0a0a0')));
    }

    // Energy
    if (room[RESOURCE_ENERGY]) {
        const energy = room[RESOURCE_ENERGY];
        const energyThreshold = 10000; // 假设能量阈值
        const color = energy > energyThreshold ? '#118AB2' : (energy > energyThreshold/2 ? '#FFD166' : '#EF476F');
        cells.push(td(colorText(`⚡ ${energy.toLocaleString()}`, color)));
    } else {
        cells.push(td(colorText(`${statusIcons.neutral} 0`, '#a0a0a0')));
    }
    
    return `<tr style="${styles.tr} ${rowStyle}">${cells.join('')}</tr>`;
}