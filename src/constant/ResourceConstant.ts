// 全局资源平衡阈值
/**
 * 全局资源平衡阈值
 * 资源: [需求阈值, 供应阈值]
 * 需求阈值: 资源需求的最小阈值，低于此值时会触发资源需求
 * 供应阈值: 资源供应的最大阈值，高于此值时会触发资源供应
 */
export const RESOURCE_BALANCE = {
    'energy': [300e3, 400e3],
    'power': [5e3, 10e3],
    'ops': [5e3, 10e3],
    
    'U': [10e3, 30e3],
    'L': [10e3, 30e3],
    'Z': [10e3, 30e3],
    'K': [10e3, 30e3],
    'H': [10e3, 30e3],
    'O': [10e3, 30e3],
    'G': [10e3, 20e3],
    'X': [10e3, 20e3],

    'OH': [10e3, 15e3],
    'ZK': [10e3, 15e3],
    'UL': [10e3, 15e3],

    'UH': [10e3, 20e3],
    'UO': [10e3, 20e3],
    'ZH': [10e3, 20e3],
    'ZO': [10e3, 20e3],
    'KH': [10e3, 20e3],
    'KO': [10e3, 20e3],
    'LH': [10e3, 20e3],
    'LO': [10e3, 20e3],
    'GH': [10e3, 20e3],
    'GO': [10e3, 20e3],

    'UHO2': [10e3, 20e3],
    'UH2O': [10e3, 20e3],
    'ZHO2': [10e3, 20e3],
    'ZH2O': [10e3, 20e3],
    'LHO2': [10e3, 20e3],
    'LH2O': [10e3, 20e3],
    'KHO2': [10e3, 20e3],
    'KH2O': [10e3, 20e3],
    'GHO2': [10e3, 20e3],
    'GH2O': [10e3, 20e3],

    'XUHO2': [10e3, 20e3],
    'XUH2O': [10e3, 20e3],
    'XZHO2': [10e3, 20e3],
    'XZH2O': [10e3, 20e3],
    'XLHO2': [10e3, 20e3],
    'XLH2O': [10e3, 20e3],
    'XKHO2': [10e3, 20e3],
    'XKH2O': [10e3, 20e3],
    'XGHO2': [10e3, 20e3],
    'XGH2O': [10e3, 20e3],

    [RESOURCE_UTRIUM_BAR]: [5e3, 10e3],
    [RESOURCE_LEMERGIUM_BAR]: [5e3, 10e3],
    [RESOURCE_ZYNTHIUM_BAR]: [5e3, 10e3],
    [RESOURCE_KEANIUM_BAR]: [5e3, 10e3],
    [RESOURCE_GHODIUM_MELT]: [3e3, 10e3],
    [RESOURCE_OXIDANT]: [5e3, 10e3],
    [RESOURCE_REDUCTANT]: [5e3, 10e3],
    [RESOURCE_PURIFIER]: [5e3, 10e3],
}

// 各个等级工厂合成商品时的需求资源
export const RESOURCE_FACTORY_REQUIREMENT = {
    // 任意等级工厂
    'any': [],
}




// 资源名称缩写
export const RESOURCE_ABBREVIATIONS = {
    // 能量
    'E': RESOURCE_ENERGY,
    'P': RESOURCE_POWER,
    // 压缩矿物
    'ubar': RESOURCE_UTRIUM_BAR,
    'lbar': RESOURCE_LEMERGIUM_BAR,
    'zbar': RESOURCE_ZYNTHIUM_BAR,
    'kbar': RESOURCE_KEANIUM_BAR,
    'gbar': RESOURCE_GHODIUM_MELT,
    'obar': RESOURCE_OXIDANT,
    'hbar': RESOURCE_REDUCTANT,
    'xbar': RESOURCE_PURIFIER,
    'ox': RESOURCE_OXIDANT,
    'red': RESOURCE_REDUCTANT,
    'pur': RESOURCE_PURIFIER,
    'comp': RESOURCE_COMPOSITE,
    'cry': RESOURCE_CRYSTAL,
    'liq': RESOURCE_LIQUID,
    // 商品
    'B': RESOURCE_BATTERY,
    'sil': RESOURCE_SILICON,
    'met': RESOURCE_METAL,
    'bio': RESOURCE_BIOMASS,
    'mist': RESOURCE_MIST,
    'wire': RESOURCE_WIRE,
    'cell': RESOURCE_CELL,
    'alloy': RESOURCE_ALLOY,
    'cond': RESOURCE_CONDENSATE,
    'swit': RESOURCE_SWITCH,
    'tran': RESOURCE_TRANSISTOR,
    'micro': RESOURCE_MICROCHIP,
    'circ': RESOURCE_CIRCUIT,
    'dev': RESOURCE_DEVICE,
    'phleg': RESOURCE_PHLEGM,
    'tiss': RESOURCE_TISSUE,
    'musc': RESOURCE_MUSCLE,
    'org': RESOURCE_ORGANOID,
    'orga': RESOURCE_ORGANISM,
    'conc': RESOURCE_CONCENTRATE,
    'ext': RESOURCE_EXTRACT,
    'spir': RESOURCE_SPIRIT,
    'eman': RESOURCE_EMANATION,
    'ess': RESOURCE_ESSENCE,
} as { [key: string]: ResourceConstant };

