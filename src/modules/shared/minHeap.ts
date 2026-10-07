/**
 * 二叉最小堆：按映射值排序，heap[0] 为哨兵占位。
 * 用于 Top-N 筛选（getMaxObjects）与优先队列。
 */
export class MinHeap<T> {
    private heap: (T | null)[];
    private func: (x: T) => number;

    constructor(func?: (x: T) => number, heap?: T[]) {
        this.heap = (heap as (T | null)[] | undefined) || [null];
        this.func = func || ((x: T) => x as unknown as number);
    }

    has(element: T): boolean {
        return this.heap.some((obj) => obj === element);
    }

    getMinValue(): number {
        return this.func(this.getMin()!);
    }

    getMin(): T | null {
        return this.heap[1];
    }

    getSize(): number {
        return this.heap.length - 1;
    }

    isEmpty(): boolean {
        return this.heap.length < 2;
    }

    toArray(): T[] {
        const result = [...this.heap] as T[];
        result.shift();
        return result;
    }

    insert(node: T): void {
        const value = this.func(node);

        if (value === Infinity) {
            return;
        }

        let current = this.heap.length;

        while (current > 1) {
            const parent = Math.floor(current / 2);
            if (this.func(this.heap[parent] as T) > value) {
                this.heap[current] = this.heap[parent];
                current = parent;
            } else break;
        }

        this.heap[current] = node;
    }

    /** 弹出最小元素并返回 */
    remove(): T | null {
        const min = this.heap[1];

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
                    this.func(this.heap[rightChildIndex] as T) < this.func(this.heap[childIndexToCompare] as T)
                ) {
                    childIndexToCompare = rightChildIndex;
                }

                if (this.func(this.heap[current] as T) > this.func(this.heap[childIndexToCompare] as T)) {
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
