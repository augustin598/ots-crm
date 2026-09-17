/**
 * Creditul de ore pe task (spec §6): consum în ore reale la Done, draft lunar de
 * depășire, reopen.
 *
 * Consumul se face printr-un UPDATE atomic condiționat pe `client` (nu „citește +
 * scrie"), ca două Done simultane să nu poată consuma același minut. Draftul de
 * depășire e o factură CRM obișnuită (`external_source = 'hour-overage'`), una
 * per client per lună calendaristică, cu liniile gestionate DOAR de aici.
 */
import { and, desc, eq, gt, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import { generateInvoiceNumber } from '$lib/server/invoice-utils';
import { vatPercentToBps } from '$lib/utils/vat';
import { effectiveRateEur } from '$lib/logic/hours-pricing';
import {
	resolveReferenceRate,
	type CatalogMode,
	type CatalogRate
} from '$lib/logic/hourly-catalog';
import {
	HOUR_OVERAGE_INVOICE_SOURCE,
	OVERAGE_NOTES_PREFIX,
	ceilToStep,
	overageLineAmountCents,
	overageMonthKey
} from '$lib/logic/hour-credits';
import { KEEZ_UNIT } from '$lib/constants/keez-measure-units';
import { notifyHourCreditEvent } from '$lib/server/hour-credit-notifications';
import { resolveHourOrderVat } from '$lib/server/hour-credit-vat';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Altă cerere a decontat (sau a redeschis) task-ul între citire și tranzacție.
 * Aruncată DIN tranzacție ca s-o anuleze; prinsă imediat în afara ei.
 */
class TaskCreditClaimLost extends Error {}

interface CreditContext {
	rate: CatalogRate;
	mode: CatalogMode;
	referenceRateEur: number;
	stepMinutes: number;
}

/** Tariful/regimul task-ului (inclusiv inactive): prețul depășirii și snapshot-ul din ledger. */
async function loadContext(
	tenantId: string,
	task: { rateSlug: string | null; modeSlug: string | null }
): Promise<CreditContext | { error: string }> {
	const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
	const reference = resolveReferenceRate(catalog.rates, catalog.rules);
	if (!reference) return { error: 'nicio specializare activă (tarif de referință lipsă)' };
	const rate = catalog.rates.find((r) => r.slug === task.rateSlug) ?? reference;
	const mode =
		catalog.modes.find((m) => m.slug === (task.modeSlug ?? 'standard')) ??
		catalog.modes.find((m) => m.slug === 'standard');
	if (!mode) return { error: 'regimul standard lipsește din catalog' };
	return {
		rate,
		mode,
		referenceRateEur: reference.rateEur,
		stepMinutes: catalog.rules.stepMinutes
	};
}

export type SettleResult =
	| {
			status: 'settled';
			consumedMinutes: number;
			overageRealMinutes: number;
			overageInvoiceId: string | null;
	  }
	| { status: 'skipped'; reason: string }
	| { status: 'failed'; reason: string };

/**
 * Scade orele efective ale unui task din creditul clientului (spec §6.2).
 * Idempotent prin `credit_settled_at`. Depășirea intră în draftul lunar.
 */
export async function settleTaskCredit(params: {
	tenantId: string;
	taskId: string;
	userId: string | null;
	actualMinutes?: number | null;
}): Promise<SettleResult> {
	const { tenantId, taskId } = params;
	const [task] = await db
		.select()
		.from(table.task)
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
		.limit(1);
	if (!task) return { status: 'failed', reason: 'task inexistent' };
	if (!task.clientId) return { status: 'skipped', reason: 'task fără client' };
	if (task.creditSettledAt) return { status: 'skipped', reason: 'deja decontat' };
	// Doar ore EFECTIVE. Fără ele taskul rămâne nedecontat și apare în „De rezolvat":
	// estimarea e o rezervare, nu timp lucrat.
	const actual = params.actualMinutes ?? task.actualMinutes ?? 0;
	if (!Number.isInteger(actual) || actual <= 0) {
		return { status: 'skipped', reason: 'fără ore efective' };
	}

	const ctx = await loadContext(tenantId, task);
	if ('error' in ctx) return { status: 'failed', reason: ctx.error };
	// Singura rotunjire: timpul lucrat, în sus, la pas. consumed + overage == billed.
	const billed = ceilToStep(actual, ctx.stepMinutes);
	const now = new Date();
	const ledgerId = generateId();

	// Tranzacția de consum: UPDATE atomic condiționat + ledger + task.
	let consumed = 0;
	try {
		await withTursoBusyRetry(
			() =>
				db.transaction(async (tx) => {
					consumed = 0;
					// Revendicarea task-ului e PRIMA scriere și e condiționată: verificarea
					// `creditSettledAt` de mai sus e o citire în afara tranzacției, deci două
					// Done simultane (sau o tranzacție reluată după SQLITE_BUSY) ar trece
					// amândouă de ea și ar consuma de două ori.
					const claim = await tx
						.update(table.task)
						.set({ actualMinutes: actual, creditSettledAt: now, updatedAt: now })
						.where(
							and(
								eq(table.task.id, taskId),
								eq(table.task.tenantId, tenantId),
								isNull(table.task.creditSettledAt)
							)
						);
					if (claim.rowsAffected !== 1) throw new TaskCreditClaimLost();

					// Încercarea 1: tot din credit.
					const full = await tx
						.update(table.client)
						.set({
							hourCreditMinutes: sql`${table.client.hourCreditMinutes} - ${billed}`,
							updatedAt: now
						})
						.where(
							and(
								eq(table.client.id, task.clientId!),
								eq(table.client.tenantId, tenantId),
								sql`${table.client.hourCreditMinutes} >= ${billed}`
							)
						);
					if (full.rowsAffected === 1) {
						// Ore reale: 1 h lucrată consumă 1 h de credit, indiferent de specializare.
						consumed = billed;
					} else {
						// Încercarea 2: cât există (≥ 0), cu gardă pe valoarea citită.
						let sawCredit = false;
						for (let attempt = 0; attempt < 3 && consumed === 0; attempt++) {
							const [row] = await tx
								.select({ balance: table.client.hourCreditMinutes })
								.from(table.client)
								.where(
									and(eq(table.client.id, task.clientId!), eq(table.client.tenantId, tenantId))
								)
								.limit(1);
							const available = Math.max(0, row?.balance ?? 0);
							if (available === 0) {
								sawCredit = false;
								break;
							}
							sawCredit = true;
							// Plafonat la timpul taxat: dacă soldul a crescut între UPDATE-ul eșuat
							// și citire (ex. o alimentare), nu consumăm mai mult decât `billed`.
							const take = Math.min(billed, available);
							const partial = await tx
								.update(table.client)
								.set({ hourCreditMinutes: available - take, updatedAt: now })
								.where(
									and(
										eq(table.client.id, task.clientId!),
										eq(table.client.tenantId, tenantId),
										eq(table.client.hourCreditMinutes, available)
									)
								);
							if (partial.rowsAffected === 1) consumed = take;
						}
						// Credit existent pe care nu l-am putut revendica: NU îl transformăm în
						// depășire. Anulăm tot; taskul rămâne nedecontat și se poate relua.
						if (consumed === 0 && sawCredit) {
							throw new Error('soldul s-a schimbat de 3 ori în timpul decontării');
						}
					}
					if (consumed > 0) {
						await tx.insert(table.clientHourLedger).values({
							id: ledgerId,
							tenantId,
							clientId: task.clientId!,
							deltaMinutes: -consumed,
							kind: 'task_consumption',
							sourceType: 'task',
							sourceId: taskId,
							note: `${task.title} — ${actual} min ${ctx.rate.label}${ctx.mode.slug !== 'standard' ? ` (${ctx.mode.label})` : ''}`,
							createdByUserId: params.userId ?? null,
							referenceRateEurSnapshot: ctx.referenceRateEur,
							rateSlug: ctx.rate.slug,
							modeSlug: ctx.mode.slug,
							rateEurSnapshot: ctx.rate.rateEur,
							multiplierPctSnapshot: ctx.mode.multiplierPct,
							realMinutes: actual,
							createdAt: now
						});
					}
					// Urma depășirii intră în ACEEAȘI tranzacție cu consumul: dacă draftul
					// pică după commit, depășirea rămâne vizibilă („nefacturată") și se poate
					// regenera. Scrisă după draft, s-ar fi pierdut fără urmă.
					const overageInTx = billed - consumed;
					if (overageInTx > 0) {
						await tx.insert(table.clientHourLedger).values({
							id: generateId(),
							tenantId,
							clientId: task.clientId!,
							deltaMinutes: 0,
							kind: 'overage_invoiced',
							sourceType: 'task',
							sourceId: taskId,
							note: `${task.title} — ${overageInTx} min peste credit`,
							createdByUserId: params.userId ?? null,
							referenceRateEurSnapshot: ctx.referenceRateEur,
							rateSlug: ctx.rate.slug,
							modeSlug: ctx.mode.slug,
							rateEurSnapshot: ctx.rate.rateEur,
							multiplierPctSnapshot: ctx.mode.multiplierPct,
							realMinutes: overageInTx,
							createdAt: now
						});
					}
				}),
			{ tenantId, label: 'task-credit.settle' }
		);
	} catch (err) {
		if (err instanceof TaskCreditClaimLost) return { status: 'skipped', reason: 'deja decontat' };
		logError(
			'server',
			`task-credit: decontarea task-ului ${taskId} a picat — ${serializeError(err).message}`,
			{
				tenantId,
				metadata: { taskId }
			}
		);
		return { status: 'failed', reason: serializeError(err).message };
	}

	// Consumul e exact ce s-a scăzut; restul din facturabil e depășire (fără a doua rotunjire).
	const overageReal = billed - consumed;

	let overageInvoiceId: string | null = null;
	if (overageReal > 0) {
		try {
			overageInvoiceId = await billOverage({
				tenantId,
				clientId: task.clientId,
				task: { id: taskId, title: task.title },
				settledAt: now,
				overageRealMinutes: overageReal,
				pricing: ctx,
				now
			});
		} catch (err) {
			// Consumul și urma depășirii sunt deja în ledger; taskul apare în Bugete ore
			// ca „depășire nefacturată" (Regenerează). Nu ascundem eroarea în log.
			logError(
				'server',
				`task-credit: draftul de depășire pentru ${taskId} a picat — ${serializeError(err).message}`,
				{
					tenantId,
					metadata: { taskId, overageReal }
				}
			);
		}
	}

	logInfo(
		'server',
		`task-credit: task ${taskId} decontat: −${consumed} min credit, ${overageReal} min depășire`,
		{
			tenantId,
			metadata: { taskId, clientId: task.clientId, consumed, overageReal, overageInvoiceId }
		}
	);
	await notifyHourCreditEvent({
		tenantId,
		clientId: task.clientId,
		event: {
			kind: 'consumed',
			taskId,
			taskTitle: task.title,
			realMinutes: actual,
			consumedMinutes: consumed,
			overageRealMinutes: overageReal,
			pricing: {
				rateLabel: ctx.rate.label,
				rateEur: ctx.rate.rateEur,
				multiplierPct: ctx.mode.multiplierPct,
				modeLabel: ctx.mode.label
			}
		}
	});
	return {
		status: 'settled',
		consumedMinutes: consumed,
		overageRealMinutes: overageReal,
		overageInvoiceId
	};
}

/** Ce trebuie știut ca să prețuiești o linie de depășire (din catalog sau din snapshot). */
interface OveragePricing {
	rate: { label: string; rateEur: number };
	mode: { slug: string; label: string; multiplierPct: number };
}

/**
 * Linia de depășire + legarea ei de task, doar dacă taskul e ÎNCĂ în decontarea
 * `settledAt`. Între commit-ul consumului și linie poate intra un reopen (sau reopen
 * + Done nou); atunci linia nu mai aparține nimănui și se scoate imediat — altfel
 * Done-ul următor ar factura aceeași depășire a doua oară.
 */
async function billOverage(params: {
	tenantId: string;
	clientId: string;
	task: { id: string; title: string };
	settledAt: Date;
	overageRealMinutes: number;
	pricing: OveragePricing;
	now: Date;
}): Promise<string | null> {
	const { tenantId, task } = params;
	const { invoiceId, lineId } = await addOverageLine(params);
	const attached = await withTursoBusyRetry(
		() =>
			db
				.update(table.task)
				.set({ overageInvoiceId: invoiceId, updatedAt: new Date() })
				.where(
					and(
						eq(table.task.id, task.id),
						eq(table.task.tenantId, tenantId),
						eq(table.task.creditSettledAt, params.settledAt),
						isNull(table.task.overageInvoiceId)
					)
				),
		{ tenantId, label: 'task-credit.attachOverage' }
	);
	if (attached.rowsAffected === 1) return invoiceId;

	logWarning(
		'server',
		`task-credit: task ${task.id} s-a schimbat în timpul facturării depășirii — linia a fost retrasă`,
		{ tenantId, metadata: { taskId: task.id, invoiceId } }
	);
	await withTursoBusyRetry(
		() =>
			db.transaction((tx) => removeTaskOverageLines(tx, tenantId, task.id, { lineIds: [lineId] })),
		{ tenantId, label: 'task-credit.retractOverage' }
	);
	return null;
}

/** Draftul lunii (sau următoarea, dacă e deja confirmat/în trimitere) + linia task-ului. */
async function addOverageLine(params: {
	tenantId: string;
	clientId: string;
	task: { id: string; title: string };
	overageRealMinutes: number;
	pricing: OveragePricing;
	now: Date;
}): Promise<{ invoiceId: string; lineId: string }> {
	const { tenantId, clientId, task, now } = params;
	const ctx = params.pricing;
	const { vatPercent, zeroVatNote } = await resolveHourOrderVat(tenantId, clientId);
	const vatBps = vatPercentToBps(vatPercent);
	const unitRateEur = effectiveRateEur(ctx.rate.rateEur, ctx.mode.multiplierPct);
	// Suma vine din MINUTE; orele cu 2 zecimale sunt doar afișare (Keez recalculează
	// din ele — la pas 15 coincid exact).
	const hours = Math.round((params.overageRealMinutes / 60) * 100) / 100;
	const lineAmount = overageLineAmountCents(params.overageRealMinutes, unitRateEur);

	const invoiceId = await findOrCreateOverageDraft({
		tenantId,
		clientId,
		now,
		vatBps,
		zeroVatNote
	});
	const lineId = generateId();
	await withTursoBusyRetry(
		() =>
			db.transaction(async (tx) => {
				await tx.insert(table.invoiceLineItem).values({
					id: lineId,
					invoiceId,
					description: `Depășire ore — ${task.title} (${ctx.rate.label}${ctx.mode.slug !== 'standard' ? `, ${ctx.mode.label}` : ''})`,
					note: `${params.overageRealMinutes} min × ${unitRateEur} €/h · task ${task.id}`,
					quantity: hours,
					rate: unitRateEur * 100,
					amount: lineAmount,
					taxRate: vatBps,
					currency: 'EUR',
					unitOfMeasure: KEEZ_UNIT.HOUR,
					taskId: task.id
				});
				await recomputeDraftTotals(tx, invoiceId);
			}),
		{ tenantId, label: 'task-credit.addOverageLine' }
	);
	return { invoiceId, lineId };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Scoate liniile de depășire ale unui task de pe drafturile încă editabile (după
 * `invoice_line_item.task_id`, nu după `task.overage_invoice_id`, care poate lipsi
 * dacă legarea a picat). Draftul rămas gol se șterge; restul își recalculează totalul.
 */
async function removeTaskOverageLines(
	tx: Tx,
	tenantId: string,
	taskId: string,
	opts: { lineIds?: string[] } = {}
): Promise<void> {
	const lines = await tx
		.select({ id: table.invoiceLineItem.id, invoiceId: table.invoiceLineItem.invoiceId })
		.from(table.invoiceLineItem)
		.innerJoin(table.invoice, eq(table.invoice.id, table.invoiceLineItem.invoiceId))
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.externalSource, HOUR_OVERAGE_INVOICE_SOURCE),
				eq(table.invoice.status, 'draft'),
				isNull(table.invoice.keezStatus),
				eq(table.invoiceLineItem.taskId, taskId),
				...(opts.lineIds ? [inArray(table.invoiceLineItem.id, opts.lineIds)] : [])
			)
		);
	if (lines.length === 0) return;
	await tx.delete(table.invoiceLineItem).where(
		inArray(
			table.invoiceLineItem.id,
			lines.map((l) => l.id)
		)
	);
	for (const invoiceId of new Set(lines.map((l) => l.invoiceId))) {
		const remaining = await tx
			.select({ id: table.invoiceLineItem.id })
			.from(table.invoiceLineItem)
			.where(eq(table.invoiceLineItem.invoiceId, invoiceId))
			.limit(1);
		if (remaining.length === 0) {
			await tx.delete(table.invoice).where(eq(table.invoice.id, invoiceId));
		} else {
			await recomputeDraftTotals(tx, invoiceId);
		}
	}
}

