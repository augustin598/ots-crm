import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { processHostingExpiryGuard } from '$lib/server/scheduler/tasks/hosting-expiry-guard';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { render as renderSuspended } from '$lib/server/hosting/email-templates/suspended';
import { sendWithPersistence, fetchTenantBrand, resolveFromEmail } from '$lib/server/email';
import type { RequestHandler } from './$types';

/**
 * Hosting expiry-guard probe.
 *
 * GET  → DRY-RUN only (read-only): lists which active hosting accounts WOULD be
 *        suspended (unpaid renewal invoice past due + 10-day grace), scoped to
 *        this tenant. Never suspends.
 * POST ?confirm=yes → LIVE run: actually emits the suspend hook for the candidates.
 * POST ?action=test-email&to=addr → renders the real "hosting suspended" email
 *        (renderSuspended) and sends it via the real pipeline (sendWithPersistence)
 *        to `to` (default office@onetopsolution.ro). Validates end-to-end dispatch
 *        WITHOUT suspending any account. Admin-gated.
 */
function assertAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	return event.locals.tenant.id;
}

export const GET: RequestHandler = async (event) => {
	const tenantId = assertAdmin(event);
	const result = await processHostingExpiryGuard({ dryRun: true, tenantId });
	return json({ mode: 'dry-run', ...result });
};

export const POST: RequestHandler = async (event) => {
	const tenantId = assertAdmin(event);
	const action = event.url.searchParams.get('action');

	if (action === 'test-email') {
		const to = event.url.searchParams.get('to') || 'office@onetopsolution.ro';
		const { subject, html } = await renderSuspended({
			tenantId,
			domain: 'exemplu-test.ro',
			clientName: 'Client Test',
			invoiceNumber: 'TEST-SUSPEND-001',
			invoiceDate: new Date().toLocaleDateString('ro-RO'),
			amountDue: 9990, // cents → 99.90 RON
			currency: 'RON',
			payUrl: `https://clients.onetopsolution.ro/${event.params.tenant}/invoices/test/pay`,
			supportEmail: 'support@onetopsolution.ro'
		});
		await sendWithPersistence(
			{
				tenantId,
				toEmail: to,
				subject: `[TEST] ${subject}`,
				emailType: 'hosting-suspended',
				metadata: { test: true },
				htmlBody: html,
				payload: null
			},
			async () => {
				const brand = await fetchTenantBrand(tenantId);
				const [settings] = await db
					.select()
					.from(table.emailSettings)
					.where(eq(table.emailSettings.tenantId, tenantId))
					.limit(1);
				const fromEmail = resolveFromEmail(settings ?? null);
				return {
					from: `"${brand.tenantName}" <${fromEmail}>`,
					to,
					subject: `[TEST] ${subject}`,
					html,
					...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {})
				};
			}
		);
		return json({ mode: 'test-email', sentTo: to, subject: `[TEST] ${subject}` });
	}

	if (event.url.searchParams.get('confirm') !== 'yes') {
		throw error(400, 'Refusing live run without ?confirm=yes (use GET for a dry-run first)');
	}
	const result = await processHostingExpiryGuard({ dryRun: false, tenantId });
	return json({ mode: 'live', ...result });
};
