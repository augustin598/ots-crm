// DirectAdmin API Client
// Authentication: HTTP Basic Auth (base64 encoded username:password)
// Base URL: https://hostname:port
// REST API endpoints: /api/*
// Legacy API endpoints: /CMD_API_* (for user creation, suspension, packages)

import pLimit from 'p-limit';

export interface DirectAdminConfig {
	hostname: string;
	port: number;
	username: string;
	password: string;
	useHttps?: boolean;
	timeoutMs?: number;
	concurrency?: number;
}

/**
 * Stable error categories surfaced by DA's legacy `error=1` responses. Callers
 * branch on `.kind` to drive retry strategy ("username_exists" → regenerate +
 * retry; "package_missing" → fail with admin guidance; "password_weak" →
 * regenerate with stricter complexity).
 *
 * `unknown` is the catch-all when DA's `text`/`details` don't match a known
 * keyword — message is still surfaced for the audit log.
 */
export type DaErrorKind =
	| 'username_exists'
	| 'username_invalid'
	| 'domain_exists'
	| 'domain_invalid'
	| 'package_missing'
	| 'ip_unavailable'
	| 'password_weak'
	| 'access_denied'
	| 'license_restricted'
	| 'unknown';

export class DirectAdminApiError extends Error {
	public kind: DaErrorKind;

	constructor(
		message: string,
		public statusCode: number,
		public daCode?: string
	) {
		super(message);
		this.name = 'DirectAdminApiError';
		this.kind = classifyDaError(message, daCode);
	}
}

/**
 * Map a DA error message (plus optional daCode) to a stable `DaErrorKind`.
 * Keyword match is intentionally loose — DA error strings drift across versions
 * (e.g., "username already exists" vs "That username is taken" vs "Username
 * 'foo' is in use") so we look for the SHORTEST distinctive substring rather
 * than full sentence matches.
 */
export function classifyDaError(message: string, daCode?: string): DaErrorKind {
	// Modern `/api/*` errors carry a `daCode` (`apierror.*`) — prefer it.
	if (daCode === 'apierror.AccessDenied') return 'access_denied';
	if (daCode === 'apierror.LicenseRestricted') return 'license_restricted';
	if (daCode === 'apierror.AlreadyExists') return 'username_exists';

	const msg = message.toLowerCase();
	if (/\b(username|user name).*(exists?|taken|in use)\b/.test(msg)) return 'username_exists';
	if (/\b(invalid|illegal).*username\b/.test(msg)) return 'username_invalid';
	if (/\bdomain.*(exists?|taken|in use|already)/.test(msg)) return 'domain_exists';
	if (/\binvalid.*domain\b/.test(msg)) return 'domain_invalid';
	if (/\b(no such|cannot find|missing|invalid|unknown).*package\b/.test(msg)) return 'package_missing';
	if (/\b(no .*package|package .*(not exist|not found))/.test(msg)) return 'package_missing';
	if (/\b(no .*ip|valid ip|ip.*not (provided|available|allowed))/.test(msg)) return 'ip_unavailable';
	if (/\b(password|passwd).*(weak|strong|complex|complexity|short)/.test(msg)) return 'password_weak';
	if (/\baccess denied|permission denied|not authoriz/.test(msg)) return 'access_denied';
	if (/\blicense\b/.test(msg)) return 'license_restricted';
	return 'unknown';
}

export interface DAUserSearchResult {
	username: string;
	domain: string;
	email: string;
	userType: string;
}

export interface DAUserConfig {
	account: string;
	username: string;
	domain: string;
	/** All domains hosted on this user (primary + addon + parked). Per /api/users/{u}/config spec. */
	domains: string[];
	email: string;
	dateCreated: string;
	creator: string;
	userType: string;
	suspended: boolean;
	package: string;
	ip: string;
	bandwidthLim: number;
	quotaLim: number;
	domainsLim: number;
	subdomainsLim: number;
	emailAccountsLim: number;
	ftpAccountsLim: number;
	mySqlDatabasesLim: number;
	inodeLim: number;
	domainPointersLim: number;
	emailForwardersLim: number;
	autorespondersLim: number;
	mailingListsLim: number;
	cgi: boolean;
	cron: boolean;
	ssh: boolean;
	ssl: boolean;
	dnsControl: boolean;
	php: boolean;
	git: boolean;
	spam: boolean;
	clamav: boolean;
	catchAll: boolean;
	redis: boolean;
	skin: string;
	language: string;
}

export interface DAUserUsage {
	bandwidth: number;
	quota: number;
	domainCount: number;
	subdomainCount: number;
	emailAccountCount: number;
	ftpCount: number;
	dbCount: number;
	inodeCount: number;
}

/**
 * Shape returned by `GET /api/admin-usage`. Field names match DirectAdmin's
 * actual JSON, NOT the historical wrapper assumption (`bandwidth`/`quota` —
 * those would always come back undefined on a real DA instance).
 */
