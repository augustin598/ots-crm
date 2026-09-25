import { buildSignedHeaders } from './hmac';
import { connectorSigningPath, connectorUrl } from './url';
import {
	WpAuthError,
	WpConnectionError,
	WpPluginMissingError,
	WpProtocolError,
	WpSiteDownError
} from './errors';
import type { CachePurgeItem, CachePurgeScope } from '$lib/logic/wordpress-cache-purge';

/** `POST /cache/purge` (connector ≥ 0.8.4): one entry per cache found on the site. */
export interface WpCachePurgeResponse {
	success: boolean;
	purged: CachePurgeItem[];
}

/** Shape returned by the plugin's `/health` endpoint. */
export interface WpHealth {
	connectorVersion: string;
	wpVersion: string;
	phpVersion: string;
	siteUrl: string;
	sslExpiresAt?: string | null;
	timestamp: number;
}

/** One item in the plugin's `/updates` response. Same shape for core / plugin / theme. */
export interface WpUpdateItem {
	type: 'core' | 'plugin' | 'theme';
	slug: string; // For plugins, this is the full path (e.g. "akismet/akismet.php")
	name: string;
	currentVersion: string;
	newVersion: string;
	securityUpdate: boolean;
	autoUpdate: boolean;
}

export interface WpUpdatesResponse {
	items: WpUpdateItem[];
	timestamp: number;
}

/** Per-item outcome returned by `/updates/apply`. */
export interface WpApplyResultItem {
	type: string;
	slug: string;
	success: boolean;
	message: string;
}

export interface WpApplyResponse {
	success: boolean; // true only if every item succeeded
	items: WpApplyResultItem[];
	timestamp: number;
}

export interface WpBackupResponse {
	success: boolean;
	archiveUrl: string;
	archivePath: string;
	sizeBytes: number;
	elapsedSec: number;
	timestamp: number;
}

/** Progress of a chunked backup (connector ≥ 0.8.0). */
export interface WpBackupJobProgress {
	tablesDone: number;
	tablesTotal: number;
	filesDone: number;
	filesTotal: number;
	bytesDone: number;
	bytesTotal: number;
}

export interface WpBackupJobResponse {
	success: boolean;
	/** Directory name of the job, e.g. `ots-backup-20260925-181229-zq8sdywc`. */
	backup: string;
	/** Another step of the same job is still running (lock held); retry shortly. */
	busy?: boolean;
	resumed?: boolean;
	phase?: 'db' | 'scan' | 'files' | 'finalize' | 'done';
	done?: boolean;
	progress?: WpBackupJobProgress;
	sizeBytes?: number;
	skipped?: number;
	elapsedSec?: number;
}

/** Progress of a chunked restore (connector ≥ 0.8.0). */
export interface WpRestoreJobProgress {
	dbPart: number;
	dbParts: number;
	filePart: number;
	fileParts: number;
	statements: number;
	filesWritten: number;
}

export interface WpRestoreJobResponse {
	success: boolean;
	backup: string;
	busy?: boolean;
	phase?: 'db' | 'files' | 'large' | 'done';
	done?: boolean;
	progress?: WpRestoreJobProgress;
	elapsedSec?: number;
}

/** Post shape returned by the plugin for list & single. */
export interface WpPostCategory {
	id: number;
	name: string;
	slug: string;
}

