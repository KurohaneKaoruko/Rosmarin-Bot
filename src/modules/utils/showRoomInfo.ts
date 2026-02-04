// 颜色常量
const COLORS = {
    theme: '#D0CAE0',     // Endfield Lavender
    good: '#4CC9F0',      // Technical Teal
    warning: '#FFC300',   // Safety Amber
    danger: '#FF003C',    // Signal Red
    neutral: '#888888',   // Muted Grey
    info: '#4CC9F0',
    text: '#F0F0F0',
    textMuted: '#666666',
    levelLow: '#666666',
    levelMid: '#4CC9F0',
    levelHigh: '#D0CAE0', // Use Theme Color
    border: '#2A2D33',
    bgDark: '#1E2024',
    bgLight: '#25282D',
} as const;

// 状态图标
const ICONS = {
    good: '■',
    warning: '▲',
    danger: '✕',
    neutral: '―',
} as const;

// 表格样式
const STYLES = {
    table: 'text-align: left; border-collapse: collapse; width: 100%; margin-top: 12px; border-top: 2px solid #D0CAE0; font-family: Consolas, monospace;',
    header: 'background-color: #15171A; color: #F0F0F0; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; border-bottom: 1px solid #333;',
    th: 'padding: 10px 12px; text-align: center; border-right: 1px solid #2A2D33;',
    tr: 'border-bottom: 1px solid #2A2D33;',
    td: 'padding: 8px 12px; color: #CCCCCC; vertical-align: middle; border-right: 1px solid #2A2D33; font-size: 12px;',
    title: 'font-size: 14px; margin-bottom: 8px; display: flex; align-items: center; color: #D0CAE0; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; border-left: 3px solid #D0CAE0; padding-left: 10px;',
    odd: 'background-color: rgba(37, 40, 45, 0.9);',
    even: 'background-color: rgba(30, 32, 36, 0.9);',
    footer: 'background-color: #15171A; font-size: 10px; color: #888; padding: 8px 12px; text-align: right; border-top: 1px solid #333; font-family: Consolas, monospace;'
} as const;

// 等级符号
const LEVEL_SYMBOLS = ['[0]', '[1]', '[2]', '[3]', '[4]', '[5]', '[6]', '[7]', '[8]'] as const;

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
    `<span style="color: ${color}; font-weight: 500; padding: 0;">${text}</span>`;

const td = (text: string) => `<td style="${STYLES.td}">${text}</td>`;

const th = (text: string) => `<th style="${STYLES.th}">${text}</th>`;

const notBuilt = () => td(`<span style="color: ${COLORS.neutral}; opacity: 0.5;padding: 0;">- NULL -</span>`);

const disabled = () => td(colorText(`${ICONS.danger} OFFLINE`, COLORS.danger));

const idle = () => td(colorText(`${ICONS.warning} IDLE`, COLORS.warning));

const lowResource = () => td(colorText(`${ICONS.warning} LOW_RES`, COLORS.warning));

// ENERGY 显示格式：默认千分位；达到百万级后转为 K 单位（保持逗号分隔）
export const formatEnergy = (energy: number): string => {
    const value = Math.trunc(energy);
    if (value >= 1_000_000) {
        const k = Math.round(value / 1000);
        return `${k.toLocaleString('en-US')}K`;
    }
    return value.toLocaleString('en-US');
};

// 根据使用率获取状态
const getStoreStatus = (ratio: number): { icon: string; color: string } => {
    if (ratio >= THRESHOLDS.storeDanger) return { icon: ICONS.danger, color: COLORS.danger };
    if (ratio >= THRESHOLDS.storeWarning) return { icon: ICONS.warning, color: COLORS.warning };
    return { icon: ICONS.good, color: COLORS.good };
};

// 生成进度条
const progressBar = (ratio: number, color: string) => 
    `<div style="background-color: #333; height: 2px; width: 100%; margin-top: 6px;"><div style="background-color: ${color}; height: 100%; width: ${Math.min(ratio, 1) * 100}%;"></div></div>`;

// 获取房间等级图标
const getRoomLevelIcon = (level?: number): string => {
    if (!level) return '';
    const color = level <= 3 ? COLORS.levelLow : level <= 6 ? COLORS.levelMid : COLORS.levelHigh;
    return `<span style="color: ${color}; font-weight: 700; margin-right: 6px; padding:0; font-size: 12px; font-family: Consolas, monospace;">${LEVEL_SYMBOLS[level]}</span>`;
};

// 各结构状态渲染函数
const renderSpawn = (room: Room): string => {
    if (!room.spawn?.length) return notBuilt();
    const missionCount = room.getMissionNumInPool('spawn');
    const { icon, color } = missionCount > 0 
        ? { icon: ICONS.warning, color: COLORS.warning }
        : { icon: ICONS.good, color: COLORS.good };
    return td(colorText(`${icon} ${missionCount}/${room.spawn.length}`, color));
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
    return td(colorText(`${ICONS.good} ${labAtype} + ${labBtype} -> ${product}`, COLORS.good));
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
    return td(colorText(`${ICONS.good} SPD:${speed}`, COLORS.good));
};

const renderNuker = (room: Room): string => {
    if (!room.nuker) return notBuilt();
    if (room.nuker.cooldown) {
        return td(colorText(`${ICONS.warning} CD(${room.nuker.cooldown})`, COLORS.warning));
    }
    if (room.nuker.store[RESOURCE_ENERGY] < THRESHOLDS.nukerEnergy || 
        room.nuker.store[RESOURCE_GHODIUM] < THRESHOLDS.nukerGhodium) {
        return lowResource();
    }
    return td(colorText(`${ICONS.good} READY`, COLORS.good));
};

const renderEnergy = (room: Room): string => {
    const energy = room[RESOURCE_ENERGY] || 0;
    if (!energy) return td(colorText(`${ICONS.neutral} 0`, COLORS.neutral));
    const color = energy > THRESHOLDS.energyHigh ? COLORS.info 
        : energy > THRESHOLDS.energyLow ? COLORS.warning : COLORS.danger;
    return td(colorText(formatEnergy(energy), color));
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
    const headers = ['ROOM', 'SPAWN', 'STORAGE', 'TERMINAL', 'LAB', 'FACTORY', 'POWER', 'NUKER', 'ENERGY'];

    const roomRows = rooms
        .map((name, index) => rowInfo(name, index))
        .filter(Boolean)
        .join('');

    return `<div style="font-family: Consolas, monospace; padding: 10px; background-color: ${COLORS.bgDark};"><div style="${STYLES.title}"><span>// ROOM_STATUS_MONITOR</span></div><table style="${STYLES.table}"><thead><tr style="${STYLES.header}">${headers.map(th).join('')}</tr></thead><tbody>${roomRows}</tbody><tfoot><tr><td colspan="${headers.length}" style="${STYLES.footer}">SYSTEM_TIME: ${new Date().toISOString()} | TICK: ${Game.time}</td></tr></tfoot></table></div>`;
}
