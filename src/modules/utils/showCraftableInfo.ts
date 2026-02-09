import { LAB_T1_PRIORITY, LabMap, RESOURCE_ABBREVIATIONS, RESOURCE_PRODUCTION, t1, t2, t3 } from '@/constant/ResourceConstant';

const br = '<br/>';
const COLORS = {
    bgDark: '#111318',
    border: '#2c2f36',
    headerBg: '#1a1e27',
    text: '#F0F0F0',
    textMuted: '#B0B0B0',
} as const;

const STYLES = {
    title: 'padding:6px 10px;margin:0 0 8px 0;border:1px solid #2c2f36;border-radius:6px;background:#141924;color:#F0F0F0;font-weight:700;',
    table: 'border-collapse:collapse;width:100%;table-layout:auto;',
    header: `background:${COLORS.headerBg};color:${COLORS.text};`,
    cell: `border:1px solid ${COLORS.border};padding:6px 8px;vertical-align:top;white-space:nowrap;`,
    tr: '',
    even: 'background:#0f1218;',
    odd: 'background:#101521;',
    footer: `padding:8px 6px;border:1px solid ${COLORS.border};color:${COLORS.textMuted};font-size:12px;`,
} as const;

const mono = (text: string, color: string = COLORS.text) =>
    `<span style="color:${color};font-family:Consolas,monospace;margin:0;padding:0;display:inline-block;">${text}</span>`;

const th = (text: string) => `<th style="${STYLES.cell} ${STYLES.header}">${mono(text)}</th>`;
const td = (html: string, extraStyle: string = '') => `<td style="${STYLES.cell} ${extraStyle}">${html}</td>`;

const TD_WRAP = 'white-space:normal;overflow-wrap:anywhere;';
const TD_NUM = 'text-align:right;font-variant-numeric:tabular-nums;';

const wrapTable = (title: string, headers: string[], rows: string) =>
    `<div style="font-family:Consolas,monospace;padding:10px;background-color:${COLORS.bgDark};"><div style="${STYLES.title}"><span>${title}</span></div><table style="${STYLES.table}"><thead><tr style="${STYLES.tr}">${headers.map(th).join('')}</tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="${headers.length}" style="${STYLES.footer}">SYSTEM_TIME: ${new Date().toISOString()} | TICK: ${Game.time}</td></tr></tfoot></table></div>`;

// 展示用资源缩写（从全局“输入缩写映射”反推得到最短缩写）
const RESOURCE_DISPLAY_ABBR: Record<string, string> = (() => {
    const map: Record<string, string> = Object.create(null);
    for (const [abbr, res] of Object.entries(RESOURCE_ABBREVIATIONS as Record<string, ResourceConstant>)) {
        const full = String(res);
        const prev = map[full];
        if (!prev || abbr.length < prev.length) map[full] = abbr;
    }
    return map;
})();

const resLabel = (res: string) => RESOURCE_DISPLAY_ABBR[res] ?? res;

// craft 参数过滤：支持按生产类型/等级/指定资源筛选展示
type CraftFilter =
    | { kind: 'none' }
    | { kind: 'type'; type: 'LAB' | 'FACTORY' }
    | { kind: 'labTier'; tier: 0 | 1 | 2 | 3 }
    | { kind: 'factoryLevel'; level: 0 | 1 | 2 | 3 | 4 | 5 }
    | { kind: 'resource'; resource: string };

const LAB_T0 = new Set<string>(['OH', 'ZK', 'UL', 'G']);
const LAB_TIER_SET = {
    0: LAB_T0,
    1: new Set<string>(t1 as unknown as string[]),
    2: new Set<string>(t2 as unknown as string[]),
    3: new Set<string>(t3 as unknown as string[]),
} as const;

const normalizeInputResource = (raw: string) => {
    const map = RESOURCE_ABBREVIATIONS as unknown as Record<string, ResourceConstant>;
    const mapped = map[raw] ?? map[raw.toLowerCase()];
    return mapped ? String(mapped) : raw;
};

