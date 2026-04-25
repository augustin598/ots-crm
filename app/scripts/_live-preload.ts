/**
 * Bun preload for STANDALONE scripts that hit live external systems
 * (Turso prod DB + Keez API). Differs from `_test-preload.ts`:
 *   - Does NOT override SQLITE_PATH → libSQL connection from .env's
 *     SQLITE_URI / SQLITE_AUTH_TOKEN takes effect.
 *   - Does NOT override ENCRYPTION_SECRET → real value from .env decrypts
 *     real Keez creds.
 *
 * Use ONLY for scripts that intentionally touch production state. Each such
 * script must guard with explicit env (e.g. WHMCS_EUR_TEST_TENANT) so it
 * cannot run by accident.
 *
 * Usage:
 *   bun --preload ./scripts/_live-preload.ts ./scripts/<live-script>.ts
 */
import { plugin } from 'bun';
import { resolve } from 'node:path';

const APP_ROOT = resolve(import.meta.dir, '..');

plugin({
	name: 'stub-sveltekit-virtuals-live',
	setup(build) {
		build.module('$env/dynamic/private', () => ({
			contents: 'export const env = process.env;',
			loader: 'ts'
		}));

		build.onResolve({ filter: /^\$lib(\/|$)/ }, (args) => {
			const rel = args.path.replace(/^\$lib/, 'src/lib');
			return { path: resolve(APP_ROOT, rel) };
		});
	}
});
