/**
 * ISR (Incremental Static Regeneration) utilities
 *
 * Routes can enable ISR by:
 * 1. Setting headers in load functions: setHeaders({ 'x-isr-expiration': '60' })
 * 2. Using the registerIsrConfig function in adapter/handler.ts
 */

/**
 * Set ISR expiration header
 * Use this in your +page.server.ts load function:
 *
 * export const load = async ({ setHeaders }) => {
 *   setIsrHeader(setHeaders, 60); // Cache for 60 seconds
 *   return { data: ... };
 * };
 */
export function setIsrHeader(
	setHeaders: (headers: Record<string, string>) => void,
	expiration: number
) {
	setHeaders({
		'x-isr-expiration': expiration.toString()
	});
}

/**
 * Alternative: Set revalidate header (same as x-isr-expiration)
 */
export function setRevalidateHeader(
	setHeaders: (headers: Record<string, string>) => void,
	expiration: number
) {
	setHeaders({
		'x-revalidate': expiration.toString()
	});
}
