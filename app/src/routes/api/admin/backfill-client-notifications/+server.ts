import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, or, isNotNull } from 'drizzle-orm';
import { createNotification } from '$lib/server/notifications';
import { logInfo, logError } from '$lib/server/logger';

/**
 * POST /api/admin/backfill-client-notifications
 *
 * One-time backfill: generates notifications from existing invoices, contracts,
 * and leads so the per-client activity feed has historical data.
 *
 * Requires admin/owner authentication.
 */
/** GET is provided for convenience — call from browser address bar while logged in as admin. */
export const GET: RequestHandler = async (event) => POST(event);

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// Check role
	const [tenantUser] = await db
		.select({ role: table.tenantUser.role })
		.from(table.tenantUser)
		.where(
			and(
				eq(table.tenantUser.tenantId, locals.tenant.id),
				eq(table.tenantUser.userId, locals.user.id)
			)
		)
		.limit(1);

	if (!tenantUser || (tenantUser.role !== 'owner' && tenantUser.role !== 'server')) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const tenantId = locals.tenant.id;
	const tenantSlug = locals.tenant.slug;
	const userId = locals.user.id;

	let created = 0;
	const errors: string[] = [];

	try {
		// ---- 1. Invoice notifications ----
		const invoices = await db
			.select({
				id: table.invoice.id,
				clientId: table.invoice.clientId,
				invoiceNumber: table.invoice.invoiceNumber,
				status: table.invoice.status,
				createdAt: table.invoice.createdAt
			})
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.tenantId, tenantId),
					isNotNull(table.invoice.clientId)
				)
			)
			.orderBy(desc(table.invoice.createdAt));

		for (const inv of invoices) {
			try {
				// invoice.created for all invoices
				await createNotification({
					tenantId,
					userId,
					clientId: inv.clientId,
					type: 'invoice.created',
					title: 'Factură creată',
					message: `Factura ${inv.invoiceNumber || 'N/A'} a fost creată`,
					link: `/${tenantSlug}/invoices/${inv.id}`,
					metadata: { invoiceId: inv.id, backfill: true }
				});
				created++;

				// invoice.paid if status is paid
				if (inv.status === 'paid') {
					await createNotification({
						tenantId,
						userId,
						clientId: inv.clientId,
						type: 'invoice.paid',
						title: 'Factură plătită',
						message: `Factura ${inv.invoiceNumber || 'N/A'} a fost marcată ca plătită`,
						link: `/${tenantSlug}/invoices/${inv.id}`,
						metadata: { invoiceId: inv.id, backfill: true }
					});
					created++;
				}

				// invoice.overdue if status is overdue
				if (inv.status === 'overdue') {
					await createNotification({
						tenantId,
						userId,
						clientId: inv.clientId,
						type: 'invoice.overdue',
						title: 'Factură restantă',
						message: `Factura ${inv.invoiceNumber || 'N/A'} a depășit termenul de plată`,
						link: `/${tenantSlug}/invoices/${inv.id}`,
						metadata: { invoiceId: inv.id, backfill: true }
					});
					created++;
				}
			} catch (e) {
				errors.push(`invoice ${inv.id}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		// ---- 2. Contract notifications ----
		const contracts = await db
			.select({
				id: table.contract.id,
				clientId: table.contract.clientId,
				contractNumber: table.contract.contractNumber,
				contractTitle: table.contract.contractTitle,
				status: table.contract.status,
				createdAt: table.contract.createdAt
			})
			.from(table.contract)
			.where(eq(table.contract.tenantId, tenantId))
			.orderBy(desc(table.contract.createdAt));

		for (const c of contracts) {
			try {
				if (c.status === 'signed' || c.status === 'active' || c.status === 'expired') {
					await createNotification({
						tenantId,
						userId,
						clientId: c.clientId,
						type: 'contract.signed',
						title: 'Contract semnat',
						message: `Contractul "${c.contractTitle}" (${c.contractNumber}) a fost semnat`,
						link: `/${tenantSlug}/contracts/${c.id}`,
						metadata: { contractId: c.id, backfill: true }
					});
					created++;
				}

				if (c.status === 'active') {
					await createNotification({
						tenantId,
						userId,
						clientId: c.clientId,
						type: 'contract.activated',
						title: 'Contract activat',
						message: `Contractul "${c.contractTitle}" (${c.contractNumber}) este activ`,
						link: `/${tenantSlug}/contracts/${c.id}`,
						metadata: { contractId: c.id, backfill: true }
					});
					created++;
				}

				if (c.status === 'expired') {
					await createNotification({
						tenantId,
						userId,
						clientId: c.clientId,
						type: 'contract.expired',
						title: 'Contract expirat',
						message: `Contractul "${c.contractTitle}" (${c.contractNumber}) a expirat`,
						link: `/${tenantSlug}/contracts/${c.id}`,
						metadata: { contractId: c.id, backfill: true }
					});
					created++;
				}
			} catch (e) {
				errors.push(`contract ${c.id}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		// ---- 3. Lead notifications (grouped by client) ----
		const leadsWithClient = await db
			.select({
				clientId: table.lead.clientId,
				platform: table.lead.platform
			})
			.from(table.lead)
			.where(
				and(
					eq(table.lead.tenantId, tenantId),
					isNotNull(table.lead.clientId)
				)
			);

		// Group leads by clientId
		const leadsByClient = new Map<string, { count: number; platforms: Set<string> }>();
		for (const lead of leadsWithClient) {
			if (!lead.clientId) continue;
			const existing = leadsByClient.get(lead.clientId) || { count: 0, platforms: new Set() };
			existing.count++;
			existing.platforms.add(lead.platform);
			leadsByClient.set(lead.clientId, existing);
		}

		for (const [clientId, data] of leadsByClient) {
			try {
				const platformLabel = [...data.platforms].join(', ');
				await createNotification({
					tenantId,
					userId,
					clientId,
					type: 'lead.imported',
					title: `${data.count} leaduri importate`,
					message: `${data.count} leaduri din ${platformLabel} asociate acestui client`,
					link: `/${tenantSlug}/leads/facebook-ads`,
					metadata: { leadCount: data.count, backfill: true }
				});
				created++;
			} catch (e) {
				errors.push(`leads for client ${clientId}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		logInfo('server', `Backfill client notifications completed: ${created} created`, {
			tenantId,
			metadata: { created, errors: errors.length }
		});

		return json({
			success: true,
			created,
			invoices: invoices.length,
			contracts: contracts.length,
			leadsClients: leadsByClient.size,
			errors: errors.length > 0 ? errors : undefined
		});
	} catch (error) {
		logError('server', 'Backfill client notifications failed', {
			tenantId,
			metadata: { error: error instanceof Error ? error.message : String(error) }
		});
		return json({ error: 'Backfill failed' }, { status: 500 });
	}
};
