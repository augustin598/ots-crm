import { getClaudeClientFor } from '$lib/server/plugins/claude';
import { renderMarkdown } from '$lib/utils/markdown';
import {
	buildSystemPrompt,
	buildSeoSystemPrompt,
	parseGeneration,
	parseSeoMeta,
	type ContentProfileLike,
	type SeoMeta
} from './article-prompt';

export type { ContentProfileLike, SeoMeta } from './article-prompt';
export { buildSystemPrompt, parseGeneration, parseSeoMeta, slugify } from './article-prompt';

interface ClaudeLike {
	defaultModel: string;
	createMessage(body: Record<string, unknown>): Promise<Response>;
}

/**
 * createMessage cu retry pe 429 (rate limit) / 529 (overloaded). Respectă `retry-after`
 * dacă e prezent, altfel backoff exponențial. Aruncă un mesaj RO clar la eșec final.
 */
async function createMessageWithRetry(
	client: ClaudeLike,
	body: Record<string, unknown>,
	retries = 3
): Promise<Response> {
	let attempt = 0;
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const res = await client.createMessage(body);
		if (res.ok) return res;
		const transient = res.status === 429 || res.status === 529;
		if (!transient || attempt >= retries) {
			const errBody = await res.text().catch(() => '');
			if (transient) {
				throw new Error(
					`Claude a răspuns ${res.status} (limită de rată pe minut / supraîncărcare temporară — NU quota ta). Am reîncercat de ${retries} ori. Reîncearcă imediat; dacă persistă, rutează „Copywriting" pe cheia API în Settings → Claude (OAuth/Abonamentul are limite de burst mai stricte pt apeluri API).`
				);
			}
			throw new Error(`Claude ${res.status}: ${errBody.slice(0, 300)}`);
		}
		const ra = Number(res.headers.get('retry-after'));
		const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 20_000) : 1500 * 2 ** attempt;
		await new Promise((r) => setTimeout(r, waitMs));
		attempt++;
	}
}

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

	const res = await createMessageWithRetry(client, {
		model: client.defaultModel,
		max_tokens: 4000,
		system,
		messages: [{ role: 'user', content: userMsg }]
	});
	const json = (await res.json()) as { content?: Array<{ text?: string }> };
	const text = json.content?.[0]?.text ?? '';
	const parsed = parseGeneration(text);
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

	const res = await createMessageWithRetry(client, {
		model: client.defaultModel,
		max_tokens: 700,
		system: buildSeoSystemPrompt(opts.profile),
		messages: [
			{
				role: 'user',
				content: `Titlu: ${opts.title}\n\nConținut:\n${opts.text.slice(0, 6000)}`
			}
		]
	});
	const json = (await res.json()) as { content?: Array<{ text?: string }> };
	return parseSeoMeta(json.content?.[0]?.text ?? '');
}
