export default class PowerCreepExecute extends PowerCreep {
    exec() {
        if(!this.room) return;

        // 生产型
        if (OPERATE(this)) return;
        
    }
}

function OPERATE(pc: PowerCreep) {
    // 续命
    if(pc.ToRenew()) return;

    const name = pc.name;
    // 移动到指定位置
    const flag = Game.flags[`${name}-move`];
    if (flag && !pc.pos.inRangeTo(flag, 0)) {
        pc.Generate_OPS();
        pc.moveTo(Game.flags[`${name}-move`], {visualizePathStyle: {stroke: '#ff0000'}, plainCost: 1, swampCost: 1});
        return;
    }

    // 移动到工作房间
    const flagHome = Game.flags[`${pc.name}-home`];
    if (flagHome && (pc.room.name != flagHome.pos.roomName || pc.pos.isRoomEdge())) {
        pc.moveTo(flagHome, {plainCost: 1, swampCost: 1});
        return true;
    }

    // 房间开启power
    if(pc.PowerEnabled()) return true;
    // 生成ops
    if(pc.Generate_OPS())  return true;
    if (pc.room.my) {
        if(pc.transferOPS())  return true;
        if(pc.withdrawOPS())  return true;
    }
    const PowerIDs = [
        PWR_REGEN_SOURCE, PWR_REGEN_MINERAL, PWR_OPERATE_SPAWN, PWR_OPERATE_EXTENSION, PWR_OPERATE_STORAGE,
        PWR_OPERATE_TOWER, PWR_OPERATE_FACTORY, PWR_OPERATE_LAB, PWR_OPERATE_POWER
    ];
    for (const powerID of PowerIDs) {
        const power = pc.powers[powerID];
        if (!power || power.cooldown) continue;
        if (powerID === PWR_REGEN_SOURCE) {
            if (pc.Regen_Source()) return true;
        } else if (powerID === PWR_REGEN_MINERAL) {
            if (pc.Regen_Mineral()) return true;
        } else if (powerID === PWR_OPERATE_SPAWN) {
            if (pc.Operate_Spawn()) return true;
        } else if (powerID === PWR_OPERATE_EXTENSION) {
            if (pc.Operate_Extension()) return true;
        } else if (powerID === PWR_OPERATE_STORAGE) {
            if (pc.Operate_Storage()) return true;
        } else if (powerID === PWR_OPERATE_TOWER) {
            if (pc.Operate_Tower()) return true;
        } else if (powerID === PWR_OPERATE_FACTORY) {
            if (pc.Operate_Factory()) return true;
        } else if (powerID === PWR_OPERATE_LAB) {
            if (pc.Operate_Lab()) return true;
        } else if (powerID === PWR_OPERATE_POWER) {
            if (pc.Operate_Power()) return true;
        }
    }

    // 移动到待机位置
    const idleFlag = Game.flags[`${name}-idle`] || flagHome;
    if (idleFlag && !pc.pos.isEqual(idleFlag.pos) &&
        pc.room.name == idleFlag.pos.roomName) {
        pc.moveTo(idleFlag, { plainCost: 1, swampCost: 1});
    }
}

