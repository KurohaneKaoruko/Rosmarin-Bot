// 颜色常量
const COLORS = {
    good: '#06D6A0',
    warning: '#FFD166',
    danger: '#EF476F',
    neutral: '#a0a0a0',
    info: '#118AB2',
    text: '#e0e0e0',
    levelLow: '#717171',
    levelMid: '#5D80B2',
    levelHigh: '#B29E6F',
} as const;

// 状态图标
const ICONS = {
    good: '✅',
    warning: '⚠️',
    danger: '❌',
    neutral: '⚪',
} as const;

// 表格样式
const STYLES = {
    table: 'text-align: center; border-collapse: collapse; width: 100%; box-shadow: 0 4px 8px rgba(0,0,0,0.3); border-radius: 8px; overflow: hidden; margin-top: 10px;',
    header: 'background: linear-gradient(135deg, #324868 0%, #1f2737 100%); color: #e0e0e0; font-weight: bold;',
    th: 'padding: 12px 8px; text-align: center; border-bottom: 2px solid #2d3850;',
    tr: 'border-bottom: 1px solid #2d3850;',
    td: 'padding: 10px 8px; color: #e0e0e0;',
    title: 'font-size: 18px; margin-bottom: 8px; display: block; color: #e0e0e0; font-weight: bold;',
    odd: 'background-color: rgba(45, 55, 72, 0.6);',
    even: 'background-color: rgba(39, 48, 63, 0.8);',
    footer: 'background-color: #1f2737; font-size: 11px; color: #a0a0a0; padding: 8px; text-align: right;'
} as const;

// 等级符号
const LEVEL_SYMBOLS = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'] as const;

// 阈值常量
const THRESHOLDS = {
    storeWarning: 0.8,
    storeDanger: 1,
    energyHigh: 10000,
    energyLow: 5000,
    nukerEnergy: 300e3,
    nukerGhodium: 5000,
    powerSpawnEnergy: 50,
} as const;

// 辅助函数
const colorText = (text: string, color: string) => 
    `<span style="color: ${color}; font-weight: 500;">${text}</span>`;

const td = (text: string) => `<td style="${STYLES.td}">${text}</td>`;

const th = (text: string) => `<th style="${STYLES.th}">${text}</th>`;

const headSpan = (text: string) => 
    `<span style="display:flex;align-items:center;justify-content:center;">${text}</span>`;

const notBuilt = () => td(colorText(`${ICONS.neutral} 未建造`, COLORS.neutral));

const disabled = () => td(colorText(`${ICONS.danger} 已关闭`, COLORS.danger));

const idle = () => td(colorText(`${ICONS.warning} 闲置中`, COLORS.warning));

const lowResource = () => td(colorText(`${ICONS.warning} 资源不足`, COLORS.warning));

// 根据使用率获取状态
const getStoreStatus = (ratio: number): { icon: string; color: string } => {
    if (ratio >= THRESHOLDS.storeDanger) return { icon: ICONS.danger, color: COLORS.danger };
    if (ratio >= THRESHOLDS.storeWarning) return { icon: ICONS.warning, color: COLORS.warning };
    return { icon: ICONS.good, color: COLORS.good };
};

// 生成进度条
const progressBar = (ratio: number, color: string) => 
    `<div style="background-color: rgba(255,255,255,0.1); height: 5px; width: 100%; margin-top: 3px; border-radius: 2px;"><div style="background-color: ${color}; height: 100%; width: ${Math.min(ratio, 1) * 100}%; border-radius: 2px;"></div></div>`;

// 获取房间等级图标
const getRoomLevelIcon = (level?: number): string => {
    if (!level) return '';
    const color = level <= 3 ? COLORS.levelLow : level <= 6 ? COLORS.levelMid : COLORS.levelHigh;
    return `<span style="color: ${color}; font-weight: bold; margin-right: 5px; font-size: 16px;">${LEVEL_SYMBOLS[level]}</span>`;
};

// 各结构状态渲染函数
const renderSpawn = (room: Room): string => {
    if (!room.spawn?.length) return notBuilt();
    const missionCount = room.getMissionNumInPool('spawn');
    const { icon, color } = missionCount > 0 
        ? { icon: ICONS.warning, color: COLORS.warning }
        : { icon: ICONS.good, color: COLORS.good };
    return td(colorText(`${icon} ${missionCount} / ${room.spawn.length}`, color));
};

const renderStorage = (room: Room): string => {
    if (!room.storage) return notBuilt();
    const used = room.storage.store.getUsedCapacity() / 1e6;
    const cap = room.storage.store.getCapacity() / 1e6;
    const ratio = used / cap;
    const { icon, color } = getStoreStatus(ratio);
    return td(`${colorText(`${icon} ${used.toFixed(2)}M/${cap.toFixed(2)}M`, color)}${progressBar(ratio, color)}`);
};

