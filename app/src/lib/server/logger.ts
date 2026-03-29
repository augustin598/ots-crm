import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';

export type LogLevel = 'info' | 'warning' | 'error';
export type LogSource =
	| 'server'
	| 'client'
	| 'scheduler'
	| 'plugin'
	| 'email'
	| 'gmail'
	| 'keez'
	| 'smartbill'
	| 'bnr'
	| 'anaf-spv'
	| 'banking'
	| 'storage'
	| 'invoice-view'
	| 'google-ads'
	| 'google-ads-dl'
	| 'google-ads-sync'
	| 'meta-ads'
	| 'invoice-downloader'
	| 'fb-cookies'
	| 'google-cookies'
	| 'tiktok-ads'
	| 'meta-ads-sync'
	| 'tiktok-ads-sync'
	| 'tiktok-invoice-downloader'
	| 'tt-cookies'
	| 'invoice-scraper'
	| 'meta-scraper'
	| 'google-scraper'
	| 'tiktok-scraper';

function generateId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

const CONSOLE_METHOD: Record<LogLevel, 'log' | 'warn' | 'error'> = {
	info: 'log',
	warning: 'warn',
	error: 'error'
};

export function serializeError(err: unknown): { message: string; stack?: string } {
	if (err instanceof Error) {
		return { message: err.message, stack: err.stack };
	}
	return { message: String(err) };
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
	action?: string;
	errorCode?: string;
	ipAddress?: string;
	userAgent?: string;
	requestId?: string;
	duration?: number;
}) {
	// Always write to console for dev visibility and container logs
	const method = CONSOLE_METHOD[params.level];
	const codeTag = params.errorCode ? `[${params.errorCode}]` : '';
	const actionTag = params.action ? `[${params.action}]` : '';
	const prefix = `[${params.source.toUpperCase()}]${codeTag}${actionTag}`;
	if (params.metadata && Object.keys(params.metadata).length > 0) {
		console[method](prefix, params.message, params.metadata);
	} else {
		console[method](prefix, params.message);
	}

	// Write to DB
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
			createdAt: new Date(),
			action: params.action ?? null,
			errorCode: params.errorCode ?? null,
			ipAddress: params.ipAddress ?? null,
			userAgent: params.userAgent ?? null,
			requestId: params.requestId ?? null,
			duration: params.duration ?? null
		});
	} catch (err) {
		// KEEP: raw console — cannot recursively call logger
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
