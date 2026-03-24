export class RoomArray {
    public arr: number[] | string[];
    public extractor: any[];
    public container: any[];
    public link: any[];
    public exec(x: number, y: number, val: number): number | string {
        const tmp = this.arr[x * 50 + y]
        this.set(x, y, val);
        return tmp
    }
    public get(x: number, y: number): number | string {
        return this.arr[x * 50 + y];
    }
    public set(x: number, y: number, value: number | string): void {
        this.arr[x * 50 + y] = value;
    }
    public init(): RoomArray {
        if (!this.arr)
            this.arr = new Array(50 * 50)
        for (let i = 0; i < 2500; i++) {
            this.arr[i] = 0;
        }
        return this;
    }
    public forEach(func: any): void {
        for (let y = 0; y < 50; y++) {
            for (let x = 0; x < 50; x++) {
                func(x, y, this.get(x, y))
            }
        }
    }
    public for4Direction(func: any, x: number, y: number): void {
        for (const e of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const xt = x + e[0]
            const yt = y + e[1]
            if (xt >= 0 && yt >= 0 && xt <= 49 && yt <= 49)
                func(xt, yt, this.get(xt, yt))
        }
    }
    public forNear(func: any, x: number, y: number, range = 1): void {
        for (let i = -range; i <= range; i++) {
            for (let j = -range; j <= range; j++) {
                const xt = x + i
                const yt = y + j
                if ((i || j) && xt >= 0 && yt >= 0 && xt <= 49 && yt <= 49)
                    func(xt, yt, this.get(xt, yt))
            }
        }
    }
    public forBorder(func: any): void {
        for (let y = 0; y < 50; y++) {
            func(0, y, this.get(0, y))
            func(49, y, this.get(49, y))
        }
        for (let x = 1; x < 49; x++) {
            func(x, 0, this.get(x, 0))
            func(x, 49, this.get(x, 49))
        }
    }
    public initRoomTerrainWalkAble(roomName: string): void {
        const terrain = new Room.Terrain(roomName);
        this.forEach((x: number, y: number) => this.set(x, y, terrain.get(x, y) == 1 ? 0 : terrain.get(x, y) == 0 ? 1 : 2))
    }
}