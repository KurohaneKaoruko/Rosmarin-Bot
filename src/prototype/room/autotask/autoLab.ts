import { LabMap, LabLevel } from '@/constant/ResourceConstant'

export default class AutoLab extends Room {
    autoLab() {
        if (Game.time % 50) return;
        if (!this.lab || !this.lab.length) return;
        const botmem =  Memory['StructControlData'][this.name];

        // 关停时不处理
        if (!botmem || !botmem.lab) return;
        const labProduct = botmem.labAtype && botmem.labBtype ?
                        REACTIONS[botmem.labAtype][botmem.labBtype] : null;
        const amount = botmem.labAmount;    // 产物限额

        const labA = Game.getObjectById(botmem.labA) as StructureLab;
        const labB = Game.getObjectById(botmem.labB) as StructureLab;
        if (!labA || !labB) return;
        // 检查库存是否够合成
        const ResAmountCheck = (this.getResAmount(botmem.labAtype) >= 1000 &&
                                this.getResAmount(botmem.labBtype) >= 1000)
        // 检查当前填充的是否够合成
        const LabMineralCheck = labA && labB &&
                                labA.mineralType === botmem.labAtype &&
                                labB.mineralType === botmem.labBtype &&
                                labA.store[botmem.labAtype] >= 15 &&
                                labB.store[botmem.labBtype] >= 15;
        // 未超限额，原料充足，则不变更任务
        if (botmem.labAtype && botmem.labBtype && labProduct &&
            (amount <= 0 || this.getResAmount(labProduct) < amount) &&
            (ResAmountCheck || LabMineralCheck)
        ) return;

        // 关闭任务
        if (labProduct) {
            botmem.labAtype = null;
            botmem.labBtype = null;
            botmem.labAmount = 0;
            global.log(`[自动Lab合成] ${this.name}已自动关闭lab合成任务: ${labProduct}`)
        }

        // 获取新任务
        let [task, taskAmount] = getCustomizeTask(this);
        if (!task) [task, taskAmount] = getT1Task(this);
        if (!task) [task, taskAmount] = getT2Task(this);
        if (!task) [task, taskAmount] = getT3Task(this);
        if (!task || !taskAmount) return;

        botmem.labAtype = LabMap[task]['raw1'];
        botmem.labBtype = LabMap[task]['raw2'];
        botmem.labAmount = taskAmount;

        global.log(`[自动Lab合成] ${this.name}已自动分配lab合成任务: ${botmem.labAtype}/${botmem.labBtype} -> ${REACTIONS[botmem.labAtype][botmem.labBtype]}, 限额: ${taskAmount || '无'}`)
        return OK;
    }
}

const getCustomizeTask = (room: Room) => {
    const autoLabMap = Memory['AutoData']['AutoLabData'][room.name];
    if (!autoLabMap || !Object.keys(autoLabMap).length) return [null, 0];

    // 查找未到达限额且原料足够的任务, 按优先级选择
    let task = null;
    let lv = Infinity; // 优先级
    for (const res in autoLabMap) {
        const level = LabLevel[res];
        if (lv <= level) continue;
        if (autoLabMap[res] > 0 && room.getResAmount(res) >= autoLabMap[res] * 0.9) continue;
        if (room.getResAmount(LabMap[res]['raw1']) < 6000 ||
            room.getResAmount(LabMap[res]['raw2']) < 6000) continue;
        task = res;
        lv = level;
    }

    let taskAmount = task ? autoLabMap[task] : 0;

    return [task, taskAmount]
}

const getT1Task = (room: Room) => {
    if (Game.time % 100) return [ null, 0 ];

    const r = (res: string) => room.getResAmount(res);

    let threshold = 20e3;
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
        if (O >= 5000 && LO <= LH) return [ 'LO', LO + 10e3 ];
        if (H >= 5000 && LH <= LO) return [ 'LH', LH + 10e3 ];
    }
    if (r('Z') >= threshold) {
        const ZO = r('ZO'), ZH = r('ZH');
        if (O >= 5000 && ZO <= ZH) return [ 'ZO', ZO + 10e3 ];
        if (H >= 5000 && ZH <= ZO) return [ 'ZH', ZH + 10e3 ];
    }

    if (r('ZK') >= 5000 && r('UL') >= 5000) {
        return [ 'G', r('G') + 10e3 ];
    }

    return [ null, 0 ];
}

const getT2Task = (room: Room) => {
    if (Game.time % 100) return [ null, 0 ];

    const r = (res: string) => room.getResAmount(res);
    if (r('OH') < 9000) return [ null, 0 ];
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
    if (r('X') < 9000) return [ null, 0 ];
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