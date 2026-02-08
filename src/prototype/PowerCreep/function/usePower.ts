import { getLabAB, ensureBoostLabs } from '@/modules/utils/labReservations';
import { getStructData } from '@/modules/utils/memory';

export default class PowerCreepUsePower extends PowerCreep {
    Generate_OPS() {
        const powers = this.powers;
        if(!powers[PWR_GENERATE_OPS]) return false;
        if(powers[PWR_GENERATE_OPS].cooldown > 0) return false;
        this.usePower(PWR_GENERATE_OPS);
        return true;
    }
    Regen_Source() {
        if (this.room.memory.defend) return false;
        const sources = this.room.source || [];
        const source = sources.find(s => !s.effects || !s.effects.some(e => e.effect == PWR_REGEN_SOURCE && e.ticksRemaining));
        if(!source) return false;
        let result = this.usePower(PWR_REGEN_SOURCE, source);
        if (result == ERR_NOT_IN_RANGE) {
            this.moveTo(source, {plainCost: 1, swampCost: 1});
        } return true;
    }
    Regen_Mineral() {
        if (this.room.memory.defend) return false;
        const mineral = this.room.mineral;
        if (!mineral) return false;
        if (mineral.mineralAmount == 0) return false;
        if (mineral.effects?.some(e => e.effect == PWR_REGEN_MINERAL && e.ticksRemaining)) return false;
        let result = this.usePower(PWR_REGEN_MINERAL, mineral);
        if (result == ERR_NOT_IN_RANGE) {
            this.moveTo(mineral, {plainCost: 1, swampCost: 1});
        } return true;
    }
    Operate_Spawn() {
        if(!this.room.spawn) return false;
        if(this.store[RESOURCE_OPS] < 100) return false;
        if (this.room.my) {
            const roles = [
                'power-attack', 'power-heal', 'power-carry', 'power-defend',
                'deposit-harvest', 'deposit-transfer',
                'team-attack', 'team-dismantle', 'team-ranged', 'team-heal',
            ]
            if (!Game.flags[this.name+'-upspawn'] && !this.room.memory.defend &&
                (!this.room.checkMissionInPool('mine') ||
                this.room.getSpawnMissionTotalByRoles(roles) < 1)) return false;
        }
        const spawns = this.room.spawn;
        if(!spawns) return false;
        const spawn = spawns.find(s => !s.effects || 
            !s.effects.some(e => e.effect == PWR_OPERATE_SPAWN && e.ticksRemaining > 0));
        if(!spawn) return false;
        if(this.pos.inRangeTo(spawn, 3)) {
            this.usePower(PWR_OPERATE_SPAWN, spawn);
        } else {
            this.moveTo(spawn);
        }
        return true;
    }
    Operate_Extension() {        
        if(!this.room.storage && !this.room.terminal) return false;
        if(this.store[RESOURCE_OPS] < 2) return false;
        if(this.room.energyAvailable > this.room.energyCapacityAvailable / 2) return false;
        let target = this.room.storage as any;
        if (!target || target.store.energy < 10000) {
            target = this.room.terminal;
        }
        if (!target || target.store.energy < 10000) return false;

        if (this.pos.inRangeTo(target, 3)) {
            this.usePower(PWR_OPERATE_EXTENSION, target);
        } else {
            this.moveTo(target);
        }
        return true;
    }
    Operate_Storage() {
        const storage = this.room.storage;
        if(!storage) return false;
        if(this.store[RESOURCE_OPS] < 100) return false;
        if(storage.store.getFreeCapacity() > 5000) return false;
        if(storage.effects && storage.effects.some(e => 
            e.effect == PWR_OPERATE_STORAGE && e.ticksRemaining > 0)
        ) return false;
        if (this.pos.inRangeTo(storage, 3)) {
            this.usePower(PWR_OPERATE_STORAGE, storage);
        } else {
            this.moveTo(storage);
        }
        return true;
    }
    Operate_Tower() {
        if(!this.room.memory.defend) return false;
        if(this.store[RESOURCE_OPS] < 10) return false;

        const towers = this.room.tower;
        if(!towers) return false;
        const tower = towers.find(t => !t.effects ||
            !t.effects.some(e => e.effect == PWR_OPERATE_TOWER && e.ticksRemaining > 0)
        );
        if(!tower) return false;
    
        if(this.pos.inRangeTo(tower, 3)) {
            this.usePower(PWR_OPERATE_TOWER, tower);
        } else {
            this.moveTo(tower);
        }
        return true;
    }
    Operate_Factory() {
        // 没有factory时不处理
        const factory = this.room.factory;
        if(!factory) return false;
        // ops不足时不处理
        if(this.store[RESOURCE_OPS] < 100) return false;
        // 已有效果未结束时不处理
        if(factory.effects && factory.effects.some(e => e.effect == PWR_OPERATE_FACTORY && e.ticksRemaining > 0)) return false;

        // 为什么：当 factory 没有等级时，先用一次技能固定等级，避免资源管理分配任务时无法正确判断房间的 factory 等级。
        if (!factory.level) {
            if (this.pos.inRangeTo(factory, 3)) {
                this.usePower(PWR_OPERATE_FACTORY, factory);
            } else {
                this.moveTo(factory);
            }
            return true;
        }

        // 没有任务时不处理
        const memory = getStructData(this.room.name);
        if(!memory || !memory.factoryProduct) return false;

        // factory等级不匹配时不处理（不再依赖 memory.factoryLevel）
        if(COMMODITIES[memory.factoryProduct].level != factory.level) return false;
        // 资源不充足时不处理
        const components = COMMODITIES[memory.factoryProduct]?.components;
        for(const resource in components) {
            if(factory.store[resource] < components[resource]) return false;
        }
        if(factory.level && factory.level !== this.powers[PWR_OPERATE_FACTORY].level) return false;

        if (this.pos.inRangeTo(factory, 3)) {
            this.usePower(PWR_OPERATE_FACTORY, factory);
        } else {
            this.moveTo(factory);
        }
        
        return true;
    }
    Operate_Lab() {
        if(!this.room.lab) return false;
        if(this.store[RESOURCE_OPS] < 10) return false;

        const botmem = getStructData(this.room.name);
        if (!botmem || !botmem.lab) return;
        const { labA, labB, labAId, labBId } = getLabAB(this.room.name, this.room);
        if (!labA || !labB || !labAId || !labBId) return;
        const labAtype = botmem.labAtype;
        const labBtype = botmem.labBtype;
        if (!labAtype || !labBtype ||
            labA.store[labAtype] < 1000 ||
            labB.store[labBtype] < 1000) {
            return;
        }
        
        const product = REACTIONS[labAtype][labBtype];

        if (!labAtype || !labBtype) return;
        const lab = this.room.lab.find(l => {
            if(l.id === labAId || l.id === labBId) return false;
            if(botmem.boostLabs?.[l.id]) return false;
            if(l.mineralType != product) return false;
            return !l.effects || l.effects.every(e => e.effect != PWR_OPERATE_LAB)
        });
        if(!lab) return false;
        if (this.pos.inRangeTo(lab, 3)) {
            this.usePower(PWR_OPERATE_LAB, lab);
        } else {
            this.moveTo(lab);
        }
        return true;
    }
    Operate_Power() {
        const powerSpawn = this.room.powerSpawn;
        if(!powerSpawn) return false;
        const mem = getStructData(this.room.name);
        if(!mem || !mem.powerSpawn) return false;
        if(this.store[RESOURCE_OPS] < 200) return false;
        if(this.room.storage.store[RESOURCE_POWER] < 5000) return false;
        if(powerSpawn.effects && powerSpawn.effects.some(e => e.effect == PWR_OPERATE_POWER && e.ticksRemaining > 0)) return false;

        if (this.pos.inRangeTo(powerSpawn, 3)) {
            this.usePower(PWR_OPERATE_POWER, powerSpawn);
        } else {
            this.moveTo(powerSpawn);
        }
        return true;
    }
    
