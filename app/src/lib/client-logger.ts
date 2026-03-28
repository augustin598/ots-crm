import { toast } from 'svelte-sonner';
import { ERROR_CODES, getUserMessage, type ErrorCode } from '$lib/error-codes';
import type { LogLevel, LogSource } from '$lib/server/logger';

interface ClientLogEntry {
	level: LogLevel;
	source: LogSource;
	message: string;
	url?: string;
	stackTrace?: string;
	metadata?: Record<string, unknown>;
	action?: string;
	errorCode?: string;
	requestId?: string;
	duration?: number;
	showToast?: boolean;
	toastMessage?: string;
}

const CONSOLE_METHOD: Record<LogLevel, 'log' | 'warn' | 'error'> = {
	info: 'log',
	warning: 'warn',
	error: 'error'
};

// Buffer for batching logs to server
let logBuffer: ClientLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const LOG_BUFFER_MAX_SIZE = 10;
const LOG_BUFFER_FLUSH_INTERVAL = 5000;

// Anti-flood: track recent logs
const recentLogs = new Map<string, { count: number; firstAt: number }>();
const FLOOD_WINDOW = 5000;
const FLOOD_MAX_SAME = 5;

function getFloodKey(entry: ClientLogEntry): string {
	return `${entry.errorCode || ''}:${entry.action || ''}:${entry.source}`;
}

function isFlooded(entry: ClientLogEntry): boolean {
	const key = getFloodKey(entry);
	const now = Date.now();
	const existing = recentLogs.get(key);

	if (!existing || now - existing.firstAt > FLOOD_WINDOW) {
		recentLogs.set(key, { count: 1, firstAt: now });
		return false;
	}

	existing.count++;
	return existing.count > FLOOD_MAX_SAME;
}

async function flushLogs() {
	if (logBuffer.length === 0) return;

	const entries = logBuffer.splice(0);
	try {
		const response = await fetch('/api/logs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(entries)
		});
		if (!response.ok) {
			console.error('[OTS] Failed to flush logs:', response.status);
		}
	} catch {
		console.error('[OTS] Failed to flush logs: network error');
	}
}

function scheduleFlush() {
	if (flushTimer) return;
	flushTimer = setTimeout(() => {
		flushTimer = null;
		flushLogs();
	}, LOG_BUFFER_FLUSH_INTERVAL);
}

function bufferLog(entry: ClientLogEntry) {
	if (isFlooded(entry)) return;

	logBuffer.push(entry);
	if (logBuffer.length >= LOG_BUFFER_MAX_SIZE) {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		flushLogs();
	} else {
		scheduleFlush();
	}
}

function showToast(entry: ClientLogEntry) {
	const message = entry.toastMessage
		|| (entry.errorCode ? getUserMessage(entry.errorCode) : null)
		|| entry.message;

	switch (entry.level) {
		case 'error':
			toast.error(message);
			break;
		case 'warning':
			toast.warning(message);
			break;
		case 'info':
			toast.info(message);
			break;
	}
}

function logEntry(entry: ClientLogEntry) {
	// 1. Console output
	const method = CONSOLE_METHOD[entry.level];
	const codeTag = entry.errorCode ? `[${entry.errorCode}]` : '';
	const actionTag = entry.action ? `[${entry.action}]` : '';
	const prefix = `[OTS][${entry.source.toUpperCase()}]${codeTag}${actionTag}`;
	if (entry.metadata && Object.keys(entry.metadata).length > 0) {
		console[method](prefix, entry.message, entry.metadata);
	} else {
		console[method](prefix, entry.message);
	}

	// 2. Toast (default ON for error/warning, OFF for info)
	const shouldToast = entry.showToast ?? (entry.level === 'error' || entry.level === 'warning');
	if (shouldToast && typeof window !== 'undefined') {
		showToast(entry);
	}

	// 3. Buffer for server persist
	if (typeof window !== 'undefined') {
		// Strip toast-only fields before sending to server
		const { showToast: _st, toastMessage: _tm, ...serverEntry } = entry;
		serverEntry.url = serverEntry.url || window.location.pathname;
		bufferLog(serverEntry);
	}
}

// Serialize unknown errors safely
function extractErrorDetails(error: unknown): { message: string; stack?: string; status?: number } {
	if (error instanceof Error) {
		return {
			message: error.message,
			stack: error.stack,
			status: (error as { status?: number }).status
		};
	}
	return { message: String(error) };
}

// ===================== PUBLIC API =====================

export const clientLogger = {
	error(params: Partial<ClientLogEntry> & { message: string }) {
		logEntry({ level: 'error', source: 'client', ...params });
	},

	warn(params: Partial<ClientLogEntry> & { message: string }) {
		logEntry({ level: 'warning', source: 'client', ...params });
	},

	info(params: Partial<ClientLogEntry> & { message: string }) {
		logEntry({ level: 'info', source: 'client', showToast: false, ...params });
	},

	apiError(action: string, error: unknown, errorCode?: string) {
		const details = extractErrorDetails(error);
		logEntry({
			level: 'error',
			source: 'client',
			action,
			message: details.message,
			stackTrace: details.stack,
			errorCode: errorCode || 'SYSTEM_UNEXPECTED',
			metadata: { status: details.status },
			showToast: true
		});
	},

	validationError(action: string, errorCode: string) {
		const def = ERROR_CODES[errorCode as ErrorCode];
		logEntry({
			level: def?.severity || 'warning',
			source: 'client',
			action,
			message: def?.internalMessage || errorCode,
			errorCode,
			showToast: true
		});
	},

	networkError(action: string, error: unknown) {
		const details = extractErrorDetails(error);
		let errorCode = 'NETWORK_FETCH_FAILED';

		if (typeof window !== 'undefined' && !navigator.onLine) {
			errorCode = 'NETWORK_OFFLINE';
		} else if (details.message.includes('AbortError') || details.message.includes('timeout')) {
			errorCode = 'NETWORK_TIMEOUT';
		} else if (details.status && details.status >= 500) {
			errorCode = 'NETWORK_SERVER_ERROR';
		}

		logEntry({
			level: 'error',
			source: 'client',
			action,
			message: details.message,
			stackTrace: details.stack,
			errorCode,
			showToast: true
		});
	},

	performanceLog(action: string, durationMs: number) {
		logEntry({
			level: durationMs >= 3000 ? 'warning' : 'info',
			source: 'client',
			action,
			message: `${action} took ${durationMs}ms`,
			duration: durationMs,
			showToast: false
		});
	},

	/** Force flush any buffered logs (call on page unload) */
	flush() {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		if (logBuffer.length > 0 && typeof navigator !== 'undefined' && navigator.sendBeacon) {
			navigator.sendBeacon('/api/logs', JSON.stringify(logBuffer.splice(0)));
		} else {
			flushLogs();
		}
	}
};