export const t3 = ['XKH2O', 'XKHO2', 'XZH2O', 'XZHO2', 'XGH2O', 'XGHO2', 'XLHO2', 'XLH2O', 'XUH2O', 'XUHO2']
export const t2 = ['KH2O', 'KHO2', 'ZH2O', 'ZHO2', 'GH2O', 'GHO2', 'LHO2', 'LH2O', 'UH2O', 'UHO2']
export const t1 = ['KH', 'KO', 'GH', 'GO', 'LH', 'LO', 'ZO', 'ZH', 'UH', 'UO']

/**
 * Lab 自动合成的 T1 优先级（用于资源管理的“自动排产”）
 * @description
 * - 优先合成：OH、UH、KO、LO、LH、ZO、ZH、GO、GH
 * - 其次合成：ZK、UL
 * - 最后合成：G（由 ZK + UL）
 */
export const LAB_T1_PRIORITY = ['OH', 'UH', 'KO', 'LO', 'LH', 'ZO', 'ZH', 'GO', 'GH', 'ZK', 'UL', 'G'] as const;

export const LabMap = {
    'OH': { raw1: 'H', raw2: 'O' },
    'ZK': { raw1: 'Z', raw2: 'K' },
    'UL': { raw1: 'U', raw2: 'L' },
    'G': { raw1: 'ZK', raw2: 'UL' },
    'GH': { raw1: 'G', raw2: 'H' },
    'GH2O': { raw1: 'GH', raw2: 'OH' },
    'XGH2O': { raw1: 'GH2O', raw2: 'X' },
    'ZO': { raw1: 'Z', raw2: 'O' },
    'ZHO2': { raw1: 'ZO', raw2: 'OH' },
    'XZHO2': { raw1: 'ZHO2', raw2: 'X' },
    'UH': { raw1: 'U', raw2: 'H' },
    'UH2O': { raw1: 'UH', raw2: 'OH' },
    'XUH2O': { raw1: 'UH2O', raw2: 'X' },
    'KH': { raw1: 'K', raw2: 'H' },
    'KH2O': { raw1: 'KH', raw2: 'OH' },
    'XKH2O': { raw1: 'KH2O', raw2: 'X' },
    'KO': { raw1: 'K', raw2: 'O' },
    'KHO2': { raw1: 'KO', raw2: 'OH' },
    'XKHO2': { raw1: 'KHO2', raw2: 'X' },
    'LH': { raw1: 'L', raw2: 'H' },
    'LH2O': { raw1: 'LH', raw2: 'OH' },
    'XLH2O': { raw1: 'LH2O', raw2: 'X' },
    'LO': { raw1: 'L', raw2: 'O' },
    'LHO2': { raw1: 'LO', raw2: 'OH' },
    'XLHO2': { raw1: 'LHO2', raw2: 'X' },
    'GO': { raw1: 'G', raw2: 'O' },
    'GHO2': { raw1: 'GO', raw2: 'OH' },
    'XGHO2': { raw1: 'GHO2', raw2: 'X' },
    'ZH': { raw1: 'Z', raw2: 'H' },
    'ZH2O': { raw1: 'ZH', raw2: 'OH' },
    'XZH2O': { raw1: 'ZH2O', raw2: 'X' },
    'UO': { raw1: 'U', raw2: 'O' },
    'UHO2': { raw1: 'UO', raw2: 'OH' },
    'XUHO2': { raw1: 'UHO2', raw2: 'X' },
}

export const LabRes = ['H', 'O', 'Z', 'K', 'L', 'U', 'X']

