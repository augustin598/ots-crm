/**
 * Creditul de ore — scrierile în ledger și alimentările.
 *
 * Toate scrierile trec prin `applyLedgerEntry`: inserția în `client_hour_ledger`
 * și actualizarea cache-ului `client.hour_credit_minutes` se fac în aceeași
 * tranzacție, printr-un UPDATE relativ (`+ delta`), nu „citește + scrie" — două
 * scrieri simultane nu pot pierde minute. Conflictul pe indexul unic parțial
 * (evenimente livrate de două ori) e tratat ca „deja aplicat", nu ca eroare.
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';
import { loadBnrFxRates } from '$lib/server/bnr/client';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import { resolveReferenceRate } from '$lib/logic/hourly-catalog';
import {
	eurCentsToReferenceMinutes,
	invoiceCreditEligibility,
	netToEurCents,
	startOfMonthUtc,
	type LedgerKind,
	type LedgerSourceType
} from '$lib/logic/hour-credits';
import { formatExchangeRate } from '$lib/logic/hours-pricing';
import { notifyHourCreditEvent } from '$lib/server/hour-credit-notifications';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export interface LedgerEntryInput {
	tenantId: string;
	clientId: string;
	deltaMinutes: number;
	kind: LedgerKind;
	sourceType: LedgerSourceType;
	sourceId: string;
	note?: string | null;
	createdByUserId?: string | null;
	referenceRateEurSnapshot?: number | null;
	netCentsSnapshot?: number | null;
	currencySnapshot?: string | null;
	fxRateSnapshot?: string | null;
	rateSlug?: string | null;
	modeSlug?: string | null;
	rateEurSnapshot?: number | null;
	multiplierPctSnapshot?: number | null;
	realMinutes?: number | null;
}

/**
 * Conflict pe indexul unic (parțial) = evenimentul a fost deja aplicat.
 *
 * Verificarea merge pe lanțul `cause`: drizzle împachetează eroarea libSQL într-un
 * `DrizzleQueryError` al cărui mesaj e doar „Failed query: insert into …", deci un
 * test pe mesajul de la vârf ar rata conflictul și ar arunca o eroare 500 la a doua
 * livrare a aceluiași webhook. Prins de testul de integrare (hour-credits-integration).
 */
function isUniqueViolation(err: unknown): boolean {
	let current: unknown = err;
	for (let depth = 0; current && depth < 6; depth++) {
		const e = current as { message?: unknown; code?: unknown; rawCode?: unknown; cause?: unknown };
		if (typeof e.code === 'string' && e.code.includes('SQLITE_CONSTRAINT')) return true;
		// 2067 = SQLITE_CONSTRAINT_UNIQUE, 1555 = SQLITE_CONSTRAINT_PRIMARYKEY
		if (e.rawCode === 2067 || e.rawCode === 1555) return true;
		if (typeof e.message === 'string' && /UNIQUE constraint failed/i.test(e.message)) return true;
		current = e.cause;
	}
	return false;
}

/**
 * Inserează rândul și mută soldul, atomic. `applied: false` = rândul exista deja
 * (aceeași sursă), nimic nu s-a schimbat.
 */
export async function applyLedgerEntry(
	entry: LedgerEntryInput,
	opts: { id?: string } = {}
): Promise<{ applied: boolean; id: string | null }> {
	if (!Number.isInteger(entry.deltaMinutes)) {
		throw new Error(`deltaMinutes trebuie să fie întreg: ${entry.deltaMinutes}`);
	}
	const id = opts.id ?? generateId();
	const now = new Date();
	try {
		await withTursoBusyRetry(
			() =>
				db.transaction(async (tx) => {
					await tx.insert(table.clientHourLedger).values({
						id,
						tenantId: entry.tenantId,
						clientId: entry.clientId,
						deltaMinutes: entry.deltaMinutes,
						kind: entry.kind,
						sourceType: entry.sourceType,
						sourceId: entry.sourceId,
						note: entry.note ?? null,
						createdByUserId: entry.createdByUserId ?? null,
						referenceRateEurSnapshot: entry.referenceRateEurSnapshot ?? null,
						netCentsSnapshot: entry.netCentsSnapshot ?? null,
						currencySnapshot: entry.currencySnapshot ?? null,
						fxRateSnapshot: entry.fxRateSnapshot ?? null,
						rateSlug: entry.rateSlug ?? null,
						modeSlug: entry.modeSlug ?? null,
						rateEurSnapshot: entry.rateEurSnapshot ?? null,
						multiplierPctSnapshot: entry.multiplierPctSnapshot ?? null,
						realMinutes: entry.realMinutes ?? null,
						createdAt: now
					});
					if (entry.deltaMinutes !== 0) {
						await tx
							.update(table.client)
							.set({
								hourCreditMinutes: sql`${table.client.hourCreditMinutes} + ${entry.deltaMinutes}`,
								updatedAt: now
							})
							.where(
								and(eq(table.client.id, entry.clientId), eq(table.client.tenantId, entry.tenantId))
							);
					}
				}),
			{ tenantId: entry.tenantId, label: `hour-credits.${entry.kind}` }
		);
		return { applied: true, id };
	} catch (err) {
		if (isUniqueViolation(err)) {
			logInfo(
				'server',
				`hour-credits: ${entry.kind} pentru ${entry.sourceType}:${entry.sourceId} exista deja — no-op`,
				{ tenantId: entry.tenantId, metadata: { clientId: entry.clientId } }
			);
			return { applied: false, id: null };
		}
		throw err;
	}
}

