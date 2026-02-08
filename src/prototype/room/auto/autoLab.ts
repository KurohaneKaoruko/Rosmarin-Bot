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

            const storageOk = getAvail(botmem.labAtype as ResourceConstant) >= 5
                && getAvail(botmem.labBtype as ResourceConstant) >= 5;
            const labStoreOk = labA.mineralType === botmem.labAtype &&
                labB.mineralType === botmem.labBtype &&
                (labA.store[botmem.labAtype] || 0) >= AUTO_LAB_CONFIG.continueLabStoreMin &&
                (labB.store[botmem.labBtype] || 0) >= AUTO_LAB_CONFIG.continueLabStoreMin;

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
            if (cur >= limit * 0.9) continue;
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
    if (Game.time % 100) return [ null, 0 ];

    const r = (res: string) => room.getResAmount(res);

    let threshold = 10e3;
    const H = r(RESOURCE_HYDROGEN);
    const O = r(RESOURCE_OXYGEN);

    if ((H >= threshold && O >= 5000) || (O >= threshold && H >= 5000)) {
        return [ 'OH', r('OH') + 10e3 ];
    }
    if (r('U') >= threshold && H >= 5000) {
        return [ 'UH', r('UH') + 10e3 ];
    }
    if (r('K') >= threshold && O >= 5000) {
        return [ 'KO', r('KO') + 10e3 ];
    }
    
    if (r('L') >= threshold) {
        const LO = r('LO'), LH = r('LH');
        if (O >= 5000 && H >= 5000) {
            if (LO <= LH) return [ 'LO', LO + 10e3 ];
            if (LH <= LO) return [ 'LH', LH + 10e3 ];
        } else {
            if (O >= 10000) return [ 'LO', LO + 10e3 ];
            if (H >= 10000) return [ 'LH', LH + 10e3 ];
        }
    }
    if (r('Z') >= threshold) {
        const ZO = r('ZO'), ZH = r('ZH');
        if (O >= 5000 && H >= 5000) {
            if (ZO <= ZH) return [ 'ZO', ZO + 10e3 ];
            if (ZH <= ZO) return [ 'ZH', ZH + 10e3 ];
        } else {
            if (O >= 10000) return [ 'ZO', ZO + 10e3 ];
            if (H >= 10000) return [ 'ZH', ZH + 10e3 ];
        }
    }

    if (r('ZK') >= 5000 && r('UL') >= 5000) {
        return [ 'G', r('G') + 10e3 ];
    }

    return [ null, 0 ];
}

const getT2Task = (room: Room) => {
    if (Game.time % 100) return [ null, 0 ];

    const r = (res: string) => room.getResAmount(res);
    if (r('OH') < 5000) return [ null, 0 ];
    const check = (res1: string, res2: string) => r(res1) > Math.max(r(res2), 20e3);
    if (check('GH', 'GH2O')) return [ 'GH2O', r('GH2O') + 10e3 ];
    if (check('GO', 'GHO2')) return [ 'GHO2', r('GHO2') + 10e3 ];
    if (check('LH', 'LH2O')) return [ 'LH2O', r('LH2O') + 10e3 ];
    if (check('LO', 'LHO2')) return [ 'LHO2', r('LHO2') + 10e3 ];
    if (check('ZH', 'ZH2O')) return [ 'ZH2O', r('ZH2O') + 10e3 ];
    if (check('ZO', 'ZHO2')) return [ 'ZHO2', r('ZHO2') + 10e3 ];
    if (check('UH', 'UH2O')) return [ 'UH2O', r('UH2O') + 10e3 ];
    if (check('KO', 'KHO2')) return [ 'KHO2', r('KHO2') + 10e3 ];
    return [ null, 0 ];
}

const getT3Task = (room: Room) => {
    if (Game.time % 100) return [ null, 0 ];

    const r = (res: string) => room.getResAmount(res);
    if (r('X') <5000) return [ null, 0 ];
    const check = (res1: string, res2: string) => r(res1) > Math.max(r(res2), 20e3);
    if (check('GH2O', 'XGH2O')) return [ 'XGH2O', r('XGH2O') + 10e3 ];
    if (check('GHO2', 'XGHO2')) return [ 'XGHO2', r('XGHO2') + 10e3 ];
    if (check('LH2O', 'XLH2O')) return [ 'XLH2O', r('XLH2O') + 10e3 ];
    if (check('LHO2', 'XLHO2')) return [ 'XLHO2', r('XLHO2') + 10e3 ];
    if (check('ZH2O', 'XZH2O')) return [ 'XZH2O', r('XZH2O') + 10e3 ];
    if (check('ZHO2', 'XZHO2')) return [ 'XZHO2', r('XZHO2') + 10e3 ];
    if (check('UH2O', 'XUH2O')) return [ 'XUH2O', r('XUH2O') + 10e3 ];
    if (check('KHO2', 'XKHO2')) return [ 'XKHO2', r('XKHO2') + 10e3 ];
    return [ null, 0 ];
}