export interface WpPost {
	id: number;
	title: string;
	slug: string;
	status: 'publish' | 'draft' | 'pending' | 'private' | 'future' | 'trash';
	contentHtml: string;
	excerpt: string;
	featuredMediaId: number | null;
	featuredMediaUrl: string | null;
	authorWpId: number;
	/** Prezent din conector v0.7.0; absent la site-urile cu versiuni mai vechi. */
	categories?: WpPostCategory[];
	link: string;
	publishedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface WpPostListResponse {
	items: WpPost[];
	total: number;
	totalPages: number;
	page: number;
	perPage: number;
	timestamp: number;
}

/** Payload accepted by POST /posts and PUT /posts/{id}. */
export interface WpPostPayload {
	title: string;
	contentHtml: string;
	excerpt?: string;
	slug?: string;
	status?: 'publish' | 'draft' | 'pending' | 'private' | 'future';
	publishedAt?: string; // ISO 8601, required for status=future
	featuredMediaId?: number | null;
	/** ID-uri de categorii WP; omis = categoriile existente rămân neatinse (conector ≥0.7.0). */
	categoryIds?: number[];
}

export interface WpCategory {
	id: number;
	name: string;
	slug: string;
	count: number;
}

export interface WpCategoryListResponse {
	items: WpCategory[];
	total: number;
	timestamp: number;
}

export interface WpMediaUploadResponse {
	id: number;
	url: string;
	filename: string;
	timestamp: number;
}

/** One row in the plugin manager. `plugin` is the WP identifier (e.g. "akismet/akismet.php"). */
export interface WpPluginInfo {
	plugin: string;
	name: string;
	version: string;
	description: string;
	author: string;
	authorUri: string;
	pluginUri: string;
	requiresWp: string;
	requiresPhp: string;
	/** WordPress Text Domain — stable identifier across versions, used for matching. */
	textDomain?: string;
	/** Update URI hint — authoritative identifier when set. */
	updateUri?: string;
	/** `Requires Plugins` header, comma-separated slugs (connector ≥ 0.7.1, WP ≥ 6.5). */
	requiresPlugins?: string;
	network: boolean;
	active: boolean;
	autoUpdate: boolean;
	updateAvailable: boolean;
	newVersion: string | null;
	/**
	 * Which mechanism detected the update:
	 *   - `get_plugin_updates`: standard WP flow, upgrade likely installable
	 *   - `transient`: license-gated pro plugin — upgrade known but package
	 *     may not be downloadable without license activation
	 *   - `none`: no update
	 */
	updateSource?: 'get_plugin_updates' | 'transient' | 'none';
	/** ZIP download URL when available. Empty/null for license-gated pros. */
	updatePackage?: string | null;
	/** WP directory changelog URL or vendor update details URL. */
	updateUrl?: string | null;
	/** Vendor's "activate license to update" message, when set. */
	updateMessage?: string | null;
}

export interface WpPluginListResponse {
	items: WpPluginInfo[];
	total: number;
	timestamp: number;
}

interface RequestOptions {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	path: string; // e.g. '/health' — relative to /wp-json/ots-connector/v1
	body?: unknown;
	timeoutMs?: number;
	siteId?: string; // only used to enrich thrown errors
}

/**
 * Authenticated HTTP client for the OTS Connector plugin installed on a
 * client's WordPress site. Signs every request with HMAC-SHA256 and maps
 * network/HTTP failures to typed `WpError`s callers can dispatch on.
 */
export class WpClient {
	constructor(
		private readonly siteUrl: string,
		private readonly secret: string
	) {}

	async health(opts?: { timeoutMs?: number; siteId?: string }): Promise<WpHealth> {
		return this.request<WpHealth>({
			method: 'GET',
			path: '/health',
			timeoutMs: opts?.timeoutMs ?? 10_000,
			siteId: opts?.siteId
		});
	}

	/** Force-refreshes WP's update transients and returns the current set. */
	async listUpdates(opts?: { timeoutMs?: number; siteId?: string }): Promise<WpUpdatesResponse> {
		return this.request<WpUpdatesResponse>({
			method: 'GET',
			path: '/updates',
			timeoutMs: opts?.timeoutMs ?? 45_000, // refresh can be slow on cheap hosting
			siteId: opts?.siteId
		});
	}

	/**
	 * Apply one or more updates. The plugin runs each item sequentially and
	 * returns a per-item status — partial success is the normal case when a
	 * single plugin fails mid-batch.
	 */
	async applyUpdates(
		items: { type: 'core' | 'plugin' | 'theme'; slug: string }[],
		opts?: { timeoutMs?: number; siteId?: string }
	): Promise<WpApplyResponse> {
		return this.request<WpApplyResponse>({
			method: 'POST',
			path: '/updates/apply',
			body: { items },
			timeoutMs: opts?.timeoutMs ?? 180_000, // big plugins like Woo/Elementor are slow
			siteId: opts?.siteId
		});
	}

