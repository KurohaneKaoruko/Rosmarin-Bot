let autoAttack = (creep) => {
    const name = creep.name.match(/_(\w+)/)?.[1] ?? creep.name;
    let flag = Game.flags[`aio-${name}`];

    let em = Game.getObjectById(creep.memory.targetId) as Creep | Structure;
    let isHostileCreep = false;
    let isHostileConstruction = false;
    // 找旗帜标记的目标
    if (!em) em = flag && flag.room && flag.pos.lookFor(LOOK_STRUCTURES).find((e: any) => !e.my);
    // 找最近的敌方建筑
    if (!em) em = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, { range: 3, filter: e => e.hits && e.structureType != STRUCTURE_WALL && e.structureType != STRUCTURE_ROAD && !e.pos.coverRampart() });
    // 找最近的敌方单位, 排除ranged
    if (!em) {
        em = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS, { filter: e => e.body.length > 2 && !e.body.some(e => e.type == RANGED_ATTACK) && !e.pos.coverRampart() && !e.isWhiteList() });
        if (em) isHostileCreep = true;
    }
    // 找最近的敌方单位, 排除tough
    if (!em) {
        em = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS, { filter: e => e.body.length > 2 && !e.body.some(e => e.type == TOUGH && e.boost) && !e.pos.coverRampart() && !e.isWhiteList() });//
        if (em) isHostileCreep = true;
    }
    // 找powerCreep
    if (!em) em = creep.pos.findClosestByPath(FIND_HOSTILE_POWER_CREEPS, { filter: e => !e.pos.coverRampart() && !e.isWhiteList() });
    // 找最近的敌方建筑工地
    if (!em) {
        em = creep.pos.findClosestByPath(FIND_HOSTILE_CONSTRUCTION_SITES, { filter: e => e.progress && !e.pos.coverRampart() });
    }
    // 找最近的敌方建筑
    if (!em) em = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, { filter: e => e.structureType == STRUCTURE_SPAWN });
    if (!em) em = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, { filter: e => e.hits && e.structureType != STRUCTURE_RAMPART });//&&e.structureType!=STRUCTURE_SPAWN
    if (!em && creep.room.controller && creep.room.controller.owner && !creep.room.my) {
        em = creep.pos.findClosestByPath(FIND_STRUCTURES, { filter: e => e.hits && e.structureType != STRUCTURE_ROAD });
    }//&&e.structureType!=STRUCTURE_SPAWN
    if (!em) em = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, { filter: e => e.structureType != STRUCTURE_INVADER_CORE && e.structureType != STRUCTURE_CONTROLLER && e.structureType != STRUCTURE_ROAD });
    if (!em) {
        em = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS, { filter: e => !e.pos.coverRampart() && !e.isWhiteList() && e.body.some(e => e.type == ATTACK || e.type == RANGED_ATTACK) });
        if (em) isHostileCreep = true;
    }
    if (!em) em = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3, { filter: e => !e.pos.coverRampart() && !e.isWhiteList() })[0]
    if (!em) em = creep.pos.findInRange(FIND_HOSTILE_STRUCTURES, 3, {filter: e => e.hits && !e.pos.coverRampart() && e.structureType != STRUCTURE_ROAD })[0];

    if (em) creep.room.visual.text('_', em.pos.x, em.pos.y + 0.35, { color: 'red', opacity: 0.75, font: 1 });
    if (em && (em as any).structureType) isHostileConstruction = true

    // 行动
    if (isHostileConstruction) {
        creep.moveTo(em)
        if (creep.pos.isNearTo(em) && (em.pos.coverRampart() || (em as any).owner)) {
            let em1 = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3, { filter: e => !e.pos.coverRampart() && !creep.pos.isNearTo(e) && !e.isWhiteList() })[0];// 找附近的爬
            // if(!em1) em1 = this.pos.findInRange(FIND_STRUCTURES,3,{filter:e=>e.hits<=25000&&!e.owner&&!e.pos.coverRampart()})[0];// 没事就找建筑打
            if (em1) creep.rangedAttack(em1)
            else creep.rangedMassAttack()
        } else if (creep.rangedAttack(em) == ERR_NOT_IN_RANGE) {//||!inner(creep.pos)
            // creep.rangedMassAttack()
            if (creep.room.controller && creep.room.controller.owner && !creep.room.my) {
                em = creep.pos.findClosestByRange(FIND_STRUCTURES, { filter: e => e.hits && e.structureType != STRUCTURE_ROAD })
                creep.rangedAttack(em)
            }
        }
        let em1 = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3, { filter: e => !e.pos.coverRampart() && !creep.pos.isNearTo(e) && !e.isWhiteList() })[0];// 找附近的爬
        if (em1) creep.rangedAttack(em1)
    } else if (isHostileCreep) {
        creep.moveTo(em);
        if (creep.pos.isNearTo(em) && em && (em as any).body) { creep.rangedMassAttack() }
        else if (creep.rangedAttack(em) == ERR_NOT_IN_RANGE) {//||!inner(creep.pos)
            // creep.rangedMassAttack()
            if (creep.room.controller && creep.room.controller.owner && !creep.room.my) {
                em = creep.pos.findClosestByRange(FIND_STRUCTURES, { filter: e => e.hits && e.structureType != STRUCTURE_ROAD })
                creep.rangedAttack(em)
            }
            else if (creep.pos.isNearTo(em) && (em as any).structureType != STRUCTURE_WALL && (em as any).structureType != STRUCTURE_ROAD && (em as any).structureType != STRUCTURE_CONTAINER) {
                creep.rangedMassAttack()
            }
        }
        // if(this.pos.inRangeTo(em,2)){
        //     em.range = 4
        //     let path = PathFinder.search(this.pos,em,{flee:true}).path;
        //     let code = this.moveByPath(path)
        //     // log(code,PathFinder.search(this.pos,em,{flee:true}))
        // }
    } else if (em) {
        if (creep.pos.isNearTo(em)) {
            creep.rangedMassAttack()
        } else if (creep.pos.inRangeTo(em, 3)) {
            creep.rangedAttack(em)
        }
        if (!creep.pos.inRangeTo(em, 1)) {
            creep.moveTo(em)
        }
    }

    if (creep.hits + 1300 < creep.hitsMax) {
        let exit = creep.pos.findClosestByPath(FIND_EXIT);
        if (exit) creep.moveTo(exit);
    }
}

