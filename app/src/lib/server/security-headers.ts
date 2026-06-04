import type { Handle } from '@sveltejs/kit';

/**
 * Security response headers applied to EVERY response (HTML, JSON API, assets).
 *
 * Note: Content-Security-Policy is intentionally NOT set here. It is configured
 * in `svelte.config.js` under `kit.csp` so that SvelteKit can hash its own inline
 * hydration <script> (mode: 'hash') and emit the header only on rendered HTML —
 * where it belongs. Setting CSP manually here would either break hydration
 * (no hash) or force 'unsafe-inline' on scripts (defeats the purpose).
 *
 * The six headers flagged by securityheaders.com are covered as:
 *   - Strict-Transport-Security ........ here
 *   - X-Frame-Options .................. here
 *   - X-Content-Type-Options ........... here
 *   - Referrer-Policy .................. here
 *   - Permissions-Policy ............... here
 *   - Content-Security-Policy .......... svelte.config.js (kit.csp)
 */

// HSTS: 2 years + includeSubDomains. `preload` is intentionally omitted — it is an
// irreversible commitment (browsers cache it for the max-age regardless of later
// header changes) and would force HTTPS on every current and future sub-domain of
// clients.onetopsolution.ro. Add `; preload` and submit to hstspreload.org only
// after confirming every sub-host is HTTPS-only.
const HSTS = 'max-age=63072000; includeSubDomains';

// Lock down powerful browser features the CRM does not use. `payment` is delegated
// to self + Stripe so the embedded Stripe PaymentElement (Apple Pay / Google Pay
// wallets) keeps working.
const PERMISSIONS_POLICY = [
	'accelerometer=()',
	'autoplay=()',
	'camera=()',
	'display-capture=()',
	'encrypted-media=()',
	'fullscreen=(self)',
	'geolocation=()',
	'gyroscope=()',
	'magnetometer=()',
	'microphone=()',
	'midi=()',
	'payment=(self "https://js.stripe.com")',
	'usb=()',
	'browsing-topics=()'
].join(', ');

export const handleSecurityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	const headers = response.headers;

	// Always send HSTS. The app runs behind a TLS-terminating reverse proxy, so the
	// Bun listener receives plain HTTP and `event.url.protocol` is 'http:' even though
	// the browser↔proxy leg is HTTPS — gating on protocol here would silently drop the
	// header in production. Browsers ignore HSTS received over a genuinely non-secure
	// transport (per RFC 6797 §8.1), so sending it unconditionally is safe.
	if (!headers.has('Strict-Transport-Security')) {
		headers.set('Strict-Transport-Security', HSTS);
	}

	// Always force these — the only valid value for nosniff is "nosniff".
	headers.set('X-Content-Type-Options', 'nosniff');

	// Don't clobber a route that deliberately set its own framing/referrer policy.
	if (!headers.has('X-Frame-Options')) headers.set('X-Frame-Options', 'SAMEORIGIN');
	if (!headers.has('Referrer-Policy')) {
		headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	}
	if (!headers.has('Permissions-Policy')) {
		headers.set('Permissions-Policy', PERMISSIONS_POLICY);
	}

	return response;
};