const resolveResourceKey = (raw: string) => {
    const normalized = normalizeInputResource(raw);
    const candidates: string[] = [normalized, raw, normalized.toUpperCase(), raw.toUpperCase(), normalized.toLowerCase(), raw.toLowerCase()];
    const seen = new Set<string>();
    for (const c of candidates) {
        if (!c) continue;
        if (seen.has(c)) continue;
        seen.add(c);
        if ((LabMap as any)?.[c]) return c;
        if ((COMMODITIES as any)?.[c]) return c;
    }
    return normalized;
};

const parseCraftFilter = (input?: string | number): CraftFilter => {
    if (input === undefined || input === null) return { kind: 'none' };
    const key = String(input).trim();
    if (!key) return { kind: 'none' };

    const lower = key.toLowerCase();
    if (lower === 'lab') return { kind: 'type', type: 'LAB' };
    if (lower === 'factory') return { kind: 'type', type: 'FACTORY' };

    const upper = key.toUpperCase();
    if (upper === 'T0') return { kind: 'labTier', tier: 0 };
    if (upper === 'T1') return { kind: 'labTier', tier: 1 };
    if (upper === 'T2') return { kind: 'labTier', tier: 2 };
    if (upper === 'T3') return { kind: 'labTier', tier: 3 };

    if (/^[0-5]$/.test(key)) return { kind: 'factoryLevel', level: Number(key) as 0 | 1 | 2 | 3 | 4 | 5 };

    return { kind: 'resource', resource: resolveResourceKey(key) };
};

const getGlobalAvail = (res: string) => {
    let total = 0;
    for (const room of Object.values(Game.rooms)) {
        if (!room?.controller?.my) continue;
        const storage = room.storage;
        const terminal = room.terminal;
        const factory = (room as any).factory as StructureFactory | undefined;
        if (storage) total += (storage.store as any)?.[res] || 0;
        if (terminal) total += (terminal.store as any)?.[res] || 0;
        if (factory) total += (factory.store as any)?.[res] || 0;
        const labs = (room as any).lab as StructureLab[] | undefined;
        if (Array.isArray(labs)) {
            for (const lab of labs) {
                total += (lab.store as any)?.[res] || 0;
            }
        }
    }
    return total;
};

const fmt = (n: number) => {
    const v = Math.floor(n);
    return v.toLocaleString('en-US');
};

const joinRecipe = (components: Record<string, number>, outAmount: number, product: string) => {
    const parts: string[] = [];
    const keys = Object.keys(components);
    keys.sort((a, b) => a.localeCompare(b));
    for (const c of keys) {
        const need = Number((components as any)[c] || 0);
        if (need <= 0) continue;
        parts.push(`${fmt(need)} ${resLabel(c)}`);
    }
    const left = parts.join(' + ');
    return `${left} -> ${fmt(outAmount)} ${product}`;
};

type Row = { product: string; recipe: string; type: 'LAB' | 'FACTORY' | 'N/A'; have: number; craftable: number; sortKey: number };

