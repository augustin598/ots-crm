import { getClaudeClientFor } from '$lib/server/plugins/claude';
import { renderMarkdown } from '$lib/utils/markdown';
import { buildSystemPrompt, parseGeneration, type ContentProfileLike } from './article-prompt';

export type { ContentProfileLike } from './article-prompt';
export { buildSystemPrompt, parseGeneration } from './article-prompt';

export interface GenerateOpts {
	profile: ContentProfileLike | null;
	direction: string | null;
	mode: 'rewrite' | 'brief' | 'modify';
	sourceText?: string; // pt rewrite
	brief?: string; // pt brief
	currentText?: string; // pt modify — articolul curent (HTML/text)
	instruction?: string; // pt modify — ce anume să schimbe
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
	let userMsg: string;
	if (opts.mode === 'rewrite') {
		userMsg = `Rescrie următorul advertorial ca articol de blog SEO/GEO on-brand, păstrând faptele. Material-sursă:\n\n${opts.sourceText ?? ''}`;
	} else if (opts.mode === 'brief') {
		userMsg = `Scrie un articol nou de blog SEO/GEO on-brand pe subiectul: ${opts.brief ?? ''}`;
	} else {
		// modify — editare ȚINTITĂ: aplică DOAR instrucțiunea, păstrează restul neschimbat.
		userMsg = `Iată articolul curent. Aplică DOAR modificarea cerută mai jos și PĂSTREAZĂ neschimbat tot restul (structură, titluri, paragrafe nevizate).\n\n=== ARTICOL CURENT ===\n${opts.currentText ?? ''}\n\n=== MODIFICARE DE APLICAT ===\n${opts.instruction ?? ''}`;
	}

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
