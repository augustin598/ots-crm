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
	RECENT_INVOICE_MONTHS,
	getHourCreditsOverview,
	getMonthlyReport,
	listClientCreditTasks,
	listCancelledCreditedInvoices,
	listHoursOrders,
	listUncreditedInvoices,
	reverseCancelledInvoiceCredit
} from '$lib/server/hour-credits';
import {
	createHourCreditOrder,
	listUninvoicedHourCredits,
	quoteHourCreditOrder,
	reissueHourCreditInvoice
} from '$lib/server/hour-credit-orders';
import { MAX_HOURS_MAX, activeModes, activeRates } from '$lib/logic/hourly-catalog';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import {
	computeReservedMinutes,
	listUnbilledOverages,
	listUnsettledDoneTasks,
	regenerateOverageDraft,
	settleTaskCredit
} from '$lib/server/task-credit';
import { resolveReferenceRate } from '$lib/logic/hourly-catalog';
import { computeExpiryDate } from '$lib/logic/hour-credit-expiry';
import { notifyHourCreditEvent } from '$lib/server/hour-credit-notifications';

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
	const [
		rows,
		uncredited,
		catalog,
		unbilledOverages,
		unsettledDone,
		cancelledCredited,
		uninvoicedCredits
	] = await Promise.all([
		getHourCreditsOverview(tenantId),
		listUncreditedInvoices(tenantId),
		getHourlyCatalog(tenantId),
		listUnbilledOverages(tenantId),
		listUnsettledDoneTasks(tenantId),
		listCancelledCreditedInvoices(tenantId),
		listUninvoicedHourCredits(tenantId)
	]);
	const reference = resolveReferenceRate(catalog.rates, catalog.rules);
	const reserved = await computeReservedMinutes(
		tenantId,
		rows.map((r) => r.clientId)
	);
	const withReserved = rows.map((r) => ({
		...r,
		reservedMinutes: reserved.get(r.clientId) ?? 0
	}));

	// KPI-urile din capul paginii. Le calculăm aici, nu în componentă: aceleași
	// cifre ajung și în widgetul de Dashboard, iar „sub prag" e o regulă de
	// business (disponibil = sold − rezervat), nu o decizie de afișare.
	const threshold = catalog.rules.lowCreditThresholdMinutes;
	const endOfMonth = new Date(
		Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)
	);
	// Clienții activi fără buget sunt în listă doar pentru bifă — altfel toți ar
	// umfla „pe N clienți" și ar apărea „sub prag" cu sold 0.
	const trackedRows = withReserved.filter((r) => r.tracked);
	const lowRows = trackedRows.filter((r) => r.balanceMinutes - r.reservedMinutes < threshold);
	const kpis = {
		totalBalanceMinutes: trackedRows.reduce((s, r) => s + r.balanceMinutes, 0),
		totalReservedMinutes: trackedRows.reduce((s, r) => s + r.reservedMinutes, 0),
		clientCount: trackedRows.length,
		lowCount: lowRows.length,
		negativeCount: lowRows.filter((r) => r.balanceMinutes < 0).length,
		expiringThisMonthMinutes: trackedRows.reduce(
			(s, r) => (r.expiring && r.expiring.on < endOfMonth ? s + r.expiring.minutes : s),
			0
		),
		expiringClientCount: trackedRows.filter((r) => r.expiring && r.expiring.on < endOfMonth).length
	};

	return {
		rows: withReserved,
		uncredited,
		// Tabul „De rezolvat": bani care altfel s-ar pierde fără urmă.
		issues: { unbilledOverages, unsettledDone, cancelledCredited, uninvoicedCredits },
		kpis,
		reference: reference ? { label: reference.label, rateEur: reference.rateEur } : null,
		lowCreditThresholdMinutes: threshold,
		recentInvoiceMonths: RECENT_INVOICE_MONTHS,
		canEdit: role === 'owner' || role === 'admin'
	};
});