    Shield(pos: RoomPosition) {
        const powers = this.powers;
        if(PWR_SHIELD in powers && powers[PWR_SHIELD].cooldown <= 0) {
            if(this.pos.inRangeTo(pos, 0)) {
                this.usePower(PWR_SHIELD);
            } else {
                this.moveTo(pos);
            }
            return true;
        }
        return false;
    }

    Disrupt_Tower() {
        const power = this.powers[PWR_DISRUPT_TOWER];
        if (!power || power.cooldown > 0) return false;
        if (this.store[RESOURCE_OPS] < 10) return false;

        const targets = this.room.find(FIND_STRUCTURES, {
            filter: (s: AnyStructure) => {
                if (s.structureType !== STRUCTURE_TOWER) return false;
                if ((s as any).my) return false;
                const effects = (s as any).effects as PowerEffect[] | undefined;
                if (!effects) return true;
                return !effects.some(e => e.effect === PWR_DISRUPT_TOWER && e.ticksRemaining > 0);
            }
        }) as StructureTower[];

        if (targets.length <= 0) return false;
        const target = this.pos.findClosestByRange(targets);
        if (!target) return false;

        const result = this.usePower(PWR_DISRUPT_TOWER, target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, { plainCost: 1, swampCost: 1 });
        }
        return result === OK || result === ERR_NOT_IN_RANGE;
    }

    Disrupt_Spawn() {
        const power = this.powers[PWR_DISRUPT_SPAWN];
        if (!power || power.cooldown > 0) return false;
        if (this.store[RESOURCE_OPS] < 10) return false;

        const targets = this.room.find(FIND_HOSTILE_STRUCTURES, {
            filter: (s: AnyStructure) => {
                if (s.structureType !== STRUCTURE_SPAWN) return false;
                const effects = (s as any).effects as PowerEffect[] | undefined;
                if (!effects) return true;
                return !effects.some(e => e.effect === PWR_DISRUPT_SPAWN && e.ticksRemaining > 0);
            }
        }) as StructureSpawn[];

        if (targets.length <= 0) return false;
        const target = this.pos.findClosestByRange(targets);
        if (!target) return false;

        const result = this.usePower(PWR_DISRUPT_SPAWN, target);
        if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target, { plainCost: 1, swampCost: 1 });
        }
        return result === OK || result === ERR_NOT_IN_RANGE;
    }
}
