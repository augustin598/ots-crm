/**
 * Hosting billing-gap analyzer + backfill.
 *
 * Finds billing periods that elapsed with no invoice covering them and — only for
 * domains the operator names explicitly — emits the missing renewal through the
 * standard recurring generator (series OTSH, Keez push, VAT classification and
 * hosting period description all follow the normal pipeline).
 *
 *   POST /[tenant]/api/_debug-backfill-hosting-invoices
 *      → ANALYSIS ONLY. Never writes. Returns gaps split into `emit` (certain),
 *        `uncertain` (no period evidence — human must check Keez) and the
 *        `coveredBy` evidence for everything it skipped.
 *
 *   POST ...?domains=a.ro,b.ro          → emit the CERTAIN gaps of those domains
 *   POST ...?domains=a.ro&includeUncertain=true
 *                                       → also emit that domain's uncertain gaps
 *                                         (operator has verified them in Keez)
 *   POST ...?repairDueDates=true        → apply the stale-due-date repairs
 *   Optional: &minPeriodStart=YYYY-MM-DD (default 2026-01-01) — periods starting
 *        earlier are reported only, never emitted.
 *
 * WHY the domain allowlist — coverage CANNOT be established from the CRM alone,
 * so nothing here may bill on the strength of "found no invoice". Two real
 * counter-examples from one afternoon:
 *   - OTS 477 was a 2-year prepay issued 2025-07 covering 2025-03 → 2027-03. Any
 *     detector matching issue dates re-bills a year the customer already paid.
 *   - OTS 528 IS the hosting renewal of opticatransparenta.ro, yet its text reads
 *     "Opțiuni suplimentare (yzywashipotesti.ro) - 360 Monitoring - Lite
 *     (09/10/2025 - 08/11/2025)" — wrong domain, wrong service, wrong period. No
 *     text heuristic can ever see through that.
 * `emit` therefore means "no evidence found in the CRM", NOT "unbilled". The
 * operator checks Keez (filter by CUI + year) and names the domains to bill.
 *
 * Emission mechanics per account (oldest period first):
 *   1. template.nextRunDate := periodStart (generator derives the period from it)
 *   2. generateInvoiceFromRecurringTemplate(template.id) — issued today, due
 *      +dueDateOffset (14d), status draft, NO email sent from this path.
 *   3. after all periods: template.nextRunDate := account.nextDueDate - 14d.
 * On failure the template's schedule is restored and the account is skipped.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray, or } from 'drizzle-orm';
import { generateInvoiceFromRecurringTemplate } from '$lib/server/invoice-utils';
import { advanceNextDueDate } from '$lib/server/hosting/billing';
import {
	assessCoverage,
	shiftISO,
	type InvoiceEvidence,
	type Period
} from '$lib/server/hosting/billing-coverage';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const CYCLE_MONTHS: Record<string, number> = {
	monthly: 1,
	quarterly: 3,
	semiannually: 6,
	biannually: 6,
	annually: 12,
	biennially: 24,
	triennially: 36
};

/** How many cycles back we look for gaps. */
const MAX_PERIODS_BACK = 4;
/** Periods ending before this are pre-CRM history — not reported at all. */
const HISTORY_FLOOR = '2026-01-01';
const RENEWAL_LEAD_DAYS = 14;
const HOSTING_TEXT_RE = /hosting|gazduire|găzduire|wordpress/i;

function addMonthsISO(iso: string, months: number): string {
	const [y, mo, d] = iso.slice(0, 10).split('-').map(Number);
	const target = new Date(Date.UTC(y, mo - 1 + months, 1));
	const lastDay = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
	).getUTCDate();
	target.setUTCDate(Math.min(d, lastDay));
	return target.toISOString().slice(0, 10);
}

interface GapReport extends Period {
	evidence?: Array<{ invoiceNumber: string | null; issueDate: string | null; text: string }>;
}

interface AccountReport {
	hostingAccountId: string;
	domain: string;
	clientId: string | null;
	clientName: string | null;
	billingCycle: string;
	nextDueDate: string;
	amountCents: number;
	currency: string;
	/**
	 * No invoice in the CRM shows this period as billed. That is NOT proof the
	 * customer owes it — see the header on why CRM evidence is incomplete. Bill
	 * only after checking Keez.
	 */
	emit: GapReport[];
	/** Unbilled per the anniversary walk, but a period-less invoice sits nearby —
	 *  check that invoice in Keez before billing (it may be a multi-year prepay). */
	uncertain: GapReport[];
	/** Reported only: period starts before minPeriodStart. */
	reviewOnly: GapReport[];
	/** Gaps proven already billed, with the invoice that covers them. */
	coveredBy: Array<GapReport & { invoiceNumber: string | null; declared: Period }>;
}

