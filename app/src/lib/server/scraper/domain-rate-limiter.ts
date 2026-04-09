/**
 * Global per-domain rate limiter with throttling + adaptive backpressure.
 *
 * Combines:
 *  - Concurrency cap per (domain, kind)
 *  - Minimum delay between successive fetches (throttle) per (domain, kind)
 *  - Adaptive "prefer Puppeteer" flag: if a domain returns 429 multiple times
 *    in a short window, we mark it so future fetches skip the doomed plain fetch
 *    and go straight to Puppeteer.
 *
 * In-memory only. Migrate to Redis when running multi-instance.
 */

type SlotKind = 'sitemap' | 'article';

interface DomainState {
	sitemap: Semaphore;
	article: Semaphore;
	lastArticleFetchAt: number;
	lastSitemapFetchAt: number;
	recent429Timestamps: number[]; // sliding window
	preferPuppeteerUntil: number; // epoch ms, 0 = off
}

class Semaphore {
	private permits: number;
	private queue: Array<() => void> = [];
	constructor(max: number) {
		this.permits = max;
	}
	async acquire(signal?: AbortSignal): Promise<() => void> {
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		if (this.permits > 0) {
			this.permits--;
			return () => this.release();
		}
		return new Promise<() => void>((resolve, reject) => {
			const grant = () => {
				signal?.removeEventListener('abort', onAbort);
				this.permits--;
				resolve(() => this.release());
			};
			const onAbort = () => {
				const idx = this.queue.indexOf(grant);
				if (idx >= 0) this.queue.splice(idx, 1);
				reject(new DOMException('Aborted', 'AbortError'));
			};
			this.queue.push(grant);
			signal?.addEventListener('abort', onAbort, { once: true });
		});
	}
	private release() {
		this.permits++;
		const next = this.queue.shift();
		if (next) next();
	}
}

// Defaults tuned for typical RO news sites that aggressively rate-limit.
const DEFAULT_SITEMAP_CONCURRENCY = 1;
const DEFAULT_ARTICLE_CONCURRENCY = 3;
const MIN_ARTICLE_DELAY_MS = 1200; // ≈ 0.8 req/s per worker
const MIN_SITEMAP_DELAY_MS = 800;
const RATE_LIMIT_WINDOW_MS = 30_000;
const RATE_LIMIT_THRESHOLD = 3; // ≥3 × 429 in window → switch to Puppeteer-first
const PREFER_PUPPETEER_DURATION_MS = 5 * 60 * 1000; // 5 min

const domainStates = new Map<string, DomainState>();

function getState(domain: string): DomainState {
	const key = domain.toLowerCase();
	let s = domainStates.get(key);
	if (!s) {
		s = {
			sitemap: new Semaphore(DEFAULT_SITEMAP_CONCURRENCY),
			article: new Semaphore(DEFAULT_ARTICLE_CONCURRENCY),
			lastArticleFetchAt: 0,
			lastSitemapFetchAt: 0,
			recent429Timestamps: [],
			preferPuppeteerUntil: 0
		};
		domainStates.set(key, s);
	}
	return s;
}

/** Run `fn` holding a slot + respecting throttle for the given (domain, kind). */
export async function withDomainSlot<T>(
	domain: string,
	kind: SlotKind,
	fn: () => Promise<T>,
	signal?: AbortSignal
): Promise<T> {
	const state = getState(domain);
	const sem = state[kind];
	const release = await sem.acquire(signal);
	try {
		// Throttle: enforce minimum delay since last fetch of this kind
		const now = Date.now();
		const lastAt = kind === 'article' ? state.lastArticleFetchAt : state.lastSitemapFetchAt;
		const minDelay = kind === 'article' ? MIN_ARTICLE_DELAY_MS : MIN_SITEMAP_DELAY_MS;
		const wait = lastAt + minDelay - now;
		if (wait > 0) {
			await sleep(wait, signal);
		}
		const startAt = Date.now();
		if (kind === 'article') state.lastArticleFetchAt = startAt;
		else state.lastSitemapFetchAt = startAt;

		return await fn();
	} finally {
		release();
	}
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
		const t = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(t);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/** Report that a fetch returned HTTP 429 for this domain. */
export function reportRateLimited(domain: string): void {
	const state = getState(domain);
	const now = Date.now();
	const cutoff = now - RATE_LIMIT_WINDOW_MS;
	state.recent429Timestamps = state.recent429Timestamps.filter((t) => t > cutoff);
	state.recent429Timestamps.push(now);
	if (state.recent429Timestamps.length >= RATE_LIMIT_THRESHOLD) {
		state.preferPuppeteerUntil = now + PREFER_PUPPETEER_DURATION_MS;
	}
}

/** Check if we should skip plain fetch and go straight to Puppeteer. */
export function shouldPreferPuppeteer(domain: string): boolean {
	const state = getState(domain);
	return Date.now() < state.preferPuppeteerUntil;
}
