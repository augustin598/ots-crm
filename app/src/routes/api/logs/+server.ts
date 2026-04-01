import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logDebug } from '$lib/server/logger';
import type { LogLevel, LogSource } from '$lib/server/logger';

const VALID_LEVELS: LogLevel[] = ['info', 'warning', 'error'];
const VALID_SOURCES: LogSource[] = [
	'server', 'client', 'scheduler', 'plugin', 'email', 'gmail',
	'keez', 'smartbill', 'bnr', 'anaf-spv', 'banking', 'storage',
	'invoice-view', 'google-ads', 'google-ads-dl', 'google-ads-sync',
	'meta-ads', 'invoice-downloader', 'fb-cookies', 'google-cookies',
	'tiktok-ads', 'meta-ads-sync', 'tiktok-ads-sync',
	'tiktok-invoice-downloader', 'tt-cookies'
];

// Simple in-memory rate limit: max 100 logs/minute per user
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
	const now = Date.now();
	const entry = rateLimitMap.get(userId);
	if (!entry || now > entry.resetAt) {
		rateLimitMap.set(userId, { count: 1, resetAt: now + 60_000 });
		return true;
	}
	if (entry.count >= 100) return false;
	entry.count++;
	return true;
}

interface LogInput {
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
}

function validateLogEntry(entry: unknown): entry is LogInput {
	if (!entry || typeof entry !== 'object') return false;
	const e = entry as Record<string, unknown>;
	if (!VALID_LEVELS.includes(e.level as LogLevel)) return false;
	if (!VALID_SOURCES.includes(e.source as LogSource)) return false;
	if (typeof e.message !== 'string' || e.message.length === 0 || e.message.length > 5000) return false;
	return true;
}

// POST /api/logs - receive client-side logs
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	if (!checkRateLimit(locals.user.id)) {
		return json({ error: 'Rate limit exceeded' }, { status: 429 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const entries: unknown[] = Array.isArray(body) ? body : [body];
	if (entries.length > 50) {
		return json({ error: 'Max 50 log entries per request' }, { status: 400 });
	}

	const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
		?? request.headers.get('x-real-ip')
		?? undefined;
	const userAgent = request.headers.get('user-agent') ?? undefined;

	let count = 0;
	for (const entry of entries) {
		if (!validateLogEntry(entry)) continue;

		await logDebug({
			tenantId: locals.tenant?.id ?? null,
			level: entry.level,
			source: entry.source,
			message: entry.message,
			url: entry.url,
			stackTrace: entry.stackTrace,
			metadata: entry.metadata,
			userId: locals.user.id,
			action: entry.action,
			errorCode: entry.errorCode,
			requestId: entry.requestId,
			duration: entry.duration,
			ipAddress,
			userAgent
		});
		count++;
	}

	return json({ success: true, count });
};
