/**
 * Bun preload for replay scripts that need the REAL local DB (.env).
 *
 * Differs from _test-preload.ts:
 *   - Does NOT delete or seed any DB.
 *   - Does NOT override env vars — bun's automatic .env loading is enough.
 *   - Only stubs `$env/dynamic/private` and the `$lib` alias so SvelteKit
 *     server modules can be imported under plain Bun.
 *
 * Usage:
 *   bun --preload ./scripts/_replay-preload.ts ./scripts/replay-whmcs-paid-local.ts
 */
import { plugin } from 'bun';
import { resolve } from 'node:path';

const APP_ROOT = resolve(import.meta.dir, '..');

plugin({
	name: 'stub-sveltekit-virtuals',
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
