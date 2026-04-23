/**
 * Base class for all errors thrown by the WordPress integration layer.
 * Callers can dispatch on the `code` field to produce user-friendly messages.
 */
export class WpError extends Error {
	public readonly code: string;
	public readonly siteId?: string;
	public readonly cause?: unknown;

	constructor(
		message: string,
		code: string,
		opts?: { siteId?: string; cause?: unknown }
	) {
		super(message);
		this.name = 'WpError';
		this.code = code;
		this.siteId = opts?.siteId;
		this.cause = opts?.cause;
	}

	public static isWpError(err: unknown): err is WpError {
		return err instanceof WpError;
	}
}

/** Network layer failed (DNS, TLS, timeout, ECONNREFUSED from the LB). */
export class WpConnectionError extends WpError {
	constructor(message: string, opts?: { siteId?: string; cause?: unknown }) {
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

/** Site returned 5xx or the origin refused the connection outright. */
export class WpSiteDownError extends WpError {
	constructor(message: string, opts?: { siteId?: string; cause?: unknown }) {
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
