import { getClaudeClientFor } from '$lib/server/plugins/claude';
import { renderMarkdown } from '$lib/utils/markdown';
import { buildSystemPrompt, parseGeneration, type ContentProfileLike } from './article-prompt';

export type { ContentProfileLike } from './article-prompt';
export { buildSystemPrompt, parseGeneration } from './article-prompt';

export interface GenerateOpts {
	profile: ContentProfileLike | null;
	direction: string | null;
	mode: 'rewrite' | 'brief';
	sourceText?: string;
	brief?: string;
}

export interface GenerateResult {
	title: string;
	html: string;
	excerpt: string;
	model: string;
}

/** Generează un articol (rescriere sau brief) prin ruta Claude 'copywriting'. */
export async function generateArticle(
	tenantId: string,
	opts: GenerateOpts
): Promise<GenerateResult> {
	const client = await getClaudeClientFor(tenantId, 'copywriting', 120_000);
	if (!client)
		throw new Error('Pluginul Claude nu e configurat (adaugă o cheie în Settings → Claude).');

	const system = buildSystemPrompt(opts.profile, opts.direction);
	const userMsg =
		opts.mode === 'rewrite'
			? `Rescrie următorul advertorial ca articol de blog SEO/GEO on-brand, păstrând faptele. Material-sursă:\n\n${opts.sourceText ?? ''}`
			: `Scrie un articol nou de blog SEO/GEO on-brand pe subiectul: ${opts.brief ?? ''}`;

	const res = await client.createMessage({
		model: client.defaultModel,
		max_tokens: 4000,
		system,
		messages: [{ role: 'user', content: userMsg }]
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Claude ${res.status}: ${body.slice(0, 300)}`);
	}
	const json = (await res.json()) as { content?: Array<{ text?: string }> };
	const text = json.content?.[0]?.text ?? '';
	const parsed = parseGeneration(text);
	return {
		title: parsed.title,
		excerpt: parsed.excerpt,
		html: renderMarkdown(parsed.bodyMarkdown),
		model: client.defaultModel
	};
}
