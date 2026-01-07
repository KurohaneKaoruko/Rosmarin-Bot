export default class BaseFunction extends PowerCreep {
    isWhiteList() {
        let whiteList = new Set<string>(Memory['whitelist'] || []);
        return whiteList.has(this.owner.username);
    }
    PowerEnabled(): boolean {
        const controller = this.room?.controller;
        if(!controller.isPowerEnabled) {
            if(this.pos.isNearTo(controller)) this.enableRoom(controller);
            else this.moveTo(controller)
            return true;
        }
        return false
    }
    transferOPS(): boolean {
        if (this.store.getFreeCapacity() === 0 && this.store[RESOURCE_OPS] > 200) {
            const halfOps = Math.floor(this.store[RESOURCE_OPS] / 2);
            const amount = Math.min(halfOps, this.store[RESOURCE_OPS] - 200);
            if (amount <= 0) return false;
            if (this.pos.isNearTo(this.room.storage)) {
                this.transfer(this.room.storage, RESOURCE_OPS, amount);
            } else {
                this.moveTo(this.room.storage);
            }
            return true;
        }
        if(this.ticksToLive < 50 && this.store[RESOURCE_OPS] > 0) {
            if (this.pos.isNearTo(this.room.storage)) {
                this.transfer(this.room.storage, RESOURCE_OPS);
            } else {
                this.moveTo(this.room.storage);
            }
        }
        return false;
    }
    withdrawOPS(amount: number = 200): boolean {
        if(this.store[RESOURCE_OPS] < amount && 
            (this.room.storage?.store[RESOURCE_OPS] > amount || this.room.terminal?.store[RESOURCE_OPS] > amount)) {
            const target = this.room.storage?.store[RESOURCE_OPS] > amount ? this.room.storage : this.room.terminal;
            if(this.pos.isNearTo(target)) {
                this.withdraw(target, RESOURCE_OPS, amount - this.store[RESOURCE_OPS]);
            } else {
                this.moveTo(target);
            }
            return true;
        }
        return false
    }
    ToRenew(): boolean {
        if(this.ticksToLive > 500) return false;
        if(this.room.controller?.my && this.room.powerSpawn) {
            const powerSpawn = this.room.powerSpawn;
            if(this.pos.isNearTo(powerSpawn)) {
                this.renew(powerSpawn);
            } else {
                this.moveTo(powerSpawn);
            }
            return true;
        }
        if(!(/^[EW]\d*[1-9][NS]\d*[1-9]$/.test(this.room.name))) {
            const powerBank = this.room.find(FIND_STRUCTURES, {filter: (s) => s.structureType === STRUCTURE_POWER_BANK})[0] as StructurePowerBank;
            if (powerBank) {
                if(this.pos.isNearTo(powerBank)) {
                    this.renew(powerBank);
                } else {
                    this.moveTo(powerBank);
                }
                return true;
            }
        }
        if (Game.flags[this.name + '-renew']) {
            const flag = Game.flags[this.name + '-renew'];
            if(this.pos.roomName !== flag.pos.roomName || this.pos.isRoomEdge()) {
                this.moveTo(flag);
            } else if(this.room.powerSpawn) {
                const powerSpawn = this.room.powerSpawn;
                if(this.pos.isNearTo(powerSpawn)) {
                    this.renew(powerSpawn);
                } else {
                    this.moveTo(powerSpawn);
                }
            }
            return true;
        }
        return false;
    }
    transferPower() {
        const mem = Memory['StructControlData'][this.room.name];
        if(!mem || !mem.powerSpawn) return false;

        const powerSpawn = this.room.powerSpawn;
        if (!powerSpawn) return;
        const storage = this.room.storage;
        if (!storage) return;
        if (storage.store[RESOURCE_POWER] < 100) return;
        if (storage.store[RESOURCE_ENERGY] < 10000) return;

        if (this.pos.isNearTo(powerSpawn)) {
            if (powerSpawn.store[RESOURCE_POWER] < 50 && this.store[RESOURCE_POWER] > 0) {
                this.transfer(powerSpawn, RESOURCE_POWER);
                return true;
            }
        }

        if (this.pos.isNearTo(storage)) {
            if (powerSpawn.store[RESOURCE_POWER] > 60 && this.store[RESOURCE_POWER] > 0) {
                this.transfer(storage, RESOURCE_POWER);
                return true;
            }
            if (powerSpawn.store[RESOURCE_POWER] < 50 && this.store[RESOURCE_POWER] == 0) {
                this.withdraw(storage, RESOURCE_POWER, 100);
                return true;
            }
        }

        if (powerSpawn.store[RESOURCE_POWER] < 50 && this.store[RESOURCE_POWER] > 0) {
            this.moveTo(powerSpawn);
            return true;
        }
        if (powerSpawn.store[RESOURCE_POWER] > 60 && this.store[RESOURCE_POWER] > 0 ||
            powerSpawn.store[RESOURCE_POWER] < 50 && this.store[RESOURCE_POWER] == 0) {
            this.moveTo(storage);
            return true;
        }
        
        return false;
    }
}