	/**
	 * Trigger a full backup (SQL dump + wp-content zip). Synchronous on the
	 * plugin side — can take minutes on larger sites — so we give it a
	 * generous timeout. Returns the archive's public URL and size.
	 */
	async triggerBackup(opts?: { timeoutMs?: number; siteId?: string }): Promise<WpBackupResponse> {
		return this.request<WpBackupResponse>({
			method: 'POST',
			path: '/backup',
			body: {},
			timeoutMs: opts?.timeoutMs ?? 600_000, // 10 min for big sites
			siteId: opts?.siteId
		});
	}

	/**
	 * Chunked backup (connector ≥ 0.8.0): create the job, or get back the one
	 * still running. Each `backupStep` then does ~`budgetSec` of work, so no
	 * request outlives the host's proxy timeout or the 60 s HMAC window.
	 */
	async backupStart(opts?: { siteId?: string }): Promise<WpBackupJobResponse> {
		return this.request<WpBackupJobResponse>({
			method: 'POST',
			path: '/backup/start',
			body: {},
			timeoutMs: 30_000,
			siteId: opts?.siteId
		});
	}

	async backupStep(
		backup: string,
		opts?: { budgetSec?: number; siteId?: string }
	): Promise<WpBackupJobResponse> {
		const budgetSec = opts?.budgetSec ?? 10;
		return this.request<WpBackupJobResponse>({
			method: 'POST',
			path: '/backup/step',
			body: { backup, budgetSec },
			timeoutMs: (budgetSec + 35) * 1000,
			siteId: opts?.siteId
		});
	}

	/** Chunked restore (connector ≥ 0.8.0) of a chunked backup. DESTRUCTIVE once it completes. */
	async restoreStart(backup: string, opts?: { siteId?: string }): Promise<WpRestoreJobResponse> {
		return this.request<WpRestoreJobResponse>({
			method: 'POST',
			path: '/restore/start',
			body: { backup },
			timeoutMs: 30_000,
			siteId: opts?.siteId
		});
	}

	async restoreStep(
		backup: string,
		opts?: { budgetSec?: number; siteId?: string }
	): Promise<WpRestoreJobResponse> {
		const budgetSec = opts?.budgetSec ?? 10;
		return this.request<WpRestoreJobResponse>({
			method: 'POST',
			path: '/restore/step',
			body: { backup, budgetSec },
			timeoutMs: (budgetSec + 35) * 1000,
			siteId: opts?.siteId
		});
	}

	/**
	 * Empty every page / asset cache the connector recognises on the site
	 * (connector ≥ 0.8.4); `restore` also flushes the object cache and OPcache.
	 * Deleting a big file cache takes a while on a slow host, hence 60 s.
	 */
	async purgeCache(opts?: {
		scope?: CachePurgeScope;
		timeoutMs?: number;
		siteId?: string;
	}): Promise<WpCachePurgeResponse> {
		return this.request<WpCachePurgeResponse>({
			method: 'POST',
			path: '/cache/purge',
			body: { scope: opts?.scope ?? 'update' },
			timeoutMs: opts?.timeoutMs ?? 60_000,
			siteId: opts?.siteId
		});
	}

	/** Delete a single backup archive on the WP server. Idempotent. */
	async deleteBackup(
		filename: string,
		opts?: { timeoutMs?: number; siteId?: string }
	): Promise<{ success: boolean; deleted: boolean }> {
		return this.request<{ success: boolean; deleted: boolean }>({
			method: 'DELETE',
			path: '/backup',
			body: { filename },
			timeoutMs: opts?.timeoutMs ?? 30_000,
			siteId: opts?.siteId
		});
	}

	/**
	 * Restore a backup archive — DESTRUCTIVE: overwrites DB + wp-content.
	 * The plugin extracts the zip locally and replays the SQL dump.
	 */
	async restoreBackup(
		filename: string,
		opts?: { timeoutMs?: number; siteId?: string }
	): Promise<{ success: boolean; filename: string; elapsedSec: number; tablesImported: number }> {
		return this.request({
			method: 'POST',
			path: '/restore',
			body: { filename },
			timeoutMs: opts?.timeoutMs ?? 900_000, // 15 min — big sites can be slow
			siteId: opts?.siteId
		});
	}

