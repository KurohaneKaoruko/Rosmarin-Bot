export type BodyPartLike = {
    type: BodyPartConstant;
    hits?: number;
    boost?: ResourceConstant | undefined;
};

export type CombatProfile = {
    id?: string;
    hits: number;
    hitsMax: number;
    parts: Partial<Record<BodyPartConstant, number>>;
    boosted: boolean;
    boosts: Partial<Record<BodyPartConstant, Partial<Record<string, number>>>>;
};

const BOOST_MULT: Record<string, number> = {
    UH: 2,
    UH2O: 3,
    XUH2O: 4,
    KO: 2,
    KHO2: 3,
    XKHO2: 4,
    LO: 2,
    LHO2: 3,
    XLHO2: 4,
    ZH: 2,
    ZH2O: 3,
    XZH2O: 4,
};

const TOUGH_DAMAGE_FACTOR: Record<string, number> = {
    GO: 0.7,
    GHO2: 0.5,
    XGHO2: 0.3,
};

export const getBoostMultiplier = (partType: BodyPartConstant, boost?: string): number => {
    // 这里不直接依赖 BOOSTS，全局在本地单测环境并不存在；用硬编码倍率保证“可复现的决策”。
    if (!boost) return 1;
    if (partType === TOUGH) return TOUGH_DAMAGE_FACTOR[boost] ?? 1;
    return BOOST_MULT[boost] ?? 1;
};

export const getActivePartCounts = (body: BodyPartLike[] | undefined): Partial<Record<BodyPartConstant, number>> => {
    const out: Partial<Record<BodyPartConstant, number>> = {};
    if (!body || body.length === 0) return out;
    for (const p of body) {
        if (!p || !p.type) continue;
        if (typeof p.hits === 'number' && p.hits <= 0) continue;
        out[p.type] = (out[p.type] || 0) + 1;
    }
    return out;
};

export const buildCombatProfile = (creep: { id?: string; hits: number; hitsMax: number; body?: BodyPartLike[] }): CombatProfile => {
    const parts = getActivePartCounts(creep.body);
    let boosted = false;
    const boosts: CombatProfile['boosts'] = {};
    for (const p of creep.body || []) {
        if (!p || !p.boost) continue;
        if (typeof p.hits === 'number' && p.hits <= 0) continue;
        boosted = true;
        const t = p.type;
        const b = String(p.boost);
        if (!boosts[t]) boosts[t] = {};
        boosts[t]![b] = (boosts[t]![b] || 0) + 1;
    }
    return { id: creep.id, hits: creep.hits, hitsMax: creep.hitsMax, parts, boosted, boosts };
};

export const estimateHealPower = (healer: { body?: BodyPartLike[] }, rangeToTarget: number): number => {
    const base = rangeToTarget <= 1 ? 12 : rangeToTarget <= 3 ? 4 : 0;
    if (base <= 0) return 0;
    let total = 0;
    for (const p of healer.body || []) {
        if (!p || p.type !== HEAL) continue;
        if (typeof p.hits === 'number' && p.hits <= 0) continue;
        total += base * getBoostMultiplier(HEAL, p.boost ? String(p.boost) : undefined);
    }
    return total;
};

export const estimateMeleeDamage = (attacker: { body?: BodyPartLike[] }): number => {
    let total = 0;
    for (const p of attacker.body || []) {
        if (!p || p.type !== ATTACK) continue;
        if (typeof p.hits === 'number' && p.hits <= 0) continue;
        total += 30 * getBoostMultiplier(ATTACK, p.boost ? String(p.boost) : undefined);
    }
    return total;
};

export const estimateRangedDamage = (attacker: { body?: BodyPartLike[] }, rangeToTarget: number): number => {
    let base = 0;
    if (rangeToTarget <= 1) base = 30;
    else if (rangeToTarget === 2) base = 20;
    else if (rangeToTarget === 3) base = 10;
    if (base <= 0) return 0;
    let total = 0;
    for (const p of attacker.body || []) {
        if (!p || p.type !== RANGED_ATTACK) continue;
        if (typeof p.hits === 'number' && p.hits <= 0) continue;
        total += base * getBoostMultiplier(RANGED_ATTACK, p.boost ? String(p.boost) : undefined);
    }
    return total;
};

export const estimateDismantlePower = (worker: { body?: BodyPartLike[] }): number => {
    let total = 0;
    for (const p of worker.body || []) {
        if (!p || p.type !== WORK) continue;
        if (typeof p.hits === 'number' && p.hits <= 0) continue;
        total += 50 * getBoostMultiplier(WORK, p.boost ? String(p.boost) : undefined);
    }
    return total;
};