export type CreditResult =
	| { status: 'credited'; minutes: number }
	| { status: 'already_credited' }
	| { status: 'skipped'; reason: string }
	| { status: 'failed'; reason: string };

/** Tariful de referință + pasul curent al tenantului. */
async function loadReference(
	tenantId: string
): Promise<{ rateEur: number; stepMinutes: number } | null> {
	const catalog = await getHourlyCatalog(tenantId);
	const ref = resolveReferenceRate(catalog.rates, catalog.rules);
	if (!ref) return null;
	return { rateEur: ref.rateEur, stepMinutes: catalog.rules.stepMinutes };
}

/** Lei per euro la data dată (sau ultima cotație anterioară, max 15 zile). */
async function ronPerEurOn(isoDate: string): Promise<number | null> {
	const fx = await loadBnrFxRates(['EUR'], [isoDate]);
	return fx[isoDate]?.EUR?.ronPerUnit ?? null;
}

async function isHoursOrderInvoice(tenantId: string, invoiceId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: table.serviceHoursOrder.id })
		.from(table.serviceHoursOrder)
		.where(
			and(
				eq(table.serviceHoursOrder.tenantId, tenantId),
				eq(table.serviceHoursOrder.invoiceId, invoiceId)
			)
		)
		.limit(1);
	return !!row;
}

/**
 * Creditează o factură plătită (spec §5.1). Idempotent: a doua chemare pe aceeași
 * factură întoarce `already_credited`. `trigger` ajunge în nota rândului.
 */
