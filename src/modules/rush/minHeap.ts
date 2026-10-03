/**
 * 二叉最小堆（数组实现，堆顶为最小值）：孵化队列与建造队列共用。
 * insert 时值为 Infinity 的节点直接丢弃。
 */
export class RushMinHeap<T> {
    private heap: T[];
    private readonly key: (item: T) => number;

    constructor(key?: (item: T) => number, heap?: T[]) {
        this.heap = heap ?? [null as unknown as T];
        this.key = key ?? ((x: T) => x as unknown as number);
    }

    has(element: T): boolean {
        return this.heap.some((obj) => obj === element);
    }

    getMinValue(): number {
        return this.key(this.getMin());
    }

    getMin(): T {
        return this.heap[1];
    }

    getSize(): number {
        return this.heap.length - 1;
    }

    isEmpty(): boolean {
        return this.heap.length < 2;
    }

    toArray(): T[] {
        const result = [...this.heap];
        result.shift();
        return result;
    }

    insert(node: T): void {
        const value = this.key(node);

        if (value === Infinity) return;

        let current = this.heap.length;

        while (current > 1) {
            const parent = Math.floor(current / 2);
            if (this.key(this.heap[parent]) > value) {
                this.heap[current] = this.heap[parent];
                current = parent;
            } else break;
        }

        this.heap[current] = node;
    }

    /** 弹出堆顶（最小值）；空堆返回 null */
    remove(): T | null {
        let min = this.heap[1];

        if (this.heap.length > 2) {
            this.heap[1] = this.heap[this.heap.length - 1];
            this.heap.splice(this.heap.length - 1);

            let current = 1;
            let leftChildIndex = current * 2;
            let rightChildIndex = current * 2 + 1;

            while (this.heap[leftChildIndex]) {
                let childIndexToCompare = leftChildIndex;
                if (
                    this.heap[rightChildIndex] &&
                    this.key(this.heap[rightChildIndex]) < this.key(this.heap[childIndexToCompare])
                ) {
                    childIndexToCompare = rightChildIndex;
                }

                if (this.key(this.heap[current]) > this.key(this.heap[childIndexToCompare])) {
                    [this.heap[current], this.heap[childIndexToCompare]] = [
                        this.heap[childIndexToCompare],
                        this.heap[current],
                    ];
                    current = childIndexToCompare;
                } else break;

                leftChildIndex = current * 2;
                rightChildIndex = current * 2 + 1;
            }
        } else if (this.heap.length === 2) {
            this.heap.splice(1, 1);
        } else {
            return null;
        }

        return min;
    }
}