export interface DAAdminUsage {
	bandwidthBytes: number;
	quotaBytes: number;
	dbQuotaBytes: number;
	emailQuotaBytes: number;
	otherQuotaBytes: number;
	users: number;
	resellers: number;
	domains: number;
	subdomains: number;
	domainPointers: number;
	mySqlDatabases: number;
	emailAccounts: number;
	emailForwarders: number;
	emailDeliveries: number;
	emailDeliveriesIncoming: number;
	emailDeliveriesOutgoing: number;
	ftpAccounts: number;
	autoresponders: number;
	mailingLists: number;
	inode: number;
	lastTally: string;
}

/** `GET /api/system-info/cpu` */
export interface DASystemInfoCpu {
	coresCount: number;
	cores: { brand: string; model: string; clockMHz: number; bogoMIPS: number }[];
}

/** `GET /api/system-info/memory` */
export interface DASystemInfoMemory {
	ram: { totalBytes: number; usedBytes: number; cachedBytes: number; freeBytes: number };
	swap: { totalBytes: number; usedBytes: number; freeBytes: number };
}

/** `GET /api/system-info/fs` — one entry per mounted filesystem */
export interface DASystemInfoFsEntry {
	device: string;
	mountPoint: string;
	fileSystem: string;
	totalBytes: number;
	availableBytes: number;
	reservedBytes: number;
	usedBytes: number;
}

/** `GET /api/system-info/load` */
export interface DASystemInfoLoad {
	last1: number;
	last5: number;
	last15: number;
}

/**
 * `GET /api/version` — current DA version + available update info, surfaced
 * on the Updates page of DA's web UI. Drives the "DA update available"
 * indicator on the servers list.
 */
export interface DAVersionInfo {
	commit: string;
	version: string;
	arch: string;
	os: string;
	distro: string;
	eol: boolean;
	/** Server uptime in nanoseconds. */
	uptime: number;
	update: {
		available: boolean;
		availableChannels: string[];
		channel: string;
		commit: string;
		version: string;
	};
	buildDistro: string;
	detectedDistro: string;
}

export interface DAResellerConfig {
	username: string;
	domain: string;
	email: string;
	userType: string;
	bandwidthLim: number;
	quotaLim: number;
	usersLim: number;
}

export interface DADatabase {
	name: string;
	size: number;
	users: string[];
}

export interface DACert {
	id: string;
	domain: string;
	issuer: string;
	expiresAt: string;
	isActive: boolean;
}

export interface DAAcmeConfig {
	enabled: boolean;
	email: string;
	provider: string;
}

export interface DAResourceUsage {
	cpu: number;
	memory: number;
	disk: number;
	timestamp: string;
}

export interface DALoginKey {
	id: string;
	name: string;
	createdAt: string;
	lastUsedAt: string | null;
}

export interface DAVacationConfig {
	enabled: boolean;
	subject: string;
	body: string;
	startDate: string | null;
	endDate: string | null;
}

// PackageInput shape & wire-format helpers live in package-serializer.ts so
// the wrapper itself doesn't drift from the DA admin form layout.
import {
	serializeDAPackage,
	serializeDeletePackageBody,
	type PackageInput
} from './package-serializer';

export type { PackageInput };

export interface DAPackageDetails {
	/** Bandwidth limit in MB, or null for unlimited. */
	bandwidth: number | null;
	/** Disk quota in MB, or null for unlimited. */
	quota: number | null;
	maxEmailAccounts: number | null;
	maxEmailForwarders: number | null;
	maxMailingLists: number | null;
	maxAutoresponders: number | null;
	maxDatabases: number | null;
	maxFtpAccounts: number | null;
	maxDomains: number | null;
	maxSubdomains: number | null;
	maxDomainPointers: number | null;
	maxInodes: number | null;
	emailDailyLimit: number | null;
	cgi: boolean;
	php: boolean;
	spam: boolean;
	cron: boolean;
	ssl: boolean;
	ssh: boolean;
	dnsControl: boolean;
	suspendAtLimit: boolean;
	anonymousFtp: boolean;
	clamav: boolean;
	wordpress: boolean;
	git: boolean;
	redis: boolean;
	oversold: boolean;
	skin: string | null;
	language: string | null;
	/** Raw key-value map from the legacy endpoint, for debugging / forward-compat. */
	raw: Record<string, string>;
}

export interface CreateUserParams {
	username: string;
	password: string;
	domain: string;
	email: string;
	package: string;
	ip?: string;
	notify?: boolean;
	/**
	 * Skip the pre-flight `userExists` + `domainExists` checks. Use when the
	 * caller has just verified existence elsewhere (e.g. a username freshly
	 * generated for a collision retry, or the caller already called
	 * `checkDomainAvailability` immediately before this).
	 */
	skipPreCheck?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 5;

export class DirectAdminClient {
	private baseUrl: string;
	private authHeader: string;
	private timeoutMs: number;
	private limiter: ReturnType<typeof pLimit>;

