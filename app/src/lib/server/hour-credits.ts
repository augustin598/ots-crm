/**
 * Creditul de ore — scrierile în ledger și alimentările.
 *
 * Toate scrierile trec prin `applyLedgerEntry`: inserția în `client_hour_ledger`
 * și actualizarea cache-ului `client.hour_credit_minutes` se fac în aceeași
 * tranzacție, printr-un UPDATE relativ (`+ delta`), nu „citește + scrie" — două
 * scrieri simultane nu pot pierde minute. Conflictul pe indexul unic parțial
 * (evenimente livrate de două ori) e tratat ca „deja aplicat", nu ca eroare.
 */
import { and, desc, eq, gt, gte, inArray, or, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';
import { loadBnrFxRates } from '$lib/server/bnr/client';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import {
	computeExpiryDate,
	expiringBatches,
	type ExpiryLedgerRow
} from '$lib/logic/hour-credit-expiry';
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
	/** Termenul lotului de credit; doar pe alimentări. */
	expiresAt?: Date | null;
}

/**
 * Conflict pe indexul unic (parțial) = evenimentul a fost deja aplicat.
 *
 * Verificarea merge pe lanțul `cause`: drizzle împachetează eroarea libSQL într-un
 * `DrizzleQueryError` al cărui mesaj e doar „Failed query: insert into …", deci un
 * test pe mesajul de la vârf ar rata conflictul și ar arunca o eroare 500 la a doua
 * livrare a aceluiași webhook. Prins de testul de integrare (hour-credits-integration).
 */