/**
 * Chemată din `deleteInvoice` înainte de ștergerea unui draft `hour-overage`, în
 * aceeași tranzacție: taskurile legate își pierd legătura și apar în Bugete ore ca
 * „depășire nefacturată" (urma din ledger rămâne), în loc să arate spre o factură
 * care nu mai există.
 */
export async function detachOverageInvoiceTasks(
	tx: Tx,
	tenantId: string,
	invoiceId: string
): Promise<void> {
	await tx
		.update(table.task)
		.set({ overageInvoiceId: null, updatedAt: new Date() })
		.where(and(eq(table.task.tenantId, tenantId), eq(table.task.overageInvoiceId, invoiceId)));
}

export interface UnbilledOverage {
	taskId: string;
	taskTitle: string;
	clientId: string;
	clientName: string;
	/** Minute REALE peste credit, din urma decontării curente. */
	overageRealMinutes: number;
	settledAt: Date;
}

/** Urma depășirii din decontarea CURENTĂ a taskului (rândul `overage_invoiced` al ciclului). */
async function currentOverageTrace(tenantId: string, taskId: string, settledAt: Date) {
	const [row] = await db
		.select()
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				eq(table.clientHourLedger.kind, 'overage_invoiced'),
				eq(table.clientHourLedger.sourceType, 'task'),
				eq(table.clientHourLedger.sourceId, taskId),
				gte(table.clientHourLedger.createdAt, settledAt)
			)
		)
		.orderBy(desc(table.clientHourLedger.createdAt))
		.limit(1);
	return row ?? null;
}

