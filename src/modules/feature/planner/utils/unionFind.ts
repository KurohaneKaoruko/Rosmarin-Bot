export class UnionFind {
	size: number;
	parent: number[];
	constructor(size) {
		this.size = size;
		this.parent = new Array(size);
	}
	init() {
		for (let i = 0; i < this.size; i++) {
			this.parent[i] = i;
		}
	}
	find(x) {
		let r = x;
		while (this.parent[r] != r) r = this.parent[r];
		while (this.parent[x] != x) {
			const t = this.parent[x];
			this.parent[x] = r;
			x = t;
		}
		return x;
	}
	union(a, b) {
		a = this.find(a);
		b = this.find(b);
		if (a > b) this.parent[a] = b;
		else if (a != b) this.parent[b] = a;
	}
	same(a, b) {
		return this.find(a) == this.find(b);
	}
}
