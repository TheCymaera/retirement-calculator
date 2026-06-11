import { Duration } from "./Duration.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CachedFunctionReturn<T> {
	data: T;
	fetchedAt: Date;
	isFresh: boolean;
}

export type CachedFunction<T extends (...args: any[]) => Promise<any>> = 
	((...args: Parameters<T>) => Promise<CachedFunctionReturn<Awaited<ReturnType<T>>>>) &
	{ withOptions: (options: { maxAge: Duration }) => CachedFunction<T> };

type CacheStore = Record<string, { payload: string; fetchedAt: string }>;

const CACHE_DIR = path.resolve(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "function-cache.json");

let writeQueue: Promise<void> = Promise.resolve();

async function readStore(): Promise<CacheStore> {
	try {
		const content = await readFile(CACHE_FILE, "utf8");
		const parsed = JSON.parse(content) as unknown;
		if (parsed && typeof parsed === "object") {
			return parsed as CacheStore;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			console.warn("Failed to read cache file, proceeding with empty cache", error);
		}
	}

	return {};
}

async function queueStoreWrite(cacheKey: string, payload: string, fetchedAt: string): Promise<void> {
	writeQueue = writeQueue.then(async () => {
		const store = await readStore();
		store[cacheKey] = { payload, fetchedAt };

		await mkdir(CACHE_DIR, { recursive: true });
		await writeFile(CACHE_FILE, JSON.stringify(store, null, 2), "utf8");
	});

	await writeQueue;
}

export function cached<T extends (...args: any[]) => Promise<any>>(
	key: string,
	fn: T,
	options = { maxAge: Duration.hours(24) }
): CachedFunction<T> {
	async function cachedFn(...args: Parameters<T>): Promise<CachedFunctionReturn<Awaited<ReturnType<T>>>> {
		const cacheKey = `${key}:${JSON.stringify(args)}`;
		const now = new Date();

		const store = await readStore();
		const row = store[cacheKey];

		if (row) {
			const cachedTimestamp = Date.parse(row.fetchedAt);
			const age = now.getTime() - cachedTimestamp;
			
			if (age < options.maxAge.milliseconds) try {
				const parsed = JSON.parse(row.payload);
				return {
					data: parsed as Awaited<ReturnType<T>>,
					fetchedAt: new Date(cachedTimestamp),
					isFresh: false
				}
			} catch(e) {
				console.error(`Failed to load "${cacheKey}" from cache`);
			}
		}

		// upstream
		const result = await fn(...args);
		const fetchedAt = new Date();
		const nowIso = fetchedAt.toISOString();
		const serialized = JSON.stringify(result);

		await queueStoreWrite(cacheKey, serialized, nowIso);

		return {
			data: result,
			fetchedAt,
			isFresh: true
		};
	}

	cachedFn.withOptions = (options: { maxAge: Duration }) => cached(key, fn, options);

	return cachedFn as unknown as CachedFunction<T>;
}