/**
 * Taskuri decontate cu depășire care nu stă pe nicio factură: draftul a picat,
 * legarea a picat sau draftul a fost șters. Sursa e urma din ledger a decontării
 * curente, nu o coloană care se poate pierde.
 */
export async function listUnbilledOverages(tenantId: string): Promise<UnbilledOverage[]> {
	const rows = await db
		.select({
			taskId: table.task.id,
			taskTitle: table.task.title,
			clientId: table.task.clientId,
			clientName: table.client.name,
			settledAt: table.task.creditSettledAt,
			traceMinutes: table.clientHourLedger.realMinutes,
			traceAt: table.clientHourLedger.createdAt
		})
		.from(table.task)
		.innerJoin(table.client, eq(table.client.id, table.task.clientId))
		.innerJoin(
			table.clientHourLedger,
			and(
				eq(table.clientHourLedger.tenantId, table.task.tenantId),
				eq(table.clientHourLedger.sourceId, table.task.id),
				eq(table.clientHourLedger.kind, 'overage_invoiced')
			)
		)
		.where(
			and(
				eq(table.task.tenantId, tenantId),
				isNull(table.task.overageInvoiceId),
				sql`${table.task.creditSettledAt} IS NOT NULL`,
				sql`${table.clientHourLedger.createdAt} >= ${table.task.creditSettledAt}`
			)
		);
	return rows
		.filter((r) => r.clientId && r.settledAt && (r.traceMinutes ?? 0) > 0)
		.map((r) => ({
			taskId: r.taskId,
			taskTitle: r.taskTitle,
			clientId: r.clientId!,
			clientName: r.clientName,
			overageRealMinutes: r.traceMinutes!,
			settledAt: r.settledAt!
		}));
}