export async function creditPaidInvoice(params: {
	tenantId: string;
	invoiceId: string;
	trigger: 'hook' | 'manual';
	userId?: string | null;
}): Promise<CreditResult> {
	const { tenantId, invoiceId } = params;
	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, tenantId)))
		.limit(1);
	if (!invoice) return { status: 'failed', reason: 'factura nu există' };
	if (!invoice.clientId) return { status: 'skipped', reason: 'factură fără client' };

	const [client] = await db
		.select({
			id: table.client.id,
			optedIn: table.client.hourCreditFromInvoices
		})
		.from(table.client)
		.where(and(eq(table.client.id, invoice.clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (!client) return { status: 'failed', reason: 'clientul nu există' };

	const eligibility = invoiceCreditEligibility(
		{
			status: invoice.status,
			hostingAccountId: invoice.hostingAccountId ?? null,
			externalSource: invoice.externalSource ?? null,
			amount: invoice.amount ?? null,
			currency: invoice.currency
		},
		{
			clientOptedIn: !!client.optedIn,
			isHoursOrderInvoice: await isHoursOrderInvoice(tenantId, invoiceId)
		}
	);
	if (!eligibility.eligible)
		return { status: 'skipped', reason: eligibility.reason ?? 'neeligibilă' };

	const reference = await loadReference(tenantId);
	if (!reference)
		return { status: 'failed', reason: 'nicio specializare activă (tarif de referință lipsă)' };

	const paidOn = (invoice.paidDate ?? new Date()).toISOString().slice(0, 10);
	const currency = invoice.currency.toUpperCase();
	let ronPerEur: number | null = null;
	if (currency === 'RON') {
		ronPerEur = await ronPerEurOn(paidOn);
		if (!ronPerEur) return { status: 'failed', reason: `curs BNR indisponibil pentru ${paidOn}` };
	}
	const netEurCents = netToEurCents(invoice.amount!, currency, ronPerEur);
	const minutes = eurCentsToReferenceMinutes(netEurCents, reference.rateEur, reference.stepMinutes);
	if (minutes <= 0) return { status: 'skipped', reason: 'sumă sub jumătate de pas' };

	const result = await applyLedgerEntry({
		tenantId,
		clientId: invoice.clientId,
		deltaMinutes: minutes,
		kind: 'invoice_credit',
		sourceType: 'invoice',
		sourceId: invoiceId,
		note: `Factura ${invoice.invoiceNumber ?? invoiceId}${params.trigger === 'manual' ? ' (creditată manual)' : ''}`,
		createdByUserId: params.userId ?? null,
		referenceRateEurSnapshot: reference.rateEur,
		netCentsSnapshot: invoice.amount!,
		currencySnapshot: currency,
		fxRateSnapshot: ronPerEur ? formatExchangeRate(ronPerEur) : null
	});
	if (!result.applied) return { status: 'already_credited' };
	logInfo(
		'server',
		`hour-credits: factura ${invoice.invoiceNumber ?? invoiceId} → +${minutes} min`,
		{
			tenantId,
			metadata: { clientId: invoice.clientId, invoiceId, trigger: params.trigger }
		}
	);
	await notifyHourCreditEvent({
		tenantId,
		clientId: invoice.clientId,
		event: { kind: 'credited', minutes, source: `factura ${invoice.invoiceNumber ?? invoiceId}` }
	});
	return { status: 'credited', minutes };
}

/** Creditează o comandă de ore plătită de pe /servicii (spec §5.2). Idempotent. */
export async function creditPaidHoursOrder(params: {
	tenantId: string;
	orderId: string;
	userId?: string | null;
}): Promise<CreditResult> {
	const { tenantId, orderId } = params;
	const [order] = await db
		.select()
		.from(table.serviceHoursOrder)
		.where(
			and(eq(table.serviceHoursOrder.id, orderId), eq(table.serviceHoursOrder.tenantId, tenantId))
		)
		.limit(1);
	if (!order) return { status: 'failed', reason: 'comanda nu există' };
	if (order.status !== 'paid')
		return { status: 'skipped', reason: `comanda nu e plătită (${order.status})` };
	if (!order.clientId) return { status: 'skipped', reason: 'comandă fără client' };

	const reference = await loadReference(tenantId);
	if (!reference)
		return { status: 'failed', reason: 'nicio specializare activă (tarif de referință lipsă)' };
	const netEurCents = netToEurCents(order.netCents, order.currency, null);
	const minutes = eurCentsToReferenceMinutes(netEurCents, reference.rateEur, reference.stepMinutes);
	if (minutes <= 0) return { status: 'skipped', reason: 'sumă sub jumătate de pas' };

	const result = await applyLedgerEntry({
		tenantId,
		clientId: order.clientId,
		deltaMinutes: minutes,
		kind: 'purchase',
		sourceType: 'hours_order',
		sourceId: orderId,
		note: `${order.hours} h ${order.rateLabel} cumpărate pe /servicii`,
		createdByUserId: params.userId ?? null,
		referenceRateEurSnapshot: reference.rateEur,
		netCentsSnapshot: order.netCents,
		currencySnapshot: order.currency,
		rateSlug: order.rateSlug,
		modeSlug: order.modeSlug,
		rateEurSnapshot: order.rateEur,
		multiplierPctSnapshot: order.modeMultiplierPct,
		realMinutes: order.hours * 60
	});
	if (!result.applied) return { status: 'already_credited' };
	logInfo('server', `hour-credits: comanda ${orderId} → +${minutes} min`, {
		tenantId,
		metadata: { clientId: order.clientId, orderId }
	});
	await notifyHourCreditEvent({
		tenantId,
		clientId: order.clientId,
		event: { kind: 'credited', minutes, source: `${order.hours} h ${order.rateLabel} cumpărate` }
	});
	return { status: 'credited', minutes };
}

/** Rândurile de ledger ale unei surse (pentru „creditat deja?"). */
async function creditedSourceIds(
	tenantId: string,
	kind: LedgerKind,
	sourceType: LedgerSourceType
): Promise<Set<string>> {
	const rows = await db
		.select({ sourceId: table.clientHourLedger.sourceId })
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				eq(table.clientHourLedger.kind, kind),
				eq(table.clientHourLedger.sourceType, sourceType)
			)
		);
	return new Set(rows.map((r) => r.sourceId));
}

export interface UncreditedInvoice {
	invoiceId: string;
	invoiceNumber: string | null;
	clientId: string;
	clientName: string;
	amount: number;
	currency: string;
	paidDate: Date | null;
	reason: string | null;
}

