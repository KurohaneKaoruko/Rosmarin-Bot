import { LAB_T1_PRIORITY, LabMap, RESOURCE_PRODUCTION, t1, t2, t3 } from '@/constant/ResourceConstant';
import { resolveLabFromMem } from '@/modules/utils/labReservations';

const COLORS = {
    theme: '#D0CAE0',
    good: '#4CC9F0',
    warning: '#FFC300',
    danger: '#FF003C',
    neutral: '#888888',
    text: '#F0F0F0',
    textMuted: '#B0B0B0',
    border: '#2A2D33',
    bgDark: '#1E2024',
    bgLight: '#25282D',
    header: '#15171A',
} as const;

const ICONS = {
    good: '■',
    warning: '▲',
    danger: '✕',
    neutral: '―',
} as const;

const STYLES = {
    table: `text-align:left;border-collapse:collapse;width:100%;margin-top:12px;border-top:2px solid ${COLORS.theme};font-family:Consolas,monospace;`,
    header: `background-color:${COLORS.header};color:${COLORS.text};font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:1px;border-bottom:1px solid #333;`,
    th: `padding:10px 12px;text-align:center;border-right:1px solid ${COLORS.border};`,
    tr: `border-bottom:1px solid ${COLORS.border};`,
    td: `padding:8px 12px;color:#CCCCCC;vertical-align:top;border-right:1px solid ${COLORS.border};font-size:12px;white-space:nowrap;`,
    odd: `background-color:rgba(37,40,45,0.9);`,
    even: `background-color:rgba(30,32,36,0.9);`,
    title: `font-size:14px;margin-bottom:8px;display:flex;align-items:center;color:${COLORS.theme};font-weight:700;text-transform:uppercase;letter-spacing:1px;border-left:3px solid ${COLORS.theme};padding-left:10px;`,
    footer: `background-color:${COLORS.header};font-size:10px;color:${COLORS.neutral};padding:8px 12px;text-align:right;border-top:1px solid #333;font-family:Consolas,monospace;`,
} as const;

const br = '<br/>';

const colorText = (text: string, color: string, bold = false) =>
    `<span style="color:${color};${bold ? 'font-weight:700;' : 'font-weight:500;'}padding:0;margin:0;">${text}</span>`;

const mono = (text: string, color: string = COLORS.text) =>
    `<span style="color:${color};font-family:Consolas,monospace;padding:0;margin:0;">${text}</span>`;

const td = (html: string) => `<td style="${STYLES.td}">${html}</td>`;
const th = (text: string) => `<th style="${STYLES.th}">${text}</th>`;

const fmt = (n: number) => Math.trunc(n).toLocaleString('en-US');

const getBotMem = (): any => (Memory as any)?.RosmarinBot;
const peekStruct = (roomName: string): any => getBotMem()?.StructData?.[roomName];
const peekAutoLab = (roomName: string): Record<string, number> | undefined => getBotMem()?.AutoData?.AutoLabData?.[roomName];
const peekAutoFactory = (roomName: string): Record<string, number> | undefined => getBotMem()?.AutoData?.AutoFactoryData?.[roomName];
const peekMissionPools = (): any => getBotMem()?.MissionPools;
const peekResourceManage = (roomName: string): any => getBotMem()?.ResourceManage?.[roomName];

type Transfer = { from: string; to: string; res: string; amount: number; id?: string };

const listTerminalTransfers = (roomName: string, onlyResources?: Set<string>) => {
    const pools = peekMissionPools() || {};
    const outgoing: Transfer[] = [];
    const incoming: Transfer[] = [];

    const pushIf = (arr: Transfer[], t: Transfer) => {
        if (onlyResources && !onlyResources.has(t.res)) return;
        arr.push(t);
    };

    const myTerminal = pools?.[roomName]?.terminal;
    if (Array.isArray(myTerminal)) {
        for (const t of myTerminal) {
            if (!t || t.type !== 'send') continue;
            const d = t.data as any;
            if (!d?.targetRoom || !d?.resourceType || typeof d?.amount !== 'number') continue;
            pushIf(outgoing, { id: t.id, from: roomName, to: d.targetRoom, res: String(d.resourceType), amount: d.amount });
        }
    }

    for (const fromRoom in pools) {
        const tasks = pools?.[fromRoom]?.terminal;
        if (!Array.isArray(tasks)) continue;
        for (const t of tasks) {
            if (!t || t.type !== 'send') continue;
            const d = t.data as any;
            if (d?.targetRoom !== roomName) continue;
            if (!d?.resourceType || typeof d?.amount !== 'number') continue;
            pushIf(incoming, { id: t.id, from: fromRoom, to: roomName, res: String(d.resourceType), amount: d.amount });
        }
    }

    return { outgoing, incoming };
};

