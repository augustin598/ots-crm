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

export class DirectAdminApiError extends Error {
	constructor(
		message: string,
		public statusCode: number,
		public daCode?: string
	) {
		super(message);
		this.name = 'DirectAdminApiError';
	}
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

export interface DAAdminUsage {
	bandwidth: number;
	quota: number;
	users: number;
	resellers: number;
	domains: number;
	databases: number;
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
					const textVal = parsed.text ?? parsed.details;
					const errMsg = typeof textVal === 'string' ? textVal : 'DirectAdmin returned error';
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

	async createUserAccount(data: CreateUserParams): Promise<void> {
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
				ip: data.ip ?? 'shared',
				notify: data.notify ? 'yes' : 'no'
			},
			true
		);
	}

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

	async suspendUser(username: string): Promise<void> {
		await this.request<Record<string, string>>(
			'POST',
			'/CMD_API_SELECT_USERS',
			{
				action: 'suspend',
				[`select${username}`]: username
			},
			true
		);
	}

	async unsuspendUser(username: string): Promise<void> {
		await this.request<Record<string, string>>(
			'POST',
			'/CMD_API_SELECT_USERS',
			{
				action: 'unsuspend',
				[`select${username}`]: username
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