export type RegenerateOverageResult =
	| { status: 'billed'; invoiceId: string }
	| { status: 'already_billed' }
	| { status: 'skipped'; reason: string };

/**
 * „Regenerează draftul" pentru un task din `listUnbilledOverages`. Dacă linia există
 * deja pe un draft (s-a pierdut doar legătura), o relegăm; altfel o recreăm din
 * snapshot-ul de preț al decontării (tariful înghețat atunci, nu cel de azi).
 */
export async function regenerateOverageDraft(params: {
	tenantId: string;
	taskId: string;
}): Promise<RegenerateOverageResult> {
	const { tenantId, taskId } = params;
	const [task] = await db
		.select()
		.from(table.task)
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
		.limit(1);
	if (!task || !task.clientId)
		return { status: 'skipped', reason: 'task inexistent sau fără client' };
	if (!task.creditSettledAt) return { status: 'skipped', reason: 'taskul nu e decontat' };
	if (task.overageInvoiceId) return { status: 'already_billed' };
	const settledAt = task.creditSettledAt;
	const trace = await currentOverageTrace(tenantId, taskId, settledAt);
	if (!trace?.realMinutes) return { status: 'skipped', reason: 'decontarea nu are depășire' };

	const [existingLine] = await db
		.select({ invoiceId: table.invoiceLineItem.invoiceId })
		.from(table.invoiceLineItem)
		.innerJoin(table.invoice, eq(table.invoice.id, table.invoiceLineItem.invoiceId))
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.externalSource, HOUR_OVERAGE_INVOICE_SOURCE),
				eq(table.invoiceLineItem.taskId, taskId)
			)
		)
		.limit(1);

	let invoiceId: string | null;
	if (existingLine) {
		const relinked = await withTursoBusyRetry(
			() =>
				db
					.update(table.task)
					.set({ overageInvoiceId: existingLine.invoiceId, updatedAt: new Date() })
					.where(
						and(
							eq(table.task.id, taskId),
							eq(table.task.tenantId, tenantId),
							eq(table.task.creditSettledAt, settledAt),
							isNull(table.task.overageInvoiceId)
						)
					),
			{ tenantId, label: 'task-credit.relinkOverage' }
		);
		invoiceId = relinked.rowsAffected === 1 ? existingLine.invoiceId : null;
	} else {
		const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
		const modeSlug = trace.modeSlug ?? 'standard';
		invoiceId = await billOverage({
			tenantId,
			clientId: task.clientId,
			task: { id: taskId, title: task.title },
			settledAt,
			overageRealMinutes: trace.realMinutes,
			pricing: {
				rate: {
					label:
						catalog.rates.find((r) => r.slug === trace.rateSlug)?.label ?? trace.rateSlug ?? '',
					rateEur: trace.rateEurSnapshot!
				},
				mode: {
					slug: modeSlug,
					label: catalog.modes.find((m) => m.slug === modeSlug)?.label ?? modeSlug,
					multiplierPct: trace.multiplierPctSnapshot ?? 100
				}
			},
			now: new Date()
		});
	}
	if (!invoiceId)
		return { status: 'skipped', reason: 'taskul s-a schimbat între timp; reîncearcă' };
	logInfo('server', `task-credit: depășirea task-ului ${taskId} regenerată pe ${invoiceId}`, {
		tenantId,
		metadata: { taskId, invoiceId }
	});
	return { status: 'billed', invoiceId };
}

