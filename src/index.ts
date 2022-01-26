import fs from 'fs';
import path from 'path';

let wake = () => void trigger();

const state = {
	toStat: new Set<string>(),
	toRead: new Set<string>(),
	toWrite: new Set<
		[
			string,
			() => void,
			/* rejection */ (e: unknown) => void,
			Buffer | string
		]
	>(),
	statPromises: new Map<string, Promise<fs.Stats | false>>(),
	statCallbacks: new Map<string, (b: fs.Stats | false) => void>(),
	readPromises: new Map<string, Promise<Buffer>>(),
	readCallbacks: new Map<string, (b: Buffer) => void>(),
	toReadLater: new Set<string>(),
};

export function stat(file_path: string): Promise<fs.Stats | false> {
	file_path = path.resolve(file_path);
	if (state.statPromises.has(file_path)) {
		return state.statPromises.get(file_path) || stat(file_path);
	}
	const promise = new Promise<fs.Stats | false>((resolve) => {
		state.statCallbacks.set(file_path, (b: fs.Stats | false) => resolve(b));
		state.toStat.add(file_path);
		wake();
	});
	state.statPromises.set(file_path, promise);
	return promise;
}

/**
 * Asynchronously read a file
 * @param file_path Path to file, resolved to absolute path upon call
 * @returns Promise of read buffer
 */
export function read(file_path: string): Promise<Buffer> {
	file_path = path.resolve(file_path);
	if (state.readPromises.has(file_path)) {
		return state.readPromises.get(file_path) || read(file_path);
	}
	const promise = new Promise<Buffer>((resolve) => {
		state.readCallbacks.set(file_path, (b: Buffer) => resolve(b));
		state.toRead.add(file_path);
		wake();
	});
	state.readPromises.set(file_path, promise);
	return promise;
}

type TypedArray =
	| Int8Array
	| Uint8Array
	| Uint8ClampedArray
	| Int16Array
	| Uint16Array
	| Int32Array
	| Uint32Array
	| Float32Array
	| Float64Array
	| BigInt64Array
	| BigUint64Array
	| ArrayBuffer;

/**
 * Asynchronously write to a file
 * @param file_path Path to file, resolved to absolute path upon call
 * @param data Data `string` or `Buffer`
 * @returns A promise that resolves to undefined
 */
export function write(
	file_path: string,
	data: TypedArray | string
): Promise<void> {
	file_path = path.resolve(file_path);
	return new Promise((resolve, reject) => {
		// Don't keep a referrence to the data object
		state.toWrite.add([
			file_path,
			resolve,
			reject,
			typeof data === 'string' ? data : Buffer.from(data),
		]);
		wake();
	});
}

async function trigger(): Promise<void> {
	wake = () => void null;
	try {
		for (const to_stat of state.toStat.values()) {
			const stat: fs.Stats | false = await fs.promises
				.stat(to_stat)
				.catch(() => false);
			state.statCallbacks.get(to_stat)?.(stat);
			state.statCallbacks.delete(to_stat);
			state.statPromises.delete(to_stat);
			state.toStat.delete(to_stat);
		}
		for (const to_write of state.toWrite.values()) {
			const [file, cb, reject, buf] = to_write;
			try {
				await fs.promises.writeFile(file, buf);
				cb();
			} catch (error) {
				reject(error);
			}
			state.toWrite.delete(to_write);
		}
		for (const to_read of state.toRead.values()) {
			try {
				const data = await fs.promises.readFile(to_read);
				state.readCallbacks.get(to_read)?.(data);
				state.readCallbacks.delete(to_read);
				state.readPromises.delete(to_read);
				state.toReadLater.delete(to_read);
			} catch (error) {
				state.toReadLater.add(to_read);
			}
			state.toRead.delete(to_read);
		}
	} catch (error) {
		wake = () => void trigger();
		return void setTimeout(() => wake());
	}
	wake = () => void trigger();
	if (state.toRead.size || state.toWrite.size) {
		setTimeout(wake);
	} else if (state.toReadLater.size) {
		for (const entry of state.toReadLater) {
			state.toRead.add(entry);
		}
	} else {
		const cb = finished_callback_array.shift();
		if (cb) cb(finished_callback_array.length);
	}
}

/** Internal array of callbacks */
const finished_callback_array = Array<(remaining_callbacks: number) => void>();

/**
 * Add a custom callback
 * gets called once, when all io is finished
 */
const add_finished_callback = (cb: (remaining_callbacks: number) => void) =>
	finished_callback_array.push(cb);

/**
 * Get a Promise
 * gets resolved when all io is finished
 */
const get_finished_promise = () =>
	new Promise((resolve) =>
		finished_callback_array.push(() =>
			resolve(finished_callback_array.length)
		)
	);

export const finished = {
	callbacks: finished_callback_array,
	add_callback: add_finished_callback,
	get_promise: get_finished_promise,
};

Object.freeze(finished);

const def = { read, write, finished };
const prop = { get: () => def };

Object.defineProperties(def, { def: prop, default: prop });

export default def;