type ManageMove = { source: string; target: string; res: string; amount: number; id?: string };

const listManageMoves = (roomName: string, onlyResources?: Set<string>) => {
    const pools = peekMissionPools() || {};
    const tasks = pools?.[roomName]?.manage;
    const moves: ManageMove[] = [];
    if (!Array.isArray(tasks)) return moves;
    for (const t of tasks) {
        if (!t || t.type !== 'manage') continue;
        const d = t.data as any;
        if (!d?.source || !d?.target || !d?.resourceType || typeof d?.amount !== 'number') continue;
        const res = String(d.resourceType);
        if (onlyResources && !onlyResources.has(res)) continue;
        moves.push({ id: t.id, source: String(d.source), target: String(d.target), res, amount: d.amount });
    }
    return moves;
};

const renderTransfers = (roomName: string, resources?: Set<string>) => {
    const { outgoing, incoming } = listTerminalTransfers(roomName, resources);
    const out = outgoing.slice(0, 5).map(t => `${mono('发', COLORS.warning)} ${mono(t.res)} ${mono(fmt(t.amount), COLORS.warning)} ${mono('->')} ${mono(t.to, COLORS.textMuted)}`).join(br);
    const inc = incoming.slice(0, 5).map(t => `${mono('收', COLORS.good)} ${mono(t.res)} ${mono(fmt(t.amount), COLORS.good)} ${mono('<-')} ${mono(t.from, COLORS.textMuted)}`).join(br);
    const moreOut = outgoing.length > 5 ? br + mono(`... +${outgoing.length - 5}`, COLORS.textMuted) : '';
    const moreIn = incoming.length > 5 ? br + mono(`... +${incoming.length - 5}`, COLORS.textMuted) : '';
    const parts = [];
    if (incoming.length) parts.push(inc + moreIn);
    if (outgoing.length) parts.push(out + moreOut);
    if (!parts.length) return mono('-', COLORS.textMuted);
    return parts.join(br);
};

const renderManage = (roomName: string, resources?: Set<string>) => {
    const moves = listManageMoves(roomName, resources);
    if (!moves.length) return mono('-', COLORS.textMuted);
    const lines = moves.slice(0, 6).map(m => `${mono(m.source, COLORS.textMuted)}${mono('->', COLORS.textMuted)}${mono(m.target, COLORS.textMuted)} ${mono(m.res)} ${mono(fmt(m.amount), COLORS.warning)}`).join(br);
    const more = moves.length > 6 ? br + mono(`... +${moves.length - 6}`, COLORS.textMuted) : '';
    return lines + more;
};

const getLabAvail = (room: Room, res: ResourceConstant) => {
    let total = room.getResAmount(res);
    const labs = (room as any).lab as StructureLab[] | undefined;
    if (Array.isArray(labs)) {
        for (const lab of labs) {
            if (!lab || lab.mineralType !== res) continue;
            total += (lab.store as any)[res] || 0;
        }
    }
    return total;
};

const getFactoryAvail = (room: Room, res: ResourceConstant) => {
    return room.getResAmount(res) + ((room.factory?.store as any)?.[res] || 0);
};

const renderAutoPlan = (room: Room, autoMap: Record<string, number> | undefined, getAvail: (r: ResourceConstant) => number) => {
    if (!autoMap || Object.keys(autoMap).length === 0) return mono('-', COLORS.textMuted);
    const entries = Object.entries(autoMap)
        .filter(([, v]) => typeof v === 'number')
        .sort((a, b) => (Number(b[1]) - Number(a[1])) || a[0].localeCompare(b[0]));
    const top = entries.slice(0, 3).map(([p, limit]) => {
        const cur = getAvail(p as any);
        const left = Math.max(0, limit - cur);
        const status = left > 0 ? colorText(`${ICONS.warning} ${fmt(cur)}/${fmt(limit)}`, COLORS.warning) : colorText(`${ICONS.good} ${fmt(cur)}/${fmt(limit)}`, COLORS.good);
        return `${mono(p)} ${status}`;
    });
    const more = entries.length > 3 ? br + mono(`... +${entries.length - 3}`, COLORS.textMuted) : '';
    return top.join(br) + more;
};

