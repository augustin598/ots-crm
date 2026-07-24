import { json, error } from '@sveltejs/kit';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { serializeError } from '$lib/server/logger';
import { renderMarkdown } from '$lib/utils/markdown';
import { parseFrontmatter } from '$lib/server/content/frontmatter';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const role = locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: admin access required');
	const tenantId = locals.tenant.id;
	const now = new Date();

	const dir = join(process.cwd(), '..', 'content', 'heylux', 'rewritten');
	if (!existsSync(dir)) throw error(400, 'Lipsă content/heylux/rewritten');

	try {
		const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
		let updated = 0, notFound = 0, skipped = 0;
		const missing: string[] = [];
		for (const f of files) {
			const md = readFileSync(join(dir, f), 'utf8');
			const { data, body } = parseFrontmatter(md);
			if (!data.id) { skipped++; continue; } // fișier fără id în frontmatter (M4)
			const html = renderMarkdown(body.trim());
			const res = await db.update(table.contentArticle)
				.set({
					generatedTitle: data.rewrittenTitle ?? null,
					generatedExcerpt: data.rewrittenExcerpt ?? null,
					generatedHtml: html,
					origin: 'rewrite',
					rewriteStatus: 'ready',
					generatedAt: now,
					updatedAt: now
				})
				.where(and(eq(table.contentArticle.id, data.id), eq(table.contentArticle.tenantId, tenantId)))
				.returning({ id: table.contentArticle.id });
			if (res.length) updated++;
			else { notFound++; missing.push(data.id); }
		}
		return json({ ok: true, files: files.length, updated, notFound, skipped, missing: missing.slice(0, 10) });
	} catch (e) {
		console.error('[import-content]', serializeError(e));
		throw error(500, 'Import eșuat: ' + serializeError(e).message);
	}
};
