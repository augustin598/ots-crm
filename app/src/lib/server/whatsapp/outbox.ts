/**
 * Outbox pentru mesajele automate în grupuri WhatsApp.
 *
 * Problema: sesiunea Baileys trăiește într-un singur proces, iar cererea HTTP
 * care schimbă statusul unui task poate ateriza pe altă instanță. De aceea
 * producătorul scrie doar un rând în `whatsapp_outbox`, iar golirea o face
 * bucla pornită în `session-manager` la `connection === 'open'`, adică exact
 * pe instanța care are socketul. Un „kick" imediat scurtează așteptarea când
 * producătorul se nimerește pe aceeași instanță.
 *
 * Regulile (coalescere, backoff, plafon orar) sunt în `outbox-policy.ts`.
 */
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logError, logInfo, logWarning } from '$lib/server/logger';
import {
	HOURLY_TENANT_LIMIT,
	STALE_SENDING_MS,
	planEnqueue,
	planFailure
} from './outbox-policy';

const DRAIN_INTERVAL_MS = 30_000;
const DRAIN_BATCH = 10;

const LOOPS_SYMBOL = Symbol.for('ots_crm_whatsapp_outbox_loops');
const INFLIGHT_SYMBOL = Symbol.for('ots_crm_whatsapp_outbox_inflight');
const GT = globalThis as unknown as Record<symbol, unknown>;

const loops: Map<string, ReturnType<typeof setInterval>> =
	(GT[LOOPS_SYMBOL] as Map<string, ReturnType<typeof setInterval>>) ??
	(GT[LOOPS_SYMBOL] = new Map());
const inflight: Set<string> = (GT[INFLIGHT_SYMBOL] as Set<string>) ?? (GT[INFLIGHT_SYMBOL] = new Set());

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export type OutboxKind = 'task.status' | 'task.mention' | 'task.linked' | 'task.command-ack';

export interface EnqueueInput {
	tenantId: string;
	groupJid: string;
	kind: OutboxKind;
	/** Cu cheie, un rând netrimis cu aceeași cheie e înlocuit (coalescere). */
	dedupeKey?: string | null;
	taskId?: string | null;
	body: string;
	mentions?: string[];
}

export async function enqueueGroupMessage(input: EnqueueInput): Promise<{ id: string; action: 'insert' | 'replace' }> {
	const now = new Date();
	let queued: { id: string; nextAttemptAt: Date } | null = null;
	let lastSentAt: Date | null = null;

	if (input.dedupeKey) {
		const [q] = await db
			.select({ id: table.whatsappOutbox.id, nextAttemptAt: table.whatsappOutbox.nextAttemptAt })
			.from(table.whatsappOutbox)
			.where(
				and(
					eq(table.whatsappOutbox.tenantId, input.tenantId),
					eq(table.whatsappOutbox.dedupeKey, input.dedupeKey),
					eq(table.whatsappOutbox.status, 'queued')
				)
			)
			.limit(1);
		queued = q ?? null;

		const [s] = await db
			.select({ sentAt: table.whatsappOutbox.sentAt })
			.from(table.whatsappOutbox)
			.where(
				and(
					eq(table.whatsappOutbox.tenantId, input.tenantId),
					eq(table.whatsappOutbox.dedupeKey, input.dedupeKey),
					eq(table.whatsappOutbox.status, 'sent')
				)
			)
			.orderBy(desc(table.whatsappOutbox.sentAt))
			.limit(1);
		lastSentAt = s?.sentAt ?? null;
	}

	const plan = planEnqueue({ queued, lastSentAt }, now);
	const mentions = input.mentions && input.mentions.length > 0 ? input.mentions : null;

	if (plan.action === 'replace') {
		await db
			.update(table.whatsappOutbox)
			.set({ body: input.body, mentionsJson: mentions, updatedAt: now })
			.where(eq(table.whatsappOutbox.id, plan.id));
		kickOutbox(input.tenantId);
		return { id: plan.id, action: 'replace' };
	}

	const id = generateId();
	await db.insert(table.whatsappOutbox).values({
		id,
		tenantId: input.tenantId,
		groupJid: input.groupJid,
		kind: input.kind,
		dedupeKey: input.dedupeKey ?? null,
		taskId: input.taskId ?? null,
		body: input.body,
		mentionsJson: mentions,
		status: 'queued',
		attempts: 0,
		nextAttemptAt: plan.nextAttemptAt,
		createdAt: now,
		updatedAt: now
	});
	kickOutbox(input.tenantId);
	return { id, action: 'insert' };
}