const aio = {
    run: function (creep: Creep) {
        if (!creep.memory.notified) {
            creep.notifyWhenAttacked(false);
            creep.memory.notified = true;
        }

        if (!creep.memory.boosted) {
            if (creep.memory['boostmap']) {
                let result = creep.Boost(creep.memory['boostmap'])
                if (result == OK) {
                    creep.memory.boosted = true
                }
            } else {
                const boost = ['XGHO2', 'XLHO2', 'XKHO2', 'XZHO2'];
                creep.memory.boosted = creep.goBoost(boost);
            }
            return;
        }

        creep.heal(creep);

        // 躲避
        let attackHostile = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3).find(e => e.body.some(t => t.boost == "XUH2O") && !e.isWhiteList());
        if (attackHostile) {
            if (creep.room.level > 0 && !creep.room.my && creep.room.tower) {
                let exit = creep.pos.findClosestByPath(FIND_EXIT);
                creep.moveTo(exit);
                creep.rangedMassAttack();
            } else {
                let em = attackHostile;
                if (creep.pos.inRangeTo(em, 2)) {
                    let range = creep.pos.getRangeTo(em) + 1;
                    let path = PathFinder.search(creep.pos, { pos: em.pos, range }, { flee: true }).path;
                    creep.moveByPath(path);
                    creep.rangedAttack(em);

                    let exit = creep.pos.findClosestByPath(FIND_EXIT);
                    if (exit && creep.pos.isNear(exit) && creep.pos.isNearTo(em)) {
                        creep.moveTo(exit);
                    }
                }
            }
            return;
        }

        

        const name = creep.name.match(/_(\w+)/)?.[1] ?? creep.name;
        const moveflag = Game.flags[name + '-move'];
        if (moveflag) {
            if (creep.room.name !== moveflag.pos.roomName) {
                creep.memory.targetRoom = moveflag.pos.roomName;
            }
            creep.moveTo(moveflag.pos, { visualizePathStyle: { stroke: '#0000ff' } })
            return;
        }

        let rangedAttack = (c) => {
            let creeps = c.pos.findInRange(FIND_HOSTILE_CREEPS, 1, { filter: e => !e.isWhiteList() });
            if (creeps.length) {
                return c.rangedMassAttack();
            }
            creeps = c.pos.findInRange(FIND_HOSTILE_CREEPS, 3, { filter: e => !e.isWhiteList() });
            if (creeps.length) {
                c.rangedAttack(creeps.reduce((a, b) => a.hits < b.hits ? a : b));
            }
        }


        if (creep.room.name != creep.memory.targetRoom) {
            let inner = (pos) => pos.x > 2 && pos.x < 47 && pos.y > 2 && pos.y < 47;
            if ((creep.hitsMax-creep.hits) > 1300 && !inner(creep.pos) && !creep.room.tower.find(e => !e.my)) {
                rangedAttack(creep);
                creep.moveTo(new RoomPosition(25, 25, creep.room.name));
            } else if ((creep.hitsMax-creep.hits) <= 1300) {
                rangedAttack(creep);
                let tarPos = Game.flags[`aio-${name}`]?.pos;
                if (tarPos) {
                    creep.moveTo(tarPos);
                } else {
                    creep.moveToRoom(creep.memory.targetRoom);
                }
            } else {
                autoAttack(creep);
            }
        } else {
            if(creep.hits + 1300 >= creep.hitsMax){
                autoAttack(creep);
            }else{
                rangedAttack(creep);
                creep.moveTo(new RoomPosition(25,25,creep.room.name));
            }
        }
    }
}

export default aio