/**
 * Lista „Necreditate": facturi plătite ale clienților bifați, eligibile după
 * reguli, fără rând `invoice_credit` (spec §5.1). NU e un tabel, e o interogare.
 */
export async function listUncreditedInvoices(tenantId: string): Promise<UncreditedInvoice[]> {
	const rows = await db
		.select({
			invoice: table.invoice,
			clientName: table.client.name
		})
		.from(table.invoice)
		.innerJoin(table.client, eq(table.invoice.clientId, table.client.id))
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.status, 'paid'),
				eq(table.client.hourCreditFromInvoices, true)
			)
		)
		.orderBy(desc(table.invoice.paidDate));
	if (rows.length === 0) return [];

	const credited = await creditedSourceIds(tenantId, 'invoice_credit', 'invoice');
	const orderInvoices = await db
		.select({ invoiceId: table.serviceHoursOrder.invoiceId })
		.from(table.serviceHoursOrder)
		.where(eq(table.serviceHoursOrder.tenantId, tenantId));
	const orderInvoiceIds = new Set(
		orderInvoices.map((o) => o.invoiceId).filter(Boolean) as string[]
	);

	const out: UncreditedInvoice[] = [];
	for (const { invoice, clientName } of rows) {
		if (credited.has(invoice.id)) continue;
		const e = invoiceCreditEligibility(
			{
				status: invoice.status,
				hostingAccountId: invoice.hostingAccountId ?? null,
				externalSource: invoice.externalSource ?? null,
				amount: invoice.amount ?? null,
				currency: invoice.currency
			},
			{ clientOptedIn: true, isHoursOrderInvoice: orderInvoiceIds.has(invoice.id) }
		);
		// Excluderile structurale (hosting, ads, comenzi) nu sunt „necreditate", sunt
		// ne-eligibile de-a binelea; apar doar cazurile pe care adminul le poate rezolva.
		const structural = /hosting|ads|depășire|comenzi/.test(e.reason ?? '');
		if (!e.eligible && structural) continue;
		out.push({
			invoiceId: invoice.id,
			invoiceNumber: invoice.invoiceNumber ?? null,
			clientId: invoice.clientId!,
			clientName,
			amount: invoice.amount ?? 0,
			currency: invoice.currency,
			paidDate: invoice.paidDate ?? null,
			reason: e.reason
		});
	}
	return out;
}

export interface ClientHourCreditOverviewRow {
	clientId: string;
	clientName: string;
	optedIn: boolean;
	balanceMinutes: number;
	consumedThisMonthMinutes: number;
	lastCreditAt: Date | null;
	lastCreditMinutes: number | null;
}

/** Tabelul „Bugete ore": clienții bifați sau cu sold/mișcări. */
export async function getHourCreditsOverview(
	tenantId: string
): Promise<ClientHourCreditOverviewRow[]> {
	const clients = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			optedIn: table.client.hourCreditFromInvoices,
			balance: table.client.hourCreditMinutes
		})
		.from(table.client)
		.where(eq(table.client.tenantId, tenantId));
	const withLedger = await db
		.select({ clientId: table.clientHourLedger.clientId })
		.from(table.clientHourLedger)
		.where(eq(table.clientHourLedger.tenantId, tenantId))
		.groupBy(table.clientHourLedger.clientId);
	const ledgerClients = new Set(withLedger.map((r) => r.clientId));
	const relevant = clients.filter((c) => c.optedIn || c.balance !== 0 || ledgerClients.has(c.id));
	if (relevant.length === 0) return [];

	const ids = relevant.map((c) => c.id);
	const monthStart = startOfMonthUtc(new Date());
	const consumed = await db
		.select({
			clientId: table.clientHourLedger.clientId,
			minutes: sql<number>`coalesce(sum(${table.clientHourLedger.deltaMinutes}), 0)`
		})
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				inArray(table.clientHourLedger.clientId, ids),
				eq(table.clientHourLedger.kind, 'task_consumption'),
				gte(table.clientHourLedger.createdAt, monthStart)
			)
		)
		.groupBy(table.clientHourLedger.clientId);
	const consumedBy = new Map(consumed.map((r) => [r.clientId, Number(r.minutes)]));

	const credits = await db
		.select({
			clientId: table.clientHourLedger.clientId,
			deltaMinutes: table.clientHourLedger.deltaMinutes,
			createdAt: table.clientHourLedger.createdAt
		})
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				inArray(table.clientHourLedger.clientId, ids),
				inArray(table.clientHourLedger.kind, ['invoice_credit', 'purchase', 'manual'])
			)
		)
		.orderBy(desc(table.clientHourLedger.createdAt));
	const lastCredit = new Map<string, { at: Date; minutes: number }>();
	for (const c of credits) {
		if (c.deltaMinutes > 0 && !lastCredit.has(c.clientId)) {
			lastCredit.set(c.clientId, { at: c.createdAt, minutes: c.deltaMinutes });
		}
	}

	return relevant
		.map((c) => ({
			clientId: c.id,
			clientName: c.name,
			optedIn: !!c.optedIn,
			balanceMinutes: c.balance,
			consumedThisMonthMinutes: -(consumedBy.get(c.id) ?? 0),
			lastCreditAt: lastCredit.get(c.id)?.at ?? null,
			lastCreditMinutes: lastCredit.get(c.id)?.minutes ?? null
		}))
		.sort((a, b) => a.clientName.localeCompare(b.clientName, 'ro'));
}

