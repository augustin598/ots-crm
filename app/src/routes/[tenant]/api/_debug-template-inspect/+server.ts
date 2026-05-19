/**
 * One-off inspector for recurringInvoice + linked hostingAccount. Useful when
 * the helper produces unexpected output and we need to see the raw data.
 *
 *   GET /[tenant]/api/_debug-template-inspect?templateId=<id>
 *   GET /[tenant]/api/_debug-template-inspect?hostingAccountId=<id>
 *
 * Admin-only.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;
	const templateId = event.url.searchParams.get('templateId');
	const hostingAccountId = event.url.searchParams.get('hostingAccountId');

	if (!templateId && !hostingAccountId) {
		throw error(400, 'templateId or hostingAccountId query param is required');
	}

	let templates;
	if (templateId) {
		templates = await db
			.select()
			.from(table.recurringInvoice)
			.where(
				and(
					eq(table.recurringInvoice.id, templateId),
					eq(table.recurringInvoice.tenantId, tenantId)
				)
			)
			.limit(1);
	} else {
		templates = await db
			.select()
			.from(table.recurringInvoice)
			.where(
				and(
					eq(table.recurringInvoice.hostingAccountId, hostingAccountId!),
					eq(table.recurringInvoice.tenantId, tenantId)
				)
			)
			.limit(1);
	}

	const template = templates[0];
	if (!template) {
		return json({ ok: false, reason: 'template_not_found' }, { status: 404 });
	}

	let hostingAccount = null;
	if (template.hostingAccountId) {
		const rows = await db
			.select()
			.from(table.hostingAccount)
			.where(
				and(
					eq(table.hostingAccount.id, template.hostingAccountId),
					eq(table.hostingAccount.tenantId, tenantId)
				)
			)
			.limit(1);
		hostingAccount = rows[0] ?? null;
	}

	return json({ ok: true, template, hostingAccount });
};
