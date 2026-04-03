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
	| 'tiktok-scraper'
	| 'token-refresh'
	| 'meta-ads-leads';

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

// ---------------------------------------------------------------------------
// Buffered batch-write system
// Instead of inserting each log row individually (which saturates the single
// libsql connection under load), we push entries into an in-memory buffer and
// flush them in batches every FLUSH_INTERVAL_MS.
// ---------------------------------------------------------------------------

type DebugLogInsert = typeof table.debugLog.$inferInsert;

const LOG_BUFFER: DebugLogInsert[] = [];
const FLUSH_INTERVAL_MS = 2_000;
const MAX_BUFFER = 500;
const BATCH_SIZE = 50; // ~16 cols × 50 = 800 bind params (SQLite limit: 999)

let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

/**
 * Flush all buffered log entries to the database in batches.
 * Exported so it can be called during graceful shutdown.
 */
export async function flushLogBuffer(): Promise<void> {
	if (LOG_BUFFER.length === 0 || flushing) return;
	flushing = true;
	try {
		// Drain the buffer
		const entries = LOG_BUFFER.splice(0, LOG_BUFFER.length);
		for (let i = 0; i < entries.length; i += BATCH_SIZE) {
			const batch = entries.slice(i, i + BATCH_SIZE);
			try {
				await db.insert(table.debugLog).values(batch);
			} catch (err) {
				// KEEP: raw console — cannot recursively call logger
				console.error('[logger] Batch flush failed:', err);
			}
		}
	} finally {
		flushing = false;
	}
}

function ensureFlushTimer() {
	if (!flushTimer) {
		flushTimer = setInterval(() => {
			flushLogBuffer();
		}, FLUSH_INTERVAL_MS);
		// Allow the process to exit even if the timer is still running
		if (flushTimer && typeof flushTimer === 'object' && 'unref' in flushTimer) {
			flushTimer.unref();
		}
	}
}

// ---------------------------------------------------------------------------

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

	// Push to buffer instead of direct DB insert
	LOG_BUFFER.push({
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

	// Force-flush if buffer is getting too large
	if (LOG_BUFFER.length >= MAX_BUFFER) {
		flushLogBuffer();
	}

	// Ensure the periodic flush timer is running
	ensureFlushTimer();
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
