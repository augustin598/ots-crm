/**
 * Creditul de ore pe task (spec §6): consum ponderat la Done, draft lunar de
 * depășire, reopen.
 *
 * Consumul se face printr-un UPDATE atomic condiționat pe `client` (nu „citește +
 * scrie"), ca două Done simultane să nu poată consuma același minut. Draftul de
 * depășire e o factură CRM obișnuită (`external_source = 'hour-overage'`), una
 * per client per lună calendaristică, cu liniile gestionate DOAR de aici.
 */
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import { generateInvoiceNumber } from '$lib/server/invoice-utils';
import { resolveVatPercent, vatPercentToBps } from '$lib/utils/vat';
import { effectiveRateEur } from '$lib/logic/hours-pricing';
import {
	resolveReferenceRate,
	type CatalogMode,
	type CatalogRate
} from '$lib/logic/hourly-catalog';
import {
	HOUR_OVERAGE_INVOICE_SOURCE,
	OVERAGE_NOTES_PREFIX,
	overageMonthKey,
	splitTaskSettlement,
	weightFactor,
	weightedMinutes
} from '$lib/logic/hour-credits';
import { KEEZ_UNIT } from '$lib/constants/keez-measure-units';
import { notifyHourCreditEvent } from '$lib/server/hour-credit-notifications';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

const OPEN_TASK_STATUSES_EXCLUDED = ['done', 'cancelled'] as const;

interface CreditContext {
	rate: CatalogRate;
	mode: CatalogMode;
	referenceRateEur: number;
	stepMinutes: number;
	factor: number;
}