export function isUniqueViolation(err: unknown): boolean {
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
						expiresAt: entry.expiresAt ?? null,
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

/** Tariful de referință, pasul și termenul de expirare curente ale tenantului. */
async function loadReference(
	tenantId: string
): Promise<{ rateEur: number; stepMinutes: number; expiryDays: number } | null> {
	const catalog = await getHourlyCatalog(tenantId);
	const ref = resolveReferenceRate(catalog.rates, catalog.rules);
	if (!ref) return null;
	return {
		rateEur: ref.rateEur,
		stepMinutes: catalog.rules.stepMinutes,
		expiryDays: catalog.rules.creditExpiryDays
	};
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
		fxRateSnapshot: ronPerEur ? formatExchangeRate(ronPerEur) : null,
		expiresAt: computeExpiryDate(new Date(), reference.expiryDays)
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
	// Orele cumpărate intră ca ore reale (nu suma convertită la referință).
	const minutes = order.hours * 60;
	if (minutes <= 0) return { status: 'skipped', reason: 'comandă fără ore' };

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
		realMinutes: order.hours * 60,
		expiresAt: computeExpiryDate(new Date(), reference.expiryDays)
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
		// Excluderile structurale (hosting, ads, depășire, comenzi, „Adaugă ore") nu sunt
		// „necreditate", sunt ne-eligibile de-a binelea; apar doar cazurile pe care
		// adminul le poate rezolva.
		if (e.structural) continue;
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
	/** CUI-ul clientului, pentru meta rândului din listă. */
	cui: string | null;
	/**
	 * Consumul din ultimele 30 de zile — segmentul gri al gauge-ului. E o
	 * fereastră mobilă, diferită de `consumedThisMonthMinutes` (luna calendaristică).
	 */
	consumedLast30Minutes: number;
	/** Orice mișcare, nu doar alimentare — „ultima mișcare" din listă. */
	lastMovementAt: Date | null;
	/** Creditul cu termen apropiat; null dacă nimic nu expiră. */
	expiring: { minutes: number; on: Date } | null;
}

/** Tabelul „Bugete ore": clienții bifați sau cu sold/mișcări. */
export async function getHourCreditsOverview(
	tenantId: string
): Promise<ClientHourCreditOverviewRow[]> {
	const clients = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			cui: table.client.cui,
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

	// Consumul pe fereastra mobilă de 30 de zile (segmentul gri al gauge-ului) —
	// altă mărime decât consumul lunii calendaristice de mai sus.
	const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	const consumed30 = await db
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
				gte(table.clientHourLedger.createdAt, since30)
			)
		)
		.groupBy(table.clientHourLedger.clientId);
	const consumed30By = new Map(consumed30.map((r) => [r.clientId, Number(r.minutes)]));

	// Ultima mișcare de orice fel + loturile cu termen, dintr-o singură citire a
	// ledgerului: expirarea cere alocarea FIFO a consumului, deci avem oricum
	// nevoie de toate rândurile clientului.
	const allRows = await db
		.select({
			id: table.clientHourLedger.id,
			clientId: table.clientHourLedger.clientId,
			createdAt: table.clientHourLedger.createdAt,
			deltaMinutes: table.clientHourLedger.deltaMinutes,
			expiresAt: table.clientHourLedger.expiresAt,
			// Stornările nu sunt loturi: FIFO-ul are nevoie de tip și sursă.
			kind: table.clientHourLedger.kind,
			sourceId: table.clientHourLedger.sourceId
		})
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				inArray(table.clientHourLedger.clientId, ids)
			)
		);
	const rowsBy = new Map<string, ExpiryLedgerRow[]>();
	const lastMovement = new Map<string, Date>();
	for (const r of allRows) {
		const list = rowsBy.get(r.clientId) ?? [];
		list.push({
			id: r.id,
			createdAt: r.createdAt,
			deltaMinutes: r.deltaMinutes,
			expiresAt: r.expiresAt,
			kind: r.kind,
			sourceId: r.sourceId
		});
		rowsBy.set(r.clientId, list);
		const prev = lastMovement.get(r.clientId);
		if (!prev || r.createdAt > prev) lastMovement.set(r.clientId, r.createdAt);
	}

	// Cu expirarea oprită (sau pentru termene de dinainte de repornire) nimic nu „expiră".
	const { rules } = await getHourlyCatalog(tenantId);
	return relevant
		.map((c) => {
			const batches = expiringBatches(rowsBy.get(c.id) ?? [], rules);
			const first = batches[0];
			return {
				clientId: c.id,
				clientName: c.name,
				cui: c.cui ?? null,
				optedIn: !!c.optedIn,
				balanceMinutes: c.balance,
				consumedThisMonthMinutes: -(consumedBy.get(c.id) ?? 0),
				consumedLast30Minutes: -(consumed30By.get(c.id) ?? 0),
				lastCreditAt: lastCredit.get(c.id)?.at ?? null,
				lastCreditMinutes: lastCredit.get(c.id)?.minutes ?? null,
				lastMovementAt: lastMovement.get(c.id) ?? null,
				expiring:
					first && first.expiresAt
						? {
								// Tot creditul care expiră la acel prim termen.
								minutes: batches
									.filter((b) => b.expiresAt?.getTime() === first.expiresAt?.getTime())
									.reduce((sum, b) => sum + b.remainingMinutes, 0),
								on: first.expiresAt
							}
						: null
			};
		})
		.sort((a, b) => a.clientName.localeCompare(b.clientName, 'ro'));
}