	constructor(config: DirectAdminConfig) {
		const protocol = config.useHttps === false ? 'http' : 'https';
		this.baseUrl = `${protocol}://${config.hostname}:${config.port}`;
		this.authHeader =
			'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
		this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.limiter = pLimit(config.concurrency ?? DEFAULT_CONCURRENCY);
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
		isLegacy = false
	): Promise<T> {
		return this.limiter(async () => {
			const url = `${this.baseUrl}${path}`;
			const headers: Record<string, string> = {
				Authorization: this.authHeader,
				Accept: 'application/json'
			};

			let bodyStr: string | undefined;
			if (body && isLegacy) {
				headers['Content-Type'] = 'application/x-www-form-urlencoded';
				bodyStr = new URLSearchParams(body as Record<string, string>).toString();
			} else if (body) {
				headers['Content-Type'] = 'application/json';
				bodyStr = JSON.stringify(body);
			}

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

			try {
				// DirectAdmin installs ship with a self-signed TLS cert on the
				// admin port (2222). The hostname allow-list (network-safety.ts)
				// blocks RFC1918/loopback/metadata at server-creation time, so
				// disabling cert validation here only affects the explicitly-
				// added DA hostnames. Bun-specific `tls` option.
				const response = await fetch(url, {
					method,
					headers,
					body: bodyStr,
					signal: controller.signal,
					// Bun extends RequestInit with `tls`; types vary by Bun version, see https://bun.sh/docs/api/fetch
					tls: { rejectUnauthorized: false } as never
				});

				if (!response.ok) {
					let errorMessage = `DirectAdmin API error: ${response.status} ${response.statusText}`;
					let daCode: string | undefined;
					try {
						const errorBody = await response.json();
						if (errorBody?.error) errorMessage = errorBody.error;
						if (errorBody?.type) daCode = errorBody.type;
					} catch {
						// ignore JSON parse errors
					}
					throw new DirectAdminApiError(errorMessage, response.status, daCode);
				}

				if (response.status === 204) {
					return undefined as T;
				}

				const contentType = response.headers.get('content-type') ?? '';
				if (contentType.includes('application/json')) {
					return response.json();
				}

				// Legacy API returns text/html with key=value format
				const text = await response.text();
				const parsed = this.parseLegacyResponse(text);
				// Legacy DA endpoints return HTTP 200 with `error=1&text=...` on failure.
				// Without this check, suspend/unsuspend/create/delete silently appear to succeed
				// while DA actually rejected the call → CRM and DA state diverge.
				const errVal = parsed.error;
				if (errVal === '1' || (Array.isArray(errVal) && errVal[0] === '1')) {
					// DA legacy returns BOTH `text` (short header like "Unable to
					// Create User") and `details` (the actual reason — "Username
					// already exists", "Domain already used", "Package not found",
					// etc). Earlier we only surfaced `text`, so every failure looked
					// the same and staff couldn't tell why. Combine both, picking
					// the first string element when DA encodes them as `list[]=`.
					const pick = (v: unknown): string | undefined => {
						if (typeof v === 'string') return v.trim();
						if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim();
						return undefined;
					};
					const text = pick(parsed.text);
					const details = pick(parsed.details);
					// Decode any HTML entities + collapse whitespace so the message
					// is readable in toasts and audit logs.
					const clean = (s: string) =>
						s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
					const parts = [text, details].filter((s): s is string => !!s).map(clean);
					const errMsg = parts.length > 0 ? parts.join(' — ') : 'DirectAdmin returned error';
					throw new DirectAdminApiError(errMsg, 200, 'da_legacy_error');
				}
				return parsed as T;
			} catch (e) {
				if (e instanceof DOMException && e.name === 'AbortError') {
					throw new DirectAdminApiError(
						`DirectAdmin request timed out after ${this.timeoutMs}ms`,
						0,
						'timeout'
					);
				}
				throw e;
			} finally {
				clearTimeout(timeoutId);
			}
		});
	}

	/**
	 * Parse DA legacy responses (URL-encoded key=value or list[]=v1&list[]=v2).
	 *
	 * DA uses two list formats depending on version/endpoint:
	 *   - `list[]=A&list[]=B&list[]=C`  — preferred, modern legacy
	 *   - `list=A,B,C`                  — older versions / some endpoints
	 *
	 * The previous implementation did `forEach((v, k) => result[k] = v)` which
	 * silently overwrote repeated keys, dropping all but the last `list[]` value.
	 * This version preserves both shapes: arrays land under the base key (e.g.
	 * `list`) without the `[]` suffix, scalar keys stay as strings.
	 */
	private parseLegacyResponse(text: string): Record<string, string | string[]> {
		const result: Record<string, string | string[]> = {};
		const params = new URLSearchParams(text);
		for (const rawKey of new Set(params.keys())) {
			const values = params.getAll(rawKey);
			const baseKey = rawKey.endsWith('[]') ? rawKey.slice(0, -2) : rawKey;
			if (values.length > 1 || rawKey.endsWith('[]')) {
				result[baseKey] = values;
			} else {
				result[baseKey] = values[0];
			}
		}
		return result;
	}

	/**
	 * Diagnostic helper — fetch the raw body of a legacy endpoint without parsing.
	 * Used by admin "Diagnose Sync" button to see exactly what DA returns when
	 * sync fails (different DA versions return different shapes).
	 */
	async getRawLegacyResponse(path: string): Promise<{ status: number; body: string }> {
		return this.limiter(async () => {
			const url = `${this.baseUrl}${path}`;
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
			try {
				const response = await fetch(url, {
					method: 'GET',
					headers: { Authorization: this.authHeader, Accept: '*/*' },
					signal: controller.signal,
					// Bun extends RequestInit with `tls`; types vary by Bun version, see https://bun.sh/docs/api/fetch
					tls: { rejectUnauthorized: false } as never
				});
				const body = await response.text();
				return { status: response.status, body };
			} finally {
				clearTimeout(timeoutId);
			}
		});
	}