// lab合成优先级
export const LabLevel = {
    'ZK': 1,
    'UL': 1,

    'G': 2,

    'UH': 3,
    'UO': 3,
    'KH': 3,
    'KO': 3,
    'LH': 3,
    'LO': 3,
    'OH': 3,
    'ZO': 3,
    'ZH': 3,
    'GH': 3,
    'GO': 3,

    'LHO2': 4,
    'LH2O': 4,
    'GH2O': 4,
    'GHO2': 4,
    'KH2O': 4,
    'KHO2': 4,
    'ZH2O': 4,
    'ZHO2': 4,
    'UH2O': 4,
    'UHO2': 4,

    'XLHO2': 5,
    'XLH2O': 5,
    'XUH2O': 5,
    'XUHO2': 5,
    'XZH2O': 5,
    'XZHO2': 5,
    'XKH2O': 5,
    'XKHO2': 5,
    'XGH2O': 5,
    'XGHO2': 5,
}

export const CompoundColor = {
    'L': '#6cf0a9',
    'LH': '#6cf0a9',
    'LHO2': '#6cf0a9',
    'XLHO2': '#6cf0a9',
    'LH2O': '#6cf0a9',
    'LO': '#6cf0a9',
    'XLH2O': '#6cf0a9',
    'U': '#4ca7e5',
    'UH': '#4ca7e5',
    'UO': '#4ca7e5',
    'UH2O': '#4ca7e5',
    'UHO2': '#4ca7e5',
    'XUH2O': '#4ca7e5',
    'XUHO2': '#4ca7e5',
    'Z': '#f7d492',
    'ZO': '#f7d492',
    'ZH': '#f7d492',
    'ZH2O': '#f7d492',
    'ZHO2': '#f7d492',
    'XZH2O': '#f7d492',
    'XZHO2': '#f7d492',
    'K': '#da6Bf5',
    'KH': '#da6Bf5',
    'KO': '#da6Bf5',
    'KH2O': '#da6Bf5',
    'KHO2': '#da6Bf5',
    'XKH2O': '#da6Bf5',
    'XKHO2': '#da6Bf5',
    'G': '#d9d6c3',
    'GH': '#d9d6c3',
    'GO': '#d9d6c3',
    'GH2O': '#d9d6c3',
    'GHO2': '#d9d6c3',
    'XGH2O': '#d9d6c3',
    'XGHO2': '#d9d6c3',
    'X': '#aa2116',
    'ZK': '#74787c',
    'UL': '#7c8577'
}

// export const BarList = [RESOURCE_BATTERY, 'lemergium_bar', 'zynthium_bar', 'keanium_bar', 'utrium_bar', 'ghodium_melt', 'oxidant', 'reductant', 'purifier']

export const zipMap = {
    'energy': "battery",
    'L': 'lemergium_bar',
    'Z': 'zynthium_bar',
    'K': 'keanium_bar',
    'U': 'utrium_bar',
    'G': 'ghodium_melt',
    'O': 'oxidant',
    'H': 'reductant',
    'X': 'purifier',
}

export const unzipMap = {
    'battery': RESOURCE_ENERGY,
    'lemergium_bar': RESOURCE_LEMERGIUM,
    'zynthium_bar': RESOURCE_ZYNTHIUM,
    'keanium_bar': RESOURCE_KEANIUM,
    'utrium_bar': RESOURCE_UTRIUM,
    'ghodium_melt': RESOURCE_GHODIUM,
    'oxidant': RESOURCE_OXYGEN,
    'reductant': RESOURCE_HYDROGEN,
    'purifier': RESOURCE_CATALYST,
}

export const BarList = [...Object.keys(unzipMap)]

export const BaseGoods = [
    RESOURCE_METAL, RESOURCE_BIOMASS, RESOURCE_SILICON, RESOURCE_MIST,
    RESOURCE_ALLOY, RESOURCE_CELL, RESOURCE_WIRE, RESOURCE_CONDENSATE,
]

export const Goods = [
    RESOURCE_COMPOSITE, RESOURCE_CRYSTAL, RESOURCE_LIQUID,
    RESOURCE_TUBE, RESOURCE_PHLEGM, RESOURCE_SWITCH, RESOURCE_CONCENTRATE,
    RESOURCE_FIXTURES, RESOURCE_TISSUE, RESOURCE_TRANSISTOR, RESOURCE_EXTRACT,
    RESOURCE_FRAME, RESOURCE_MUSCLE, RESOURCE_MICROCHIP, RESOURCE_SPIRIT,
    RESOURCE_HYDRAULICS, RESOURCE_ORGANOID, RESOURCE_CIRCUIT, RESOURCE_EMANATION,
    RESOURCE_MACHINE, RESOURCE_ORGANISM, RESOURCE_DEVICE, RESOURCE_ESSENCE,
]