	/* ─────────────────────── Posts + Media ─────────────────────── */

	async listPosts(
		params?: { status?: string; search?: string; page?: number; perPage?: number },
		opts?: { timeoutMs?: number; siteId?: string }
	): Promise<WpPostListResponse> {
		const qs = new URLSearchParams();
		if (params?.status) qs.set('status', params.status);
		if (params?.search) qs.set('search', params.search);
		if (params?.page) qs.set('page', String(params.page));
		if (params?.perPage) qs.set('per_page', String(params.perPage));
		const path = qs.toString() ? `/posts?${qs.toString()}` : '/posts';
		return this.request<WpPostListResponse>({
			method: 'GET',
			path,
			timeoutMs: opts?.timeoutMs ?? 20_000,
			siteId: opts?.siteId
		});
	}

	/** Categoriile site-ului (conector ≥0.7.0; site-urile mai vechi întorc 404). */
	async listCategories(opts?: { timeoutMs?: number; siteId?: string }): Promise<WpCategoryListResponse> {
		return this.request<WpCategoryListResponse>({
			method: 'GET',
			path: '/categories',
			timeoutMs: opts?.timeoutMs ?? 15_000,
			siteId: opts?.siteId
		});
	}

	async getPost(id: number, opts?: { timeoutMs?: number; siteId?: string }): Promise<WpPost> {
		return this.request<WpPost>({
			method: 'GET',
			path: `/posts/${id}`,
			timeoutMs: opts?.timeoutMs ?? 15_000,
			siteId: opts?.siteId
		});
	}

	async createPost(payload: WpPostPayload, opts?: { timeoutMs?: number; siteId?: string }): Promise<WpPost> {
		return this.request<WpPost>({
			method: 'POST',
			path: '/posts',
			body: payload,
			timeoutMs: opts?.timeoutMs ?? 45_000,
			siteId: opts?.siteId
		});
	}

	async updatePost(
		id: number,
		payload: WpPostPayload,
		opts?: { timeoutMs?: number; siteId?: string }
	): Promise<WpPost> {
		return this.request<WpPost>({
			method: 'PUT',
			path: `/posts/${id}`,
			body: payload,
			timeoutMs: opts?.timeoutMs ?? 45_000,
			siteId: opts?.siteId
		});
	}

	async deletePost(id: number, opts?: { timeoutMs?: number; siteId?: string }): Promise<{ success: boolean }> {
		return this.request<{ success: boolean }>({
			method: 'DELETE',
			path: `/posts/${id}`,
			timeoutMs: opts?.timeoutMs ?? 20_000,
			siteId: opts?.siteId
		});
	}

	/* ─────────────────────── Plugins ─────────────────────── */

	/**
	 * List every installed plugin. `light: true` asks the connector (≥0.7.1)
	 * to skip the update-transient refresh — the round-trip to
	 * api.wordpress.org plus every licence-gated vendor's own check — and
	 * answer from WP's existing cache. Use it when only the installed
	 * versions matter (plugin library comparison); older connectors ignore
	 * the flag and simply take longer.
	 */
	async listPlugins(opts?: {
		timeoutMs?: number;
		siteId?: string;
		light?: boolean;
	}): Promise<WpPluginListResponse> {
		return this.request<WpPluginListResponse>({
			method: 'GET',
			path: opts?.light ? '/plugins?light=1' : '/plugins',
			timeoutMs: opts?.timeoutMs ?? 30_000,
			siteId: opts?.siteId
		});
	}

	async activatePlugin(
		plugin: string,
		opts?: { timeoutMs?: number; siteId?: string }
	): Promise<{
		success: boolean;
		plugin: string;
		active: boolean;
		already_active?: boolean;
		/** Populated when the connector (v0.6.2+) reports a structured failure. */
		error?: string;
		/** Classifier from the connector (activation_fatal | activation_redirect | ...). */
		subcode?: string;
		/** Sanitized stdout captured during the activation hook (0.6.2+). */
		output_captured?: string;
	}> {
		return this.request({
			method: 'POST',
			path: '/plugins/activate',
			body: { plugin },
			timeoutMs: opts?.timeoutMs ?? 60_000,
			siteId: opts?.siteId
		});
	}