	async searchUsers(query?: string): Promise<DAUserSearchResult[]> {
		const params = query ? `?search=${encodeURIComponent(query)}` : '';
		const result = await this.request<{ list?: DAUserSearchResult[] } | DAUserSearchResult[]>(
			'GET',
			`/api/search/users${params}`
		);
		return Array.isArray(result) ? result : (result as { list?: DAUserSearchResult[] }).list ?? [];
	}

	async searchUsersExtended(query?: string): Promise<DAUserSearchResult[]> {
		const params = query ? `?search=${encodeURIComponent(query)}` : '';
		const result = await this.request<{ list?: DAUserSearchResult[] } | DAUserSearchResult[]>(
			'GET',
			`/api/search/users-extended${params}`
		);
		return Array.isArray(result) ? result : (result as { list?: DAUserSearchResult[] }).list ?? [];
	}

	async getUserConfig(username: string): Promise<DAUserConfig> {
		return this.request<DAUserConfig>('GET', `/api/users/${encodeURIComponent(username)}/config`);
	}

	async getUserUsage(username: string): Promise<DAUserUsage> {
		return this.request<DAUserUsage>('GET', `/api/users/${encodeURIComponent(username)}/usage`);
	}

	private cachedUsernames: { ts: number; usernames: Set<string> } | null = null;
	private cachedDomains: { ts: number; domains: Set<string> } | null = null;
	private cachedUsernamesInFlight: Promise<Set<string>> | null = null;
	private cachedDomainsInFlight: Promise<Set<string>> | null = null;

	/**
	 * Real-world DA endpoint compatibility note (probed against DA Evolution
	 * v1.701, 2026-05-22):
	 *   - `/api/search/users?search=foo` → returns ALL usernames as a string
	 *     array, IGNORING the search param. Cannot be used to test existence.
	 *   - `/api/users` → HTML SPA (Evolution skin route, not the API).
	 *   - `/CMD_API_SHOW_USERS` → returns `list[]=user1&list[]=user2&...`
	 *     reliably (legacy form).
	 *   - `/CMD_API_SHOW_USER_DOMAINS?user=X` → returns URL-encoded
	 *     `domain1=stats&domain2=stats&...` (domain names are the KEYS).
	 *   - `/CMD_API_SHOW_RESELLER_IPS` → returns `list[]=ip1&list[]=ip2&...`
	 *     (the IPs the admin can assign to new users — what we actually need).
	 *   - `/CMD_API_SHOW_USER_IPS` and `/CMD_API_ADDITIONAL_IPS` → HTML SPA.
	 *
	 * So the wrapper now drives existence checks off the legacy listings and
	 * caches them per-client (TTL 60s) to keep per-create cost bounded.
	 */
	private static readonly LIST_CACHE_TTL_MS = 60_000;

	private async listAllUsernames(): Promise<Set<string>> {
		const now = Date.now();
		if (
			this.cachedUsernames &&
			now - this.cachedUsernames.ts < DirectAdminClient.LIST_CACHE_TTL_MS
		) {
			return this.cachedUsernames.usernames;
		}
		if (this.cachedUsernamesInFlight) return this.cachedUsernamesInFlight;
		this.cachedUsernamesInFlight = (async () => {
			try {
				const raw = await this.request<Record<string, unknown>>(
					'GET',
					'/CMD_API_SHOW_USERS',
					undefined,
					true
				);
				const list = raw.list;
				const arr: string[] = Array.isArray(list)
					? (list as string[])
					: typeof list === 'string'
					? list.split(',')
					: [];
				const set = new Set(arr.map((u) => u.trim().toLowerCase()).filter(Boolean));
				this.cachedUsernames = { ts: now, usernames: set };
				return set;
			} finally {
				this.cachedUsernamesInFlight = null;
			}
		})();
		return this.cachedUsernamesInFlight;
	}

	private async listAllDomains(): Promise<Set<string>> {
		const now = Date.now();
		if (
			this.cachedDomains &&
			now - this.cachedDomains.ts < DirectAdminClient.LIST_CACHE_TTL_MS
		) {
			return this.cachedDomains.domains;
		}
		if (this.cachedDomainsInFlight) return this.cachedDomainsInFlight;
		this.cachedDomainsInFlight = (async () => {
			try {
				const usernames = await this.listAllUsernames();
				const all = new Set<string>();
				// Bounded concurrency: 8 parallel SHOW_USER_DOMAINS calls. Tuned to
				// keep total wall-time under ~2s for typical 30–100 user installs
				// without overwhelming DA's per-IP rate limiter.
				const queue = [...usernames];
				const CONCURRENCY = 8;
				async function worker(self: DirectAdminClient) {
					while (queue.length > 0) {
						const u = queue.shift();
						if (!u) break;
						try {
							const domains = await self.fetchUserDomains(u);
							for (const d of domains) all.add(d);
						} catch {
							// Skip a single bad config; the snapshot is best-effort.
						}
					}
				}
				await Promise.all(
					Array.from({ length: Math.min(CONCURRENCY, usernames.size) }, () => worker(this))
				);
				this.cachedDomains = { ts: now, domains: all };
				return all;
			} finally {
				this.cachedDomainsInFlight = null;
			}
		})();
		return this.cachedDomainsInFlight;
	}

