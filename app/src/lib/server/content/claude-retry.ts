/**
 * Retry răbdător pentru /v1/messages pe 429 (rate limit) / 529 (overloaded), cu failover
 * opțional pe cealaltă cheie stocată (abonament ↔ API).
 *
 * Context: cheia de abonament (OAuth) are limită de burst pe MINUT, partajată cu sesiunile
 * Claude Code active pe același cont. Reîncercările trebuie să acopere fereastra de minut
 * (implicit 5 retry-uri ≈ 62s cumulat), dar plafonate de un buget total ca să nu ținem un
 * request HTTP blocat minute în șir. Modul pur (fără db/logger) — testabil direct cu bun:test.
 */

export interface ClaudeLike {
	readonly keyType: 'api' | 'oat';
	readonly defaultModel: string;
	createMessage(body: Record<string, unknown>): Promise<Response>;
}

export interface RetryOptions {
	/** Reîncercări pe clientul primar, după prima cerere. Default 5 (backoff ≈ 62s cumulat). */
	retries?: number;
	/** Reîncercări pe clientul de rezervă. Default 2. */
	fallbackRetries?: number;
	/**
	 * Plafon pe SUMA pauzelor de retry (primar + rezervă). Default 90s — peste el renunțăm
	 * cu mesajul final în loc să ținem requestul blocat (proxy-urile taie oricum răspunsul).
	 */
	totalWaitBudgetMs?: number;
	/** Clientul cheii alternative (null dacă tenantul nu are a doua cheie stocată). */
	fallback?: () => Promise<ClaudeLike | null>;
	/** Notificare (logging) când se comută pe cheia de rezervă. */
	onFallback?: (from: ClaudeLike['keyType'], to: ClaudeLike['keyType']) => void;
	/** Factory-ul de fallback a eșuat (ex. DecryptionError tranzitoriu) — logăm, nu mascăm 429-ul. */
	onFallbackError?: (err: unknown) => void;
	/** Injectabil pentru teste. */
	sleep?: (ms: number) => Promise<void>;
}

/** retry-after e respectat integral până la 60s — limitele pe minut cer pauze de zeci de secunde. */
const RETRY_AFTER_CAP_MS = 60_000;
const BASE_DELAY_MS = 2_000;
const DEFAULT_WAIT_BUDGET_MS = 90_000;

const isTransient = (status: number) => status === 429 || status === 529;

function waitMsFor(res: Response, attempt: number): number {
	// Doar forma delta-seconds (Anthropic o folosește); forma HTTP-date pică pe backoff.
	const ra = Number(res.headers.get('retry-after'));
	if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, RETRY_AFTER_CAP_MS);
	const base = BASE_DELAY_MS * 2 ** attempt;
	return base + Math.floor(Math.random() * 0.25 * base); // jitter ca cererile paralele să nu re-lovească sincron
}

const keyLabel = (k: ClaudeLike['keyType']) => (k === 'oat' ? 'Abonament' : 'API');

/**
 * De ce a picat cheia primară, pe limba tipului ei. Din ~feb 2026 Anthropic NU mai
 * acceptă tokenurile de abonament (sk-ant-oat01) pe Messages API — 429 indiferent
 * de trafic (github.com/anthropics/claude-code/issues/28091; probat cu
 * _debug-claude-key-health pe 2026-07-25). Pe cheia API, 429/529 e rate limit real.
 */
function primaryFailureNote(k: ClaudeLike['keyType'], status: number): string {
	return k === 'oat'
		? `Cheia Abonament a răspuns ${status}: Anthropic nu mai acceptă cheile de abonament pentru apeluri API (din feb 2026)`
		: `Cheia API e rate-limited (${status} — limită pe minut / supraîncărcare temporară, NU quota ta)`;
}

const discardBody = (res: Response) => void res.body?.cancel().catch(() => {});