const renderLabNeed = (room: Room, struct: any) => {
    const labAtype = struct?.labAtype as ResourceConstant | undefined;
    const labBtype = struct?.labBtype as ResourceConstant | undefined;
    if (!labAtype || !labBtype) return mono('-', COLORS.textMuted);
    const product = (REACTIONS as any)?.[labAtype]?.[labBtype] as ResourceConstant | undefined;
    const needs = new Set<string>([labAtype, labBtype, product].filter(Boolean) as any);
    const { labA, labB } = (() => {
        const a = resolveLabFromMem(room, struct?.labA)?.lab;
        const b = resolveLabFromMem(room, struct?.labB)?.lab;
        return { labA: a, labB: b };
    })();

    const lines: string[] = [];
    if (!labA || !labB) {
        lines.push(colorText(`${ICONS.danger} A/B 未配置或不可见`, COLORS.danger));
        return lines.join(br);
    }
    const aOk = labA.mineralType === labAtype && (labA.store as any)[labAtype] >= 5;
    const bOk = labB.mineralType === labBtype && (labB.store as any)[labBtype] >= 5;
    if (!aOk) {
        const has = (labA.store as any)[labAtype] || 0;
        lines.push(`${mono('A')} ${mono(labAtype)} ${colorText(`${has}/5`, has >= 5 ? COLORS.good : COLORS.warning)}`);
    }
    if (!bOk) {
        const has = (labB.store as any)[labBtype] || 0;
        lines.push(`${mono('B')} ${mono(labBtype)} ${colorText(`${has}/5`, has >= 5 ? COLORS.good : COLORS.warning)}`);
    }
    if (product) {
        const amountLimit = Number(struct?.labAmount || 0);
        if (amountLimit > 0) {
            const cur = getLabAvail(room, product);
            const left = Math.max(0, amountLimit - cur);
            if (left > 0) lines.push(`${mono('产物')} ${mono(product)} ${colorText(`缺口 ${fmt(left)}`, COLORS.warning)}`);
        }
    }
    if (!lines.length) return colorText(`${ICONS.good} OK`, COLORS.good);
    const transfers = renderTransfers(room.name, needs);
    const manage = renderManage(room.name, needs);
    return [lines.join(br), mono('调度', COLORS.textMuted) + br + transfers, mono('搬运', COLORS.textMuted) + br + manage].join(br);
};

const renderLabStatus = (room: Room, struct: any) => {
    if (!room.lab?.length) return colorText(`${ICONS.neutral} 未建造`, COLORS.neutral);
    if (!struct?.lab) return colorText(`${ICONS.danger} 已关闭`, COLORS.danger);
    const hasTask = !!(struct?.labAtype && struct?.labBtype);
    if (!hasTask) return colorText(`${ICONS.warning} 闲置`, COLORS.warning);
    return colorText(`${ICONS.good} 运行中`, COLORS.good);
};

const renderLabTask = (room: Room, struct: any) => {
    const labAtype = struct?.labAtype as ResourceConstant | undefined;
    const labBtype = struct?.labBtype as ResourceConstant | undefined;
    if (!labAtype || !labBtype) return mono('-', COLORS.textMuted);
    const product = (REACTIONS as any)?.[labAtype]?.[labBtype] as ResourceConstant | undefined;
    const amountLimit = Number(struct?.labAmount || 0);
    const parts = [
        `${mono(labAtype)} ${mono('+', COLORS.textMuted)} ${mono(labBtype)} ${mono('->', COLORS.textMuted)} ${mono(String(product || '?'))}`,
        amountLimit > 0 ? `${mono('限额', COLORS.textMuted)} ${mono(fmt(amountLimit), COLORS.warning)}` : `${mono('限额', COLORS.textMuted)} ${mono('无', COLORS.textMuted)}`
    ];
    const { lab: labA } = resolveLabFromMem(room, struct?.labA);
    const { lab: labB } = resolveLabFromMem(room, struct?.labB);
    if (labA && labB) {
        parts.push(`${mono('A', COLORS.textMuted)}(${mono(`${labA.pos.x},${labA.pos.y}`, COLORS.textMuted)}) ${mono(String(labA.mineralType || '-'))}:${mono(fmt((labA.store as any)[labA.mineralType as any] || 0), COLORS.textMuted)}`);
        parts.push(`${mono('B', COLORS.textMuted)}(${mono(`${labB.pos.x},${labB.pos.y}`, COLORS.textMuted)}) ${mono(String(labB.mineralType || '-'))}:${mono(fmt((labB.store as any)[labB.mineralType as any] || 0), COLORS.textMuted)}`);
    }
    return parts.join(br);
};

const renderFactoryStatus = (room: Room, struct: any) => {
    if (!room.factory) return colorText(`${ICONS.neutral} 未建造`, COLORS.neutral);
    if (!struct?.factory) return colorText(`${ICONS.danger} 已关闭`, COLORS.danger);
    if (room.factory.cooldown) return colorText(`${ICONS.warning} 冷却(${room.factory.cooldown})`, COLORS.warning);
    const hasTask = !!struct?.factoryProduct;
    if (!hasTask) return colorText(`${ICONS.warning} 闲置`, COLORS.warning);
    return colorText(`${ICONS.good} 运行中`, COLORS.good);
};