	private async fetchUserDomains(username: string): Promise<string[]> {
		// CMD_API_SHOW_USER_DOMAINS returns URL-encoded `domain1=stats&domain2=stats`.
		// The KEYS are the domain names (already URL-decoded by `URLSearchParams`
		// inside `parseLegacyResponse`); the values are bandwidth/usage tuples we
		// ignore. DA emits an `error=...` row for bad inputs — skip non-domain
		// keys defensively. Verified against DA Evolution v1.701, 2026-05-22.
		const url = `/CMD_API_SHOW_USER_DOMAINS?user=${encodeURIComponent(username)}`;
		try {
			const parsed = await this.request<Record<string, unknown>>('GET', url, undefined, true);
			const domains: string[] = [];
			for (const key of Object.keys(parsed)) {
				const clean = key.trim().toLowerCase();
				if (clean === 'error' || clean === 'text' || clean === 'details') continue;
				if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) domains.push(clean);
			}
			return domains;
		} catch {
			return [];
		}
	}

	/** Returns true if `username` already exists on this DA admin's pool. */
	async userExists(username: string): Promise<boolean> {
		try {
			const all = await this.listAllUsernames();
			return all.has(username.trim().toLowerCase());
		} catch {
			return false; // fail-open: real create will surface DA's authoritative answer
		}
	}

	/**
	 * Returns true if `domain` is hosted on ANY user (primary, addon, or parked)
	 * on this DA admin's pool. Builds the index lazily on first call and caches
	 * for `LIST_CACHE_TTL_MS`. The `deep` flag is preserved for API parity but
	 * has no effect now — the lookup is always full-domain-coverage.
	 */
	async domainExists(domain: string, _opts: { deep?: boolean } = {}): Promise<boolean> {
		try {
			const all = await this.listAllDomains();
			return all.has(domain.trim().toLowerCase());
		} catch {
			return false;
		}
	}

	async createUserAccount(data: CreateUserParams): Promise<void> {
		// Pre-flight: short-circuit obvious conflicts with a typed error BEFORE
		// hitting DA's slower CMD_API_ACCOUNT_USER. Two upsides:
		//   1. Saves a wasted DA round-trip on duplicate username/domain (DA
		//      returns the same answer 50–200ms later anyway).
		//   2. Lets the caller-side retry loop classify the failure WITHOUT
		//      string-matching DA's error message — they get `DirectAdminApiError
		//      { kind: 'username_exists' }` directly.
		// If DA is unreachable for the pre-check, we fail-open and let the real
		// create call surface the authoritative error. `skipPreCheck=true` lets
		// callers who have already verified existence (e.g. fresh username from
		// retry-after-collision) skip the duplicate work.
		if (!data.skipPreCheck) {
			if (await this.userExists(data.username)) {
				throw new DirectAdminApiError(
					`Username ${data.username} already exists`,
					200,
					'da_legacy_error'
				);
			}
			if (await this.domainExists(data.domain)) {
				throw new DirectAdminApiError(
					`Domain ${data.domain} already exists`,
					200,
					'da_legacy_error'
				);
			}
		}

		// IP handling: many DA admins ship without a `shared` IP pool configured,
		// so the historical default of `ip: 'shared'` fails with
		// "Unable to Create User — A valid IP was not provided". When the caller
		// doesn't pass an IP, fetch the admin's available IPs from DA and use the
		// first available one. The result is cached per-instance.
		const ip = data.ip ?? (await this.resolveDefaultIp());
		await this.request<Record<string, string>>(
			'POST',
			'/CMD_API_ACCOUNT_USER',
			{
				action: 'create',
				add: 'Submit',
				username: data.username,
				passwd: data.password,
				passwd2: data.password,
				domain: data.domain,
				email: data.email,
				package: data.package,
				ip,
				notify: data.notify ? 'yes' : 'no'
			},
			true
		);
	}

	private cachedDefaultIp: string | null = null;
	private resolveDefaultIpInFlight: Promise<string> | null = null;

