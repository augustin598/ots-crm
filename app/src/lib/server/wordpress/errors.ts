/**
 * Base class for all errors thrown by the WordPress integration layer.
 * Callers can dispatch on the `code` field to produce user-friendly messages.
 */
export class WpError extends Error {
	public readonly code: string;
	public readonly siteId?: string;
	public readonly cause?: unknown;
	/** Fine-grained classifier within `code`; populated where useful (see WpSiteDownError). */
	public readonly subcode?: string;
	/** Truncated, HTML-stripped snippet of the failing response body for diagnostics. */
	public readonly bodySnippet?: string;
	/** HTTP status the site returned (when applicable). */
	public readonly httpStatus?: number;

	constructor(
		message: string,
		code: string,
		opts?: {
			siteId?: string;
			cause?: unknown;
			subcode?: string;
			bodySnippet?: string;
			httpStatus?: number;
		}
	) {
		super(message);
		this.name = 'WpError';
		this.code = code;
		this.siteId = opts?.siteId;
		this.cause = opts?.cause;
		this.subcode = opts?.subcode;
		this.bodySnippet = opts?.bodySnippet;
		this.httpStatus = opts?.httpStatus;
	}

	public static isWpError(err: unknown): err is WpError {
		return err instanceof WpError;
	}
}

/**
 * Network layer failed — DNS, TLS handshake, ECONNREFUSED, RST, or
 * timeout (AbortSignal.timeout fires a DOMException named 'TimeoutError').
 *
 * `subcode` distinguishes these so callers can decide retry behavior:
 *   - `timeout`      → request timed out; retry with backoff is sensible
 *   - `network_fail` → DNS/TLS/refused; retry likely fails the same way
 *                      until the site recovers
 *   - (unset)        → legacy call sites; treat as `network_fail`
 */
export class WpConnectionError extends WpError {
	constructor(
		message: string,
		opts?: { siteId?: string; cause?: unknown; subcode?: string }
	) {
		super(message, 'wp_connection_error', opts);
		this.name = 'WpConnectionError';
	}
}

/** HMAC rejected by the plugin (bad secret, timestamp outside the window). */
export class WpAuthError extends WpError {
	constructor(message: string, opts?: { siteId?: string; cause?: unknown }) {
		super(message, 'wp_auth_error', opts);
		this.name = 'WpAuthError';
	}
}

/**
 * Site returned 5xx or the origin refused the connection outright.
 *
 * `subcode` (when set) tells the caller whether retry makes sense:
 *   - `maintenance_mode`     → transient, retry with backoff
 *   - `activation_hook_fatal`→ permanent, plugin-side; fail fast
 *   - `php_fatal`            → likely permanent (syntax error after update)
 *   - `generic_5xx`          → unknown; retry a couple of times and give up
 */
export class WpSiteDownError extends WpError {
	constructor(
		message: string,
		opts?: {
			siteId?: string;
			cause?: unknown;
			subcode?: string;
			bodySnippet?: string;
			httpStatus?: number;
		}
	) {
		super(message, 'wp_site_down', opts);
		this.name = 'WpSiteDownError';
	}
}

/** The site is up but the OTS Connector plugin is not installed / inactive. */
export class WpPluginMissingError extends WpError {
	constructor(message: string, opts?: { siteId?: string; cause?: unknown }) {
		super(message, 'wp_plugin_missing', opts);
		this.name = 'WpPluginMissingError';
	}
}

/** Response body had an unexpected shape (protocol mismatch, bad JSON). */
export class WpProtocolError extends WpError {
	constructor(message: string, opts?: { siteId?: string; cause?: unknown }) {
		super(message, 'wp_protocol_error', opts);
		this.name = 'WpProtocolError';
	}
}
