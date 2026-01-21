export default class BaseFunction extends RoomPosition {
    // 切比雪夫距离
    getDistance(pos: RoomPosition): number {
        const { x: x1, y: y1, roomName: roomName1} = this;
        const { x: x2, y: y2, roomName: roomName2 } = pos;
        if (roomName1 !== roomName2) return Infinity;
        return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
    }
    // 是否位置相同
    isEqual(pos: RoomPosition): boolean {
        const { x: x1, y: y1, roomName: roomName1 } = this;
        const { x: x2, y: y2, roomName: roomName2 } = pos;
        return x1 === x2 && y1 === y2 && roomName1 === roomName2;
    }
    // 是否相邻
    isNear(pos: RoomPosition): boolean {
        const { x: x1, y: y1, roomName: roomName1} = this;
        const { x: x2, y: y2, roomName: roomName2 } = pos;
        if (roomName1 !== roomName2) return false;
        return Math.abs(x1 - x2) <= 1 && Math.abs(y1 - y2) <= 1;
    }
    // 是否在指定距离内
    inRange(target: any, range: number): boolean {
        let pos = target.pos || target;
        if (!pos) return false;
        return this.getDistance(pos) <= range;
    }
    // 是否位于房间边界
    isRoomEdge(): boolean {
        const { x, y } = this;
        return x === 0 || x === 49 || y === 0 || y === 49;
    }

    // 该位置是否可通行, 无视野根据terrain判定
    walkable(withCreep = false, rampartOwnerUserName?: string): boolean {
        if (Game.rooms[this.roomName]) {
            const structure =
                this.lookFor(LOOK_STRUCTURES).every((struct: any) => {
                    return !(
                        struct.structureType !== STRUCTURE_CONTAINER &&
                        struct.structureType !== STRUCTURE_ROAD &&
                        (struct.structureType !== STRUCTURE_RAMPART ||
                            (rampartOwnerUserName ? rampartOwnerUserName != struct.owner.username : !struct.my) ||
                            struct.isPublic)
                    )
                }) &&
                !(
                    this.lookFor(LOOK_TERRAIN).find((o: any) => o === 'wall') &&
                    this.lookFor(LOOK_STRUCTURES).every((struct: any) => struct == STRUCTURE_ROAD)
                ) &&
                this.lookFor(LOOK_CONSTRUCTION_SITES).every(
                    (s: any) => !_.contains(OBSTACLE_OBJECT_TYPES, s.structureType) || !s.my,
                )
            if (withCreep) {
                const creep = this.lookFor(LOOK_CREEPS).length === 0
                return structure && creep
            } else {
                return structure
            }
        } else {
            return new Room.Terrain(this.roomName).get(this.x, this.y) != 1 // 1 是 wall
        }
    }

    // 获取房间坐标
    getRoomCoordinate() {
        const CHAR_0 = '0'.charCodeAt(0)
        const MAP_DIRECT = { E: 1, N: -1, W: -1, S: 1 } //东西南北坐标
        const MAP_OFFSET = { E: 0, N: -1, W: -1, S: 0 } //东西南北坐标
        const roomName = this.roomName;

        const tmp = { x: 0, y: 0 }
        let sh = 0
        let pow = 1
        for (let i = roomName.length - 1; i >= 0; i--) {
            const cc = roomName.charCodeAt(i) - CHAR_0
            if (cc >= 0 && cc <= 9) {
                if (sh == 0) {
                    tmp.y += cc * pow
                } else {
                    tmp.x += cc * pow
                }
                pow *= 10
            } else {
                const c = roomName[i] as keyof typeof MAP_DIRECT
                if (sh == 0) {
                    tmp.y *= MAP_DIRECT[c]
                    tmp.y += MAP_OFFSET[c]
                } else {
                    tmp.x *= MAP_DIRECT[c]
                    tmp.x += MAP_OFFSET[c]
                }
                pow = 1
                sh += 1
            }
        }
        return tmp
    }

    // 计算 RoomPosition 在全图的坐标
    toGlobal(): { x: number, y: number } {
        const roomCoordinate = this.getRoomCoordinate()
        return {
            x: roomCoordinate.x * 50 + this.x,
            y: roomCoordinate.y * 50 + this.y,
        }
    }

    // 是否有rampart
    coverRampart(): boolean {
        if (!Game.rooms[this.roomName]) return undefined;
        return this.lookFor(LOOK_STRUCTURES).some(e=>e.structureType == STRUCTURE_RAMPART);
    }

    /**
     * 跨房是否相邻
     */
    isCrossRoomNearTo(other: RoomPosition) {
        if (this.roomName == other.roomName) return this.isNearTo(other)
        return this.crossRoomGetRangeTo(other) <= 1
    }
    /**
     * 跨房间的两点之间的距离
     */
    crossRoomGetRangeTo(other: RoomPosition) {
        if (this.roomName == other.roomName) return this.getRangeTo(other)
        const det = this.crossRoomSubPos(other)
        return Math.max(Math.abs(det.x), Math.abs(det.y))
    }

    /**
     * 减去另一个坐标
     */
    crossRoomSubPos(other: RoomPosition) {
        const sameRoom = this.roomName == other.roomName
        const change = (e: number) => (sameRoom ? e : e == 49 ? 50 : e == 0 ? -1 : e) // 如果房间不一样默认交换位置
        const a = other.getRoomCoordinate()
        const b = this.getRoomCoordinate()
        const x = b.x - a.x
        const y = b.y - a.y
        const tmp = {
            x: change(this.x) + x * 50 - change(other.x),
            y: change(this.y) + y * 50 - change(other.y),
        }
        return tmp
    }

    /**
     * 判断爬是否在房间边缘附近
     */
    isNearEdge(range = 1): boolean {
        return this.x <= range || this.x >= 49 - range || this.y <= range || this.y >= 49 - range
    }

    /**
     * 返回范围内的 posList，不包括自己
     */
    nearPos(range = 1) {
        const arr = []
        for (let i = -range; i <= range; i++) {
            for (let j = -range; j <= range; j++) {
                if ((i || j) && this.x + i >= 0 && this.y + j >= 0 && this.x + i <= 49 && this.y + j <= 49)
                    arr.push(new RoomPosition(this.x + i, this.y + j, this.roomName))
            }
        }
        return arr
    }

    /**
     * 获得 direction 的方向 的 RoomPosition
     */
    getDirectPos(direction: DirectionConstant) {
        const DIRECTION_MAP = {
            [TOP]: [0, -1],
            [TOP_RIGHT]: [1, -1],
            [RIGHT]: [1, 0],
            [BOTTOM_RIGHT]: [1, 1],
            [BOTTOM]: [0, 1],
            [BOTTOM_LEFT]: [-1, 1],
            [LEFT]: [-1, 0],
            [TOP_LEFT]: [-1, -1],
        }
        const x = this.x + DIRECTION_MAP[direction][0]
        const y = this.y + DIRECTION_MAP[direction][1]
        let offsetX = 0
        let offsetY = 0
        if (x < 0) offsetX -= 1
        else if (x > 49) offsetX += 1
        if (y < 0) offsetY -= 1
        else if (y > 49) offsetY += 1
        if (offsetX == 0 && offsetY == 0) return new RoomPosition(x, y, this.roomName)
        else {
            function getRoomNameByXY(x: number, y: number) {
                return `${x >= 0 ? 'E' : 'W'}${x >= 0 ? x : -1 - x}${y >= 0 ? 'S' : 'N'}${y >= 0 ? y : -1 - y}`
            }
            const co = this.getRoomCoordinate()
            return new RoomPosition((x + 50) % 50, (y + 50) % 50, getRoomNameByXY(co.x + offsetX, co.y + offsetY))
        }
    }

    /**
     * 获取 RoomPosition 的哈希值
     */
    hashCode () {
        const roomCoordinate = this.getRoomCoordinate()
        return (roomCoordinate.x << 19) + (roomCoordinate.y << 13) + (this.x << 6) + this.y
    }

    /**
     * 获取 RoomPosition 在房间内的哈希值
     */
    hashCodeInRoom() {
        return (this.x << 6) + this.y
    }

    /**
     * 获取pos相邻某个方向上的点
     * @param direction 方向
     * @returns 
     */
    getAdjacentPos(direction: DirectionConstant): RoomPosition {
        if (direction == TOP) {
            return new RoomPosition(this.x, this.y - 1, this.roomName);
        } else if (direction == TOP_RIGHT) {
            return new RoomPosition(this.x + 1, this.y - 1, this.roomName);
        } else if (direction == RIGHT) {
            return new RoomPosition(this.x + 1, this.y, this.roomName);
        } else if (direction == BOTTOM_RIGHT) {
            return new RoomPosition(this.x + 1, this.y + 1, this.roomName);
        } else if (direction == BOTTOM) {
            return new RoomPosition(this.x, this.y + 1, this.roomName);
        } else if (direction == BOTTOM_LEFT) {
            return new RoomPosition(this.x - 1, this.y + 1, this.roomName);
        } else if (direction == LEFT) {
            return new RoomPosition(this.x - 1, this.y, this.roomName);
        } else if (direction == TOP_LEFT) {
            return new RoomPosition(this.x - 1, this.y - 1, this.roomName);
        } else {
            return this;
        }
    }

    /**
     * 获取相邻点的方向
     * @param toPos 目标位置
     */
    getDirection(toPos: RoomPosition): DirectionConstant {
        if (this.roomName == toPos.roomName) {
            if (toPos.x > this.x) {    // 下一步在右边
                if (toPos.y > this.y) {    // 下一步在下面
                    return BOTTOM_RIGHT;
                } else if (toPos.y == this.y) { // 下一步在正右
                    return RIGHT;
                }
                return TOP_RIGHT;   // 下一步在上面
            } else if (toPos.x == this.x) { // 横向相等
                if (toPos.y > this.y) {    // 下一步在下面
                    return BOTTOM;
                } else if (toPos.y < this.y) {
                    return TOP;
                }
            } else {  // 下一步在左边
                if (toPos.y > this.y) {    // 下一步在下面
                    return BOTTOM_LEFT;
                } else if (toPos.y == this.y) {
                    return LEFT;
                }
                return TOP_LEFT;
            }
        } else {  // 房间边界点
            if (this.x == 0 || this.x == 49) {  // 左右相邻的房间，只需上下移动（左右边界会自动弹过去）
                if (toPos.y > this.y) {   // 下一步在下面
                    return BOTTOM;
                } else if (toPos.y < this.y) { // 下一步在上
                    return TOP
                } // else 正左正右
                return this.x ? RIGHT : LEFT;
            } else if (this.y == 0 || this.y == 49) {    // 上下相邻的房间，只需左右移动（上下边界会自动弹过去）
                if (toPos.x > this.x) {    // 下一步在右边
                    return RIGHT;
                } else if (toPos.x < this.x) {
                    return LEFT;
                }// else 正上正下
                return this.y ? BOTTOM : TOP;
            }
        }
    }

    /** 创建旗帜 */
    createFlag(name: string, color1: ColorConstant = COLOR_WHITE, color2: ColorConstant = COLOR_WHITE) {
        let obj = { name: this.roomName, createFlag: Room.prototype.createFlag };
        return obj.createFlag(this.x, this.y, name, color1, color2);
    };
}