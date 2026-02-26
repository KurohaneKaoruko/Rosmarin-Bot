// 全局资源平衡阈值
/**
 * 全局资源平衡阈值
 * 资源: [需求阈值, 供应阈值]
 * 需求阈值: 资源需求的最小阈值，低于此值时会触发资源需求
 * 供应阈值: 资源供应的最大阈值，高于此值时会触发资源供应
 */
export const AUTO_ENERGY_POLICY = {
    buyBelow: 100e3,
    balanceAt: 200e3,
    sellAbove: 300e3,
} as const;

export const AUTO_MARKET_DEFAULT = {
    energy: {
        buyBelow: 100e3,
        sellAbove: 300e3,
        balanceAt: 200e3,
    },
    storageCapacitySplit: 3e6,
    harvestableMineralSellAboveSmallStorage: 500e3,
    harvestableMineralSellAboveLargeStorage: 1e6,
    harvestableMinerals: [
        RESOURCE_HYDROGEN,
        RESOURCE_OXYGEN,
        RESOURCE_UTRIUM,
        RESOURCE_LEMERGIUM,
        RESOURCE_KEANIUM,
        RESOURCE_ZYNTHIUM,
        RESOURCE_CATALYST,
    ] as ResourceConstant[],
} as const;

/**
 * AutoMarket 策略参数
 * @description
 * - 控制自动买卖、调价、即时成交与候选订单筛选行为
 */
export const AUTO_MARKET_CONFIG = {
    /** 自动市场执行间隔 */
    tickInterval: 50,
    /** 历史均价不可用时的回退价格 */
    energyAvgPriceFallback: 0.01,
    /** 估算跨房能量成本比时的采样量 */
    energyPriceCostSampleAmount: 1000,
    /** 调价最小绝对变化 */
    priceAdjustMinAbs: 0.01,
    /** 调价最小相对变化 */
    priceAdjustMinRatio: 0.02,

    /** 能量买单默认挂单量 */
    energyOrderBuyAmount: 20e3,
    /** 能量卖单默认挂单量 */
    energyOrderSellAmount: 10e3,
    /** 非能量默认挂单量 */
    defaultOrderAmount: 3e3,
    /** 能量挂单最小生效量 */
    energyMinOrderAmount: 5e3,
    /** 非能量挂单最小生效量 */
    defaultMinOrderAmount: 500,

    /** 能量优先尝试即时成交的单次上限 */
    energyDirectDealAmount: 10e3,
    /** 能量即时成交最小生效量 */
    energyMinDealAmount: 5e3,
    /** 即时成交优先扫描的候选长度 */
    dealCandidateLength: 10,
    /** 即时成交候选池最小保底长度 */
    dealCandidateFloor: 50,
    /** 挂单定价时按房间去重后的头部订单数量 */
    topOrderRoomLimit: 10,
    /** 能量参与挂单定价的最小订单量 */
    energyOrderMinAmountForPricing: 10e3,
    /** dealbuy 模式下能量最小成交量 */
    dealBuyMinEnergyAmount: 10e3,
    /** dealsell 模式下能量最小成交量 */
    dealSellMinEnergyAmount: 5e3,
} as const;