/** Buget partajat între clientul primar și cel de rezervă + contor real de reîncercări. */
interface RetryBudget {
	leftMs: number;
	retriesDone: number;
}

/**
 * Trimite cererea cu până la `max` reîncercări pe 429/529, în limita bugetului de pauze.
 * Întoarce Response-ul final (ok SAU ultimul transient — decizia de failover e a
 * apelantului); aruncă pe non-transient și pe timeout de fetch (mesaj RO).
 */
async function attemptOn(
	client: ClaudeLike,
	body: Record<string, unknown>,
	max: number,
	sleep: (ms: number) => Promise<void>,
	budget: RetryBudget
): Promise<Response> {
	let attempt = 0;
	// eslint-disable-next-line no-constant-condition
	while (true) {
		let res: Response;
		try {
			res = await client.createMessage(body);
		} catch (e) {
			const name = (e as { name?: unknown } | null)?.name;
			if (name === 'TimeoutError' || name === 'AbortError') {
				throw new Error('Claude nu a răspuns în timpul alocat (timeout de rețea). Reîncearcă.');
			}
			throw e;
		}
		if (res.ok) return res;
		if (!isTransient(res.status)) {
			const errBody = await res.text().catch(() => '');
			throw new Error(`Claude ${res.status}: ${errBody.slice(0, 300)}`);
		}
		const waitMs = waitMsFor(res, attempt);
		if (attempt >= max || waitMs > budget.leftMs) return res;
		discardBody(res); // eliberează socket-ul înainte de pauză
		budget.leftMs -= waitMs;
		budget.retriesDone++;
		await sleep(waitMs);
		attempt++;
	}
}

export async function createMessageWithRetry(
	client: ClaudeLike,
	body: Record<string, unknown>,
	opts: RetryOptions = {}
): Promise<Response> {
	const retries = opts.retries ?? 5;
	const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const budget: RetryBudget = {
		leftMs: opts.totalWaitBudgetMs ?? DEFAULT_WAIT_BUDGET_MS,
		retriesDone: 0
	};

	let res = await attemptOn(client, body, retries, sleep, budget);
	if (res.ok) return res;

	// Transient epuizat pe clientul primar — încearcă cheia alternativă dacă e stocată.
	// Factory-ul poate eșua el însuși (ex. DecryptionError pe Turso) — nu mascăm 429-ul.
	let alt: ClaudeLike | null = null;
	if (opts.fallback) {
		try {
			alt = await opts.fallback();
		} catch (e) {
			opts.onFallbackError?.(e);
		}
	}
	const primaryNote = primaryFailureNote(client.keyType, res.status);
	if (alt) {
		opts.onFallback?.(client.keyType, alt.keyType);
		discardBody(res);
		try {
			res = await attemptOn(alt, body, opts.fallbackRetries ?? 2, sleep, budget);
		} catch (e) {
			// Fără context, toast-ul ar arăta doar eroarea cheii de rezervă (ex. „credit
			// balance too low") și ar ascunde de ce a picat primară.
			const detail = e instanceof Error ? e.message : String(e);
			throw new Error(`${primaryNote}, iar cheia de rezervă (${keyLabel(alt.keyType)}) a eșuat: ${detail}`);
		}
		if (res.ok) return res;
		discardBody(res);
		throw new Error(
			`${primaryNote}; cheia de rezervă (${keyLabel(alt.keyType)}) a răspuns ${res.status} (limită de rată / supraîncărcare). Așteaptă un minut și reîncearcă.`
		);
	}

	discardBody(res);
	if (client.keyType === 'oat') {
		throw new Error(
			`${primaryNote}. Adaugă o cheie API cu credit în Settings → Claude (console.anthropic.com → Plans & Billing) și rutează use-case-urile pe ea — failover-ul o folosește automat.`
		);
	}
	throw new Error(
		`${primaryNote}. Am reîncercat de ${budget.retriesDone} ori cu pauze progresive. Așteaptă un minut și reîncearcă.`
	);
}