/** Soldul + ledger-ul unui client (drill-down și cardul din panoul clientului). */
export async function getClientHourCredit(tenantId: string, clientId: string, limit = 200) {
	const [client] = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			cui: table.client.cui,
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
	// Loturile cu termen, pentru cardul „Expirare" din fișă. Folosim TOATE
	// rândurile, nu doar cele `limit` afișate: alocarea FIFO trebuie să vadă
	// întreg consumul, altfel ar raporta mai mult credit expirabil decât există.
	const forExpiry = await db
		.select({
			id: table.clientHourLedger.id,
			createdAt: table.clientHourLedger.createdAt,
			deltaMinutes: table.clientHourLedger.deltaMinutes,
			expiresAt: table.clientHourLedger.expiresAt,
			// Stornările nu sunt loturi: FIFO-ul are nevoie de tip și sursă.
			kind: table.clientHourLedger.kind,
			sourceId: table.clientHourLedger.sourceId
		})
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				eq(table.clientHourLedger.clientId, clientId)
			)
		);
	const { rules } = await getHourlyCatalog(tenantId);
	const batches = expiringBatches(forExpiry, rules);
	const firstExpiry = batches[0]?.expiresAt ?? null;

	return {
		clientId: client.id,
		clientName: client.name,
		cui: client.cui ?? null,
		optedIn: !!client.optedIn,
		balanceMinutes: client.balance,
		entries: entries.map((e) => ({ ...e, kind: e.kind as LedgerKind })),
		expiring: firstExpiry
			? {
					minutes: batches
						.filter((b) => b.expiresAt?.getTime() === firstExpiry.getTime())
						.reduce((sum, b) => sum + b.remainingMinutes, 0),
					on: firstExpiry
				}
			: null,
		/** Tot creditul cu termen, indiferent de dată — pentru procentul din card. */
		expiringTotalMinutes: batches.reduce((sum, b) => sum + b.remainingMinutes, 0)
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

// ── Comenzi de ore (tabul „Comenzi ore") ─────────────────────────────────────

export interface HoursOrderRow {
	id: string;
	clientId: string | null;
	clientName: string | null;
	rateLabel: string;
	rateSlug: string;
	modeSlug: string;
	modeMultiplierPct: number;
	modeSla: string | null;
	rateEur: number;
	hours: number;
	netCents: number;
	vatCents: number;
	grossCents: number;
	currency: string;
	status: string;
	requestedWindow: string | null;
	invoiceId: string | null;
	invoiceNumber: string | null;
	createdAt: Date;
	/** Dacă orele au ajuns deja în ledger (creditare idempotentă pe comandă). */
	credited: boolean;
	/**
	 * Creditul comenzii, în minute la tariful de REFERINȚĂ: cel scris în ledger dacă
	 * e creditată, altfel estimarea cu aceeași conversie ca la plată. NU e `hours × 60`
	 * — 10 h Development la referința PM înseamnă 11 h 45 min de credit.
	 */
	creditMinutes: number | null;
}

/**
 * Comenzile de ore ale tenantului, cu clientul, factura și starea creditării —
 * o singură interogare cu join-uri, fără N+1.
 */
export async function listHoursOrders(tenantId: string, limit = 100): Promise<HoursOrderRow[]> {
	const rows = await db
		.select({
			id: table.serviceHoursOrder.id,
			clientId: table.serviceHoursOrder.clientId,
			clientName: table.client.name,
			rateLabel: table.serviceHoursOrder.rateLabel,
			rateSlug: table.serviceHoursOrder.rateSlug,
			modeSlug: table.serviceHoursOrder.modeSlug,
			modeMultiplierPct: table.serviceHoursOrder.modeMultiplierPct,
			modeSla: table.serviceHoursOrder.modeSlaSnapshot,
			rateEur: table.serviceHoursOrder.rateEur,
			hours: table.serviceHoursOrder.hours,
			netCents: table.serviceHoursOrder.netCents,
			vatCents: table.serviceHoursOrder.vatCents,
			grossCents: table.serviceHoursOrder.grossCents,
			currency: table.serviceHoursOrder.currency,
			status: table.serviceHoursOrder.status,
			requestedWindow: table.serviceHoursOrder.requestedWindow,
			invoiceId: table.serviceHoursOrder.invoiceId,
			invoiceNumber: table.invoice.invoiceNumber,
			createdAt: table.serviceHoursOrder.createdAt
		})
		.from(table.serviceHoursOrder)
		.leftJoin(table.client, eq(table.client.id, table.serviceHoursOrder.clientId))
		.leftJoin(table.invoice, eq(table.invoice.id, table.serviceHoursOrder.invoiceId))
		.where(eq(table.serviceHoursOrder.tenantId, tenantId))
		.orderBy(desc(table.serviceHoursOrder.createdAt))
		.limit(limit);
	if (rows.length === 0) return [];

	const purchases = await db
		.select({
			sourceId: table.clientHourLedger.sourceId,
			deltaMinutes: table.clientHourLedger.deltaMinutes
		})
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				eq(table.clientHourLedger.kind, 'purchase'),
				eq(table.clientHourLedger.sourceType, 'hours_order')
			)
		);
	const creditedMinutes = new Map(purchases.map((p) => [p.sourceId, p.deltaMinutes]));
	return rows.map((r) => {
		const ledgerMinutes = creditedMinutes.get(r.id);
		let creditMinutes: number | null = ledgerMinutes ?? null;
		if (ledgerMinutes === undefined && r.hours > 0) creditMinutes = r.hours * 60;
		return { ...r, credited: ledgerMinutes !== undefined, creditMinutes };
	});
}

