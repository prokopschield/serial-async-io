import fs from 'fs';
import path from 'path';

let wake = () => void trigger();

const state = {
	toRead: new Set<string>(),
	toWrite: new Set<[string, () => void, Buffer | string]>(),
	readPromises: new Map<string, Promise<Buffer>>(),
	readCallbacks: new Map<string, (b: Buffer) => void>(),
	toReadLater: new Set<string>(),
};

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
	return new Promise((resolve) => {
		// Don't keep a referrence to the data object
		state.toWrite.add([
			file_path,
			resolve,
			typeof data === 'string' ? data : Buffer.from(data),
		]);
		wake();
	});
}

async function trigger(): Promise<void> {
	wake = () => void null;
	try {
		for (const to_write of state.toWrite.values()) {
			const [file, cb, buf] = to_write;
			await fs.promises.writeFile(file, buf);
			cb();
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
	}
}

export default module.exports = {
	default: { read, write },
	read,
	write,
};