export const RESOURCE_BALANCE = {
    'energy': [AUTO_ENERGY_POLICY.balanceAt, AUTO_ENERGY_POLICY.balanceAt],
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
            batchPerRoom: 10e3,
            /** 单房间单轮最多写入的候选计划条数（避免因单条计划缺料导致长期闲置） */
            maxPlansPerRoom: 3,
            /** ResourceManage 注入到生产房间的原料需求阈值（用于触发跨房间调度补料） */
            inputMin: {
                t1: 6e3,
                t2: 6e3,
                t3: 5e3,
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
            /**
             * 专项保有库存（不走四色链条筛选）
             * @description
             * - 用于白色根商品与关键中间件：Composite/Crystal/Liquid/Gbar(ghodium_melt)\n
             * - 目标库存不需要太多，默认每种 10k，足够作为后续合成原料\n
             */
            specialKeep: {
                [RESOURCE_COMPOSITE]: 10e3,
                [RESOURCE_CRYSTAL]: 10e3,
                [RESOURCE_LIQUID]: 10e3,
                [RESOURCE_GHODIUM_MELT]: 10e3,
                [RESOURCE_UTRIUM_BAR]: 10e3,
                [RESOURCE_LEMERGIUM_BAR]: 10e3,
                [RESOURCE_ZYNTHIUM_BAR]: 10e3,
                [RESOURCE_KEANIUM_BAR]: 10e3,
                [RESOURCE_OXIDANT]: 10e3,
                [RESOURCE_REDUCTANT]: 10e3,
                [RESOURCE_PURIFIER]: 10e3,
            } as Record<string, number>,
            /** 单房间单轮写入 AutoFactoryData 的"增量限额" */
            batchPerRoom: 5e3,
            /** 单房间单轮最多写入的备用计划数（避免因主计划缺料/Ban导致长期闲置） */
            maxPlansPerRoom: 2,
            /**
             * 各等级四色商品希望维持的目标库存
             * @description
             * - 仅用于防止无限堆积：达到该值后会切换同级其他颜色或停止
             * - 这些是“全局目标”（资源管理视角），按需可自行调节
             */
            keepByLevel: {
                0: 20e3,
                1: 10e3,
                2: 5e3,
                3: 2e3,
                4: 1e3,
                5: 500,
            } as Record<number, number>,
            /** true：房间存在手动 AutoFactoryData（非四色链条键）时不覆盖 */
            respectManualAutoData: true,
        },
    },
} as const;

/**
 * 智能优先级排序算法配置
 * @description
 * - 用于 Lab 和 Factory 排产逻辑的多维度权重计算
 * - 权重系数控制各维度在最终优先级评分中的占比
 */
export const PRIORITY_CONFIG = {
    /** tierRank 权重：T3=1.0, T2=0.8, T1=0.6 */
    tierWeight: 0.35,
    /** 缺口系数权重 */
    deficitWeight: 0.30,
    /** 原料充足度权重 */
    resourceWeight: 0.20,
    /** 时间等待权重 */
    timeWeight: 0.15,
    /** tierRank 映射值 */
    tierRank: { T3: 1.0, T2: 0.8, T1: 0.6 },
} as const;

/**
 * 动态阈值配置
 * @description
 * - 用于智能优先级算法中的动态调整参数
 */
export const DYNAMIC_THRESHOLD_CONFIG = {
    /** 基准缺口量（用于计算缺口系数） */
    baseDeficit: 5000,
    /** 缺口系数上限 */
    deficitCap: 2.0,
    /** 原料充足度临界值（超过此值视为充足） */
    resourceSufficient: 10000,
    /** 原料充足度计算的最大值 */
    resourceMax: 20000,
    /** 时间等待因递增子上限 */
    timeFactorMax: 1.5,
    /** 时间等待递增因子下限 */
    timeFactorMin: 1.0,
    /** 等待时间阈值（超过此值开始计算时间系数） */
    waitTimeThreshold: 50,
    /** 阈值调整百分比 */
    adjustPercent: 0.1,
    /** 连续缺料周期数触发调整 */
    adjustInterval: 3,
    /** 阈值最低调整比例 */
    minThresholdRatio: 0.5,
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
    continueInputMin: 1e3,
    /** 自定义 AutoLabData 任务选择时，raw1/raw2 的最低库存门槛（默认沿用旧逻辑） */
    customTaskInputMin: 6e3,
    /** 自定义任务达到该比例视为接近完成 */
    customTaskDoneRatio: 0.9,
    /** 兜底任务的检查间隔 */
    fallbackCheckInterval: 100,
    /** 兜底任务每次追加的目标增量 */
    fallbackBatchAmount: 10e3,
    /** 兜底任务原矿判定的主阈值 */
    fallbackPrimaryThreshold: 10e3,
    /** 兜底任务原矿判定的辅阈值 */
    fallbackSecondaryThreshold: 5e3,
    /** 单原料模式下的阈值 */
    fallbackSingleReagentThreshold: 10e3,
    /** T2/T3 与前级库存差值阈值 */
    fallbackDiffFloor: 20e3,
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
    /** 任务达到该比例视为接近完成 */
    taskDoneRatio: 0.9,
    /** 缺料且存在其它可开工计划时的等待上限（避免长期占用任务阻塞切换） */
    waitTimeoutTicksWhenAlternatives: 50,
    /** 因“填装不足”超时结束任务后，对同一产物的冷却期（避免立刻重分配抖动） */
    banTicksAfterFillTimeout: 200,
    /** goods 组件目标倍数（默认保持与旧逻辑一致） */
    goodsComponentMultiplier: 10,
    /** 非 goods 组件库存门槛（默认保持与旧逻辑一致） */
    componentMin: 10e3,
} as const;