export interface UnsettledDoneTask {
	taskId: string;
	taskTitle: string;
	clientId: string;
	clientName: string;
	estimatedMinutes: number | null;
	actualMinutes: number | null;
	updatedAt: Date;
}

/**
 * Taskuri trecute în Done cu ore, dar fără decontare (ex. decontarea a întors
 * `failed` — tarif de referință lipsă — iar apelantul doar a logat). Nu mai rezervă
 * (sunt Done) și nici n-au consumat: fără lista asta, munca ar fi gratuită și invizibilă.
 */
export async function listUnsettledDoneTasks(tenantId: string): Promise<UnsettledDoneTask[]> {
	const rows = await db
		.select({
			taskId: table.task.id,
			taskTitle: table.task.title,
			clientId: table.task.clientId,
			clientName: table.client.name,
			estimatedMinutes: table.task.estimatedMinutes,
			actualMinutes: table.task.actualMinutes,
			updatedAt: table.task.updatedAt
		})
		.from(table.task)
		.innerJoin(table.client, eq(table.client.id, table.task.clientId))
		.where(
			and(
				eq(table.task.tenantId, tenantId),
				eq(table.task.status, 'done'),
				isNull(table.task.creditSettledAt),
				or(gt(table.task.estimatedMinutes, 0), gt(table.task.actualMinutes, 0))
			)
		)
		.orderBy(desc(table.task.updatedAt));
	return rows.map((r) => ({ ...r, clientId: r.clientId! }));
}

