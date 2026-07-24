import { query, command, getRequestEvent } from '$app/server';
import { error as svelteError } from '@sveltejs/kit';
import { requireStaff } from '$lib/server/get-actor';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export const getWebsiteContentProfile = query(v.string(), async (websiteId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	await requireStaff(event);
	const rows = await db
		.select()
		.from(table.websiteContentProfile)
		.where(
			and(
				eq(table.websiteContentProfile.websiteId, websiteId),
				eq(table.websiteContentProfile.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);
	return rows[0] ?? null;
});

const PROFILE_FIELDS = [
	'tone',
	'audience',
	'language',
	'keywords',
	'topics',
	'doList',
	'dontList',
	'guardrails',
	'sampleUrls',
	'extraNotes'
] as const;

export const updateWebsiteContentProfile = command(
	v.object({
		websiteId: v.string(),
		tone: v.optional(v.string()),
		audience: v.optional(v.string()),
		language: v.optional(v.string()),
		keywords: v.optional(v.string()),
		topics: v.optional(v.string()),
		doList: v.optional(v.string()),
		dontList: v.optional(v.string()),
		guardrails: v.optional(v.string()),
		sampleUrls: v.optional(v.string()),
		extraNotes: v.optional(v.string())
	}),
	async (input) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
		await requireStaff(event);
		const tenantId = event.locals.tenant.id;
		const patch: Record<string, unknown> = { updatedAt: new Date() };
		for (const k of PROFILE_FIELDS) if (input[k] !== undefined) patch[k] = input[k];
		await db
			.update(table.websiteContentProfile)
			.set(patch)
			.where(
				and(
					eq(table.websiteContentProfile.websiteId, input.websiteId),
					eq(table.websiteContentProfile.tenantId, tenantId)
				)
			);
		return { ok: true };
	}
);
