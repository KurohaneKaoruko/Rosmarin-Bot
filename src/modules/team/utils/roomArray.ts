/**
 * 遍历函数类型
 */
type forEachFunc<T> = (x: number, y: number, value: T) => void

export default class RoomArray<T extends number = number> {
    // 存放房间中 50 * 50 信息的数组
    protected arr: T[]

    public constructor(initValue?: T) {
        this.arr = new Array(50 * 50).fill(initValue || 0)
    }

    /**
     * 获取指定位置的值
     */
    public get(x: number, y: number): T {
        return this.arr[x * 50 + y]
    }

    /**
     * 设置指定位置的值
     */
    public set(x: number, y: number, value: T) {
        this.arr[x * 50 + y] = value
    }

    /**
     * 填充整个数组
     */
    public fill(value: T) {
        this.arr.fill(value)
    }

    /**
     * 遍历数组
     */
    public forEach(func: forEachFunc<T>) {
        for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y++) {
                func(x, y, this.get(x, y))
            }
        }
    }

    /**
     * 遍历 range 范围内的位置
     */
    public forNear(x: number, y: number, range: number, func: forEachFunc<T>) {
        for (let i = -range; i <= range; i++) {
            for (let j = -range; j <= range; j++) {
                const xx = x + i
                const yy = y + j

                if ((i || j) && xx >= 0 && xx < 50 && yy >= 0 && yy < 50) {
                    func(xx, yy, this.get(xx, yy))
                }
            }
        }
    }

    /**
     * 从上顺时针遍历周围八个方向，没考虑边界情况
     */
    public forEachNear(x: number, y: number, func: forEachFunc<T>) {
        for (const [xx, yy] of [
            [x, y - 1],
            [x + 1, y - 1],
            [x + 1, y],
            [x + 1, y + 1],
            [x, y + 1],
            [x - 1, y + 1],
            [x - 1, y],
            [x - 1, y - 1],
        ]) {
            func(xx, yy, this.get(xx, yy))
        }
    }
}
