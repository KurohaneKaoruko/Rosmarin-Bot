type BoostConfig = {
    bodypart: [BodyPartConstant, number][];
    boostmap: BoostMap;
};

type BoostMap = { [bodypart: string]: MineralBoostConstant | MineralBoostConstant[] };

type AioConfig = {
    bodypart: [BodyPartConstant, number][];
    boostmap: BoostMap;
};

type LootConfig = {
    bodypart: [BodyPartConstant, number][];
    boostmap: BoostMap | null;
};

const AidBodys: { [role: string]: { [tier: string]: BoostConfig } } = {
    'aid-build': {
        'T3': {
            bodypart: [[WORK, 35], [CARRY, 5], [MOVE, 10]],
            boostmap: { [WORK]: 'XLH2O', [CARRY]: 'XKH2O', [MOVE]: 'XZHO2' }
        }
    },
    'aid-upgrade': {
        'T3': {
            bodypart: [[WORK, 35], [CARRY, 5], [MOVE, 10]],
            boostmap: { [WORK]: 'XGH2O', [CARRY]: 'XKH2O', [MOVE]: 'XZHO2' }
        }
    },
    'aid-carry': {
        'T3': {
            bodypart: [[CARRY, 25], [MOVE, 25]],
            boostmap: { [CARRY]: 'XKH2O' }
        },
        'BIG': {
            bodypart: [[CARRY, 40], [MOVE, 10]],
            boostmap: { [CARRY]: 'XKH2O', [MOVE]: 'XZHO2' }
        }
    }
};

const AIO_CONFIG: { [key: string]: AioConfig } = {
    '1T': {
        bodypart: [[TOUGH, 3], [RANGED_ATTACK, 32], [MOVE, 10], [HEAL, 5]],
        boostmap: { [HEAL]: 'XLHO2', [RANGED_ATTACK]: 'XKHO2', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' }
    },
    '2T': {
        bodypart: [[TOUGH, 4], [RANGED_ATTACK, 26], [MOVE, 10], [HEAL, 10]],
        boostmap: { [HEAL]: 'XLHO2', [RANGED_ATTACK]: 'XKHO2', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' }
    },
    '3T': {
        bodypart: [[TOUGH, 6], [RANGED_ATTACK, 22], [MOVE, 10], [HEAL, 12]],
        boostmap: { [HEAL]: 'XLHO2', [RANGED_ATTACK]: 'XKHO2', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' }
    },
    '6T': {
        bodypart: [[TOUGH, 10], [RANGED_ATTACK, 5], [MOVE, 10], [HEAL, 25]],
        boostmap: { [HEAL]: 'XLHO2', [RANGED_ATTACK]: 'XKHO2', [MOVE]: 'XZHO2', [TOUGH]: 'XGHO2' }
    }
}

const LOOT_CONFIG: { [tier: string]: LootConfig } = {
    'T0': {
        bodypart: [[CARRY, 25], [MOVE, 25]],
        boostmap: null,
    },
    'T1': {
        bodypart: [[CARRY, 33], [MOVE, 17]],
        boostmap: { [CARRY]: 'KH', [MOVE]: 'ZO' },
    },
    'T2': {
        bodypart: [[CARRY, 37], [MOVE, 13]],
        boostmap: { [CARRY]: 'KH2O', [MOVE]: 'ZHO2' },
    },
    'T3': {
        bodypart: [[CARRY, 40], [MOVE, 10]],
        boostmap: { [CARRY]: 'XKH2O', [MOVE]: 'XZHO2' },
    },
}

export type { BoostConfig, BoostMap, AioConfig, LootConfig }
export { AidBodys, AIO_CONFIG, LOOT_CONFIG }
