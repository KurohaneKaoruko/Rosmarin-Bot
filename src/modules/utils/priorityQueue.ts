// @ts-nocheck
const NodeCache: any[] = [];
export function NewNode(k?: any, x?: any, y?: any, v?: any) {
	let t: any;
	if (NodeCache.length) {
		t = NodeCache.pop();
	} else {
		t = {};
	}
	t.k = k;
	t.x = x;
	t.y = y;
	t.v = v;
	return t;
}

export function ReclaimNode(node) {
	if (NodeCache.length < 10000) NodeCache.push(node);
}

// @ts-ignore

const tryRequire = (path) => {
	try {
		return require(`${path}`);
	} catch (err) {
		return null;
	}
};

const decodeBase64ToUint8Array = (base64) => {
	// @ts-ignore
	if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'));
	// @ts-ignore
	const bin = atob(base64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
};

const toWasmBytes = (data) => {
	if (!data) throw new Error('WASM 模块不存在');
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	if (typeof data === 'string') return decodeBase64ToUint8Array(data);
	if (typeof data === 'object') {
		// @ts-ignore
		if (data.binary && typeof data.binary === 'string') return decodeBase64ToUint8Array(data.binary);
		// @ts-ignore
		if (data.default) return toWasmBytes(data.default);
	}
	throw new Error(`WASM 模块类型不支持: ${typeof data}`);
};

const validateWasmHeader = (bytes) => {
	return (
		bytes &&
		bytes.length >= 8 &&
		bytes[0] === 0x00 &&
		bytes[1] === 0x61 &&
		bytes[2] === 0x73 &&
		bytes[3] === 0x6d &&
		bytes[4] === 0x01 &&
		bytes[5] === 0x00 &&
		bytes[6] === 0x00 &&
		bytes[7] === 0x00
	);
};

const getWasmBinary = () => {
	const moduleNoExt = tryRequire('algo_wasm_priorityqueue');
	if (moduleNoExt) return toWasmBytes(moduleNoExt);
	const moduleWithExt = tryRequire('algo_wasm_priorityqueue.wasm');
	if (moduleWithExt) return toWasmBytes(moduleWithExt);
	throw new Error('未找到 algo_wasm_priorityqueue WASM 模块');
};

const getWasModule = () => {
	const bytes = getWasmBinary();
	if (!validateWasmHeader(bytes)) {
		const head = Array.from(bytes.slice(0, 8)).map((n) => n.toString(16).padStart(2, '0')).join(' ');
		throw new Error(`WASM 头校验失败: ${head}`);
	}
	const wasmModule = new WebAssembly.Module(bytes);
	return wasmModule;
};



/**
 *
 * @typedef {Object} node
 * @property {number} k 优先级实数（可负）
 *
 * @typedef {{
 *      memory:{
 *          buffer: ArrayBuffer
 *      },
 *      init(is_min:number):void,
 *      push(priorty:number, id:number):void,
 *      pop():void,
 *      top():number,
 *      get_identifier(pointer:number):number,
 *      size():number,
 *      clear():void,
 *      is_empty():boolean
 *  }} cppQueue
 */

class BaseQueue {
	/**
	 * 队列元素个数
	 * @returns {number}
	 */
	size() {
		// @ts-ignore
		return this.instance.size();
	}
	/**
	 * 清空整个队列
	 */
	clear() {
		// @ts-ignore
		this.instance.clear();
	}
	/**
	 * 队列是否为空
	 * @returns {boolean} 实际返回值是0或1
	 */
	isEmpty() {
		// @ts-ignore
		return !this.instance.is_empty();
	}
}

/**
 *  c++优先队列
 *  最大容量 131072 个元素（2的17次方）
 *  每个元素是带有priority属性的任意对象
 *  连续pop 100k个元素时比js队列快 80% 以上，元素个数少时比js快 5~10 倍
 */
export class PriorityQueue extends BaseQueue {
	whileNoEmpty: (func) => void;
	/**
	 * @param {boolean} isMinRoot 优先级方向，true则pop()时得到数字最小的，否则pop()出最大的
	 */
	constructor(isMinRoot = false) {
		super();
		/**@type {cppQueue} */
		let instance;
		/**@type {node[]} */
		const cache: any[] = [];
		const heap: any[] = [];
		const isMin = !!isMinRoot;

		const imports = {
			// 把wasm类实例化需要的接口函数
			env: {
				emscripten_notify_memory_growth() { }
			},
			wasi_snapshot_preview1: {
				proc_exit: () => { }
			}
		};
		// @ts-ignore
		// eslint-disable-next-line prefer-const
		let useWasm = false;
		try {
			const wasmModule = getWasModule();
			instance = new WebAssembly.Instance(wasmModule, imports).exports; // 实例化
			instance.init(+!!isMinRoot); // !!转化为boolean, +转为数字
			useWasm = true;
		} catch (e) {
			useWasm = false;
		}

		const higherPriority = (a, b) => (isMin ? a.k < b.k : a.k > b.k);
		const heapPush = (node) => {
			heap.push(node);
			let i = heap.length - 1;
			while (i > 0) {
				const p = (i - 1) >> 1;
				if (higherPriority(heap[p], heap[i])) break;
				const t = heap[p];
				heap[p] = heap[i];
				heap[i] = t;
				i = p;
			}
		};
		const heapPop = () => {
			if (heap.length === 0) return undefined;
			const root = heap[0];
			const last = heap.pop();
			if (heap.length > 0) {
				heap[0] = last;
				let i = 0;
				while (true) {
					let best = i;
					const l = i * 2 + 1;
					const r = l + 1;
					if (l < heap.length && higherPriority(heap[l], heap[best])) best = l;
					if (r < heap.length && higherPriority(heap[r], heap[best])) best = r;
					if (best === i) break;
					const t = heap[i];
					heap[i] = heap[best];
					heap[best] = t;
					i = best;
				}
			}
			return root;
		};

		/**
		 * @param {node} node
		 */
		this.push = (node) => {
			if (!useWasm) {
				heapPush(node);
				return;
			}
			try {
				instance.push(node.k, cache.length);
				cache.push(node);
			} catch (e) {
				if (e instanceof TypeError) {
					throw e;
				} else {
					throw Error(
						`priorityQueue is full.\n\t Current size is ${instance.size()}, buffer length is ${(instance.memory.buffer.byteLength * 2) / 1024
						}KB.`
					);
				}
			}
		};
		/**
		 *  @returns {node|undefined}
		 */
		this.pop = () => {
			if (!useWasm) return heapPop();
			if (instance.size() > 0) {
				const pointer = instance.top();
				const id = instance.get_identifier(pointer);
				const node = cache[id];
				instance.pop();
				// @ts-ignore
				cache[id] = undefined;
				return node;
			} else {
				return undefined;
			}
		};
		/**
		 *  @returns {node|undefined}
		 */
		this.top = () => {
			if (!useWasm) return heap[0];
			if (instance.size() > 0) {
				const pointer = instance.top();
				return cache[instance.get_identifier(pointer)];
			} else {
				return undefined;
			}
		};
		/**
		 *  @returns {undefined}
		 */
		this.whileNoEmpty = (func) => {
			while (!this.isEmpty()) {
				const node = this.pop();
				func(node);
				ReclaimNode(node);
			}
		};

		this.size = () => {
			if (!useWasm) return heap.length;
			return instance.size();
		};

		this.clear = () => {
			if (!useWasm) {
				heap.length = 0;
				return;
			}
			instance.clear();
		};

		this.isEmpty = () => {
			if (!useWasm) return heap.length === 0;
			return !instance.is_empty();
		};

		Object.defineProperty(this, 'instance', {
			// 不想被枚举到
			value: instance
		});
	}
	/**
	 *  把节点插入队列
	 * @param {node} node 待插入对象，至少含有priority:k属性
	 */
	push(node) { }
	/**
	 *  查看顶端节点，空队列返回undefined
	 *  @returns {node|undefined}
	 */
	top() {
		return;
	}
	/**
	 *  取出顶端节点，空队列返回undefined
	 *  @returns {node|undefined}
	 */
	pop() {
		return;
	}
}
