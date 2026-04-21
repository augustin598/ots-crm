import { proto, initAuthCreds, BufferJSON, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from 'baileys';
import { encrypt, decrypt } from '$lib/server/plugins/smartbill/crypto';
import { getIfExists, putStable, removePrefix } from './minio-helpers';
import { logError, logWarning } from '$lib/server/logger';

const FLUSH_DEBOUNCE_MS = 1500;

type StoreShape = {
	creds: AuthenticationCreds;
	keys: Record<string, Record<string, unknown>>;
};

function storageKey(tenantId: string): string {
	return `${tenantId}/whatsapp/auth.json.enc`;
}

async function loadStore(tenantId: string): Promise<StoreShape> {
	let encrypted: Buffer | null = null;
	try {
		encrypted = await getIfExists(storageKey(tenantId));
	} catch (err) {
		console.error(`[WHATSAPP] MinIO getIfExists failed for tenant=${tenantId}:`, err);
		// Fresh start if MinIO unreachable at boot — flushes will retry later
		return { creds: initAuthCreds(), keys: {} };
	}
	if (!encrypted) {
		return { creds: initAuthCreds(), keys: {} };
	}
	try {
		const plaintext = decrypt(tenantId, encrypted.toString('utf8'));
		const parsed = JSON.parse(plaintext, BufferJSON.reviver) as StoreShape;
		return parsed;
	} catch (err) {
		logError('whatsapp', 'Failed to decrypt auth store — starting fresh', {
			tenantId,
			metadata: { err: err instanceof Error ? err.message : String(err) }
		});
		return { creds: initAuthCreds(), keys: {} };
	}
}

async function persistStore(tenantId: string, store: StoreShape): Promise<void> {
	const serialized = JSON.stringify(store, BufferJSON.replacer);
	const encrypted = encrypt(tenantId, serialized);
	await putStable(storageKey(tenantId), encrypted, 'application/octet-stream');
}

export interface TenantAuthStore {
	state: AuthenticationState;
	saveCreds: () => Promise<void>;
	flush: () => Promise<void>;
	clear: () => Promise<void>;
}

export async function makeTenantAuthStore(tenantId: string): Promise<TenantAuthStore> {
	const store = await loadStore(tenantId);

	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingFlush: Promise<void> | null = null;

	function scheduleFlush(): void {
		if (flushTimer) clearTimeout(flushTimer);
		flushTimer = setTimeout(() => {
			flushTimer = null;
			pendingFlush = persistStore(tenantId, store).catch((err) => {
				logWarning('whatsapp', 'Auth flush to MinIO failed — will retry on next event', {
					tenantId,
					metadata: { err: err instanceof Error ? err.message : String(err) }
				});
			});
		}, FLUSH_DEBOUNCE_MS);
	}

	async function flushNow(): Promise<void> {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		if (pendingFlush) await pendingFlush.catch(() => {});
		await persistStore(tenantId, store);
	}

	const state: AuthenticationState = {
		creds: store.creds,
		keys: {
			get: async (type, ids) => {
				const bucket = store.keys[type] || {};
				const result: Record<string, unknown> = {};
				for (const id of ids) {
					let value = bucket[id];
					if (type === 'app-state-sync-key' && value) {
						value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
					}
					if (value !== undefined) result[id] = value;
				}
				return result as { [id: string]: SignalDataTypeMap[typeof type] };
			},
			set: async (data) => {
				for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
					const bucket = (store.keys[type] = store.keys[type] || {});
					const section = data[type] as Record<string, unknown> | undefined;
					if (!section) continue;
					for (const id of Object.keys(section)) {
						const value = section[id];
						if (value === null || value === undefined) delete bucket[id];
						else bucket[id] = value;
					}
				}
				scheduleFlush();
			}
		}
	};

	return {
		state,
		saveCreds: async () => {
			store.creds = state.creds;
			scheduleFlush();
		},
		flush: flushNow,
		clear: async () => {
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = null;
			}
			await removePrefix(`${tenantId}/whatsapp/`);
		}
	};
}