	/**
	 * Resolve a usable IP for new user creation. Tries in order:
	 *   1. `CMD_API_ADDITIONAL_IPS` (detailed list with `status=` per IP — when
	 *      available, prefer entries marked `shared` over `owned`/`assigned` so
	 *      we don't consume dedicated IPs for shared-hosting users).
	 *   2. `CMD_API_SHOW_USER_IPS` — the legacy "IPs available for assignment"
	 *      endpoint that admin/reseller-level accounts can call. Returns
	 *      `list[]=1.2.3.4&list[]=...` — IPs in the order DA returns them.
	 *
	 * Throws `ip_unavailable` if both endpoints return nothing usable.
	 *
	 * Concurrency: a single in-flight promise is shared across parallel callers
	 * so two simultaneous `createUserAccount` requests on a fresh client only
	 * fire ONE upstream call. Cache lives for the client instance lifetime;
	 * `clearStripeCache(tenantId)`-style invalidation isn't needed because the
	 * factory creates a fresh client whenever credentials change.
	 */
	async resolveDefaultIp(): Promise<string> {
		if (this.cachedDefaultIp) return this.cachedDefaultIp;
		if (this.resolveDefaultIpInFlight) return this.resolveDefaultIpInFlight;

		this.resolveDefaultIpInFlight = (async () => {
			try {
				// Prefer the detailed listing — has per-IP `status` field. Some DA
				// versions only have `CMD_API_SHOW_USER_IPS` (next branch).
				const shared = await this.tryResolveSharedIp();
				if (shared) {
					this.cachedDefaultIp = shared;
					return shared;
				}
				const any = await this.tryResolveAnyIp();
				if (any) {
					this.cachedDefaultIp = any;
					return any;
				}
				throw new DirectAdminApiError(
					'DA admin nu are IP-uri disponibile pentru creare cont. ' +
						'Adaugă un IP în DirectAdmin (Admin → IP Manager) sau atribuie unul către admin/reseller.',
					200,
					'no_ip_available'
				);
			} finally {
				this.resolveDefaultIpInFlight = null;
			}
		})();

		return this.resolveDefaultIpInFlight;
	}

	private async tryResolveSharedIp(): Promise<string | null> {
		// Live probe against DA Evolution v1.701 (2026-05-22) showed:
		//   - /CMD_API_ADDITIONAL_IPS → returns HTML SPA (broken legacy route)
		//   - /CMD_API_SHOW_USER_IPS  → returns HTML SPA
		//   - /CMD_API_SHOW_RESELLER_IPS → returns `list[]=46.4.159.108` ✓
		// So we hit SHOW_RESELLER_IPS as the primary source (admin/reseller
		// session). The endpoint exposes IPs the admin can assign to new users,
		// which is exactly what we need for `CMD_API_ACCOUNT_USER`.
		try {
			const raw = await this.request<Record<string, unknown>>(
				'GET',
				'/CMD_API_SHOW_RESELLER_IPS',
				undefined,
				true
			);
			const candidates: string[] = [];
			const list = raw.list ?? raw.ip;
			if (typeof list === 'string') candidates.push(list);
			else if (Array.isArray(list))
				for (const v of list) if (typeof v === 'string') candidates.push(v);
			for (const v of Object.values(raw)) {
				if (typeof v === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(v.split(':')[0])) {
					candidates.push(v.split(':')[0]);
				}
			}
			const first = candidates
				.map((s) => s.trim())
				.find((s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s));
			return first ?? null;
		} catch {
			return null;
		}
	}

