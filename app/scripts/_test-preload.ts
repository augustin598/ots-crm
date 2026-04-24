/**
 * Bun preload for WHMCS standalone test scripts.
 *
 * Responsibilities:
 *   1. Stub SvelteKit virtual modules (`$env/dynamic/private`) so server code
 *      that normally runs under Vite can import cleanly under plain Bun.
 *   2. Set test-only environment variables BEFORE any module import runs.
 *      JavaScript hoists `import` statements above top-level code, so
 *      `process.env.FOO = …` inside the test file runs too late.
 *
 * Usage:
 *   bun --preload ./scripts/_test-preload.ts ./scripts/test-whmcs-*.ts
 *
 * This file is NOT a test itself — the leading underscore signals to
 * grep/test-runner tooling that it is a harness, not a target.
 */
import { plugin } from 'bun';
import { unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Environment ───────────────────────────────────────────────────
// Each test file that runs through this preload shares the same DB.
// Remove it fresh so tests start from empty state.
const TEST_DB = 'test-whmcs-integration.db';
try { unlinkSync(TEST_DB); } catch {}
process.env.SQLITE_PATH = TEST_DB;
process.env.ENCRYPTION_SECRET =
	process.env.ENCRYPTION_SECRET ?? 'test-only-encryption-secret-do-not-use-prod-xx';

// ─── SvelteKit virtual-module shims ────────────────────────────────
const APP_ROOT = resolve(import.meta.dir, '..');

plugin({
	name: 'stub-sveltekit-virtuals',
	setup(build) {
		build.module('$env/dynamic/private', () => ({
			contents: 'export const env = process.env;',
			loader: 'ts'
		}));

		// $lib alias — SvelteKit's convention maps `$lib` to `src/lib`.
		// Tests importing endpoints (+server.ts) need this to resolve.
		build.onResolve({ filter: /^\$lib(\/|$)/ }, (args) => {
			const rel = args.path.replace(/^\$lib/, 'src/lib');
			return { path: resolve(APP_ROOT, rel) };
		});
	}
});
