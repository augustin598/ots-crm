import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { inlineEmailCids } from '$lib/server/email-preview';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}

	const logId = event.params.logId;
	const tenantId = event.locals.tenant.id;

	const [log] = await db
		.select({ htmlBody: table.emailLog.htmlBody, metadata: table.emailLog.metadata })
		.from(table.emailLog)
		.where(and(eq(table.emailLog.id, logId), eq(table.emailLog.tenantId, tenantId)))
		.limit(1);

	if (!log) {
		throw error(404, 'Email log not found');
	}
	if (!log.htmlBody) {
		throw error(404, 'No HTML preview available for this email');
	}

	// Logo-ul și pozele din comentarii sunt referite prin `cid:` (piese MIME) —
	// un browser nu le poate rezolva. Le înlocuim cu `data:` URI ca preview-ul
	// să arate ce vede destinatarul, nu imagini rupte.
	let metadata: Record<string, unknown> | null = null;
	if (log.metadata) {
		try {
			metadata = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
		} catch {
			metadata = null;
		}
	}
	const html = await inlineEmailCids(log.htmlBody, { tenantId, metadata });

	return new Response(html, {
		status: 200,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Content-Security-Policy':
				"default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:;",
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
