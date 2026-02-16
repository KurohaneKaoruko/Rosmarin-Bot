// @ts-nocheck
const tryRequire = (path) => {
	try {
		return require(`${path}`);
	} catch {
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
		if (data.binary && typeof data.binary === 'string') return decodeBase64ToUint8Array(data.binary);
		if (data.default) return toWasmBytes(data.default);
	}
	throw new Error(`WASM 模块类型不支持: ${typeof data}`);
};

const getWasmBinary = () => {
	const moduleNoExt = tryRequire('planner_kernel_wasm');
	if (moduleNoExt) return toWasmBytes(moduleNoExt);
	const moduleWithExt = tryRequire('planner_kernel_wasm.wasm');
	if (moduleWithExt) return toWasmBytes(moduleWithExt);
	throw new Error('未找到 planner_kernel_wasm WASM 模块');
};

let instance = null;
let enabled = true;

const getInstance = () => {
	if (instance) return instance;
	const bytes = getWasmBinary();
	const wasmModule = new WebAssembly.Module(bytes);
	instance = new WebAssembly.Instance(wasmModule, {}).exports;
	return instance;
};

const typedView = (exports, ptr, Type, len) => new Type(exports.memory.buffer, ptr, len);

export const isComputeBlockWasmEnabled = () => enabled;

export const computeBlockByWasm = (walkableU8, scoreF32, routeI16, blockedU8?) => {
	if (!enabled) return null;
	try {
		const exp = getInstance();
		const len = 2500;

		const walkBytes = len;
		const scoreBytes = len * 4;
		const routeBytes = len * 2;
		const blockedBytes = len;
		const outParentBytes = len * 4;
		const outSizeBytes = len * 2;

		const walkPtr = exp.alloc(walkBytes);
		const scorePtr = exp.alloc(scoreBytes);
		const routePtr = exp.alloc(routeBytes);
		const blockedPtr = blockedU8 ? exp.alloc(blockedBytes) : 0;
		const outParentPtr = exp.alloc(outParentBytes);
		const outSizePtr = exp.alloc(outSizeBytes);

		try {
			typedView(exp, walkPtr, Uint8Array, len).set(walkableU8);
			typedView(exp, scorePtr, Float32Array, len).set(scoreF32);
			typedView(exp, routePtr, Int16Array, len).set(routeI16);
			if (blockedU8) typedView(exp, blockedPtr, Uint8Array, len).set(blockedU8);

			exp.compute_block(
				walkPtr,
				scorePtr,
				routePtr,
				blockedPtr,
				blockedU8 ? 1 : 0,
				outParentPtr,
				outSizePtr
			);

			const parent = new Int32Array(len);
			const size = new Int16Array(len);
			parent.set(typedView(exp, outParentPtr, Int32Array, len));
			size.set(typedView(exp, outSizePtr, Int16Array, len));
			return { parent, size };
		} finally {
			exp.dealloc(walkPtr, walkBytes);
			exp.dealloc(scorePtr, scoreBytes);
			exp.dealloc(routePtr, routeBytes);
			if (blockedU8) exp.dealloc(blockedPtr, blockedBytes);
			exp.dealloc(outParentPtr, outParentBytes);
			exp.dealloc(outSizePtr, outSizeBytes);
		}
	} catch {
		enabled = false;
		return null;
	}
};

export const getBlockPutAbleCountByWasm = (walkableU8, parentI32, root) => {
	if (!enabled) return -1;
	try {
		const exp = getInstance();
		const len = 2500;
		const walkBytes = len;
		const parentBytes = len * 4;
		const walkPtr = exp.alloc(walkBytes);
		const parentPtr = exp.alloc(parentBytes);
		try {
			typedView(exp, walkPtr, Uint8Array, len).set(walkableU8);
			typedView(exp, parentPtr, Int32Array, len).set(parentI32);
			return exp.get_block_putable_count(walkPtr, parentPtr, root | 0);
		} finally {
			exp.dealloc(walkPtr, walkBytes);
			exp.dealloc(parentPtr, parentBytes);
		}
	} catch {
		enabled = false;
		return -1;
	}
};

export const findLabAnchorByWasm = (manorI16, storageX, storageY) => {
	if (!enabled) return null;
	try {
		const exp = getInstance();
		const len = 2500;
		const manorBytes = len * 2;
		const manorPtr = exp.alloc(manorBytes);
		try {
			typedView(exp, manorPtr, Int16Array, len).set(manorI16);
			const packed = exp.find_lab_anchor(manorPtr, storageX | 0, storageY | 0);
			if (packed < 0) return null;
			return { x: ((packed / 50) | 0), y: (packed % 50) | 0 };
		} finally {
			exp.dealloc(manorPtr, manorBytes);
		}
	} catch {
		enabled = false;
		return null;
	}
};