export const getClientHourCreditView = query(clientIdSchema, async (clientId) => {
	const { tenantId, role } = await requireStaffTenant();
	const [view, catalog, tasks] = await Promise.all([
		getClientHourCredit(tenantId, clientId),
		getHourlyCatalog(tenantId),
		listClientCreditTasks(tenantId, clientId)
	]);
	if (!view) throw error(404, 'Clientul nu există.');
	const reference = resolveReferenceRate(catalog.rates, catalog.rules);
	const reserved = await computeReservedMinutes(tenantId, [clientId]);
	return {
		...view,
		tasks,
		reservedMinutes: reserved.get(clientId) ?? 0,
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
				referenceRateEurSnapshot: reference?.rateEur ?? null,
				// Doar alimentările au termen; o ajustare în minus e consum, nu lot.
				expiresAt:
					data.deltaMinutes > 0
						? computeExpiryDate(new Date(), catalog.rules.creditExpiryDays)
						: null
			},
			{ id }
		);
		if (data.deltaMinutes > 0) {
			await notifyHourCreditEvent({
				tenantId,
				clientId: data.clientId,
				event: { kind: 'credited', minutes: data.deltaMinutes, source: 'ajustare manuală' }
			});
		}
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

// ── Taburile „Comenzi ore" și „Raport lunar" ─────────────────────────────────

export const getHoursOrdersPage = query(async () => {
	const { tenantId } = await requireStaffTenant();
	const [orders, catalog] = await Promise.all([
		listHoursOrders(tenantId),
		getHourlyCatalog(tenantId, { includeInactive: true })
	]);
	// Eticheta regimului vine din catalog cu `includeInactive`: un regim dezactivat
	// între comandă și afișare trebuie să apară tot cu numele lui.
	const modeLabels = new Map(catalog.modes.map((m) => [m.slug as string, m.label]));
	return {
		orders: orders.map((o) => ({ ...o, modeLabel: modeLabels.get(o.modeSlug) ?? o.modeSlug }))
	};
});

export const getMonthlyHourReport = query(async () => {
	const { tenantId } = await requireStaffTenant();
	const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
	const labels = new Map(catalog.rates.map((r) => [r.slug, r.label]));
	return getMonthlyReport(tenantId, labels);
});

// ── Modalul „Adaugă ore" ─────────────────────────────────────────────────────

/** Catalogul pentru selectoarele din modal (doar ce e activ azi). */
export const getHourOrderOptions = query(async () => {
	const { tenantId } = await requireStaffTenant();
	const catalog = await getHourlyCatalog(tenantId);
	return {
		rates: activeRates(catalog.rates).map((r) => ({
			slug: r.slug,
			label: r.label,
			rateEur: r.rateEur
		})),
		modes: activeModes(catalog.modes).map((m) => ({
			slug: m.slug,
			label: m.label,
			sla: m.sla,
			description: m.description,
			multiplierPct: m.multiplierPct,
			maxHours: m.maxHours
		}))
	};
});

const orderDraftSchema = v.object({
	rateSlug: v.pipe(v.string(), v.minLength(1), v.maxLength(40)),
	modeSlug: v.pipe(v.string(), v.minLength(1), v.maxLength(40)),
	hours: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_HOURS_MAX)),
	/** Fără client nu putem ști dacă e operațiune cu TVA 0 (intracom/export). */
	clientId: v.optional(v.string())
});

/**
 * Previewul de preț al modalului. Rulează pe server cu ACELEAȘI reguli ca
 * submitul, ca suma afișată să nu poată diverge de cea facturată.
 */
export const quoteHourCredit = query(orderDraftSchema, async (data) => {
	const { tenantId } = await requireStaffTenant();
	return quoteHourCreditOrder({ tenantId, ...data });
});