async function recomputeDraftTotals(tx: Tx, invoiceId: string) {
	const lines = await tx
		.select({ amount: table.invoiceLineItem.amount, taxRate: table.invoiceLineItem.taxRate })
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoiceId));
	const net = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
	const tax = lines.reduce(
		(s, l) => s + Math.round(((l.amount ?? 0) * (l.taxRate ?? 0)) / 10000),
		0
	);
	await tx
		.update(table.invoice)
		.set({ amount: net, taxAmount: tax, totalAmount: net + tax, updatedAt: new Date() })
		.where(eq(table.invoice.id, invoiceId));
}

async function findOrCreateOverageDraft(params: {
	tenantId: string;
	clientId: string;
	now: Date;
	vatBps: number;
	/** Mențiunea legală de TVA 0% (intracom/export); se adaugă la FINALUL notelor. */
	zeroVatNote: string | null;
}): Promise<string> {
	const { tenantId, clientId, now, vatBps, zeroVatNote } = params;
	// Luna curentă; dacă draftul ei a plecat din `draft`, mergem pe luna următoare.
	let monthKey = overageMonthKey(now);
	for (let hop = 0; hop < 2; hop++) {
		const [existing] = await db
			.select({
				id: table.invoice.id,
				status: table.invoice.status,
				keezStatus: table.invoice.keezStatus
			})
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.tenantId, tenantId),
					eq(table.invoice.clientId, clientId),
					eq(table.invoice.externalSource, HOUR_OVERAGE_INVOICE_SOURCE),
					sql`${table.invoice.notes} LIKE ${OVERAGE_NOTES_PREFIX + monthKey + '%'}`
				)
			)
			.orderBy(desc(table.invoice.createdAt))
			.limit(1);
		if (!existing) break;
		if (existing.status === 'draft' && !existing.keezStatus) return existing.id;
		const [y, m] = monthKey.split('-').map(Number);
		monthKey = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
	}

	const [owner] = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(and(eq(table.tenantUser.tenantId, tenantId), eq(table.tenantUser.role, 'owner')))
		.limit(1);
	if (!owner?.userId) throw new Error('tenantul nu are owner — nu putem crea draftul');
	const invoiceNumber = await generateInvoiceNumber(tenantId);
	const id = generateId();
	const due = new Date(now.getTime() + 15 * 86_400_000);
	await withTursoBusyRetry(
		() =>
			db.insert(table.invoice).values({
				id,
				tenantId,
				clientId,
				createdByUserId: owner.userId,
				invoiceNumber,
				status: 'draft',
				amount: 0,
				taxRate: vatBps,
				taxAmount: 0,
				totalAmount: 0,
				currency: 'EUR',
				taxApplicationType: 'apply',
				issueDate: now,
				dueDate: due,
				externalSource: HOUR_OVERAGE_INVOICE_SOURCE,
				notes: `${OVERAGE_NOTES_PREFIX}${monthKey} — ore peste creditul clientului, luna ${monthKey}. Liniile sunt generate automat la finalizarea task-urilor; confirmă manual înainte de emitere.${zeroVatNote ? ` ${zeroVatNote}` : ''}`
			}),
		{ tenantId, label: 'task-credit.createDraft' }
	);
	logInfo(
		'server',
		`task-credit: draft de depășire ${invoiceNumber} creat pentru luna ${monthKey}`,
		{
			tenantId,
			metadata: { clientId, invoiceId: id }
		}
	);
	return id;
}