/**
 * 自动生产调度（由 ResourceManage 驱动）
 * @description
 * - enabled=false：ResourceManage 仅按 RESOURCE_BALANCE 做资源平衡；autoLab/autoFactory 仍可单房间工作。
 * - enabled=true：ResourceManage 会根据缺口/规则写入 AutoLabData/AutoFactoryData，并为生产注入原料需求阈值以触发跨房间调度。
 */
export const RESOURCE_PRODUCTION = {
    enabled: true,
    log: {
        enabled: true,
        limitPerTick: 10,
    },
    lab: {
        enabled: true,
        chain: {
            enabled: true,
            /** 单房间单轮写入 AutoLabData 的“增量限额” */
            batchPerRoom: 10000,
            /** ResourceManage 注入到生产房间的原料需求阈值（用于触发跨房间调度补料） */
            inputMin: {
                t1: 6000,
                t2: 6000,
                t3: 5000,
            },
            /** true：房间存在手动 AutoLabData（非链条键）时不覆盖 */
            respectManualAutoData: true,
        },
    },
    factory: {
        enabled: true,
        chain: {
            enabled: true,
            /** 自动合成到的最高等级（默认 5） */
            maxLevel: 5,
            /** 白色商品不自动合成（白色链：composite/crystal/liquid 及其派生物） */
            excludeWhite: true,
            /** 单房间单轮写入 AutoFactoryData 的“增量限额” */
            batchPerRoom: 5000,
            /**
             * 各等级四色商品希望维持的目标库存
             * @description
             * - 仅用于防止无限堆积：达到该值后会切换同级其他颜色或停止
             * - 这些是“全局目标”（资源管理视角），按需可自行调节
             */
            keepByLevel: {
                0: 20000,
                1: 10000,
                2: 5000,
                3: 2000,
                4: 1000,
                5: 500,
            } as Record<number, number>,
            /** true：房间存在手动 AutoFactoryData（非四色链条键）时不覆盖 */
            respectManualAutoData: true,
        },
    },
} as const;

/**
 * AutoLab 自动合成参数
 * @description
 * - 这些参数用于改善“lab 长期闲置/频繁清空任务”的问题。
 * - 与 RESOURCE_PRODUCTION 联动时：资源管理补料到位之前，AutoLab 会优先“保持任务等待”而不是立刻关停。
 */
export const AUTO_LAB_CONFIG = {
    tickInterval: 50,
    /** A/B lab 内原料达到该值即认为“可以继续维持任务”等待补料 */
    continueLabStoreMin: 5,
    /** 自定义 AutoLabData 任务选择时，raw1/raw2 的最低库存门槛（默认沿用旧逻辑） */
    customTaskInputMin: 6000,
    /** 缺料时最多保持任务的 tick 数，超过后允许自动切换/清空，避免永久卡死 */
    waitTimeoutTicks: 500,
} as const;

/**
 * AutoFactory 自动生产参数
 * @description
 * - 主要用于避免“材料已搬进 factory，但 getResAmount 不统计导致误判缺料→停工/换任务”。
 */
export const AUTO_FACTORY_CONFIG = {
    tickInterval: 50,
    /** 缺料时最多保持任务的 tick 数，超过后允许自动切换/清空 */
    waitTimeoutTicks: 500,
    /** goods 组件目标倍数（默认保持与旧逻辑一致） */
    goodsComponentMultiplier: 10,
    /** 非 goods 组件库存门槛（默认保持与旧逻辑一致） */
    componentMin: 10000,
} as const;

/**
 * 最小生产额度（用于“计划挑选/继续生产/排产写入”）
 * @description
 * - 化合物（Lab 产物）统一最小生产额度为 1000
 * - 商品（Factory）按等级逐级递减，5 级最小生产额度为 10
 */
export const PRODUCTION_MIN = {
    compound: 1000,
    commodityByLevel: {
        0: 1000,
        1: 500,
        2: 200,
        3: 100,
        4: 50,
        5: 10,
    } as Record<number, number>,
} as const;