/** Tariful/regimul task-ului (inclusiv inactive) și factorul de ponderare. */
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
		stepMinutes: catalog.rules.stepMinutes,
		factor: weightFactor(rate.rateEur, mode.multiplierPct, reference.rateEur)
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
	const actual = params.actualMinutes ?? task.actualMinutes ?? task.estimatedMinutes ?? 0;
	if (!Number.isInteger(actual) || actual <= 0) return { status: 'skipped', reason: 'fără ore' };

	const ctx = await loadContext(tenantId, task);
	if ('error' in ctx) return { status: 'failed', reason: ctx.error };
	const weighted = weightedMinutes(actual, ctx.factor);
	const now = new Date();
	const ledgerId = generateId();

	// Tranzacția de consum: UPDATE atomic condiționat + ledger + task.
	let consumed = 0;
	try {
		await withTursoBusyRetry(
			() =>
				db.transaction(async (tx) => {
					// Încercarea 1: tot din credit.
					const full = await tx
						.update(table.client)
						.set({
							hourCreditMinutes: sql`${table.client.hourCreditMinutes} - ${weighted}`,
							updatedAt: now
						})
						.where(
							and(
								eq(table.client.id, task.clientId!),
								eq(table.client.tenantId, tenantId),
								sql`${table.client.hourCreditMinutes} >= ${weighted}`
							)
						);
					if (full.rowsAffected === 1) {
						consumed = weighted;
					} else {
						// Încercarea 2: cât există (≥ 0), cu gardă pe valoarea citită.
						for (let attempt = 0; attempt < 3 && consumed === 0; attempt++) {
							const [row] = await tx
								.select({ balance: table.client.hourCreditMinutes })
								.from(table.client)
								.where(
									and(eq(table.client.id, task.clientId!), eq(table.client.tenantId, tenantId))
								)
								.limit(1);
							const available = Math.max(0, row?.balance ?? 0);
							if (available === 0) break;
							const partial = await tx
								.update(table.client)
								.set({ hourCreditMinutes: 0, updatedAt: now })
								.where(
									and(
										eq(table.client.id, task.clientId!),
										eq(table.client.tenantId, tenantId),
										eq(table.client.hourCreditMinutes, available)
									)
								);
							if (partial.rowsAffected === 1) consumed = available;
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
					await tx
						.update(table.task)
						.set({ actualMinutes: actual, creditSettledAt: now, updatedAt: now })
						.where(eq(table.task.id, taskId));
				}),
			{ tenantId, label: 'task-credit.settle' }
		);
	} catch (err) {
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

	const split = splitTaskSettlement({
		realMinutes: actual,
		factor: ctx.factor,
		balanceMinutes: consumed,
		stepMinutes: ctx.stepMinutes
	});
	// `balanceMinutes: consumed` → consumul e exact ce s-a scăzut, restul e depășire.
	const overageReal = split.overageRealMinutes;

	let overageInvoiceId: string | null = null;
	if (overageReal > 0) {
		try {
			overageInvoiceId = await addOverageLine({
				tenantId,
				clientId: task.clientId,
				task: { id: taskId, title: task.title },
				overageRealMinutes: overageReal,
				ctx,
				now
			});
			await db
				.update(table.task)
				.set({ overageInvoiceId, updatedAt: new Date() })
				.where(eq(table.task.id, taskId));
			await db.insert(table.clientHourLedger).values({
				id: generateId(),
				tenantId,
				clientId: task.clientId,
				deltaMinutes: 0,
				kind: 'overage_invoiced',
				sourceType: 'task',
				sourceId: taskId,
				note: `${task.title} — ${overageReal} min peste credit, în draftul lunii`,
				createdByUserId: params.userId ?? null,
				referenceRateEurSnapshot: ctx.referenceRateEur,
				rateSlug: ctx.rate.slug,
				modeSlug: ctx.mode.slug,
				rateEurSnapshot: ctx.rate.rateEur,
				multiplierPctSnapshot: ctx.mode.multiplierPct,
				realMinutes: overageReal,
				createdAt: new Date()
			});
		} catch (err) {
			// Consumul e deja în ledger; depășirea rămâne „nefacturată" (Bugete ore →
			// Regenerează draftul). Nu ascundem eroarea în log.
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
			overageRealMinutes: overageReal
		}
	});
	return {
		status: 'settled',
		consumedMinutes: consumed,
		overageRealMinutes: overageReal,
		overageInvoiceId
	};
}

/** Draftul lunii (sau următoarea, dacă e deja confirmat/în trimitere) + linia task-ului. */
async function addOverageLine(params: {
	tenantId: string;
	clientId: string;
	task: { id: string; title: string };
	overageRealMinutes: number;
	ctx: CreditContext;
	now: Date;
}): Promise<string> {
	const { tenantId, clientId, task, ctx, now } = params;
	const [settings] = await db
		.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	const vatBps = vatPercentToBps(resolveVatPercent(settings?.defaultTaxRate));
	const unitRateEur = effectiveRateEur(ctx.rate.rateEur, ctx.mode.multiplierPct);
	const hours = Math.round((params.overageRealMinutes / 60) * 100) / 100;
	const lineAmount = Math.round(hours * unitRateEur * 100);

	const invoiceId = await findOrCreateOverageDraft({ tenantId, clientId, now, vatBps });
	await withTursoBusyRetry(
		() =>
			db.transaction(async (tx) => {
				await tx.insert(table.invoiceLineItem).values({
					id: generateId(),
					invoiceId,
					description: `Depășire ore — ${task.title} (${ctx.rate.label}${ctx.mode.slug !== 'standard' ? `, ${ctx.mode.label}` : ''})`,
					note: `${hours} h × ${unitRateEur} € · task ${task.id}`,
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
	return invoiceId;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
}): Promise<string> {
	const { tenantId, clientId, now, vatBps } = params;
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
				notes: `${OVERAGE_NOTES_PREFIX}${monthKey} — ore peste creditul clientului, luna ${monthKey}. Liniile sunt generate automat la finalizarea task-urilor; confirmă manual înainte de emitere.`
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
	if (!task?.overageInvoiceId) return;
	const [inv] = await db
		.select({ status: table.invoice.status, keezStatus: table.invoice.keezStatus })
		.from(table.invoice)
		.where(eq(table.invoice.id, task.overageInvoiceId))
		.limit(1);
	if (inv && (inv.status !== 'draft' || inv.keezStatus)) {
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

	const [consumption] = await db
		.select({ deltaMinutes: table.clientHourLedger.deltaMinutes })
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				eq(table.clientHourLedger.sourceType, 'task'),
				eq(table.clientHourLedger.sourceId, taskId),
				eq(table.clientHourLedger.kind, 'task_consumption')
			)
		)
		.orderBy(desc(table.clientHourLedger.createdAt))
		.limit(1);
	const reversed = consumption ? -consumption.deltaMinutes : 0;
	const now = new Date();

	await withTursoBusyRetry(
		() =>
			db.transaction(async (tx) => {
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
				if (task.overageInvoiceId) {
					await tx
						.delete(table.invoiceLineItem)
						.where(
							and(
								eq(table.invoiceLineItem.invoiceId, task.overageInvoiceId),
								eq(table.invoiceLineItem.taskId, taskId)
							)
						);
					const remaining = await tx
						.select({ id: table.invoiceLineItem.id })
						.from(table.invoiceLineItem)
						.where(eq(table.invoiceLineItem.invoiceId, task.overageInvoiceId))
						.limit(1);
					if (remaining.length === 0) {
						await tx.delete(table.invoice).where(eq(table.invoice.id, task.overageInvoiceId));
					} else {
						await recomputeDraftTotals(tx, task.overageInvoiceId);
					}
				}
				await tx
					.update(table.task)
					.set({
						actualMinutes: null,
						creditSettledAt: null,
						overageInvoiceId: null,
						updatedAt: now
					})
					.where(eq(table.task.id, taskId));
			}),
		{ tenantId, label: 'task-credit.reverse' }
	);
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

/** Rezervările (spec §3.2): estimările task-urilor deschise, ponderate cu catalogul curent. */
export async function computeReservedMinutes(
	tenantId: string,
	clientIds: string[]
): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	if (clientIds.length === 0) return out;
	const rows = await db
		.select({
			clientId: table.task.clientId,
			estimatedMinutes: table.task.estimatedMinutes,
			rateSlug: table.task.rateSlug,
			modeSlug: table.task.modeSlug
		})
		.from(table.task)
		.where(
			and(
				eq(table.task.tenantId, tenantId),
				inArray(table.task.clientId, clientIds),
				notInArray(table.task.status, [...OPEN_TASK_STATUSES_EXCLUDED]),
				isNull(table.task.creditSettledAt),
				sql`${table.task.estimatedMinutes} > 0`
			)
		);
	if (rows.length === 0) return out;
	const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
	const reference = resolveReferenceRate(catalog.rates, catalog.rules);
	for (const r of rows) {
		if (!r.clientId || !r.estimatedMinutes) continue;
		let minutes = r.estimatedMinutes;
		if (reference) {
			const rate = catalog.rates.find((x) => x.slug === r.rateSlug) ?? reference;
			const mode = catalog.modes.find((m) => m.slug === (r.modeSlug ?? 'standard'));
			try {
				minutes = weightedMinutes(
					r.estimatedMinutes,
					weightFactor(rate.rateEur, mode?.multiplierPct ?? 100, reference.rateEur)
				);
			} catch (err) {
				logWarning(
					'server',
					`task-credit: rezervare neponderată — ${serializeError(err).message}`,
					{ tenantId }
				);
			}
		}
		out.set(r.clientId, (out.get(r.clientId) ?? 0) + minutes);
	}
	return out;
}