	private async tryResolveAnyIp(): Promise<string | null> {
		// Fallback path: try SHOW_USER_IPS (legacy, present on some DA installs)
		// for resellers that don't have SHOW_RESELLER_IPS visible. If this also
		// returns HTML / nothing parseable, the caller will throw `ip_unavailable`
		// with admin guidance.
		try {
			const raw = await this.request<Record<string, unknown>>(
				'GET',
				'/CMD_API_SHOW_USER_IPS',
				undefined,
				true
			);
			const candidates: string[] = [];
			const list = raw.list ?? raw.ip;
			if (typeof list === 'string') candidates.push(list);
			else if (Array.isArray(list))
				for (const v of list) if (typeof v === 'string') candidates.push(v);
			for (const v of Object.values(raw)) {
				if (typeof v === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(v)) candidates.push(v);
			}
			const first = candidates.find((s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s.trim()))?.trim();
			return first ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * ⚠ DESTRUCTIVE — DO NOT CALL FROM PRODUCTION CODE PATHS.
	 *
	 * Strict policy (memory: feedback_never_delete_da_accounts.md):
	 * DA account deletion is admin-only manual operation on the DA panel.
	 * The method is kept on the wrapper ONLY for staging-DA testing with
	 * throw-away data. No production caller should invoke it — not as a rollback
	 * compensation, not as a debug endpoint action, not as a "cancel hosting"
	 * automation. Account deletion removes SSH user, all domains, mailboxes,
	 * MySQL DBs, files (`/home/{user}`), crons, and logs — irreversibly.
	 *
	 * If you find yourself needing this in a production path, STOP and ask
	 * the user. The CRM-side cleanup pattern is: `db.delete(hostingAccount)`
	 * only — leave the DA account untouched until admin confirms manual delete.
	 */
	async deleteUserAccount(username: string): Promise<void> {
		await this.request<Record<string, string>>(
			'POST',
			'/CMD_API_SELECT_USERS',
			{
				delete: 'yes',
				confirmed: 'Confirm',
				[`select${username}`]: username
			},
			true
		);
	}

	// CMD_API_SELECT_USERS routes by *button-name* form fields, not by `action=`.
	// Sending `action=suspend` makes DA's CMD_SHOW_USERS handler resolve the
	// command to "none" and reply with `text=Unkown Select Command&details=none`
	// (typo is in DA's source). The accepted shape — used by TomMalbran/DirectAdmin,
	// clientexec/directadmin-server, and nexces/directadmin-commands — is:
	//   location=CMD_SELECT_USERS  (some DA versions require this hint)
	//   dosuspend=Suspend         (button name, presence of key is what matters)
	//   select0=<username>        (numeric-indexed select rows)
	async suspendUser(username: string): Promise<void> {
		await this.request<Record<string, string>>(
			'POST',
			'/CMD_API_SELECT_USERS',
			{
				location: 'CMD_SELECT_USERS',
				dosuspend: 'Suspend',
				select0: username
			},
			true
		);
	}

	async unsuspendUser(username: string): Promise<void> {
		await this.request<Record<string, string>>(
			'POST',
			'/CMD_API_SELECT_USERS',
			{
				location: 'CMD_SELECT_USERS',
				dounsuspend: 'Unsuspend',
				select0: username
			},
			true
		);
	}

	async changeUserPackage(username: string, packageName: string): Promise<void> {
		await this.request<Record<string, string>>(
			'POST',
			'/CMD_API_MODIFY_USER',
			{
				action: 'package',
				username,
				package: packageName
			},
			true
		);
	}

	/**
	 * Change a user's DA login password. Legacy form endpoint — DA expects both
	 * `passwd` and `passwd2` to match. DA enforces its own complexity policy on
	 * the server side; if the password is rejected, `request()` surfaces a
	 * `DirectAdminApiError` with `kind: 'password_weak'`.
	 *
	 * On success, the OLD password is immediately invalidated on DA. The caller
	 * MUST re-encrypt `hostingAccount.daCredentialsEncrypted` with the new value
	 * in the same transaction — otherwise the CRM's stored credentials diverge
	 * from DA.
	 */
	async changeUserPassword(username: string, password: string): Promise<void> {
		await this.request<Record<string, string>>(
			'POST',
			'/CMD_API_USER_PASSWD',
			{
				username,
				passwd: password,
				passwd2: password
			},
			true
		);
	}

	async getAdminUsage(): Promise<DAAdminUsage> {
		return this.request<DAAdminUsage>('GET', '/api/admin-usage');
	}

	async getResellerConfig(username: string): Promise<DAResellerConfig> {
		return this.request<DAResellerConfig>(
			'GET',
			`/api/resellers/${encodeURIComponent(username)}/config`
		);
	}

	async listUserPackages(): Promise<string[]> {
		const result = await this.request<Record<string, string | string[]>>(
			'GET',
			'/CMD_API_PACKAGES_USER',
			undefined,
			true
		);
		const list = result.list;
		// Modern legacy: list[]=A&list[]=B → string[] (preferred)
		if (Array.isArray(list)) return list.filter(Boolean);
		// Older format: list=A,B,C → comma-joined string
		if (typeof list === 'string') return list.split(',').filter(Boolean);
		return [];
	}

	/**
	 * Fetch the full set of limits + flags for a single package.
	 * Legacy endpoint, URL-encoded response. DA returns "unlimited" as the literal
	 * string for unbounded numeric fields — we map those to `null`.
	 */
	async getPackageDetails(packageName: string): Promise<DAPackageDetails> {
		const result = await this.request<Record<string, string | string[]>>(
			'GET',
			`/CMD_API_PACKAGES_USER?package=${encodeURIComponent(packageName)}`,
			undefined,
			true
		);

		// parseLegacyResponse can now return string[] for repeated keys; flatten
		// to first scalar for legacy package-detail fields (none are repeated).
		const get = (key: string): string | undefined => {
			const raw = result[key];
			if (Array.isArray(raw)) return raw[0];
			return raw;
		};

		const num = (key: string): number | null => {
			const raw = get(key);
			if (raw === undefined || raw === '' || raw.toLowerCase() === 'unlimited') return null;
			const n = parseInt(raw, 10);
			return Number.isFinite(n) ? n : null;
		};
		const bool = (key: string): boolean => {
			const raw = get(key)?.toLowerCase();
			return raw === 'on' || raw === 'yes' || raw === '1' || raw === 'true';
		};
		const str = (key: string): string | null => {
			const raw = get(key);
			return raw && raw.length > 0 ? raw : null;
		};

		// Flatten the raw map to strings for forward-compat storage. Use the first
		// value if a key was repeated.
		const flatRaw: Record<string, string> = {};
		for (const [k, v] of Object.entries(result)) {
			flatRaw[k] = Array.isArray(v) ? v.join(',') : v;
		}

		return {
			bandwidth: num('bandwidth'),
			quota: num('quota'),
			maxEmailAccounts: num('nemails'),
			maxEmailForwarders: num('nemailf'),
			maxMailingLists: num('nemailml'),
			maxAutoresponders: num('nemailr'),
			maxDatabases: num('mysql'),
			maxFtpAccounts: num('ftp'),
			maxDomains: num('vdomains'),
			maxSubdomains: num('nsubdomains'),
			maxDomainPointers: num('domainptr'),
			maxInodes: num('inode'),
			emailDailyLimit: num('email_daily_limit'),
			cgi: bool('cgi'),
			php: bool('php'),
			spam: bool('spam'),
			cron: bool('cron'),
			ssl: bool('ssl'),
			ssh: bool('ssh'),
			dnsControl: bool('dnscontrol'),
			suspendAtLimit: bool('suspend_at_limit'),
			anonymousFtp: bool('aftp'),
			clamav: bool('clamav'),
			wordpress: bool('wordpress'),
			git: bool('git'),
			redis: bool('redis'),
			oversold: bool('oversold'),
			skin: str('skin'),
			language: str('language'),
			raw: flatRaw
		};
	}

	/**
	 * Create a new user package on the DA server.
	 *
	 * Wraps `POST /CMD_API_MANAGE_USER_PACKAGES` with `action=create`. The full
	 * field set is built by {@link serializeDAPackage} so all wire quirks
	 * (`unlimited` strings, ON/OFF booleans, snake_case keys) live in one place.
	 *
	 * Throws on any DA-reported error — the `request()` helper inspects
	 * `error=1&text=...` form responses and raises {@link DirectAdminApiError}.
	 */
	async createPackage(packageName: string, opts: PackageInput): Promise<void> {
		const body = serializeDAPackage(packageName, 'create', opts);
		await this.request<Record<string, string>>(
			'POST',
			'/CMD_API_MANAGE_USER_PACKAGES',
			body,
			true
		);
	}

	/**
	 * Update an existing user package. Same endpoint as create, but with
	 * `action=modify`. DA replaces all fields with the values in the body — pass
	 * the COMPLETE intended state, not a diff.
	 */
	async modifyPackage(packageName: string, opts: PackageInput): Promise<void> {
		const body = serializeDAPackage(packageName, 'modify', opts);
		await this.request<Record<string, string>>(
			'POST',
			'/CMD_API_MANAGE_USER_PACKAGES',
			body,
			true
		);
	}

	/**
	 * Delete a user package via DA's bulk-select shape (`select0=<name>`).
	 *
	 * DA refuses to delete a package that's currently assigned to live users;
	 * the caller must reconcile those users (move them to a different package)
	 * before deletion or DA returns `error=1`.
	 */
	async deletePackage(packageName: string): Promise<void> {
		const body = serializeDeletePackageBody(packageName);
		await this.request<Record<string, string>>(
			'POST',
			'/CMD_API_MANAGE_USER_PACKAGES',
			body,
			true
		);
	}

	async listDatabases(): Promise<DADatabase[]> {
		const result = await this.request<{ list?: DADatabase[] } | DADatabase[]>(
			'GET',
			'/api/db-show/databases'
		);
		return Array.isArray(result) ? result : (result as { list?: DADatabase[] }).list ?? [];
	}

	async getDomainCerts(domain: string): Promise<DACert[]> {
		const result = await this.request<{ list?: DACert[] } | DACert[]>(
			'GET',
			`/api/domain-tls/${encodeURIComponent(domain)}/certs`
		);
		return Array.isArray(result) ? result : (result as { list?: DACert[] }).list ?? [];
	}

	async getDomainAcmeConfig(domain: string): Promise<DAAcmeConfig> {
		return this.request<DAAcmeConfig>(
			'GET',
			`/api/domain-tls/${encodeURIComponent(domain)}/acme-config`
		);
	}

	async getLatestResourceUsage(): Promise<DAResourceUsage> {
		return this.request<DAResourceUsage>('GET', '/api/resource-usage/latest');
	}

	async getSystemInfoCpu(): Promise<DASystemInfoCpu> {
		return this.request<DASystemInfoCpu>('GET', '/api/system-info/cpu');
	}

	async getSystemInfoMemory(): Promise<DASystemInfoMemory> {
		return this.request<DASystemInfoMemory>('GET', '/api/system-info/memory');
	}

	async getSystemInfoFs(): Promise<DASystemInfoFsEntry[]> {
		return this.request<DASystemInfoFsEntry[]>('GET', '/api/system-info/fs');
	}

	async getSystemInfoLoad(): Promise<DASystemInfoLoad> {
		return this.request<DASystemInfoLoad>('GET', '/api/system-info/load');
	}

	async getVersion(): Promise<DAVersionInfo> {
		return this.request<DAVersionInfo>('GET', '/api/version');
	}

	async listLoginKeys(): Promise<DALoginKey[]> {
		const result = await this.request<{ list?: DALoginKey[] } | DALoginKey[]>(
			'GET',
			'/api/login-keys'
		);
		return Array.isArray(result) ? result : (result as { list?: DALoginKey[] }).list ?? [];
	}

	async getEmailVacation(domain: string, user: string): Promise<DAVacationConfig> {
		return this.request<DAVacationConfig>(
			'GET',
			`/api/emailvacation/${encodeURIComponent(domain)}/${encodeURIComponent(user)}`
		);
	}

	async ping(): Promise<{ online: boolean; responseMs: number }> {
		const start = Date.now();
		try {
			await this.request('GET', '/api/admin-usage');
			return { online: true, responseMs: Date.now() - start };
		} catch {
			try {
				await this.request('GET', '/api/session/user-usage');
				return { online: true, responseMs: Date.now() - start };
			} catch {
				return { online: false, responseMs: Date.now() - start };
			}
		}
	}
}