// ── Raport lunar ─────────────────────────────────────────────────────────────

export interface MonthlyReport {
	monthStart: Date;
	creditedMinutes: number;
	purchasedMinutes: number;
	consumedMinutes: number;
	expiredMinutes: number;
	byRate: { slug: string; label: string; minutes: number }[];
	weeks: { label: string; startsOn: Date; creditedMinutes: number; consumedMinutes: number }[];
}

/**
 * Agregatele lunii: alimentat / cumpărat / consumat / expirat, consumul pe
 * specializare și evoluția pe săptămâni. Totul dintr-o singură citire a
 * mișcărilor lunii — sunt puține, iar gruparea în memorie evită 4 interogări.
 */
export async function getMonthlyReport(
	tenantId: string,
	rateLabels: ReadonlyMap<string, string> = new Map()
): Promise<MonthlyReport> {
	const monthStart = startOfMonthUtc(new Date());
	const rows = await db
		.select({
			kind: table.clientHourLedger.kind,
			deltaMinutes: table.clientHourLedger.deltaMinutes,
			rateSlug: table.clientHourLedger.rateSlug,
			createdAt: table.clientHourLedger.createdAt
		})
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				gte(table.clientHourLedger.createdAt, monthStart)
			)
		);

	let creditedMinutes = 0;
	let purchasedMinutes = 0;
	let consumedMinutes = 0;
	let expiredMinutes = 0;
	const byRate = new Map<string, number>();
	// Săptămâni de câte 7 zile de la începutul lunii — cum arată graficul din design.
	const weeks = [0, 1, 2, 3].map((i) => {
		const startsOn = new Date(monthStart);
		startsOn.setUTCDate(startsOn.getUTCDate() + i * 7);
		return { startsOn, creditedMinutes: 0, consumedMinutes: 0 };
	});

	for (const r of rows) {
		const weekIndex = Math.min(
			3,
			Math.floor((r.createdAt.getTime() - monthStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
		);
		const week = weeks[Math.max(0, weekIndex)];
		if (r.kind === 'invoice_credit') {
			creditedMinutes += r.deltaMinutes;
			week.creditedMinutes += r.deltaMinutes;
		} else if (r.kind === 'purchase') {
			purchasedMinutes += r.deltaMinutes;
			week.creditedMinutes += r.deltaMinutes;
		} else if (r.kind === 'task_consumption') {
			const spent = Math.abs(r.deltaMinutes);
			consumedMinutes += spent;
			week.consumedMinutes += spent;
			if (r.rateSlug) byRate.set(r.rateSlug, (byRate.get(r.rateSlug) ?? 0) + spent);
		} else if (r.kind === 'expire') {
			expiredMinutes += Math.abs(r.deltaMinutes);
		}
	}

	return {
		monthStart,
		creditedMinutes,
		purchasedMinutes,
		consumedMinutes,
		expiredMinutes,
		byRate: [...byRate.entries()]
			.map(([slug, minutes]) => ({ slug, label: rateLabels.get(slug) ?? slug, minutes }))
			.sort((a, b) => b.minutes - a.minutes),
		weeks: weeks.map((w, i) => ({
			label: `săpt. ${i + 1}`,
			startsOn: w.startsOn,
			creditedMinutes: w.creditedMinutes,
			consumedMinutes: w.consumedMinutes
		}))
	};
}

// ── Taskurile care ating creditul unui client ────────────────────────────────

export interface ClientTaskRow {
	id: string;
	title: string;
	status: string;
	projectName: string | null;
	ownerName: string | null;
	/** Estimarea, în minute reale (rezervă credit cât timp taskul e deschis). */
	estimatedMinutes: number | null;
	/** Orele confirmate la Done, în minute reale. */
	actualMinutes: number | null;
	/** Setat după scăderea din credit; null = încă rezervă. */
	creditSettledAt: Date | null;
	rateSlug: string | null;
	modeSlug: string | null;
}

/**
 * Taskurile clientului care au de-a face cu creditul: cele deschise (rezervă) și
 * cele decontate recent (consum). Un singur query cu join-uri, fără N+1.
 */
export async function listClientCreditTasks(
	tenantId: string,
	clientId: string,
	limit = 50
): Promise<ClientTaskRow[]> {
	const rows = await db
		.select({
			id: table.task.id,
			title: table.task.title,
			status: table.task.status,
			projectName: table.project.name,
			ownerFirst: table.user.firstName,
			ownerLast: table.user.lastName,
			estimatedMinutes: table.task.estimatedMinutes,
			actualMinutes: table.task.actualMinutes,
			creditSettledAt: table.task.creditSettledAt,
			rateSlug: table.task.rateSlug,
			modeSlug: table.task.modeSlug,
			updatedAt: table.task.updatedAt
		})
		.from(table.task)
		.leftJoin(table.project, eq(table.project.id, table.task.projectId))
		.leftJoin(table.user, eq(table.user.id, table.task.assignedToUserId))
		.where(
			and(
				eq(table.task.tenantId, tenantId),
				eq(table.task.clientId, clientId),
				// Filtrul stă în SQL, ÎNAINTEA limitei: filtrat în memorie după `limit`,
				// taskurile fără ore mai recente împingeau afară taskurile cu ore.
				or(gt(table.task.estimatedMinutes, 0), gt(table.task.actualMinutes, 0))
			)
		)
		.orderBy(desc(table.task.updatedAt))
		.limit(limit);

	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		status: r.status,
		projectName: r.projectName,
		ownerName: [r.ownerFirst, r.ownerLast].filter(Boolean).join(' ') || null,
		estimatedMinutes: r.estimatedMinutes,
		actualMinutes: r.actualMinutes,
		creditSettledAt: r.creditSettledAt,
		rateSlug: r.rateSlug,
		modeSlug: r.modeSlug
	}));
}

