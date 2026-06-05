/**
 * Hosting expiry guard — the PRIMARY auto-suspension mechanism for non-payment.
 *
 * Why this exists: the business runs a proforma-first Keez workflow. An unpaid
 * renewal stays a Keez "Draft" (proforma) until paid, and the invoice-overdue
 * transition (invoice-overdue-reminders.ts) is gated on keezStatus='Valid'.
 * So an unpaid renewal NEVER reaches the overdue→suspend chain — that chain only
 * ever sees already-paid (Valid) invoices. This job closes that gap: it suspends
 * a hosting account when its linked renewal invoice (proforma OR fiscal) is unpaid
 * past due + grace.
 *
 * Anchor (business decision "A"): grace is counted from the UNPAID renewal
 * invoice's due_date — i.e. the deadline the client was actually given — not from
 * the account's next_due_date.
 *
 * Safety:
 *  - Only acts on accounts with status='active'.
 *  - Only on invoices that are NOT effectively paid (CRM status/paidDate OR Keez
 *    remainingAmount=0) — never suspends a paying customer even if Keez lags.
 *  - Suspension is performed by EMITTING the existing 'invoice.status.changed'
 *    (overdue) hook, so it reuses the DA suspend path, the 10-day grace recheck,
 *    the dual-paid guard, autoSuspendedByInvoiceId linkage (so onInvoicePaid
 *    unsuspends correctly), and customer notification — no duplicated logic.
 *  - dryRun=true (default) only logs/returns candidates; it never suspends.
 */
import { db } from '../../db';
import * as table from '../../db/schema';
import { and, eq, lt, isNull, isNotNull, ne, or, notInArray } from 'drizzle-orm';
import { getHooksManager } from '$lib/server/plugins/hooks';
import { logInfo, logError, serializeError } from '$lib/server/logger';

const GRACE_DAYS = 10;

export interface ExpiryGuardCandidate {
	tenantId: string;
	hostingAccountId: string;
	domain: string | null;
	invoiceId: string;
	invoiceNumber: string | null;
	dueDate: string | null;
	daysOverdue: number;
	keezStatus: string | null;
	status: string | null;
}

export async function processHostingExpiryGuard(
	params: { dryRun?: boolean; tenantId?: string } = {}
): Promise<{ dryRun: boolean; checked: number; suspended: number; candidates: ExpiryGuardCandidate[] }> {
	// Default to DRY-RUN: this job suspends real customers, so live mode must be
	// explicit (cron passes dryRun:false; the debug endpoint requires ?confirm=yes).
	const dryRun = params.dryRun !== false;
	const now = Date.now();
	const cutoff = new Date(now - GRACE_DAYS * 24 * 60 * 60 * 1000);

	const conditions = [
		// active hosting accounts only
		eq(table.hostingAccount.status, 'active'),
		// linked renewal invoice, past due by >= grace
		isNotNull(table.invoice.hostingAccountId),
		lt(table.invoice.dueDate, cutoff),
		// NOT effectively paid (CRM signal): status not terminal-paid AND no manual paidDate
		notInArray(table.invoice.status, ['paid', 'partially_paid', 'cancelled']),
		isNull(table.invoice.paidDate),
		// NOT effectively paid (Keez signal): remainingAmount not synced to 0
		or(isNull(table.invoice.remainingAmount), ne(table.invoice.remainingAmount, 0))
	];
	if (params.tenantId) conditions.push(eq(table.invoice.tenantId, params.tenantId));

	const rows = await db
		.select({
			tenantId: table.invoice.tenantId,
			hostingAccountId: table.invoice.hostingAccountId,
			domain: table.hostingAccount.domain,
			invoiceId: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			clientId: table.invoice.clientId,
			dueDate: table.invoice.dueDate,
			status: table.invoice.status,
			paidDate: table.invoice.paidDate,
			remainingAmount: table.invoice.remainingAmount,
			keezStatus: table.invoice.keezStatus
		})
		.from(table.invoice)
		.innerJoin(table.hostingAccount, eq(table.invoice.hostingAccountId, table.hostingAccount.id))
		.where(and(...conditions));

	const candidates: ExpiryGuardCandidate[] = rows.map((r) => ({
		tenantId: r.tenantId,
		hostingAccountId: r.hostingAccountId as string,
		domain: r.domain,
		invoiceId: r.invoiceId,
		invoiceNumber: r.invoiceNumber,
		dueDate: r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : null,
		daysOverdue: r.dueDate
			? Math.floor((now - new Date(r.dueDate).getTime()) / (24 * 60 * 60 * 1000))
			: 0,
		keezStatus: r.keezStatus,
		status: r.status
	}));

	let suspended = 0;
	if (!dryRun && rows.length > 0) {
		const hooks = getHooksManager();
		for (const r of rows) {
			try {
				await hooks.emit({
					type: 'invoice.status.changed',
					invoice: r as any,
					previousStatus: r.status ?? 'draft',
					newStatus: 'overdue',
					tenantId: r.tenantId,
					userId: 'system:expiry-guard'
				});
				suspended++;
			} catch (e) {
				const { message, stack } = serializeError(e);
				logError('scheduler', `emit failed for invoice ${r.invoiceNumber}: ${message}`, {
					tenantId: r.tenantId,
					stackTrace: stack
				});
			}
		}
	}

	logInfo(
		'scheduler',
		`[expiry-guard] ${dryRun ? 'DRY-RUN' : 'LIVE'} checked=${rows.length} ${dryRun ? 'wouldSuspend' : 'suspendEmitted'}=${dryRun ? rows.length : suspended}`,
		{ metadata: { dryRun, checked: rows.length, suspended, candidates } }
	);

	return { dryRun, checked: rows.length, suspended, candidates };
}
