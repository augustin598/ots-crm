import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, lte } from 'drizzle-orm';
import { publishArticleToWordpress } from '$lib/server/content/publisher';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';

/**
 * Publică articolele programate scadente (publish_status='scheduled',
 * rewrite_status='ready', scheduled_at<=now). Gate = starea ARTICOLULUI,
 * NU modul website-ului (și website-urile 'auto' au articole de publicat).
 * Claim atomic per articol → zero duplicate la suprapuneri/retry. Respectă
 * defaultWpStatus per website (draft|publish). `dryRun` doar numără.
 */
export async function processContentAutoPublish(params: Record<string, unknown> = {}) {
	const dryRun = params.dryRun === true;
	const now = new Date();

	const due = await db
		.select({
			id: table.contentArticle.id,
			tenantId: table.contentArticle.tenantId,
			defaultWpStatus: table.websiteContentProfile.defaultWpStatus
		})
		.from(table.contentArticle)
		.leftJoin(
			table.websiteContentProfile,
			eq(table.websiteContentProfile.websiteId, table.contentArticle.websiteId)
		)
		.where(
			and(
				eq(table.contentArticle.publishStatus, 'scheduled'),
				eq(table.contentArticle.rewriteStatus, 'ready'),
				lte(table.contentArticle.scheduledAt, now)
			)
		)
		.limit(100);

	if (dryRun) {
		logInfo('content', `[auto-publish] dryRun — ${due.length} articole scadente`, { metadata: { due: due.length } });
		return { success: true, due: due.length, published: 0, failed: 0, skipped: 0 };
	}

	let published = 0;
	let failed = 0;
	let skipped = 0;
	for (const a of due) {
		// Claim atomic: revendică rândul DOAR dacă e încă 'scheduled'. O rulare
		// suprapusă / retry BullMQ îl vede deja 'publishing' → rowsAffected=0 → skip.
		const claim = await db
			.update(table.contentArticle)
			.set({ publishStatus: 'publishing', updatedAt: new Date() })
			.where(
				and(
					eq(table.contentArticle.id, a.id),
					eq(table.contentArticle.publishStatus, 'scheduled')
				)
			);
		const claimed = (claim as { rowsAffected?: number })?.rowsAffected ?? 0;
		if (claimed !== 1) {
			skipped++;
			continue;
		}
		try {
			// Respectă politica per website: 'draft' → ciornă în WP, altfel live.
			const status: 'draft' | 'publish' = a.defaultWpStatus === 'draft' ? 'draft' : 'publish';
			// publishArticleToWordpress setează la final publishStatus='published'/'draft' (sau 'failed'),
			// suprascriind starea tranzitorie 'publishing'.
			await publishArticleToWordpress(a.tenantId, a.id, { status });
			published++;
		} catch (err) {
			failed++;
			const { message, stack } = serializeError(err);
			logWarning('content', `[auto-publish] eșec pe ${a.id}: ${message}`, {
				tenantId: a.tenantId,
				metadata: { articleId: a.id },
				stackTrace: stack
			});
		}
	}
	logInfo('content', `[auto-publish] ${published}/${due.length} publicate (${failed} eșecuri, ${skipped} sărite)`, {
		metadata: { due: due.length, published, failed, skipped }
	});
	return { success: true, due: due.length, published, failed, skipped };
}
