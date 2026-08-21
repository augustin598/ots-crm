/**
 * Regulile outbox-ului WhatsApp, fără DB, ca să se poată testa izolat.
 *
 * De ce există: un task mutat de cinci ori în cinci minute nu trebuie să
 * trimită cinci mesaje într-un grup (pagina /whatsapp avertizează deja că
 * metoda încalcă termenii Meta). Coalescerea și plafonul orar stau aici;
 * `outbox.ts` doar le aplică peste rânduri.
 */

/** Două schimbări ale aceluiași task în același grup, la sub 2 minute, devin una. */
export const COALESCE_WINDOW_MS = 120_000;
/** Peste atâtea mesaje pe oră per tenant, restul așteaptă (și se loghează). */
export const HOURLY_TENANT_LIMIT = 60;
/** O notificare de status livrată după 6 ore e zgomot: expiră. */
export const MAX_AGE_MS = 6 * 3_600_000;
export const MAX_ATTEMPTS = 10;
/** Un rând rămas în `sending` atât (proces picat) se readuce în coadă. */
export const STALE_SENDING_MS = 5 * 60_000;

const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 10 * 60_000;

export function statusDedupeKey(taskId: string, groupJid: string): string {
	return `task.status:${taskId}:${groupJid}`;
}

export type EnqueueContext = {
	/** Rândul încă netrimis cu aceeași cheie, dacă există. */
	queued: { id: string; nextAttemptAt: Date } | null;
	/** Când s-a trimis ultima dată ceva cu aceeași cheie. */
	lastSentAt: Date | null;
};

export type EnqueuePlan = { action: 'insert'; nextAttemptAt: Date } | { action: 'replace'; id: string };

export function planEnqueue(ctx: EnqueueContext, now: Date): EnqueuePlan {
	if (ctx.queued) return { action: 'replace', id: ctx.queued.id };
	if (ctx.lastSentAt) {
		const earliest = ctx.lastSentAt.getTime() + COALESCE_WINDOW_MS;
		if (earliest > now.getTime()) return { action: 'insert', nextAttemptAt: new Date(earliest) };
	}
	return { action: 'insert', nextAttemptAt: now };
}

/** `attempts` = câte încercări s-au făcut deja, inclusiv cea care tocmai a picat. */
export function nextAttemptDelayMs(attempts: number): number {
	const delay = BASE_RETRY_MS * 2 ** Math.max(0, attempts - 1);
	return Math.min(delay, MAX_RETRY_MS);
}

export type FailurePlan = {
	status: 'queued' | 'failed' | 'expired';
	nextAttemptAt: Date | null;
};

export function planFailure(row: { attempts: number; createdAt: Date }, now: Date): FailurePlan {
	if (now.getTime() - row.createdAt.getTime() > MAX_AGE_MS) {
		return { status: 'expired', nextAttemptAt: null };
	}
	if (row.attempts >= MAX_ATTEMPTS) return { status: 'failed', nextAttemptAt: null };
	return { status: 'queued', nextAttemptAt: new Date(now.getTime() + nextAttemptDelayMs(row.attempts)) };
}
