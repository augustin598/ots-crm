import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logInfo } from '$lib/server/logger';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!params.id) throw error(400, 'Missing id');

	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch { /* empty body OK for backwards compat */ }

	const [rec] = await db
		.select({ status: table.adOptimizationRecommendation.status })
		.from(table.adOptimizationRecommendation)
		.where(
			and(
				eq(table.adOptimizationRecommendation.id, params.id),
				eq(table.adOptimizationRecommendation.tenantId, locals.tenant.id)
			)
		)
		.limit(1);
	if (!rec) throw error(404, 'Recomandare inexistentă');
	if (rec.status !== 'draft') {
		return json({ ok: false, error: `cannot reject: status=${rec.status}` }, { status: 400 });
	}

	const now = new Date();
	await db
		.update(table.adOptimizationRecommendation)
		.set({
			status: 'rejected',
			decidedAt: now,
			decidedByUserId: locals.user.id,
			updatedAt: now
		})
		.where(eq(table.adOptimizationRecommendation.id, params.id));

	logInfo('ads-monitor', `User rejected recommendation ${params.id}`, {
		tenantId: locals.tenant.id,
		userId: locals.user.id
	});

	// Optional structured feedback for worker tuning
	const reason = typeof body.reason === 'string' ? body.reason : null;
	const VALID_REASONS = new Set(['false_positive','wrong_action','bad_timing','manually_handled','other']);
	if (reason && VALID_REASONS.has(reason)) {
		const fid = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		await db.insert(table.adRecommendationFeedback).values({
			id: fid,
			tenantId: locals.tenant.id,
			recommendationId: params.id,
			userId: locals.user.id,
			rejectionReason: reason,
			note: typeof body.note === 'string' ? body.note.trim().slice(0, 200) : null
		});
	}

	return json({ ok: true });
};