// ── Facturi anulate care au dat ore ─────────────────────────────────────────

export interface CancelledCreditedInvoice {
	invoiceId: string;
	invoiceNumber: string | null;
	clientId: string;
	clientName: string;
	/** Minutele intrate în ledger din factura asta (factură plătită sau „Adaugă ore"). */
	creditedMinutes: number;
	kind: 'invoice_credit' | 'purchase';
}

const REVERSAL_KIND = {
	invoice_credit: 'invoice_credit_reversal',
	purchase: 'purchase_reversal'
} as const;

/**
 * Facturi anulate care au alimentat creditul și nu au fost încă stornate. Anularea
 * nu stornează automat (spec, abaterea 4): lista e locul în care adminul decide.
 */
export async function listCancelledCreditedInvoices(
	tenantId: string
): Promise<CancelledCreditedInvoice[]> {
	const rows = await db
		.select({
			invoiceId: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			clientId: table.clientHourLedger.clientId,
			clientName: table.client.name,
			kind: table.clientHourLedger.kind,
			deltaMinutes: table.clientHourLedger.deltaMinutes
		})
		.from(table.clientHourLedger)
		.innerJoin(
			table.invoice,
			and(
				eq(table.invoice.id, table.clientHourLedger.sourceId),
				eq(table.invoice.tenantId, table.clientHourLedger.tenantId)
			)
		)
		.innerJoin(table.client, eq(table.client.id, table.clientHourLedger.clientId))
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				eq(table.clientHourLedger.sourceType, 'invoice'),
				inArray(table.clientHourLedger.kind, ['invoice_credit', 'purchase']),
				eq(table.invoice.status, 'cancelled')
			)
		);
	if (rows.length === 0) return [];

	const reversals = await db
		.select({ sourceId: table.clientHourLedger.sourceId, kind: table.clientHourLedger.kind })
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				eq(table.clientHourLedger.sourceType, 'invoice'),
				inArray(table.clientHourLedger.kind, Object.values(REVERSAL_KIND)),
				inArray(
					table.clientHourLedger.sourceId,
					rows.map((r) => r.invoiceId)
				)
			)
		);
	const reversed = new Set(reversals.map((r) => `${r.kind}:${r.sourceId}`));

	return rows
		.filter((r) => {
			const kind = r.kind as keyof typeof REVERSAL_KIND;
			return !reversed.has(`${REVERSAL_KIND[kind]}:${r.invoiceId}`);
		})
		.map((r) => ({
			invoiceId: r.invoiceId,
			invoiceNumber: r.invoiceNumber ?? null,
			clientId: r.clientId,
			clientName: r.clientName,
			creditedMinutes: r.deltaMinutes,
			kind: r.kind as 'invoice_credit' | 'purchase'
		}));
}

