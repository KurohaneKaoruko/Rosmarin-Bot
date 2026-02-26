import { AUTO_LAB_CONFIG, LabMap, LabLevel, PRODUCTION_MIN, RESOURCE_PRODUCTION, t2, t3 } from '@/constant/ResourceConstant'
import { log } from '@/utils';
import { getLabAB } from '@/modules/utils/labReservations';
import { getAutoLabData, getStructData } from '@/modules/utils/memory';

export default class AutoLab extends Room {
    autoLab() {
        if (Game.time % AUTO_LAB_CONFIG.tickInterval) return;
        if (!this.lab || !this.lab.length) return;
        const botmem = getStructData(this.name) as any;
        if (botmem.lab === undefined) botmem.lab = true;
        if (!botmem.lab) return;

        const labProduct: ResourceConstant | null = botmem.labAtype && botmem.labBtype
            ? (REACTIONS[botmem.labAtype][botmem.labBtype] as ResourceConstant)
            : null;
        const amount: number = Number(botmem.labAmount) || 0;    // 产物限额

        // 注意：getResAmount 只统计 storage+terminal；AutoLab 需要把已被搬进 lab 的原料/产物也纳入判断，
        // 否则会出现“看起来有料但判定无料→关停/不分配”，导致 lab 长期闲置。
        const getAvail = (res: ResourceConstant) => {
            let total = this.getResAmount(res);
            for (const lab of this.lab) {
                if (!lab) continue;
                if (lab.mineralType !== res) continue;
                total += lab.store[res] || 0;
            }
            return total;
        };

        // AutoLab 只读取 A/B，不负责推导/写回；A/B 的修正由 LabWork 的 ensureLabAB 负责
        const { labA, labB } = getLabAB(this.name, this);
        if (!labA || !labB) return;

        if (botmem.labAtype && botmem.labBtype && labProduct) {
            if (amount > 0) {
                const cur = getAvail(labProduct);
                if (cur >= amount) {
                    botmem.labAtype = null;
                    botmem.labBtype = null;
                    botmem.labAmount = 0;
                    delete botmem.labWaitSince;
                    log('AutoLab', `${this.name}已自动关闭lab合成任务(达到限额): ${labProduct}`)
                }
            }

            if (!(botmem.labAtype && botmem.labBtype)) {
                return;
            }

            const continueInputMin = Number((AUTO_LAB_CONFIG as any).continueInputMin ?? AUTO_LAB_CONFIG.continueLabStoreMin ?? 5);
            const storageOk = getAvail(botmem.labAtype as ResourceConstant) >= continueInputMin
                && getAvail(botmem.labBtype as ResourceConstant) >= continueInputMin;
            const labStoreOk = labA.mineralType === botmem.labAtype &&
                labB.mineralType === botmem.labBtype &&
                (labA.store[botmem.labAtype] || 0) >= continueInputMin &&
                (labB.store[botmem.labBtype] || 0) >= continueInputMin;

            if (storageOk || labStoreOk) {
                delete botmem.labWaitSince;
                return;
            }

            const since = botmem.labWaitSince ?? Game.time;
            botmem.labWaitSince = since;
            if (Game.time - since < AUTO_LAB_CONFIG.waitTimeoutTicks) return;

            botmem.labAtype = null;
            botmem.labBtype = null;
            botmem.labAmount = 0;
            delete botmem.labWaitSince;
            log('AutoLab', `${this.name}已自动关闭lab合成任务: ${labProduct}`)
        }

        // 获取新任务
        let [task, taskAmount] = getCustomizeTask(this, getAvail);
        if (!task) [task, taskAmount] = getT1Task(this);
        if (!task) [task, taskAmount] = getT2Task(this);
        if (!task) [task, taskAmount] = getT3Task(this);
        if (!task) return;
        if (taskAmount === undefined || taskAmount === null) taskAmount = 0;

        botmem.labAtype = LabMap[task]['raw1'];
        botmem.labBtype = LabMap[task]['raw2'];
        botmem.labAmount = taskAmount;

        log('AutoLab', `${this.name}已自动分配lab合成任务: ${botmem.labAtype}/${botmem.labBtype} -> ${REACTIONS[botmem.labAtype][botmem.labBtype]}, 限额: ${taskAmount || '无'}`)
        return OK;
    }
}

const getCustomizeTask = (room: Room, getAvail: (res: ResourceConstant) => number) => {
    const autoLabMap = getAutoLabData(room.name);
    if (!Object.keys(autoLabMap).length) return [null, 0];

    const getInputMin = (product: string) => {
        if (!RESOURCE_PRODUCTION.enabled) return AUTO_LAB_CONFIG.customTaskInputMin;
        if ((t3 as any).includes(product)) return RESOURCE_PRODUCTION.lab.chain.inputMin.t3;
        if ((t2 as any).includes(product)) return RESOURCE_PRODUCTION.lab.chain.inputMin.t2;
        return RESOURCE_PRODUCTION.lab.chain.inputMin.t1;
    };

    // 查找未到达限额且原料足够的任务, 按优先级选择
    let task = null;
    let lv = Infinity; // 优先级
    for (const res in autoLabMap) {
        if (!LabMap[res] || LabLevel[res] === undefined) continue;
        const level = LabLevel[res];
        if (lv <= level) continue;
        const limit = autoLabMap[res];
        const raw1 = LabMap[res]['raw1'] as ResourceConstant;
        const raw2 = LabMap[res]['raw2'] as ResourceConstant;
        if (limit > 0) {
            const cur = getAvail(res as any);
            if (cur >= limit * AUTO_LAB_CONFIG.customTaskDoneRatio) continue;
        }
        const inputMin = getInputMin(res);
        if (getAvail(raw1) < inputMin || getAvail(raw2) < inputMin) continue;
        const possible = Math.floor(Math.min(getAvail(raw1), getAvail(raw2)) / 5) * 5;
        if (possible <= PRODUCTION_MIN.compound) continue;
        task = res;
        lv = level;
    }

    let taskAmount = task ? autoLabMap[task] : 0;

    return [task, taskAmount]
}