/** Reopen permis doar dacă depășirea nu a fost emisă fiscal (spec §6.4). */
export async function assertTaskReopenAllowed(tenantId: string, taskId: string): Promise<void> {
	const [task] = await db
		.select({
			overageInvoiceId: table.task.overageInvoiceId,
			creditSettledAt: table.task.creditSettledAt
		})
		.from(table.task)
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
		.limit(1);
	if (!task?.creditSettledAt) return;
	const blocked = (inv: { status: string; keezStatus: string | null } | undefined) =>
		!!inv && (inv.status !== 'draft' || !!inv.keezStatus);
	let emitted = false;
	if (task.overageInvoiceId) {
		const [inv] = await db
			.select({ status: table.invoice.status, keezStatus: table.invoice.keezStatus })
			.from(table.invoice)
			.where(eq(table.invoice.id, task.overageInvoiceId))
			.limit(1);
		emitted = blocked(inv);
	}
	if (!emitted) {
		// Legătura de pe task se poate pierde; linia cu `task_id` pe o factură ieșită
		// din draft blochează la fel.
		const lines = await db
			.select({ status: table.invoice.status, keezStatus: table.invoice.keezStatus })
			.from(table.invoiceLineItem)
			.innerJoin(table.invoice, eq(table.invoice.id, table.invoiceLineItem.invoiceId))
			.where(
				and(
					eq(table.invoice.tenantId, tenantId),
					eq(table.invoice.externalSource, HOUR_OVERAGE_INVOICE_SOURCE),
					eq(table.invoiceLineItem.taskId, taskId)
				)
			);
		emitted = lines.some(blocked);
	}
	if (emitted) {
		throw new Error(
			'Task-ul are o depășire de ore deja facturată; nu mai poate fi redeschis. Creează un task de continuare.'
		);
	}
}

