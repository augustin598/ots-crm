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

	// Select the FULL invoice row (not a projection). The DA suspend hook reads
	// event.invoice.id / .clientId / .hostingAccountId / .dueDate / .status /
	// .paidDate / .remainingAmount. The previous projection aliased id → invoiceId,
	// leaving event.invoice.id undefined — which silently set autoSuspendedByInvoiceId
	// to NULL (so onInvoicePaid could never auto-unsuspend) and made the suspension
	// email's invoice lookup throw. Passing the whole row matches the canonical
	// overdue emitter (invoice-overdue-reminders.ts) so every listener gets its fields.
	const rows = await db
		.select({
			invoice: table.invoice,
			domain: table.hostingAccount.domain
		})
		.from(table.invoice)
		.innerJoin(table.hostingAccount, eq(table.invoice.hostingAccountId, table.hostingAccount.id))
		.where(and(...conditions));

	const candidates: ExpiryGuardCandidate[] = rows.map(({ invoice, domain }) => ({
		tenantId: invoice.tenantId,
		hostingAccountId: invoice.hostingAccountId as string,
		domain,
		invoiceId: invoice.id,
		invoiceNumber: invoice.invoiceNumber,
		dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : null,
		daysOverdue: invoice.dueDate
			? Math.floor((now - new Date(invoice.dueDate).getTime()) / (24 * 60 * 60 * 1000))
			: 0,
		keezStatus: invoice.keezStatus,
		status: invoice.status
	}));

	let suspended = 0;
	if (!dryRun && rows.length > 0) {
		const hooks = getHooksManager();
		for (const { invoice } of rows) {
			try {
				await hooks.emit({
					type: 'invoice.status.changed',
					invoice: invoice as any,
					previousStatus: invoice.status ?? 'draft',
					newStatus: 'overdue',
					tenantId: invoice.tenantId,
					userId: 'system:expiry-guard'
				});
				suspended++;
			} catch (e) {
				const { message, stack } = serializeError(e);
				logError('scheduler', `emit failed for invoice ${invoice.invoiceNumber}: ${message}`, {
					tenantId: invoice.tenantId,
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