const renderFactoryTask = (room: Room, struct: any) => {
    const product = struct?.factoryProduct as ResourceConstant | undefined;
    const amountLimit = Number(struct?.factoryAmount || 0);
    const flv = Number(room.factory?.level || struct?.factoryLevel || 0);
    if (!product) return `${mono('等级', COLORS.textMuted)} ${mono(String(flv), COLORS.warning)}`;
    const parts = [
        `${mono('等级', COLORS.textMuted)} ${mono(String(flv), COLORS.warning)}`,
        `${mono(product)} ${amountLimit > 0 ? `${mono('限额', COLORS.textMuted)} ${mono(fmt(amountLimit), COLORS.warning)}` : `${mono('限额', COLORS.textMuted)} ${mono('无', COLORS.textMuted)}`}`,
    ];
    return parts.join(br);
};

const renderFactoryNeed = (room: Room, struct: any) => {
    const product = struct?.factoryProduct as ResourceConstant | undefined;
    const flv = Number(room.factory?.level || struct?.factoryLevel || 0);
    if (!product) return mono('-', COLORS.textMuted);
    const info = (COMMODITIES as any)?.[product];
    const components = info?.components as Record<string, number> | undefined;
    if (!components) return colorText(`${ICONS.danger} 无配方`, COLORS.danger);
    if (info?.level && Number(info.level) !== flv) return colorText(`${ICONS.danger} 等级不匹配`, COLORS.danger);
    const needs = new Set<string>([product, ...Object.keys(components)]);
    const lines: string[] = [];
    for (const [c, need] of Object.entries(components)) {
        const has = (room.factory?.store as any)?.[c] || 0;
        if (has < Number(need)) {
            lines.push(`${mono(c)} ${colorText(`${fmt(has)}/${fmt(Number(need))}`, COLORS.warning)}`);
        }
    }
    if (!lines.length) return colorText(`${ICONS.good} OK`, COLORS.good);
    const transfers = renderTransfers(room.name, needs);
    const manage = renderManage(room.name, needs);
    return [lines.join(br), mono('调度', COLORS.textMuted) + br + transfers, mono('搬运', COLORS.textMuted) + br + manage].join(br);
};

const roomRow = (roomName: string, idx: number, kind: 'lab' | 'factory') => {
    const room = Game.rooms[roomName];
    if (!room?.my) return '';
    const struct = peekStruct(roomName) || {};
    const autoLab = peekAutoLab(roomName);
    const autoFactory = peekAutoFactory(roomName);
    const rowStyle = idx % 2 === 0 ? STYLES.even : STYLES.odd;

    if (kind === 'lab') {
        const headers = [
            td(mono(roomName)),
            td(renderLabStatus(room, struct)),
            td(renderLabTask(room, struct)),
            td(renderAutoPlan(room, autoLab, (r) => getLabAvail(room, r))),
            td(renderLabNeed(room, struct)),
        ];
        return `<tr style="${STYLES.tr} ${rowStyle}">${headers.join('')}</tr>`;
    }

    const headers = [
        td(mono(roomName)),
        td(renderFactoryStatus(room, struct)),
        td(renderFactoryTask(room, struct)),
        td(renderAutoPlan(room, autoFactory, (r) => getFactoryAvail(room, r))),
        td(renderFactoryNeed(room, struct)),
    ];
    return `<tr style="${STYLES.tr} ${rowStyle}">${headers.join('')}</tr>`;
};

const wrapTable = (title: string, headers: string[], rows: string) =>
    `<div style="font-family:Consolas,monospace;padding:10px;background-color:${COLORS.bgDark};"><div style="${STYLES.title}"><span>${title}</span></div><table style="${STYLES.table}"><thead><tr style="${STYLES.header}">${headers.map(th).join('')}</tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="${headers.length}" style="${STYLES.footer}">SYSTEM_TIME: ${new Date().toISOString()} | TICK: ${Game.time}</td></tr></tfoot></table></div>`;

export const showLabInfo = (rooms: string[]) => {
    const headers = ['房间', '状态', '任务', '计划', '缺口'];
    const rows = rooms.map((r, i) => roomRow(r, i, 'lab')).filter(Boolean).join('');
    return wrapTable('// LAB_PRODUCTION', headers, rows);
};

export const showFactoryInfo = (rooms: string[]) => {
    const headers = ['房间', '状态', '任务', '计划', '缺口'];
    const rows = rooms.map((r, i) => roomRow(r, i, 'factory')).filter(Boolean).join('');
    return wrapTable('// FACTORY_PRODUCTION', headers, rows);
};
