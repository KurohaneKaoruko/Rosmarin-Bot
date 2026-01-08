// 颜色常量
const COLORS = {
    good: '#06D6A0',
    warning: '#FFD166',
    danger: '#EF476F',
    neutral: '#8892a0',
    info: '#118AB2',
    text: '#e8eaed',
    textMuted: '#a0aab8',
    levelLow: '#8892a0',
    levelMid: '#6B9FD4',
    levelHigh: '#D4AF37',
    border: '#3d4a5c',
    bgDark: '#1a2332',
    bgLight: '#242f3f',
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
    table: 'text-align: center; border-collapse: separate; border-spacing: 0; width: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.4); border-radius: 3px; overflow: hidden; margin-top: 12px; border: 1px solid #3d4a5c;',
    header: 'background-color: #2a3a4f; color: #e8eaed; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;',
    th: 'padding: 14px 10px; text-align: center; border-bottom: 2px solid #4a5a6f;',
    tr: 'border-bottom: 1px solid #2d3850; transition: background-color 0.2s;',
    td: 'padding: 12px 10px; color: #e8eaed; vertical-align: middle;',
    title: 'font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; color: #e8eaed; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,0.3);',
    odd: 'background-color: rgba(42, 58, 79, 0.5);',
    even: 'background-color: rgba(36, 47, 63, 0.7);',
    footer: 'background-color: #1a2332; font-size: 11px; color: #8892a0; padding: 10px 12px; text-align: right; border-top: 1px solid #3d4a5c;'
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
    `<span style="color: ${color}; font-weight: 500; text-shadow: 0 1px 1px rgba(0,0,0,0.2);">${text}</span>`;

const td = (text: string) => `<td style="${STYLES.td}">${text}</td>`;

const th = (text: string) => `<th style="${STYLES.th}">${text}</th>`;

const headSpan = (text: string) => 
    `<span style="display:flex;align-items:center;justify-content:center;gap:4px;">${text}</span>`;

const notBuilt = () => td(`<span style="color: ${COLORS.neutral}; font-style: italic; opacity: 0.7;">${ICONS.neutral} 未建造</span>`);

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
    `<div style="background-color: rgba(255,255,255,0.08); height: 4px; width: 100%; margin-top: 5px; border-radius: 3px; overflow: hidden;"><div style="background: linear-gradient(90deg, ${color} 0%, ${color}dd 100%); height: 100%; width: ${Math.min(ratio, 1) * 100}%; border-radius: 3px; transition: width 0.3s;"></div></div>`;

// 获取房间等级图标
const getRoomLevelIcon = (level?: number): string => {
    if (!level) return '';
    const color = level <= 3 ? COLORS.levelLow : level <= 6 ? COLORS.levelMid : COLORS.levelHigh;
    return `<span style="color: ${color}; font-weight: bold; margin-right: 6px; font-size: 12px; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">${LEVEL_SYMBOLS[level]}</span>`;
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
    return td(colorText(`${ICONS.good} 已就绪`, COLORS.good));
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

    return `<div style="font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; padding: 16px;"><div style="${STYLES.title}"><span style="font-size: 16px;">🏠</span><span>房间信息</span></div><table style="${STYLES.table}"><thead><tr style="${STYLES.header}">${headers.map(th).join('')}</tr></thead><tbody>${roomRows}</tbody><tfoot><tr><td colspan="${headers.length}" style="${STYLES.footer}">📅 ${new Date().toLocaleString()} &nbsp;|&nbsp; ⏱ Tick ${Game.time.toLocaleString()}</td></tr></tfoot></table></div>`;
}