const renderTerminal = (room: Room): string => {
    if (!room.terminal) return notBuilt();
    const ratio = room.terminal.store.getUsedCapacity() / room.terminal.store.getCapacity();
    const { icon, color } = getStoreStatus(ratio);
    return td(`${colorText(`${icon} ${(ratio * 100).toFixed(0)}%`, color)}${progressBar(ratio, color)}`);
};

const renderLab = (room: Room, structMem: any): string => {
    if (!room.lab?.length) return notBuilt();
    if (!structMem['lab']) return disabled();
    const { labAtype, labBtype } = structMem;
    if (!labAtype || !labBtype) return idle();
    const product = REACTIONS[labAtype][labBtype];
    return td(colorText(`${ICONS.good} ${labAtype} + ${labBtype} → ${product}`, COLORS.good));
};

const renderFactory = (room: Room, structMem: any): string => {
    if (!room.factory) return notBuilt();
    if (!structMem['factory']) return disabled();
    if (!structMem['factoryProduct']) return idle();
    return td(colorText(`${ICONS.good} ${structMem['factoryProduct']}`, COLORS.good));
};

const renderPowerSpawn = (room: Room, structMem: any): string => {
    if (!room.powerSpawn) return notBuilt();
    if (!structMem['powerSpawn']) return disabled();
    const ps = room.powerSpawn;
    if (ps.store[RESOURCE_ENERGY] < THRESHOLDS.powerSpawnEnergy || ps.store[RESOURCE_POWER] < 1) {
        return lowResource();
    }
    const effect = ps.effects?.find(e => e.effect === PWR_OPERATE_POWER) as PowerEffect | undefined;
    const speed = 1 + (effect?.level || 0);
    return td(colorText(`${ICONS.good} ${speed}速工作中`, COLORS.good));
};

const renderNuker = (room: Room): string => {
    if (!room.nuker) return notBuilt();
    if (room.nuker.cooldown) {
        return td(colorText(`${ICONS.warning} 冷却中(${room.nuker.cooldown})`, COLORS.warning));
    }
    if (room.nuker.store[RESOURCE_ENERGY] < THRESHOLDS.nukerEnergy || 
        room.nuker.store[RESOURCE_GHODIUM] < THRESHOLDS.nukerGhodium) {
        return lowResource();
    }
    return td(colorText(`${ICONS.good} ☢已就绪☢`, COLORS.good));
};

const renderEnergy = (room: Room): string => {
    const energy = room[RESOURCE_ENERGY] || 0;
    if (!energy) return td(colorText(`${ICONS.neutral} 0`, COLORS.neutral));
    const color = energy > THRESHOLDS.energyHigh ? COLORS.info 
        : energy > THRESHOLDS.energyLow ? COLORS.warning : COLORS.danger;
    return td(colorText(`⚡ ${energy.toLocaleString()}`, color));
};

// 生成单行数据
const rowInfo = (roomName: string, rowIndex: number): string => {
    const room = Game.rooms[roomName];
    if (!room?.my) return '';
    
    const structMem = Memory['StructControlData']?.[roomName] || {};
    const rowStyle = rowIndex % 2 === 0 ? STYLES.even : STYLES.odd;
    
    const cells = [
        td(`${getRoomLevelIcon(room.controller?.level)}<b style="color: ${COLORS.text};">${roomName}</b>`),
        renderSpawn(room),
        renderStorage(room),
        renderTerminal(room),
        renderLab(room, structMem),
        renderFactory(room, structMem),
        renderPowerSpawn(room, structMem),
        renderNuker(room),
        renderEnergy(room),
    ];
    
    return `<tr style="${STYLES.tr} ${rowStyle}">${cells.join('')}</tr>`;
};

export const showRoomInfo = (rooms: string[]): string => {
    const headers = ['房间', 'Spawn', 'Storage', 'Terminal', 'Lab', 'Factory', 'PowerSpawn', 'Nuker', 'Energy']
        .map((h, i) => i === 0 ? h : headSpan(h));

    const roomRows = rooms
        .map((name, index) => rowInfo(name, index))
        .filter(Boolean)
        .join('');

    return `<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 15px; border-radius: 2px;"><b style="${STYLES.title}">🏠房间信息</b><table style="${STYLES.table}"><thead><tr style="${STYLES.header}">${headers.map(th).join('')}</tr></thead><tbody>${roomRows}</tbody><tfoot><tr><td colspan="${headers.length}" style="${STYLES.footer}">最后更新: ${new Date().toLocaleString()} (游戏时间: ${Game.time})</td></tr></tfoot></table></div>`;
}