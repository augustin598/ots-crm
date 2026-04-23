/**
 * Normalize a site URL to its canonical form: lowercase origin, no trailing
 * slash, no path, no query, no fragment. Throws if the URL is invalid.
 */
export function normalizeSiteUrl(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new Error('Site URL is empty');
	}
	const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	const parsed = new URL(withScheme);
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`Unsupported protocol: ${parsed.protocol}`);
	}
	const host = parsed.hostname.toLowerCase();
	const port = parsed.port ? `:${parsed.port}` : '';
	return `${parsed.protocol}//${host}${port}`;
}

/**
 * Build the full URL for an OTS Connector endpoint on a given site.
 * `path` should start with a slash, e.g. `/health`.
 */
export function connectorUrl(siteUrl: string, path: string): string {
	const base = normalizeSiteUrl(siteUrl);
	const cleanPath = path.startsWith('/') ? path : `/${path}`;
	return `${base}/wp-json/ots-connector/v1${cleanPath}`;
}

/**
 * The request-signing path used in the HMAC canonical payload. Must match
 * what the PHP plugin uses when verifying: `/wp-json/ots-connector/v1/<path>`.
 */
export function connectorSigningPath(path: string): string {
	const cleanPath = path.startsWith('/') ? path : `/${path}`;
	return `/wp-json/ots-connector/v1${cleanPath}`;
}