/** Reopen din Done: stornează consumul, scoate linia din draft, golește câmpurile. */
export async function reverseTaskCredit(params: {
	tenantId: string;
	taskId: string;
	userId: string | null;
}): Promise<{ reversedMinutes: number } | null> {
	const { tenantId, taskId } = params;
	const [task] = await db
		.select()
		.from(table.task)
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
		.limit(1);
	if (!task || !task.creditSettledAt || !task.clientId) return null;
	await assertTaskReopenAllowed(tenantId, taskId);

	const settledAt = task.creditSettledAt;
	const now = new Date();
	let reversed = 0;

	try {
		await withTursoBusyRetry(
			() =>
				db.transaction(async (tx) => {
					// Revendicarea ciclului de Done, condiționată pe exact decontarea citită:
					// două reopen simultane (sau o reluare după SQLITE_BUSY) ar storna altfel
					// de două ori.
					const claim = await tx
						.update(table.task)
						.set({
							actualMinutes: null,
							creditSettledAt: null,
							overageInvoiceId: null,
							updatedAt: now
						})
						.where(
							and(
								eq(table.task.id, taskId),
								eq(table.task.tenantId, tenantId),
								eq(table.task.creditSettledAt, settledAt)
							)
						);
					if (claim.rowsAffected !== 1) throw new TaskCreditClaimLost();

					// Doar consumul ACESTUI ciclu. Un Done fără credit nu scrie rând de consum,
					// iar „ultimul consum al task-ului" ar fi fost cel dintr-un ciclu anterior,
					// deja stornat — restituit a doua oară, din nimic.
					const [consumption] = await tx
						.select({ deltaMinutes: table.clientHourLedger.deltaMinutes })
						.from(table.clientHourLedger)
						.where(
							and(
								eq(table.clientHourLedger.tenantId, tenantId),
								eq(table.clientHourLedger.sourceType, 'task'),
								eq(table.clientHourLedger.sourceId, taskId),
								eq(table.clientHourLedger.kind, 'task_consumption'),
								gte(table.clientHourLedger.createdAt, settledAt)
							)
						)
						.orderBy(desc(table.clientHourLedger.createdAt))
						.limit(1);
					reversed = consumption ? -consumption.deltaMinutes : 0;

					if (reversed > 0) {
						await tx.insert(table.clientHourLedger).values({
							id: generateId(),
							tenantId,
							clientId: task.clientId!,
							deltaMinutes: reversed,
							kind: 'task_reversal',
							sourceType: 'task',
							sourceId: taskId,
							note: `${task.title} — redeschis`,
							createdByUserId: params.userId ?? null,
							createdAt: now
						});
						await tx
							.update(table.client)
							.set({
								hourCreditMinutes: sql`${table.client.hourCreditMinutes} + ${reversed}`,
								updatedAt: now
							})
							.where(and(eq(table.client.id, task.clientId!), eq(table.client.tenantId, tenantId)));
					}
					// După `task_id`, nu după `task.overage_invoice_id`: legătura poate lipsi
					// (legare picată, reopen intrat înainte de legare).
					await removeTaskOverageLines(tx, tenantId, taskId);
				}),
			{ tenantId, label: 'task-credit.reverse' }
		);
	} catch (err) {
		if (err instanceof TaskCreditClaimLost) return null;
		throw err;
	}
	logInfo('server', `task-credit: task ${taskId} redeschis, +${reversed} min înapoi în credit`, {
		tenantId,
		metadata: { taskId, clientId: task.clientId }
	});
	return { reversedMinutes: reversed };
}

/** Efectele unei tranziții de status asupra creditului (apelat din toate căile). */
export async function applyTaskStatusCreditEffects(params: {
	tenantId: string;
	taskId: string;
	oldStatus: string;
	newStatus: string;
	userId: string | null;
}): Promise<void> {
	const { oldStatus, newStatus } = params;
	if (newStatus === 'done' && oldStatus !== 'done') {
		await settleTaskCredit({
			tenantId: params.tenantId,
			taskId: params.taskId,
			userId: params.userId
		});
	} else if (oldStatus === 'done' && newStatus !== 'done') {
		await reverseTaskCredit({
			tenantId: params.tenantId,
			taskId: params.taskId,
			userId: params.userId
		});
	}
}

// Rezervările stau în modul propriu: le folosesc și notificările (pragul pe
// disponibil), care nu pot importa din `task-credit` fără import circular.
export { computeReservedMinutes } from '$lib/server/hour-credit-reserved';