export const showCraftableInfo = (filter?: string | number) => {
    const parsed = parseCraftFilter(filter);
    const rows: Row[] = [];

    // 指定资源：无论是否可合成/是否处于自动链路，都强制只显示该资源
    if (parsed.kind === 'resource') {
        const product = parsed.resource;
        const have = getGlobalAvail(product);
        const labRecipe = (LabMap as any)?.[product];
        const commodityInfo = (COMMODITIES as any)?.[product];

        if (labRecipe?.raw1 && labRecipe?.raw2) {
            const raw1 = String(labRecipe.raw1);
            const raw2 = String(labRecipe.raw2);
            const a = getGlobalAvail(raw1);
            const b = getGlobalAvail(raw2);
            rows.push({
                product,
                recipe: `${resLabel(raw1)} + ${resLabel(raw2)} -> ${product}`,
                type: 'LAB',
                have,
                craftable: Math.min(a, b),
                sortKey: 0,
            });
        } else if (commodityInfo?.components) {
            const components = commodityInfo.components as Record<string, number>;
            let crafts = Infinity;
            for (const [c, needRaw] of Object.entries(components)) {
                const need = Number(needRaw) || 0;
                if (need <= 0) continue;
                const has = getGlobalAvail(c);
                crafts = Math.min(crafts, Math.floor(has / need));
            }
            if (!Number.isFinite(crafts)) crafts = 0;
            const out = Number(commodityInfo?.amount || 1);
            rows.push({
                product,
                recipe: joinRecipe(components, out, product),
                type: 'FACTORY',
                have,
                craftable: crafts * out,
                sortKey: 1,
            });
        } else {
            rows.push({
                product,
                recipe: '无配方',
                type: 'N/A',
                have,
                craftable: 0,
                sortKey: 2,
            });
        }
    }

    const isSingleResourceMode = parsed.kind === 'resource';

    const onlyType =
        parsed.kind === 'type' ? parsed.type :
            parsed.kind === 'labTier' ? 'LAB' :
                parsed.kind === 'factoryLevel' ? 'FACTORY' :
                    undefined;
    const onlyTier = parsed.kind === 'labTier' ? parsed.tier : undefined;
    const onlyFactoryLevel = parsed.kind === 'factoryLevel' ? parsed.level : undefined;

    if (!isSingleResourceMode && (!onlyType || onlyType === 'LAB') && RESOURCE_PRODUCTION.enabled && RESOURCE_PRODUCTION.lab.enabled && RESOURCE_PRODUCTION.lab.chain.enabled) {
        const labProducts = new Set<string>([
            ...(LAB_T1_PRIORITY as any),
            ...(t1 as any),
            ...(t2 as any),
            ...(t3 as any),
        ]);
        const tierSet = onlyTier === undefined ? undefined : LAB_TIER_SET[onlyTier];
        for (const product of labProducts) {
            if (tierSet && !tierSet.has(product)) continue;
            const recipe = (LabMap as any)?.[product];
            const raw1 = recipe?.raw1 as string | undefined;
            const raw2 = recipe?.raw2 as string | undefined;
            if (!raw1 || !raw2) continue;
            const a = getGlobalAvail(raw1);
            const b = getGlobalAvail(raw2);
            const craftable = Math.min(a, b);
            if (craftable <= 0) continue;
            const have = getGlobalAvail(product);
            rows.push({
                product,
                recipe: `${resLabel(raw1)} + ${resLabel(raw2)} -> ${product}`,
                type: 'LAB',
                have,
                craftable,
                sortKey: 0,
            });
        }
    }

    if (!isSingleResourceMode && (!onlyType || onlyType === 'FACTORY') && RESOURCE_PRODUCTION.enabled && RESOURCE_PRODUCTION.factory.enabled && RESOURCE_PRODUCTION.factory.chain.enabled) {
        const maxLevel = RESOURCE_PRODUCTION.factory.chain.maxLevel;
        if (onlyFactoryLevel !== undefined) {
            for (const product of Object.keys(COMMODITIES as any)) {
                const info = (COMMODITIES as any)[product];
                const level = Number(info?.level ?? 0);
                if (level !== onlyFactoryLevel) continue;
                const components = info?.components as Record<string, number> | undefined;
                if (!components) continue;
                let crafts = Infinity;
                for (const [c, needRaw] of Object.entries(components)) {
                    const need = Number(needRaw) || 0;
                    if (need <= 0) continue;
                    const has = getGlobalAvail(c);
                    crafts = Math.min(crafts, Math.floor(has / need));
                }
                if (!Number.isFinite(crafts)) crafts = 0;
                if (crafts <= 0) continue;
                const out = Number(info?.amount || 1);
                const craftable = crafts * out;
                if (craftable <= 0) continue;
                const have = getGlobalAvail(product);
                rows.push({
                    product,
                    recipe: joinRecipe(components, out, product),
                    type: 'FACTORY',
                    have,
                    craftable,
                    sortKey: 1,
                });
            }
        } else {
            const excludeWhite = RESOURCE_PRODUCTION.factory.chain.excludeWhite;
            const specialKeep = (RESOURCE_PRODUCTION.factory.chain as any).specialKeep as Record<string, number> | undefined;

            const WHITE_ROOTS = new Set<string>([RESOURCE_COMPOSITE, RESOURCE_CRYSTAL, RESOURCE_LIQUID]);
            const COLOR_ROOTS = new Set<string>([RESOURCE_METAL, RESOURCE_BIOMASS, RESOURCE_SILICON, RESOURCE_MIST]);
            const ROOT_BIT: Record<string, number> = {
                [RESOURCE_METAL]: 1,
                [RESOURCE_BIOMASS]: 2,
                [RESOURCE_SILICON]: 4,
                [RESOURCE_MIST]: 8,
            };
            const classCache = Object.create(null) as Record<string, { colored: boolean; white: boolean; rootsMask: number }>;
            const classify = (res: string): { colored: boolean; white: boolean; rootsMask: number } => {
                const hit = classCache[res];
                if (hit) return hit;
                const base = { colored: COLOR_ROOTS.has(res), white: WHITE_ROOTS.has(res), rootsMask: ROOT_BIT[res] || 0 };
                classCache[res] = base;
                const recipe = (COMMODITIES as any)?.[res];
                const components = recipe?.components as Record<string, number> | undefined;
                if (!components) return base;
                for (const comp of Object.keys(components)) {
                    const child = classify(comp);
                    base.colored ||= child.colored;
                    base.white ||= child.white;
                    base.rootsMask |= child.rootsMask;
                }
                return base;
            };

            const availableMask =
                (getGlobalAvail(RESOURCE_METAL) > 0 ? 1 : 0) |
                (getGlobalAvail(RESOURCE_BIOMASS) > 0 ? 2 : 0) |
                (getGlobalAvail(RESOURCE_SILICON) > 0 ? 4 : 0) |
                (getGlobalAvail(RESOURCE_MIST) > 0 ? 8 : 0);

            const autoProducts = new Set<string>();
            for (const product of Object.keys(COMMODITIES as any)) {
                const info = (COMMODITIES as any)[product];
                const level = Number(info?.level ?? 0);
                if (level < 0 || level > maxLevel) continue;
                const components = info?.components as Record<string, number> | undefined;
                if (!components) continue;
                const tags = classify(product);
                if (!tags.colored) continue;
                if (excludeWhite && tags.white) continue;
                if ((tags.rootsMask & ~availableMask) !== 0) continue;
                if (Object.keys(components).some(c => getGlobalAvail(c) <= 0)) continue;
                autoProducts.add(product);
            }
            if (specialKeep) {
                for (const product of Object.keys(specialKeep)) {
                    const info = (COMMODITIES as any)?.[product];
                    const components = info?.components as Record<string, number> | undefined;
                    if (!info || !components) continue;
                    if (Object.keys(components).some(c => getGlobalAvail(c) <= 0)) continue;
                    autoProducts.add(product);
                }
            }

            for (const product of autoProducts) {
                const info = (COMMODITIES as any)?.[product];
                const components = info?.components as Record<string, number> | undefined;
                if (!components) continue;
                let crafts = Infinity;
                for (const [c, needRaw] of Object.entries(components)) {
                    const need = Number(needRaw) || 0;
                    if (need <= 0) continue;
                    const has = getGlobalAvail(c);
                    crafts = Math.min(crafts, Math.floor(has / need));
                }
                if (!Number.isFinite(crafts)) crafts = 0;
                if (crafts <= 0) continue;
                const out = Number(info?.amount || 1);
                const craftable = crafts * out;
                if (craftable <= 0) continue;
                const have = getGlobalAvail(product);
                rows.push({
                    product,
                    recipe: joinRecipe(components, out, product),
                    type: 'FACTORY',
                    have,
                    craftable,
                    sortKey: 1,
                });
            }
        }
    }

    const headers = ['产物', '配方', '生产类型', '现存量', '可合成'];
    const ordered = rows
        .sort((a, b) => (a.sortKey - b.sortKey) || (b.craftable - a.craftable) || a.product.localeCompare(b.product));

    const htmlRows = ordered
        .map((r, i) => {
            const rowStyle = i % 2 === 0 ? STYLES.even : STYLES.odd;
            return `<tr style="${STYLES.tr} ${rowStyle}">` +
                td(mono(r.product)) +
                td(mono(r.recipe, COLORS.textMuted), TD_WRAP) +
                td(mono(r.type)) +
                td(mono(fmt(r.have)), TD_NUM) +
                td(mono(fmt(r.craftable)), TD_NUM) +
                `</tr>`;
        })
        .join('');

    return wrapTable('// CRAFTABLE_PRODUCTS', headers, htmlRows || `<tr style="${STYLES.tr} ${STYLES.even}"><td colspan="${headers.length}" style="${STYLES.cell}">${mono('无可合成条目', COLORS.textMuted)}</td></tr>`);
};