export type ReverseInvoiceCreditResult =
	| { status: 'reversed'; minutes: number }
	| { status: 'already_reversed' }
	| { status: 'skipped'; reason: string };

/**
 * Stornează creditul dat de o factură ANULATĂ: exact minutele intrate, cu tipul
 * de stornare al sursei. Idempotent prin indexul unic parțial (kind, invoice, id).
 */
export async function reverseCancelledInvoiceCredit(params: {
	tenantId: string;
	invoiceId: string;
	userId: string | null;
}): Promise<ReverseInvoiceCreditResult> {
	const { tenantId, invoiceId } = params;
	const [invoice] = await db
		.select({ status: table.invoice.status, invoiceNumber: table.invoice.invoiceNumber })
		.from(table.invoice)
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, tenantId)))
		.limit(1);
	if (!invoice) return { status: 'skipped', reason: 'factura nu există' };
	if (invoice.status !== 'cancelled') {
		return { status: 'skipped', reason: 'factura nu e anulată' };
	}
	const [credit] = await db
		.select()
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				eq(table.clientHourLedger.sourceType, 'invoice'),
				eq(table.clientHourLedger.sourceId, invoiceId),
				inArray(table.clientHourLedger.kind, ['invoice_credit', 'purchase'])
			)
		)
		.limit(1);
	if (!credit) return { status: 'skipped', reason: 'factura n-a dat ore' };

	const kind = REVERSAL_KIND[credit.kind as keyof typeof REVERSAL_KIND];
	const result = await applyLedgerEntry({
		tenantId,
		clientId: credit.clientId,
		deltaMinutes: -credit.deltaMinutes,
		kind,
		sourceType: 'invoice',
		sourceId: invoiceId,
		note: `Factura ${invoice.invoiceNumber ?? invoiceId} anulată — orele ei se retrag`,
		createdByUserId: params.userId,
		referenceRateEurSnapshot: credit.referenceRateEurSnapshot,
		netCentsSnapshot: credit.netCentsSnapshot,
		currencySnapshot: credit.currencySnapshot
	});
	if (!result.applied) return { status: 'already_reversed' };
	logInfo('server', `hour-credits: factura ${invoiceId} anulată → −${credit.deltaMinutes} min`, {
		tenantId,
		metadata: { clientId: credit.clientId, invoiceId }
	});
	return { status: 'reversed', minutes: credit.deltaMinutes };
}