interface EmittedInvoice {
	domain: string;
	period: Period;
	invoiceId: string;
	invoiceNumber: string | null;
	totalAmount: number | null;
	currency: string | null;
}

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;
	const domainsParam = event.url.searchParams.get('domains');
	const emitDomains = new Set(
		(domainsParam ?? '')
			.split(',')
			.map((d) => d.trim())
			.filter(Boolean)
	);
	const includeUncertain = event.url.searchParams.get('includeUncertain') === 'true';
	const repairDueDates = event.url.searchParams.get('repairDueDates') === 'true';
	const minPeriodStart = event.url.searchParams.get('minPeriodStart') ?? '2026-01-01';
	const today = new Date().toISOString().slice(0, 10);

	const accounts = await db
		.select({
			id: table.hostingAccount.id,
			clientId: table.hostingAccount.clientId,
			domain: table.hostingAccount.domain,
			billingCycle: table.hostingAccount.billingCycle,
			nextDueDate: table.hostingAccount.nextDueDate,
			recurringAmount: table.hostingAccount.recurringAmount,
			currency: table.hostingAccount.currency,
			templateId: table.recurringInvoice.id,
			templateClientId: table.recurringInvoice.clientId,
			templateActive: table.recurringInvoice.isActive,
			templateNextRun: table.recurringInvoice.nextRunDate,
			templateAmount: table.recurringInvoice.amount,
			paymentMethod: table.hostingAccount.paymentMethod,
			clientName: table.client.name
		})
		.from(table.hostingAccount)
		.leftJoin(
			table.recurringInvoice,
			and(
				eq(table.recurringInvoice.hostingAccountId, table.hostingAccount.id),
				eq(table.recurringInvoice.tenantId, tenantId)
			)
		)
		.leftJoin(
			table.client,
			and(eq(table.client.id, table.hostingAccount.clientId), eq(table.client.tenantId, tenantId))
		)
		.where(
			and(eq(table.hostingAccount.tenantId, tenantId), eq(table.hostingAccount.status, 'active'))
		);

	// Load every non-cancelled invoice of the tenant once, with its line-item text.
	// Tenant-wide on purpose: a renewal can sit on a different client row than the
	// account's (duplicate clients from the import, or a group billing entity), so
	// client-scoped lookups miss real coverage.
	const allInvoices = await db
		.select({
			id: table.invoice.id,
			clientId: table.invoice.clientId,
			status: table.invoice.status,
			issueDate: table.invoice.issueDate,
			invoiceNumber: table.invoice.invoiceNumber,
			isCreditNote: table.invoice.isCreditNote,
			hostingAccountId: table.invoice.hostingAccountId
		})
		.from(table.invoice)
		.where(eq(table.invoice.tenantId, tenantId));
	const liveInvoices = allInvoices.filter((i) => i.status !== 'cancelled' && !i.isCreditNote);

	const textByInvoice = new Map<string, string>();
	if (liveInvoices.length > 0) {
		const ids = liveInvoices.map((i) => i.id);
		const CHUNK = 400;
		for (let i = 0; i < ids.length; i += CHUNK) {
			const rows = await db
				.select({
					invoiceId: table.invoiceLineItem.invoiceId,
					description: table.invoiceLineItem.description,
					note: table.invoiceLineItem.note
				})
				.from(table.invoiceLineItem)
				.where(inArray(table.invoiceLineItem.invoiceId, ids.slice(i, i + CHUNK)));
			for (const r of rows) {
				const piece = [r.description, r.note].filter(Boolean).join(' ');
				const prev = textByInvoice.get(r.invoiceId);
				textByInvoice.set(r.invoiceId, prev ? `${prev} | ${piece}` : piece);
			}
		}
	}

	const candidates: AccountReport[] = [];
	const dueDateRepairs: Array<{
		hostingAccountId: string;
		domain: string;
		from: string;
		to: string;
		paidInvoiceNumber: string | null;
	}> = [];
	const emitted: EmittedInvoice[] = [];
	const errors: Array<{ domain: string; error: string }> = [];

	const cashSkipped: string[] = [];

	for (const acc of accounts) {
		const months = CYCLE_MONTHS[(acc.billingCycle ?? '').toLowerCase()];
		if (!months || !acc.nextDueDate) continue;
		// Cash accounts settle offline against a receipt — a paid year leaves NO
		// invoice behind, so every elapsed period looks unbilled forever. Reporting
		// them as gaps is pure noise, and billing one would double-charge a customer
		// who already paid at the counter.
		if (acc.paymentMethod === 'cash') {
			cashSkipped.push(acc.domain);
			continue;
		}
		const due = String(acc.nextDueDate).slice(0, 10);
		const domainLc = acc.domain.toLowerCase();
		const clientIds = new Set(
			[acc.clientId, acc.templateClientId].filter((v): v is string => typeof v === 'string')
		);

		// An invoice is evidence for this account when it is linked to it, names the
		// domain, or is a hosting-ish invoice on one of the account's client rows.
		// Only the first two IDENTIFY the account: a client's other domain says
		// nothing about this one, so client-level matches stay weak evidence.
		const evidence: InvoiceEvidence[] = liveInvoices
			.map((i) => ({ i, text: textByInvoice.get(i.id) ?? '' }))
			.filter(({ i, text }) => {
				if (i.hostingAccountId === acc.id) return true;
				if (text.toLowerCase().includes(domainLc)) return true;
				return clientIds.has(i.clientId) && HOSTING_TEXT_RE.test(text);
			})
			.map(({ i, text }) => ({
				invoiceNumber: i.invoiceNumber,
				issueDate: i.issueDate ? new Date(i.issueDate).toISOString().slice(0, 10) : null,
				status: i.status,
				linkedToAccount: i.hostingAccountId === acc.id,
				identifiesAccount:
					i.hostingAccountId === acc.id || text.toLowerCase().includes(domainLc),
				text
			}));

		const emit: GapReport[] = [];
		const uncertain: GapReport[] = [];
		const reviewOnly: GapReport[] = [];
		const coveredBy: AccountReport['coveredBy'] = [];

		for (let n = 1; n <= MAX_PERIODS_BACK; n++) {
			const gap: Period = {
				start: addMonthsISO(due, -months * n),
				end: addMonthsISO(due, -months * (n - 1))
			};
			if (gap.start >= today) continue;
			if (gap.end <= HISTORY_FLOOR) break;

			const verdict = assessCoverage(gap, evidence);
			if (verdict.covered) {
				coveredBy.push({
					...gap,
					invoiceNumber: verdict.by.invoiceNumber,
					declared: verdict.declared
				});
				continue;
			}
			if (gap.start < minPeriodStart) {
				reviewOnly.push(gap);
				continue;
			}
			if (verdict.certainty === 'uncertain') {
				uncertain.push({
					...gap,
					evidence: verdict.near.map((e) => ({
						invoiceNumber: e.invoiceNumber,
						issueDate: e.issueDate,
						text: e.text
					}))
				});
				continue;
			}
			emit.push(gap);
		}

		// Stale due-date repair: the renewal invoice for the CURRENT cycle is paid,
		// but next_due_date never advanced (payment recorded outside the PHASE 0 hook).
		if (due <= today) {
			const cycleStart = addMonthsISO(due, -months);
			const paidCurrent = evidence.find(
				(e) => e.linkedToAccount && e.status === 'paid' && e.issueDate !== null && e.issueDate >= cycleStart
			);
			if (paidCurrent) {
				const advanced = advanceNextDueDate(due, acc.billingCycle);
				if (advanced) {
					dueDateRepairs.push({
						hostingAccountId: acc.id,
						domain: acc.domain,
						from: due,
						to: advanced,
						paidInvoiceNumber: paidCurrent.invoiceNumber
					});
				}
			}
		}

		if (emit.length + uncertain.length + reviewOnly.length + coveredBy.length === 0) continue;
		emit.sort((a, b) => a.start.localeCompare(b.start));
		uncertain.sort((a, b) => a.start.localeCompare(b.start));
		candidates.push({
			hostingAccountId: acc.id,
			domain: acc.domain,
			clientId: acc.clientId,
			clientName: acc.clientName,
			billingCycle: acc.billingCycle ?? '',
			nextDueDate: due,
			amountCents: acc.templateAmount ?? acc.recurringAmount ?? 0,
			currency: acc.currency ?? 'RON',
			emit,
			uncertain,
			reviewOnly,
			coveredBy
		});
	}

	const unknownDomains = [...emitDomains].filter((d) => !accounts.some((a) => a.domain === d));

	logInfo(
		'directadmin',
		`Backfill-hosting-invoices scan: ${candidates.length} accounts with gaps · ` +
			`${candidates.reduce((s, c) => s + c.emit.length, 0)} certain · ` +
			`${candidates.reduce((s, c) => s + c.uncertain.length, 0)} uncertain · ` +
			`${candidates.reduce((s, c) => s + c.coveredBy.length, 0)} already covered · ` +
			`emitDomains=[${[...emitDomains].join(',')}] includeUncertain=${includeUncertain}`,
		{ tenantId, action: 'backfill_hosting_scan' }
	);

	if (repairDueDates) {
		for (const rep of dueDateRepairs) {
			await db
				.update(table.hostingAccount)
				.set({ nextDueDate: rep.to, updatedAt: new Date() })
				.where(
					and(
						eq(table.hostingAccount.id, rep.hostingAccountId),
						eq(table.hostingAccount.tenantId, tenantId)
					)
				);
			logInfo(
				'directadmin',
				`Backfill: advanced stale next_due_date ${rep.from} → ${rep.to} for ${rep.domain} (paid ${rep.paidInvoiceNumber})`,
				{ tenantId, action: 'backfill_due_date_repair' }
			);
		}
	}

	for (const cand of candidates) {
		if (!emitDomains.has(cand.domain)) continue;
		if (cashSkipped.includes(cand.domain)) {
			errors.push({ domain: cand.domain, error: 'cash account — settled offline, refusing to bill' });
			continue;
		}
		const periods = includeUncertain
			? [...cand.emit, ...cand.uncertain].sort((a, b) => a.start.localeCompare(b.start))
			: cand.emit;
		if (periods.length === 0) continue;

		const acc = accounts.find((a) => a.id === cand.hostingAccountId);
		if (!acc?.templateId || !acc.templateActive) {
			errors.push({ domain: cand.domain, error: 'no active recurring template' });
			continue;
		}
		if (acc.templateClientId !== acc.clientId) {
			errors.push({
				domain: cand.domain,
				error: `template client ${acc.templateClientId} != account client ${acc.clientId} — run _debug-sync-hosting-recurring first`
			});
			continue;
		}
		const originalNextRun = acc.templateNextRun;
		try {
			for (const period of periods) {
				await db
					.update(table.recurringInvoice)
					.set({ nextRunDate: new Date(`${period.start}T00:00:00.000Z`), updatedAt: new Date() })
					.where(
						and(
							eq(table.recurringInvoice.id, acc.templateId),
							eq(table.recurringInvoice.tenantId, tenantId)
						)
					);
				const result = await generateInvoiceFromRecurringTemplate(acc.templateId);
				const [inv] = await db
					.select({
						invoiceNumber: table.invoice.invoiceNumber,
						totalAmount: table.invoice.totalAmount,
						currency: table.invoice.currency
					})
					.from(table.invoice)
					.where(and(eq(table.invoice.id, result.invoiceId), eq(table.invoice.tenantId, tenantId)))
					.limit(1);
				emitted.push({
					domain: cand.domain,
					period: { start: period.start, end: period.end },
					invoiceId: result.invoiceId,
					invoiceNumber: inv?.invoiceNumber ?? null,
					totalAmount: inv?.totalAmount ?? null,
					currency: inv?.currency ?? null
				});
				logInfo(
					'directadmin',
					`Backfill: emitted ${inv?.invoiceNumber ?? result.invoiceId} for ${cand.domain} period ${period.start} → ${period.end}`,
					{ tenantId, action: 'backfill_invoice_emitted' }
				);
			}
			// Re-anchor the schedule on the account's due date — the generator advances
			// nextRunDate from `now`, which would drift the anniversary.
			await db
				.update(table.recurringInvoice)
				.set({
					nextRunDate: new Date(`${shiftISO(cand.nextDueDate, -RENEWAL_LEAD_DAYS)}T00:00:00.000Z`),
					updatedAt: new Date()
				})
				.where(
					and(
						eq(table.recurringInvoice.id, acc.templateId),
						eq(table.recurringInvoice.tenantId, tenantId)
					)
				);
		} catch (err) {
			const e = serializeError(err);
			errors.push({ domain: cand.domain, error: e.message });
			logError('directadmin', `Backfill failed for ${cand.domain}: ${e.message}`, {
				tenantId,
				stackTrace: e.stack,
				metadata: { hostingAccountId: cand.hostingAccountId }
			});
			if (originalNextRun) {
				await db
					.update(table.recurringInvoice)
					.set({ nextRunDate: originalNextRun, updatedAt: new Date() })
					.where(
						and(
							eq(table.recurringInvoice.id, acc.templateId),
							eq(table.recurringInvoice.tenantId, tenantId)
						)
					);
			}
		}
	}

	return json({
		ok: true,
		analysisOnly: emitDomains.size === 0 && !repairDueDates,
		minPeriodStart,
		emitDomains: [...emitDomains],
		includeUncertain,
		unknownDomains,
		accountsScanned: accounts.length,
		cashSkipped,
		totals: {
			certain: candidates.reduce((s, c) => s + c.emit.length, 0),
			uncertain: candidates.reduce((s, c) => s + c.uncertain.length, 0),
			reviewOnly: candidates.reduce((s, c) => s + c.reviewOnly.length, 0),
			alreadyCovered: candidates.reduce((s, c) => s + c.coveredBy.length, 0)
		},
		candidates,
		dueDateRepairs: { applied: repairDueDates, items: dueDateRepairs },
		emitted,
		errors
	});
};