const getT1Task = (room: Room) => {
    if (Game.time % AUTO_LAB_CONFIG.fallbackCheckInterval) return [ null, 0 ];

    const r = (res: string) => room.getResAmount(res);

    const threshold = AUTO_LAB_CONFIG.fallbackPrimaryThreshold;
    const sideThreshold = AUTO_LAB_CONFIG.fallbackSecondaryThreshold;
    const singleThreshold = AUTO_LAB_CONFIG.fallbackSingleReagentThreshold;
    const batch = AUTO_LAB_CONFIG.fallbackBatchAmount;
    const H = r(RESOURCE_HYDROGEN);
    const O = r(RESOURCE_OXYGEN);

    if ((H >= threshold && O >= sideThreshold) || (O >= threshold && H >= sideThreshold)) {
        return [ 'OH', r('OH') + batch ];
    }
    if (r('U') >= threshold && H >= sideThreshold) {
        return [ 'UH', r('UH') + batch ];
    }
    if (r('K') >= threshold && O >= sideThreshold) {
        return [ 'KO', r('KO') + batch ];
    }
    
    if (r('L') >= threshold) {
        const LO = r('LO'), LH = r('LH');
        if (O >= sideThreshold && H >= sideThreshold) {
            if (LO <= LH) return [ 'LO', LO + batch ];
            if (LH <= LO) return [ 'LH', LH + batch ];
        } else {
            if (O >= singleThreshold) return [ 'LO', LO + batch ];
            if (H >= singleThreshold) return [ 'LH', LH + batch ];
        }
    }
    if (r('Z') >= threshold) {
        const ZO = r('ZO'), ZH = r('ZH');
        if (O >= sideThreshold && H >= sideThreshold) {
            if (ZO <= ZH) return [ 'ZO', ZO + batch ];
            if (ZH <= ZO) return [ 'ZH', ZH + batch ];
        } else {
            if (O >= singleThreshold) return [ 'ZO', ZO + batch ];
            if (H >= singleThreshold) return [ 'ZH', ZH + batch ];
        }
    }

    if (r('ZK') >= sideThreshold && r('UL') >= sideThreshold) {
        return [ 'G', r('G') + batch ];
    }

    return [ null, 0 ];
}

const getT2Task = (room: Room) => {
    if (Game.time % AUTO_LAB_CONFIG.fallbackCheckInterval) return [ null, 0 ];

    const r = (res: string) => room.getResAmount(res);
    const batch = AUTO_LAB_CONFIG.fallbackBatchAmount;
    const minOH = AUTO_LAB_CONFIG.fallbackSecondaryThreshold;
    const diffFloor = AUTO_LAB_CONFIG.fallbackDiffFloor;
    if (r('OH') < minOH) return [ null, 0 ];
    const check = (res1: string, res2: string) => r(res1) > Math.max(r(res2), diffFloor);
    if (check('GH', 'GH2O')) return [ 'GH2O', r('GH2O') + batch ];
    if (check('GO', 'GHO2')) return [ 'GHO2', r('GHO2') + batch ];
    if (check('LH', 'LH2O')) return [ 'LH2O', r('LH2O') + batch ];
    if (check('LO', 'LHO2')) return [ 'LHO2', r('LHO2') + batch ];
    if (check('ZH', 'ZH2O')) return [ 'ZH2O', r('ZH2O') + batch ];
    if (check('ZO', 'ZHO2')) return [ 'ZHO2', r('ZHO2') + batch ];
    if (check('UH', 'UH2O')) return [ 'UH2O', r('UH2O') + batch ];
    if (check('KO', 'KHO2')) return [ 'KHO2', r('KHO2') + batch ];
    return [ null, 0 ];
}

const getT3Task = (room: Room) => {
    if (Game.time % AUTO_LAB_CONFIG.fallbackCheckInterval) return [ null, 0 ];

    const r = (res: string) => room.getResAmount(res);
    const batch = AUTO_LAB_CONFIG.fallbackBatchAmount;
    const minCatalyst = AUTO_LAB_CONFIG.fallbackSecondaryThreshold;
    const diffFloor = AUTO_LAB_CONFIG.fallbackDiffFloor;
    if (r('X') < minCatalyst) return [ null, 0 ];
    const check = (res1: string, res2: string) => r(res1) > Math.max(r(res2), diffFloor);
    if (check('GH2O', 'XGH2O')) return [ 'XGH2O', r('XGH2O') + batch ];
    if (check('GHO2', 'XGHO2')) return [ 'XGHO2', r('XGHO2') + batch ];
    if (check('LH2O', 'XLH2O')) return [ 'XLH2O', r('XLH2O') + batch ];
    if (check('LHO2', 'XLHO2')) return [ 'XLHO2', r('XLHO2') + batch ];
    if (check('ZH2O', 'XZH2O')) return [ 'XZH2O', r('XZH2O') + batch ];
    if (check('ZHO2', 'XZHO2')) return [ 'XZHO2', r('XZHO2') + batch ];
    if (check('UH2O', 'XUH2O')) return [ 'XUH2O', r('XUH2O') + batch ];
    if (check('KHO2', 'XKHO2')) return [ 'XKHO2', r('XKHO2') + batch ];
    return [ null, 0 ];
}
