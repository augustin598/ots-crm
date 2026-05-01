import { randomUUID } from 'crypto';

const INSTANCE_ID_KEY = Symbol.for('personalops_instance_id');

/**
 * Returns a stable UUID for this process instance.
 * Generated once on first call and persisted in globalThis for the process lifetime.
 * Survives HMR reloads within the same process.
 */
export function getInstanceId(): string {
	if (!(globalThis as Record<symbol, unknown>)[INSTANCE_ID_KEY]) {
		(globalThis as Record<symbol, unknown>)[INSTANCE_ID_KEY] = randomUUID();
	}
	return (globalThis as Record<symbol, unknown>)[INSTANCE_ID_KEY] as string;
}
