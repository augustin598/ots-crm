import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import { nextSlots } from '$lib/content/publish-schedule';
import { generateArticle } from '$lib/server/content/article-generator';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

/**
 * Pentru fiecare website 'auto': umple calendarul până la cadence_per_week în
 * următoarele 7 zile, rescriind surse nerescrise și programându-le pe sloturi
 * libere. auto_approve → 'scheduled' (le ia auto-publish); altfel 'none'
 * (apar pe calendar, așteaptă review). Bounded la cadență/rulare. `dryRun`
 * doar planifică.
 */
export async function processContentAutoGenerate(params: Record<string, unknown> = {}) {
	const dryRun = params.dryRun === true;
	const now = new Date();

	// 1) profilele 'auto'
	const autos = await db
		.select({
			websiteId: table.websiteContentProfile.websiteId,
			tenantId: table.websiteContentProfile.tenantId,
			cadencePerWeek: table.websiteContentProfile.cadencePerWeek,
			daysOfWeek: table.websiteContentProfile.daysOfWeek,
			publishTime: table.websiteContentProfile.publishTime,
			autoApprove: table.websiteContentProfile.autoApprove
		})
		.from(table.websiteContentProfile)
		.where(eq(table.websiteContentProfile.publishMode, 'auto'))
		.limit(100);

	let planned = 0;
	let generated = 0;
	for (const w of autos) {
		try {
			// 2) programate deja în fereastra viitoare
			const upcoming = await db
				.select({ scheduledAt: table.contentArticle.scheduledAt })
				.from(table.contentArticle)
				.where(
					and(
						eq(table.contentArticle.websiteId, w.websiteId),
						eq(table.contentArticle.publishStatus, 'scheduled'),
						gte(table.contentArticle.scheduledAt, now)
					)
				)
				.limit(50);
			const need = Math.max(0, (w.cadencePerWeek ?? 3) - upcoming.length);
			if (need === 0) continue;

			// 3) surse nerescrise candidate
			const sources = await db
				.select({ id: table.contentArticle.id })
				.from(table.contentArticle)
				.where(
					and(
						eq(table.contentArticle.websiteId, w.websiteId),
						eq(table.contentArticle.rewriteStatus, 'none')
					)
				)
				.limit(need);

			// daysOfWeek e stocat ca JSON array de string (updateWebsitePublishPolicy). Parse defensiv.
			let days: number[] = [];
			try { days = w.daysOfWeek ? (JSON.parse(w.daysOfWeek) as number[]) : []; } catch { days = []; }
			const existing = upcoming.map((u) => u.scheduledAt).filter((d): d is Date => d instanceof Date);
			const slots = nextSlots({ from: now, count: sources.length, daysOfWeek: days, publishTime: w.publishTime ?? '10:00', existing });
			planned += slots.length;
			if (slots.length < sources.length) {
				logWarning('content', `[auto-generate] doar ${slots.length}/${sources.length} sloturi libere pt website ${w.websiteId}`, {
					tenantId: w.tenantId, metadata: { websiteId: w.websiteId, wanted: sources.length, got: slots.length }
				});
			}

			if (dryRun) continue;

			for (let i = 0; i < sources.length; i++) {
				const src = sources[i];
				const at = slots[i];
				if (!at) break;
				await generateAndScheduleSource(w.tenantId, w.websiteId, src.id, at, w.autoApprove === true);
				generated++;
			}
		} catch (err) {
			const { message, stack } = serializeError(err);
			logWarning('content', `[auto-generate] eșec pe website ${w.websiteId}: ${message}`, {
				tenantId: w.tenantId,
				metadata: { websiteId: w.websiteId },
				stackTrace: stack
			});
		}
	}
	logInfo('content', `[auto-generate] ${generated} generate, ${planned} planificate pe ${autos.length} website-uri`, {
		metadata: { websites: autos.length, planned, generated }
	});
	return { success: true, websites: autos.length, planned, generated };
}

/** Rescrie o sursă + o programează (helper intern; profil încărcat inline). */
async function generateAndScheduleSource(
	tenantId: string,
	websiteId: string,
	articleId: string,
	at: Date,
	autoApprove: boolean
) {
	const [a] = await db
		.select()
		.from(table.contentArticle)
		.where(and(eq(table.contentArticle.id, articleId), eq(table.contentArticle.tenantId, tenantId)))
		.limit(1);
	if (!a) return;
	const [profile] = await db
		.select()
		.from(table.websiteContentProfile)
		.where(and(eq(table.websiteContentProfile.websiteId, websiteId), eq(table.websiteContentProfile.tenantId, tenantId)))
		.limit(1);
	const gen = await generateArticle(tenantId, {
		profile: profile ?? null,
		direction: a.articleDirection,
		mode: 'rewrite',
		sourceText: a.bodyText || a.bodyHtml || a.title || ''
	});
	// auto_approve gating: true → 'scheduled' (auto-publish îl va publica la slot);
	// false → 'none' (apare pe calendar prin scheduled_at, dar NU se auto-publică —
	// așteaptă review uman; omul îl aprobă și-l pune pe 'scheduled' din editor).
	const publishStatus = autoApprove ? 'scheduled' : 'none';
	await db
		.update(table.contentArticle)
		.set({
			generatedTitle: gen.title,
			generatedExcerpt: gen.excerpt,
			generatedHtml: gen.html,
			seoTitle: gen.seoTitle,
			metaDescription: gen.metaDescription,
			focusKeyword: gen.focusKeyword,
			slug: gen.slug,
			origin: 'rewrite',
			rewriteStatus: 'ready',
			scheduledAt: at,
			publishStatus,
			generatedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(table.contentArticle.id, articleId));
}
