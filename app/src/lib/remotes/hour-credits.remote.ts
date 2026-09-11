/**
 * Bugete ore (creditul de ore per client) — citire pentru staff, mutații owner/admin.
 *
 * Soldul e în minute la tariful de referință; UI-ul îl afișează în ore/minute
 * (`formatMinutes`). Scrierile trec toate prin `$lib/server/hour-credits.ts`.
 */
import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/get-actor';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import {
	applyLedgerEntry,
	creditPaidHoursOrder,
	creditPaidInvoice,
	getClientHourCredit,
	getHourCreditsOverview,
	listUncreditedInvoices
} from '$lib/server/hour-credits';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import { resolveReferenceRate } from '$lib/logic/hourly-catalog';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

async function requireStaffTenant(): Promise<{ tenantId: string; role: string | undefined }> {
	const event = getRequestEvent();
	if (!event?.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);
	return { tenantId: event.locals.tenant.id, role: event.locals.tenantUser?.role };
}

async function requireOwnerOrAdmin(): Promise<{ tenantId: string; userId: string }> {
	const event = getRequestEvent();
	if (!event?.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Doar owner-ul sau un admin pot modifica creditul de ore.');
	}
	return { tenantId: event.locals.tenant.id, userId: event.locals.user.id };
}

const clientIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(64));

// ── Citire ───────────────────────────────────────────────────────────────────

export const getHourCreditsPage = query(async () => {
	const { tenantId, role } = await requireStaffTenant();
	const [rows, uncredited, catalog] = await Promise.all([
		getHourCreditsOverview(tenantId),
		listUncreditedInvoices(tenantId),
		getHourlyCatalog(tenantId)
	]);
	const reference = resolveReferenceRate(catalog.rates, catalog.rules);
	return {
		rows,
		uncredited,
		reference: reference ? { label: reference.label, rateEur: reference.rateEur } : null,
		lowCreditThresholdMinutes: catalog.rules.lowCreditThresholdMinutes,
		canEdit: role === 'owner' || role === 'admin'
	};
});

export const getClientHourCreditView = query(clientIdSchema, async (clientId) => {
	const { tenantId, role } = await requireStaffTenant();
	const [view, catalog] = await Promise.all([
		getClientHourCredit(tenantId, clientId),
		getHourlyCatalog(tenantId)
	]);
	if (!view) throw error(404, 'Clientul nu există.');
	const reference = resolveReferenceRate(catalog.rates, catalog.rules);
	return {
		...view,
		reference: reference ? { label: reference.label, rateEur: reference.rateEur } : null,
		stepMinutes: catalog.rules.stepMinutes,
		lowCreditThresholdMinutes: catalog.rules.lowCreditThresholdMinutes,
		canEdit: role === 'owner' || role === 'admin'
	};
});

// ── Mutații (owner/admin) ────────────────────────────────────────────────────

export const setClientHourCreditFromInvoices = command(
	v.object({ clientId: clientIdSchema, enabled: v.boolean() }),
	async (data) => {
		const { tenantId } = await requireOwnerOrAdmin();
		await withTursoBusyRetry(
			() =>
				db
					.update(table.client)
					.set({ hourCreditFromInvoices: data.enabled, updatedAt: new Date() })
					.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, tenantId))),
			{ tenantId, label: 'hour-credits.setOptIn' }
		);
		return { ok: true as const };
	}
);

export const adjustHourCredit = command(
	v.object({
		clientId: clientIdSchema,
		/** Minute, semnat, multiplu de pas; validat și pe server. */
		deltaMinutes: v.pipe(v.number(), v.integer(), v.minValue(-100_000), v.maxValue(100_000)),
		note: v.pipe(v.string(), v.trim(), v.minLength(5), v.maxLength(300))
	}),
	async (data) => {
		const { tenantId, userId } = await requireOwnerOrAdmin();
		if (data.deltaMinutes === 0) throw error(400, 'Ajustarea nu poate fi zero.');
		const catalog = await getHourlyCatalog(tenantId);
		if (data.deltaMinutes % catalog.rules.stepMinutes !== 0) {
			throw error(400, `Ajustarea trebuie să fie multiplu de ${catalog.rules.stepMinutes} minute.`);
		}
		const [client] = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!client) throw error(404, 'Clientul nu există.');
		const id = generateId();
		const reference = resolveReferenceRate(catalog.rates, catalog.rules);
		await applyLedgerEntry(
			{
				tenantId,
				clientId: data.clientId,
				deltaMinutes: data.deltaMinutes,
				kind: 'manual',
				sourceType: 'manual',
				sourceId: id,
				note: data.note,
				createdByUserId: userId,
				referenceRateEurSnapshot: reference?.rateEur ?? null
			},
			{ id }
		);
		return { ok: true as const };
	}
);

export const creditInvoiceNow = command(
	v.object({ invoiceId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)) }),
	async (data) => {
		const { tenantId, userId } = await requireOwnerOrAdmin();
		const result = await creditPaidInvoice({
			tenantId,
			invoiceId: data.invoiceId,
			trigger: 'manual',
			userId
		});
		if (result.status === 'failed' || result.status === 'skipped') {
			throw error(400, `Nu s-a creditat: ${result.reason}.`);
		}
		return result;
	}
);

export const creditHoursOrderNow = command(
	v.object({ orderId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)) }),
	async (data) => {
		const { tenantId, userId } = await requireOwnerOrAdmin();
		const result = await creditPaidHoursOrder({ tenantId, orderId: data.orderId, userId });
		if (result.status === 'failed' || result.status === 'skipped') {
			throw error(400, `Nu s-a creditat: ${result.reason}.`);
		}
		return result;
	}
);