/** Golire imediată, doar dacă instanța curentă are socketul. Nu aruncă. */
export function kickOutbox(tenantId: string): void {
	setTimeout(() => {
		void drainOutbox(tenantId).catch((err) => {
			logError('whatsapp', 'outbox kick failed', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		});
	}, 0);
}

export function startOutboxLoop(tenantId: string): void {
	if (loops.has(tenantId)) return;
	const handle = setInterval(() => {
		void drainOutbox(tenantId).catch((err) => {
			logError('whatsapp', 'outbox drain failed', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		});
	}, DRAIN_INTERVAL_MS);
	loops.set(tenantId, handle);
	kickOutbox(tenantId);
}

export function stopOutboxLoop(tenantId: string): void {
	const handle = loops.get(tenantId);
	if (handle) clearInterval(handle);
	loops.delete(tenantId);
}

export type DrainResult = { skipped: 'no-session' | 'busy' | 'hourly-limit' } | { sent: number; failed: number };

export async function drainOutbox(tenantId: string): Promise<DrainResult> {
	const { getActiveSession, sendTextToJid, loadSessionIdForTenant } = await import('./session-manager');
	if (!getActiveSession(tenantId)) return { skipped: 'no-session' };
	if (inflight.has(tenantId)) return { skipped: 'busy' };
	inflight.add(tenantId);

	try {
		const now = new Date();

		// Rânduri rămase în `sending` de la un proces picat.
		await db
			.update(table.whatsappOutbox)
			.set({ status: 'queued', updatedAt: now })
			.where(
				and(
					eq(table.whatsappOutbox.tenantId, tenantId),
					eq(table.whatsappOutbox.status, 'sending'),
					lte(table.whatsappOutbox.updatedAt, new Date(now.getTime() - STALE_SENDING_MS))
				)
			);

		const [{ sentLastHour }] = await db
			.select({ sentLastHour: sql<number>`count(*)` })
			.from(table.whatsappOutbox)
			.where(
				and(
					eq(table.whatsappOutbox.tenantId, tenantId),
					eq(table.whatsappOutbox.status, 'sent'),
					gte(table.whatsappOutbox.sentAt, new Date(now.getTime() - 3_600_000))
				)
			);
		const remaining = HOURLY_TENANT_LIMIT - Number(sentLastHour);
		if (remaining <= 0) {
			const [{ waiting }] = await db
				.select({ waiting: sql<number>`count(*)` })
				.from(table.whatsappOutbox)
				.where(
					and(
						eq(table.whatsappOutbox.tenantId, tenantId),
						eq(table.whatsappOutbox.status, 'queued'),
						lte(table.whatsappOutbox.nextAttemptAt, now)
					)
				);
			if (Number(waiting) > 0) {
				logWarning('whatsapp', `outbox: plafonul de ${HOURLY_TENANT_LIMIT} mesaje/oră atins, ${waiting} așteaptă`, {
					tenantId
				});
			}
			return { skipped: 'hourly-limit' };
		}

		const rows = await db
			.select()
			.from(table.whatsappOutbox)
			.where(
				and(
					eq(table.whatsappOutbox.tenantId, tenantId),
					eq(table.whatsappOutbox.status, 'queued'),
					lte(table.whatsappOutbox.nextAttemptAt, now)
				)
			)
			.orderBy(table.whatsappOutbox.nextAttemptAt)
			.limit(Math.min(DRAIN_BATCH, remaining));

		let sent = 0;
		let failed = 0;
		const sessionId = await loadSessionIdForTenant(tenantId);

		for (const row of rows) {
			const claimedAt = new Date();
			const claim = await db
				.update(table.whatsappOutbox)
				.set({ status: 'sending', attempts: row.attempts + 1, updatedAt: claimedAt })
				.where(and(eq(table.whatsappOutbox.id, row.id), eq(table.whatsappOutbox.status, 'queued')));
			if ((claim.rowsAffected ?? 0) === 0) continue; // luat de altcineva între timp

			try {
				const mentions = Array.isArray(row.mentionsJson) ? row.mentionsJson : [];
				const wamId = await sendTextToJid(tenantId, row.groupJid, row.body, { mentions });
				const sentAt = new Date();
				await db
					.update(table.whatsappOutbox)
					.set({ status: 'sent', sentAt, wamId, lastError: null, updatedAt: sentAt })
					.where(eq(table.whatsappOutbox.id, row.id));
				if (sessionId) {
					// Ca mesajul să apară în inbox ca orice alt mesaj trimis din CRM.
					// Baileys poate să-l fi pus deja prin `messages.upsert`, de aici conflictul ignorat.
					await db
						.insert(table.whatsappMessage)
						.values({
							id: generateId(),
							tenantId,
							sessionId,
							clientId: null,
							direction: 'outbound',
							remoteJid: row.groupJid,
							remotePhoneE164: row.groupJid,
							chatType: 'group',
							wamId,
							messageType: 'text',
							body: row.body,
							status: 'sent',
							sentAt,
							createdAt: sentAt,
							updatedAt: sentAt
						})
						.onConflictDoNothing();
				}
				sent++;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const plan = planFailure({ attempts: row.attempts + 1, createdAt: row.createdAt }, new Date());
				await db
					.update(table.whatsappOutbox)
					.set({
						status: plan.status,
						nextAttemptAt: plan.nextAttemptAt ?? row.nextAttemptAt,
						lastError: message.slice(0, 500),
						updatedAt: new Date()
					})
					.where(eq(table.whatsappOutbox.id, row.id));
				failed++;
				(plan.status === 'queued' ? logWarning : logError)(
					'whatsapp',
					`outbox: trimiterea în ${row.groupJid} a picat (${plan.status}): ${message}`,
					{ tenantId, metadata: { outboxId: row.id, attempts: row.attempts + 1, kind: row.kind } }
				);
				if (message.includes('not connected')) break; // fără socket nu are rost să continuăm lotul
			}
		}

		if (sent > 0 || failed > 0) {
			logInfo('whatsapp', `outbox: ${sent} trimise, ${failed} picate`, { tenantId });
		}
		return { sent, failed };
	} finally {
		inflight.delete(tenantId);
	}
}

/** Pentru diagnostic: câte rânduri sunt în fiecare stare. */
export async function outboxCounts(tenantId: string): Promise<Record<string, number>> {
	const rows = await db
		.select({ status: table.whatsappOutbox.status, n: sql<number>`count(*)` })
		.from(table.whatsappOutbox)
		.where(
			and(
				eq(table.whatsappOutbox.tenantId, tenantId),
				inArray(table.whatsappOutbox.status, ['queued', 'sending', 'sent', 'failed', 'expired'])
			)
		)
		.groupBy(table.whatsappOutbox.status);
	return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