export const addHoursToClient = command(
	v.object({
		clientId: clientIdSchema,
		rateSlug: v.pipe(v.string(), v.minLength(1), v.maxLength(40)),
		modeSlug: v.pipe(v.string(), v.minLength(1), v.maxLength(40)),
		hours: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_HOURS_MAX)),
		requestedWindow: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200))),
		/** Nimic nu pleacă spre client fără bifă explicită. */
		sendEmail: v.boolean(),
		/** Cheia de idempotență generată de modal (dublu click / retry). */
		requestId: v.optional(v.pipe(v.string(), v.minLength(8), v.maxLength(64)))
	}),
	async (data) => {
		const { tenantId, userId } = await requireOwnerOrAdmin();
		try {
			return await createHourCreditOrder({
				tenantId,
				userId,
				clientId: data.clientId,
				rateSlug: data.rateSlug,
				modeSlug: data.modeSlug,
				hours: data.hours,
				requestedWindow: data.requestedWindow || null,
				sendEmail: data.sendEmail,
				requestId: data.requestId ?? null
			});
		} catch (err) {
			throw error(400, err instanceof Error ? err.message : 'Nu am putut adăuga orele.');
		}
	}
);

// ── Tabul „De rezolvat" (owner/admin) ────────────────────────────────────────

const taskIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(64));

/** Recreează (sau relegă) linia de depășire a unui task decontat fără factură. */
export const regenerateTaskOverage = command(taskIdSchema, async (taskId) => {
	const { tenantId } = await requireOwnerOrAdmin();
	const result = await regenerateOverageDraft({ tenantId, taskId });
	if (result.status === 'skipped') throw error(400, `Nu s-a regenerat: ${result.reason}.`);
	return result;
});

/** Decontează un task rămas Done fără decontare (ex. lipsea tariful de referință). */
export const settleDoneTaskNow = command(
	v.object({
		taskId: taskIdSchema,
		/** Obligatoriu când taskul n-are ore efective salvate. */
		actualMinutes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(999 * 60)))
	}),
	async ({ taskId, actualMinutes }) => {
		const { tenantId, userId } = await requireOwnerOrAdmin();
		const [task] = await db
			.select({ status: table.task.status, actualMinutes: table.task.actualMinutes })
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
			.limit(1);
		if (!task) throw error(404, 'Taskul nu există.');
		if (task.status !== 'done') throw error(400, 'Doar taskurile Done se decontează de aici.');
		// Orele salvate pe task au prioritate; valoarea din client contează doar când lipsesc.
		const hasSaved = (task.actualMinutes ?? 0) > 0;
		if (!hasSaved && !actualMinutes) {
			throw error(400, 'Completează orele efective ale taskului.');
		}
		const result = await settleTaskCredit({
			tenantId,
			taskId,
			userId,
			actualMinutes: hasSaved ? undefined : actualMinutes
		});
		if (result.status !== 'settled') throw error(400, `Nu s-a decontat: ${result.reason}.`);
		return result;
	}
);

/** Retrage orele date de o factură anulată. */
export const reverseCancelledInvoiceHours = command(
	v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	async (invoiceId) => {
		const { tenantId, userId } = await requireOwnerOrAdmin();
		const result = await reverseCancelledInvoiceCredit({ tenantId, invoiceId, userId });
		if (result.status === 'skipped') throw error(400, `Nu s-a stornat: ${result.reason}.`);
		return result;
	}
);

/** Emite factura unor ore adăugate din admin fără factură (curs BNR lipsă, INSERT eșuat). */
export const issueHourCreditInvoiceNow = command(
	v.object({
		ledgerEntryId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
		/** Nimic nu pleacă spre client fără bifă explicită. */
		sendEmail: v.boolean()
	}),
	async (data) => {
		const { tenantId, userId } = await requireOwnerOrAdmin();
		try {
			return await reissueHourCreditInvoice({ tenantId, userId, ...data });
		} catch (err) {
			throw error(400, err instanceof Error ? err.message : 'Nu am putut emite factura.');
		}
	}
);