/** Soldul + ledger-ul unui client (drill-down și cardul din panoul clientului). */
export async function getClientHourCredit(tenantId: string, clientId: string, limit = 200) {
	const [client] = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			optedIn: table.client.hourCreditFromInvoices,
			balance: table.client.hourCreditMinutes
		})
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (!client) return null;
	const entries = await db
		.select({
			id: table.clientHourLedger.id,
			deltaMinutes: table.clientHourLedger.deltaMinutes,
			kind: table.clientHourLedger.kind,
			sourceType: table.clientHourLedger.sourceType,
			sourceId: table.clientHourLedger.sourceId,
			note: table.clientHourLedger.note,
			netCentsSnapshot: table.clientHourLedger.netCentsSnapshot,
			currencySnapshot: table.clientHourLedger.currencySnapshot,
			fxRateSnapshot: table.clientHourLedger.fxRateSnapshot,
			referenceRateEurSnapshot: table.clientHourLedger.referenceRateEurSnapshot,
			realMinutes: table.clientHourLedger.realMinutes,
			createdByUserId: table.clientHourLedger.createdByUserId,
			createdAt: table.clientHourLedger.createdAt
		})
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				eq(table.clientHourLedger.clientId, clientId)
			)
		)
		.orderBy(desc(table.clientHourLedger.createdAt))
		.limit(limit);
	return {
		clientId: client.id,
		clientName: client.name,
		optedIn: !!client.optedIn,
		balanceMinutes: client.balance,
		entries: entries.map((e) => ({ ...e, kind: e.kind as LedgerKind }))
	};
}

/** Garda de drift: soldul cache vs. suma ledger-ului, per client. */
export async function findHourCreditDrift(
	tenantId: string
): Promise<Array<{ clientId: string; cached: number; ledger: number }>> {
	const sums = await db
		.select({
			clientId: table.clientHourLedger.clientId,
			total: sql<number>`coalesce(sum(${table.clientHourLedger.deltaMinutes}), 0)`
		})
		.from(table.clientHourLedger)
		.where(eq(table.clientHourLedger.tenantId, tenantId))
		.groupBy(table.clientHourLedger.clientId);
	const clients = await db
		.select({ id: table.client.id, cached: table.client.hourCreditMinutes })
		.from(table.client)
		.where(eq(table.client.tenantId, tenantId));
	const sumBy = new Map(sums.map((s) => [s.clientId, Number(s.total)]));
	const drift: Array<{ clientId: string; cached: number; ledger: number }> = [];
	for (const c of clients) {
		const ledger = sumBy.get(c.id) ?? 0;
		if (ledger !== c.cached) drift.push({ clientId: c.id, cached: c.cached, ledger });
	}
	if (drift.length > 0) {
		logWarning('server', `hour-credits: ${drift.length} clienți cu sold desincronizat`, {
			tenantId,
			metadata: { drift: drift.slice(0, 20) }
		});
	}
	return drift;
}

/** Repară cache-ul din ledger (doar din endpoint-ul de debug, explicit). */
export async function reconcileHourCredit(tenantId: string, clientId: string, ledgerTotal: number) {
	try {
		await withTursoBusyRetry(
			() =>
				db
					.update(table.client)
					.set({ hourCreditMinutes: ledgerTotal, updatedAt: new Date() })
					.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId))),
			{ tenantId, label: 'hour-credits.reconcile' }
		);
	} catch (err) {
		logError('server', `hour-credits: reconciliere eșuată — ${serializeError(err).message}`, {
			tenantId,
			metadata: { clientId }
		});
		throw err;
	}
}
