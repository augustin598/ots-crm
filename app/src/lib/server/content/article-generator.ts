import { getClaudeClient, getClaudeClientFor, type ClaudeClient } from '$lib/server/plugins/claude';
import { logWarning } from '$lib/server/logger';
import { renderMarkdown } from '$lib/utils/markdown';
import { createMessageWithRetry, type RetryOptions } from './claude-retry';
import {
	buildHumanizeSystemPrompt,
	buildSystemPrompt,
	buildSeoSystemPrompt,
	parseGeneration,
	parseSeoMeta,
	type ContentProfileLike,
	type SeoMeta
} from './article-prompt';

export type { ContentProfileLike, SeoMeta } from './article-prompt';
export { buildSystemPrompt, parseGeneration, parseSeoMeta, slugify } from './article-prompt';

/**
 * Failover: dacă cheia rutată dă 429/529 și după reîncercări, comută pe CEALALTĂ cheie
 * stocată (abonament ↔ API). getClaudeClient cu keyType explicit e strict — null dacă
 * tenantul nu are al doilea slot, caz în care rămâne doar mesajul de eroare.
 */
function altKeyRetryOpts(tenantId: string, client: ClaudeClient, timeoutMs: number): RetryOptions {
	const altType = client.keyType === 'oat' ? 'api' : 'oat';
	return {
		fallback: () => getClaudeClient(tenantId, altType, timeoutMs),
		onFallback: (from, to) =>
			logWarning('plugin', 'Claude rate-limited pe cheia rutată — failover pe cheia de rezervă', {
				tenantId,
				metadata: { from, to }
			}),
		onFallbackError: (err) =>
			logWarning('plugin', 'Claude fallback indisponibil (eroare la citirea cheii de rezervă)', {
				tenantId,
				metadata: { error: err instanceof Error ? err.message : String(err) }
			})
	};
}

export interface GenerateOpts {
	profile: ContentProfileLike | null;
	direction: string | null;
	mode: 'rewrite' | 'brief' | 'modify' | 'humanize';
	sourceText?: string; // pt rewrite
	brief?: string; // pt brief
	currentText?: string; // pt modify/humanize — articolul curent (HTML/text)
	instruction?: string; // pt modify — ce anume să schimbe
}

export interface GenerateResult {
	title: string;
	html: string;
	excerpt: string;
	model: string;
	focusKeyword: string;
	seoTitle: string;
	metaDescription: string;
	slug: string;
}

/** Generează un articol (rescriere sau brief) prin ruta Claude 'copywriting'. */
export async function generateArticle(
	tenantId: string,
	opts: GenerateOpts
): Promise<GenerateResult> {
	const client = await getClaudeClientFor(tenantId, 'copywriting', 120_000);
	if (!client)
		throw new Error('Pluginul Claude nu e configurat (adaugă o cheie în Settings → Claude).');

	const system =
		opts.mode === 'humanize'
			? buildHumanizeSystemPrompt(opts.profile)
			: buildSystemPrompt(opts.profile, opts.direction);
	let userMsg: string;
	if (opts.mode === 'rewrite') {
		userMsg = `Rescrie următorul advertorial ca articol de blog SEO/GEO on-brand, păstrând faptele. Material-sursă:\n\n${opts.sourceText ?? ''}`;
	} else if (opts.mode === 'humanize') {
		userMsg = `Umanizează articolul următor (titlu, excerpt și corp):\n\n${opts.currentText ?? ''}`;
	} else if (opts.mode === 'brief') {
		userMsg = `Scrie un articol nou de blog SEO/GEO on-brand pe subiectul: ${opts.brief ?? ''}`;
	} else {
		// modify — editare ȚINTITĂ: aplică DOAR instrucțiunea, păstrează restul neschimbat.
		userMsg = `Iată articolul curent. Aplică DOAR modificarea cerută mai jos și PĂSTREAZĂ neschimbat tot restul (structură, titluri, paragrafe nevizate).\n\n=== ARTICOL CURENT ===\n${opts.currentText ?? ''}\n\n=== MODIFICARE DE APLICAT ===\n${opts.instruction ?? ''}`;
	}

	const res = await createMessageWithRetry(
		client,
		{
			model: client.defaultModel,
			max_tokens: 6000,
			system,
			messages: [{ role: 'user', content: userMsg }]
		},
		altKeyRetryOpts(tenantId, client, 120_000)
	);
	const json = (await res.json()) as { content?: Array<{ text?: string }> };
	const text = json.content?.[0]?.text ?? '';
	const parsed = parseGeneration(text);
	// modify/humanize pornesc de la un articol BUN — dacă răspunsul nu e JSON parsabil
	// (ex. trunchiat la max_tokens), fallback-ul text-brut l-ar suprascrie cu gunoi.
	if ((opts.mode === 'modify' || opts.mode === 'humanize') && !parsed.title) {
		throw new Error('Răspuns invalid de la Claude (posibil trunchiat) — articolul NU a fost modificat. Reîncearcă.');
	}
	return {
		title: parsed.title,
		excerpt: parsed.excerpt,
		html: renderMarkdown(parsed.bodyMarkdown),
		model: client.defaultModel,
		focusKeyword: parsed.focusKeyword,
		seoTitle: parsed.seoTitle,
		metaDescription: parsed.metaDescription,
		slug: parsed.slug
	};
}

/** Generează DOAR metadatele SEO pentru un articol existent (butonul „Generează AI"). */
export async function generateSeoMeta(
	tenantId: string,
	opts: { profile: ContentProfileLike | null; title: string; text: string }
): Promise<SeoMeta> {
	const client = await getClaudeClientFor(tenantId, 'copywriting', 60_000);
	if (!client)
		throw new Error('Pluginul Claude nu e configurat (adaugă o cheie în Settings → Claude).');

	const res = await createMessageWithRetry(
		client,
		{
			model: client.defaultModel,
			max_tokens: 700,
			system: buildSeoSystemPrompt(opts.profile),
			messages: [
				{
					role: 'user',
					content: `Titlu: ${opts.title}\n\nConținut:\n${opts.text.slice(0, 6000)}`
				}
			]
		},
		altKeyRetryOpts(tenantId, client, 60_000)
	);
	const json = (await res.json()) as { content?: Array<{ text?: string }> };
	return parseSeoMeta(json.content?.[0]?.text ?? '');
}