	async deactivatePlugin(
		plugin: string,
		opts?: { timeoutMs?: number; siteId?: string }
	): Promise<{ success: boolean; plugin: string; active: boolean }> {
		return this.request({
			method: 'POST',
			path: '/plugins/deactivate',
			body: { plugin },
			timeoutMs: opts?.timeoutMs ?? 60_000,
			siteId: opts?.siteId
		});
	}

	async deletePlugin(
		plugin: string,
		opts?: { timeoutMs?: number; siteId?: string }
	): Promise<{ success: boolean; plugin: string; deleted: boolean }> {
		return this.request({
			method: 'POST',
			path: '/plugins/delete',
			body: { plugin },
			timeoutMs: opts?.timeoutMs ?? 60_000,
			siteId: opts?.siteId
		});
	}

	/**
	 * Install (or update) a plugin from a ZIP file, optionally activating
	 * it on success. Used by the bulk-upload flow in the CRM.
	 */
	async installPlugin(
		payload: { filename: string; mimeType: string; dataBase64: string; activate?: boolean },
		opts?: { timeoutMs?: number; siteId?: string }
	): Promise<{
		success: boolean;
		installed: boolean;
		plugin: string;
		activated: boolean;
		activationError: string | null;
		filename: string;
		sizeBytes: number;
	}> {
		return this.request({
			method: 'POST',
			path: '/plugins/install',
			body: {
				filename: payload.filename,
				mimeType: payload.mimeType || 'application/zip',
				dataBase64: payload.dataBase64,
				activate: payload.activate ?? true
			},
			timeoutMs: opts?.timeoutMs ?? 300_000, // 5 min for big plugins
			siteId: opts?.siteId
		});
	}

	/* ─────────────────────── Media ─────────────────────── */

	/**
	 * Upload a base64-encoded image to the WP media library. Used to
	 * materialize inline <img src="data:..."> images from the TipTap editor
	 * before publishing. Returns the attachment ID + public URL.
	 */
	async uploadMedia(
		payload: { filename: string; mimeType: string; dataBase64: string },
		opts?: { timeoutMs?: number; siteId?: string }
	): Promise<WpMediaUploadResponse> {
		return this.request<WpMediaUploadResponse>({
			method: 'POST',
			path: '/media',
			body: payload,
			timeoutMs: opts?.timeoutMs ?? 120_000, // up to 25 MB on a slow host
			siteId: opts?.siteId
		});
	}

