import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';

type LogLevel = 'info' | 'warning' | 'error';
type LogSource =
	| 'server'
	| 'client'
	| 'scheduler'
	| 'plugin'
	| 'email'
	| 'gmail'
	| 'keez'
	| 'smartbill'
	| 'bnr';

function generateId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export async function logDebug(params: {
	tenantId?: string | null;
	level: LogLevel;
	source: LogSource;
	message: string;
	url?: string;
	stackTrace?: string;
	metadata?: Record<string, unknown>;
	userId?: string;
}) {
	try {
		await db.insert(table.debugLog).values({
			id: generateId(),
			tenantId: params.tenantId ?? null,
			level: params.level,
			source: params.source,
			message: params.message,
			url: params.url ?? null,
			stackTrace: params.stackTrace ?? null,
			metadata: params.metadata ? JSON.stringify(params.metadata) : null,
			userId: params.userId ?? null,
			createdAt: new Date()
		});
	} catch (err) {
		console.error('[logger] Failed to write debug log:', err);
	}
}

export const logInfo = (
	source: LogSource,
	message: string,
	opts?: Partial<Omit<Parameters<typeof logDebug>[0], 'level' | 'source' | 'message'>>
) => logDebug({ level: 'info', source, message, ...opts });

export const logWarning = (
	source: LogSource,
	message: string,
	opts?: Partial<Omit<Parameters<typeof logDebug>[0], 'level' | 'source' | 'message'>>
) => logDebug({ level: 'warning', source, message, ...opts });

export const logError = (
	source: LogSource,
	message: string,
	opts?: Partial<Omit<Parameters<typeof logDebug>[0], 'level' | 'source' | 'message'>>
) => logDebug({ level: 'error', source, message, ...opts });
