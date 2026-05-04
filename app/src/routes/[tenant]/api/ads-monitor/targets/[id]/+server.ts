import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { AD_RECOMMENDATION_ACTIONS } from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { buildDiff } from '$lib/server/ads-monitor/diff-builder';
import { writeTargetAudit, evaluateAutoUnsuppress } from '$lib/server/ads-monitor/audit-writer';
import type { RequestHandler } from './$types';

const SEVERITY_VALUES = new Set(['urgent', 'high', 'warning', 'opportunity']);

function normalizeSuppressedActions(input: unknown): string[] | undefined {
	if (input === undefined) return undefined;
	if (!Array.isArray(input)) {
		throw error(400, 'suppressedActions trebuie să fie array');
	}
	const valid = new Set<string>(AD_RECOMMENDATION_ACTIONS);
	const out: string[] = [];
	for (const a of input) {
		if (typeof a !== 'string' || !valid.has(a)) {
			throw error(400, `suppressedActions: acțiune invalidă "${String(a)}"`);
		}
		if (!out.includes(a)) out.push(a);
	}
	out.sort();
	return out;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!params.id) throw error(400, 'Missing id');

	const [row] = await db
		.select({
			target: table.adMonitorTarget,
			clientName: table.client.name,
			accountName: table.metaAdsAccount.accountName,
			accountId: table.metaAdsAccount.metaAdAccountId
		})
		.from(table.adMonitorTarget)
		.innerJoin(table.client, eq(table.client.id, table.adMonitorTarget.clientId))
		.leftJoin(
			table.metaAdsAccount,
			and(
				eq(table.metaAdsAccount.clientId, table.adMonitorTarget.clientId),
				eq(table.metaAdsAccount.tenantId, locals.tenant.id),
				eq(table.metaAdsAccount.isPrimary, true)
			)
		)
		.where(
			and(
				eq(table.adMonitorTarget.id, params.id),
				eq(table.adMonitorTarget.tenantId, locals.tenant.id)
			)
		)
		.limit(1);

	if (!row) throw error(404, 'Target inexistent');

	let suppressed: string[] = [];
	try {
		const parsed = JSON.parse(row.target.suppressedActions ?? '[]');
		if (Array.isArray(parsed)) suppressed = parsed.filter((x): x is string => typeof x === 'string');
	} catch {
		suppressed = [];
	}

	const cleaned = await evaluateAutoUnsuppress(
		locals.tenant.id,
		row.target.id,
		suppressed,
		row.target.version
	);
	suppressed = cleaned.suppressedActions;

	return json({
		target: {
			...row.target,
			suppressedActions: suppressed,
			version: cleaned.version,
			snoozeUntil: row.target.snoozeUntil ?? null,
			optimizerPausedUntil: row.target.optimizerPausedUntil ?? null,
			optimizerPausedReason: row.target.optimizerPausedReason ?? null
		},
		clientName: row.clientName,
		accountName: row.accountName,
		accountId: row.target.externalAdAccountId ?? row.accountId ?? null,
		currency: null // populated via Meta API account_currency in apply path; no DB column yet
	});
};

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!params.id) throw error(400, 'Missing id');

	const [target] = await db
		.select()
		.from(table.adMonitorTarget)
		.where(
			and(eq(table.adMonitorTarget.id, params.id), eq(table.adMonitorTarget.tenantId, locals.tenant.id))
		)
		.limit(1);
	if (!target) throw error(404, 'Target inexistent');

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		throw error(400, 'JSON invalid');
	}

	// B14: snooze/unsnooze — special action (no version check needed)
	if (body.action === 'snooze' || body.action === 'unsnooze') {
		const isSnooze = body.action === 'snooze';
		const days = typeof body.days === 'number' ? body.days : 1;
		const snoozeUntil = isSnooze ? Date.now() + days * 86400_000 : null;
		await db
			.update(table.adMonitorTarget)
			.set({ snoozeUntil, updatedAt: new Date() })
			.where(
				and(eq(table.adMonitorTarget.id, params.id!), eq(table.adMonitorTarget.tenantId, locals.tenant.id))
			);
		await writeTargetAudit({
			tenantId: locals.tenant.id,
			targetId: params.id!,
			actorType: 'user',
			actorId: locals.user.id,
			action: isSnooze ? 'updated' : 'updated',
			changes: { snoozeUntil: { from: target.snoozeUntil ?? null, to: snoozeUntil } }
		});
		return json({ ok: true, snoozeUntil });
	}

	// Mute/unmute remains a special action (no version check needed — informational)
	if (body.action === 'mute' || body.action === 'unmute') {
		const isMute = body.action === 'mute';
		const days = typeof body.days === 'number' ? body.days : 7;
		const mutedUntil = isMute ? new Date(Date.now() + days * 86400_000) : null;
		await db
			.update(table.adMonitorTarget)
			.set({ isMuted: isMute, mutedUntil, updatedAt: new Date() })
			.where(
				and(eq(table.adMonitorTarget.id, params.id), eq(table.adMonitorTarget.tenantId, locals.tenant.id))
			);
		await writeTargetAudit({
			tenantId: locals.tenant.id,
			targetId: params.id,
			actorType: 'user',
			actorId: locals.user.id,
			action: isMute ? 'muted' : 'unmuted',
			changes: { isMuted: { from: target.isMuted, to: isMute } }
		});
		return json({ ok: true });
	}

	// Validate expectedVersion
	if (typeof body.expectedVersion !== 'number') {
		throw error(400, 'expectedVersion lipsește');
	}
	if (body.expectedVersion !== target.version) {
		return json(
			{ ok: false, error: 'version_conflict', currentVersion: target.version },
			{ status: 409 }
		);
	}

	// Build candidate update with strict whitelisting
	const updates: Record<string, unknown> = {};

	const numericNullable = (key: string, min?: number, max?: number) => {
		if (!(key in body)) return;
		const v = body[key];
		if (v === null) {
			updates[key] = null;
			return;
		}
		if (typeof v !== 'number' || !isFinite(v)) {
			throw error(400, `${key} invalid`);
		}
		if (min !== undefined && v < min) throw error(400, `${key} < ${min}`);
		if (max !== undefined && v > max) throw error(400, `${key} > ${max}`);
		updates[key] = v;
	};

	numericNullable('targetCplCents', 0);
	numericNullable('targetCpaCents', 0);
	numericNullable('targetRoas', 0);
	numericNullable('targetCtr', 0, 1);
	numericNullable('targetDailyBudgetCents', 0);
	numericNullable('deviationThresholdPct', 5, 100);
	numericNullable('customCooldownHours', 1, 720);
	numericNullable('minConversionsThreshold', 0, 100);

	if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
	if (typeof body.notifyTelegram === 'boolean') updates.notifyTelegram = body.notifyTelegram;
	if (typeof body.notifyEmail === 'boolean') updates.notifyEmail = body.notifyEmail;
	if (typeof body.notifyInApp === 'boolean') updates.notifyInApp = body.notifyInApp;

	if ('notes' in body) {
		updates.notes =
			typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : null;
	}

	if ('severityOverride' in body) {
		const v = body.severityOverride;
		if (v === null) updates.severityOverride = null;
		else if (typeof v === 'string' && SEVERITY_VALUES.has(v)) updates.severityOverride = v;
		else throw error(400, 'severityOverride invalid');
	}

	const normSuppressed = normalizeSuppressedActions(body.suppressedActions);
	if (normSuppressed !== undefined) {
		updates.suppressedActions = JSON.stringify(normSuppressed);
	}

	// Compute diff for audit (skip if nothing meaningful changed)
	// Parse current target's suppressedActions for comparison
	let currentSuppressed: string[] = [];
	try {
		const parsed = JSON.parse(target.suppressedActions ?? '[]');
		if (Array.isArray(parsed)) currentSuppressed = parsed.filter((x): x is string => typeof x === 'string');
	} catch { currentSuppressed = []; }

	const beforeFlat: Record<string, unknown> = {
		...target,
		suppressedActions: currentSuppressed
	};
	const afterFlat: Record<string, unknown> = { ...updates };
	if (normSuppressed !== undefined) afterFlat.suppressedActions = normSuppressed;

	const changes = buildDiff(beforeFlat, afterFlat);
	if (Object.keys(changes).length === 0) {
		return json({ ok: true, changed: false, version: target.version });
	}

	// Apply update + bump version atomically (single SQL statement guards against races)
	updates.updatedAt = new Date();
	const updated = await db
		.update(table.adMonitorTarget)
		.set({ ...updates, version: sql`${table.adMonitorTarget.version} + 1` })
		.where(
			and(
				eq(table.adMonitorTarget.id, params.id),
				eq(table.adMonitorTarget.tenantId, locals.tenant.id),
				eq(table.adMonitorTarget.version, target.version)
			)
		)
		.returning({ version: table.adMonitorTarget.version });

	if (updated.length === 0) {
		// Race: someone bumped version between SELECT and UPDATE
		const [fresh] = await db
			.select({ version: table.adMonitorTarget.version })
			.from(table.adMonitorTarget)
			.where(eq(table.adMonitorTarget.id, params.id))
			.limit(1);
		return json(
			{ ok: false, error: 'version_conflict', currentVersion: fresh?.version ?? null },
			{ status: 409 }
		);
	}

	const auditNote =
		typeof body.auditNote === 'string' ? body.auditNote.trim().slice(0, 200) : null;

	await writeTargetAudit({
		tenantId: locals.tenant.id,
		targetId: params.id,
		actorType: 'user',
		actorId: locals.user.id,
		action: 'updated',
		changes,
		note: auditNote
	});

	logInfo('ads-monitor', `Target updated: ${params.id}`, {
		tenantId: locals.tenant.id,
		userId: locals.user.id,
		metadata: { targetId: params.id, fields: Object.keys(changes) }
	});

	return json({ ok: true, changed: true, version: updated[0].version });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!params.id) throw error(400, 'Missing id');

	try {
		await db
			.delete(table.adMonitorTarget)
			.where(
				and(eq(table.adMonitorTarget.id, params.id), eq(table.adMonitorTarget.tenantId, locals.tenant.id))
			);
		return json({ ok: true });
	} catch (e) {
		logError('ads-monitor', `Failed to delete target ${params.id}: ${serializeError(e).message}`, {
			tenantId: locals.tenant.id
		});
		throw error(500, 'Eroare la ștergerea target-ului');
	}
};