	private async request<T>({
		method,
		path,
		body,
		timeoutMs = 15_000,
		siteId
	}: RequestOptions): Promise<T> {
		const bodyString = body === undefined ? '' : JSON.stringify(body);
		// The PHP side computes the signing path from $request->get_route(),
		// which is the REST route WITHOUT any query string. If we include the
		// query string in our signature, the HMACs diverge and the plugin
		// returns 401. Strip it here.
		const pathForSigning = path.split('?')[0];
		const signingPath = connectorSigningPath(pathForSigning);
		const headers = buildSignedHeaders(this.secret, method, signingPath, bodyString);
		const url = connectorUrl(this.siteUrl, path);

		let response: Response;
		try {
			response = await fetch(url, {
				method,
				headers,
				// DELETE carries a body when one is signed (DELETE /backup needs the
				// filename); sending none made the signature mismatch → HTTP 401.
				body: method === 'GET' || (method === 'DELETE' && body === undefined) ? undefined : bodyString,
				signal: AbortSignal.timeout(timeoutMs),
				redirect: 'follow'
			});
		} catch (err) {
			// Network-level failure — DNS, timeout, TLS, refused, reset, etc.
			const cause = err instanceof Error ? err : new Error(String(err));
			// AbortSignal.timeout() throws a DOMException with name='TimeoutError'
			// — worth distinguishing because a timeout hints at a slow/overloaded
			// site that might recover, while a refused/reset hints at a hard down.
			const isTimeout =
				err instanceof DOMException && err.name === 'TimeoutError';
			const kind = isTimeout ? 'Timeout' : 'Network error';
			throw new WpConnectionError(
				`${kind} calling ${method} ${path}: ${cause.message}`,
				{ siteId, cause, subcode: isTimeout ? 'timeout' : 'network_fail' }
			);
		}

		if (response.status === 401 || response.status === 403) {
			throw new WpAuthError(
				`HMAC rejected by ${this.siteUrl} (HTTP ${response.status})`,
				{ siteId }
			);
		}

		if (response.status === 404) {
			throw new WpPluginMissingError(
				`OTS Connector plugin not found at ${this.siteUrl} (HTTP 404 on ${path})`,
				{ siteId }
			);
		}

		if (response.status >= 500) {
			// Capture a sanitized snippet of the response body so logs can
			// tell a 503 maintenance page apart from a fatal PHP error or
			// a plugin's welcome-redirect HTML. Bodies larger than 2 KB
			// are truncated to keep logs readable. Content-Type is used to
			// pick a sensible strip strategy.
			const bodySnippet = await readBodySnippet(response);
			const subcode = classifyServerErrorBody(response.status, bodySnippet);
			throw new WpSiteDownError(
				`Site ${this.siteUrl} returned HTTP ${response.status}${subcode ? ` [${subcode}]` : ''}`,
				{ siteId, bodySnippet, httpStatus: response.status, subcode }
			);
		}

		if (!response.ok) {
			throw new WpProtocolError(
				`Unexpected HTTP ${response.status} from ${this.siteUrl} on ${path}`,
				{ siteId }
			);
		}

		try {
			return (await response.json()) as T;
		} catch (err) {
			const cause = err instanceof Error ? err : new Error(String(err));
			throw new WpProtocolError(
				`Invalid JSON response from ${this.siteUrl} on ${path}: ${cause.message}`,
				{ siteId, cause }
			);
		}
	}
}

/**
 * Read up to ~2 KB of the response body, strip HTML tags, normalize
 * whitespace. Returns '' on failure — diagnostics must never throw.
 */
async function readBodySnippet(response: Response): Promise<string> {
	try {
		const raw = await response.text();
		if (!raw) return '';
		// Keep it short for logs/storage. 2 KB is enough to catch a WP
		// fatal stack trace or a maintenance notice; anything longer is
		// almost always repetitive HTML.
		const clipped = raw.length > 2048 ? raw.slice(0, 2048) + '…' : raw;
		// Strip HTML tags conservatively — good enough for one-line logs.
		const text = clipped.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
		return text.length > 1000 ? text.slice(0, 1000) + '…' : text;
	} catch {
		return '';
	}
}

/**
 * Classify a 5xx response body into a subcode so callers can decide
 * whether a retry is worth it. Heuristics are conservative: we only
 * assign a subcode when the body has an unambiguous signal.
 */
function classifyServerErrorBody(status: number, snippet: string): string | undefined {
	if (!snippet) return status === 503 ? 'maintenance_mode' : undefined;
	const lower = snippet.toLowerCase();

	// WP's own maintenance page (503) — written by wp-activate-plugins during upgrade.
	if (
		status === 503 ||
		lower.includes('briefly unavailable for scheduled maintenance') ||
		lower.includes('temporar indisponibil') // RO locale
	) {
		return 'maintenance_mode';
	}

	// PHP fatals surface via either the default error handler or
	// wp_php_error_handler. Both include the word "Fatal error" or
	// "parse error" verbatim when display_errors is on.
	if (
		lower.includes('fatal error') ||
		lower.includes('parse error') ||
		lower.includes('allowed memory size') ||
		lower.includes('maximum execution time')
	) {
		return 'php_fatal';
	}

	// Plugin activation hook redirected (wp_safe_redirect + exit) — the
	// "Location:" response or a stub HTML body from Apache's default
	// "Moved Permanently" template end up surfaced as a 500 via the
	// connector because the response was never sent cleanly.
	if (
		lower.includes('headers already sent') ||
		lower.includes('location:') ||
		lower.includes('wp_safe_redirect')
	) {
		return 'activation_hook_fatal';
	}

	// Cloudflare or provider error pages (cheap hosting loves these).
	if (lower.includes('cloudflare') || lower.includes('gateway')) {
		return 'provider_error';
	}

	return 'generic_5xx';
}