/**
 * 资源跨房调度参数
 * @description
 * - 用于 ResourceManage 的 send 任务分发与生产需求补料
 * - 仅抽取“策略阈值”，局部算法细节仍保留在调用处
 */
export const RESOURCE_DISPATCH_CONFIG = {
    marketCostCacheExpiry: 1000,
    productionReserveRatio: 0.5,

    energyMinSendAmount: 5e3,
    goodsMinSendAmount: 100,
    defaultMinSendAmount: 1e3,
    productionDefaultMinSendAmount: 500,
    goodsMaxSendAmount: 500,

    energyPerPairCap: 50e3,
    goodsPerPairCap: 500,
    defaultPerPairCap: 10e3,
    energyPerSourceCap: 100e3,
    goodsPerSourceCap: 1e3,
    defaultPerSourceCap: 20e3,
    goodsPerSourceMaxPairs: 5,
    defaultPerSourceMaxPairs: 3,

    productionSourceMarkMinGoods: 50,
    productionSourceMarkMinDefault: 500,
} as const;

/**
 * AutoFactory 兜底生产配置
 * @description
 * - 当 AutoFactoryData 为空或其中所有计划都不可生产时，AutoFactory 会按此配置进行兜底生产选择。
 * - 该配置是“房间内保有量”口径（storage+terminal+factory.store）。
 */
export const AUTO_FACTORY_FALLBACK = {
    enabled: true,
    /** 递归回退补链的最大深度（避免无限依赖） */
    maxResolveDepth: 3,
    /** zip（压缩/解压）只在底物明显富余时才触发 */
    zipRawSurplusMin: {
        [RESOURCE_UTRIUM]: 20e3,
        [RESOURCE_LEMERGIUM]: 20e3,
        [RESOURCE_ZYNTHIUM]: 20e3,
        [RESOURCE_KEANIUM]: 20e3,
        [RESOURCE_GHODIUM]: 20e3,
        [RESOURCE_OXYGEN]: 20e3,
        [RESOURCE_HYDROGEN]: 20e3,
        [RESOURCE_CATALYST]: 20e3,
    } as Record<string, number>,
    /** 兜底任务的“目标库存上限”（达到则自动结束并换下一个缺口项） */
    keepInRoom: {
        [RESOURCE_COMPOSITE]: 3e3,
        [RESOURCE_CRYSTAL]: 3e3,
        [RESOURCE_LIQUID]: 3e3,

        [RESOURCE_UTRIUM_BAR]: 3e3,
        [RESOURCE_LEMERGIUM_BAR]: 3e3,
        [RESOURCE_ZYNTHIUM_BAR]: 3e3,
        [RESOURCE_KEANIUM_BAR]: 3e3,
        [RESOURCE_GHODIUM_MELT]: 3e3,
        [RESOURCE_OXIDANT]: 3e3,
        [RESOURCE_REDUCTANT]: 3e3,
        [RESOURCE_PURIFIER]: 3e3,

        [RESOURCE_WIRE]: 2e3,
        [RESOURCE_CELL]: 2e3,
        [RESOURCE_ALLOY]: 2e3,
        [RESOURCE_CONDENSATE]: 2e3,
    } as Record<string, number>,
    /** 四色链条商品按等级的兜底保有量（房间维度） */
    keepByLevelInRoom: {
        0: 5e3,
        1: 2e3,
        2: 1e3,
        3: 500,
        4: 200,
        5: 50,
    } as Record<number, number>,
} as const;

/**
 * 最小生产额度（用于“计划挑选/继续生产/排产写入”）
 * @description
 * - 化合物（Lab 产物）统一最小生产额度为 1000
 * - 商品（Factory）按等级逐级递减，5 级最小生产额度为 10
 */
export const PRODUCTION_MIN = {
    compound: 1e3,
    commodityByLevel: {
        0: 1e3,
        1: 500,
        2: 200,
        3: 100,
        4: 50,
        5: 10,
    } as Record<number, number>,
} as const;

export const PRODUCTION_MONITOR_CONFIG = {
    efficiencyThreshold: 0.5,
    efficiencyCheckInterval: 10,
    lowEfficiencyRecoveryTicks: 50,
} as const;
