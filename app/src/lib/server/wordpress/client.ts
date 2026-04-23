import { buildSignedHeaders } from './hmac';
import { connectorSigningPath, connectorUrl } from './url';
import {
	WpAuthError,
	WpConnectionError,
	WpPluginMissingError,
	WpProtocolError,
	WpSiteDownError
} from './errors';

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

/** Post shape returned by the plugin for list & single. */
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
}

export interface WpMediaUploadResponse {
	id: number;
	url: string;
	filename: string;
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
				body: method === 'GET' || method === 'DELETE' ? undefined : bodyString,
				signal: AbortSignal.timeout(timeoutMs),
				redirect: 'follow'
			});
		} catch (err) {
			// Network-level failure — DNS, timeout, TLS, refused, reset, etc.
			const cause = err instanceof Error ? err : new Error(String(err));
			throw new WpConnectionError(
				`Network error calling ${method} ${path}: ${cause.message}`,
				{ siteId, cause }
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
			throw new WpSiteDownError(
				`Site ${this.siteUrl} returned HTTP ${response.status}`,
				{ siteId }
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
