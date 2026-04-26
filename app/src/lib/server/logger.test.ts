import { describe, expect, test } from 'bun:test';
// Import from the pure module (no SvelteKit virtual deps) so bun:test can
// load it without resolving $env/dynamic/private. logger.ts re-exports it
// for production callers.
import { serializeError } from './error-serializer';

/**
 * Run: `bun test src/lib/server/logger.test.ts`
 *
 * serializeError must surface diagnostic info from common error shapes:
 *  - plain Error
 *  - AggregateError (Node Happy Eyeballs ECONNREFUSED hidden in .errors[])
 *  - Drizzle wrapper around libSQL/SQLite errors (real cause in .cause)
 *
 * Without .cause unwrapping, "Failed query" Drizzle errors would lose the
 * SQLITE_BUSY / database-locked / FK violation hint, which is what made
 * the 09:08:33 invoice_line_item incident undebuggable.
 */
describe('serializeError', () => {
	test('plain Error returns its message', () => {
		const r = serializeError(new Error('boom'));
		expect(r.message).toContain('boom');
		expect(r.stack).toBeDefined();
	});

	test('non-Error value coerces to string', () => {
		expect(serializeError('plain string').message).toBe('plain string');
		expect(serializeError(42).message).toBe('42');
		expect(serializeError(null).message).toBe('null');
	});

	test('AggregateError unwraps .errors[] with code/address/port', () => {
		const inner = Object.assign(new Error('connect failed'), {
			code: 'ECONNREFUSED',
			address: '127.0.0.1',
			port: 6379
		});
		const agg = new AggregateError([inner], 'happy eyeballs');
		const r = serializeError(agg);
		expect(r.message).toContain('ECONNREFUSED');
		expect(r.message).toContain('127.0.0.1:6379');
		expect(r.message).toContain('connect failed');
	});

	test('walks .cause chain (Drizzle wrapping libSQL)', () => {
		const sqliteErr = new Error('SQLITE_BUSY: database is locked');
		const drizzleErr = new Error('Failed query: insert into "invoice_line_item"…');
		(drizzleErr as Error & { cause?: unknown }).cause = sqliteErr;
		const r = serializeError(drizzleErr);
		expect(r.message).toContain('Failed query');
		expect(r.message).toContain('SQLITE_BUSY');
		expect(r.message).toContain('database is locked');
	});

	test('walks deep .cause chains up to depth limit', () => {
		const deep = new Error('inner');
		const mid = new Error('mid');
		(mid as Error & { cause?: unknown }).cause = deep;
		const top = new Error('top');
		(top as Error & { cause?: unknown }).cause = mid;
		const r = serializeError(top);
		expect(r.message).toContain('top');
		expect(r.message).toContain('mid');
		expect(r.message).toContain('inner');
	});

	test('does not loop on self-referencing cause', () => {
		const e = new Error('self');
		(e as Error & { cause?: unknown }).cause = e;
		// Should terminate at the depth cap, not hang.
		const r = serializeError(e);
		expect(r.message).toContain('self');
	});

	test('combines AggregateError + .cause', () => {
		const inner = Object.assign(new Error('econnreset'), { code: 'ECONNRESET' });
		const agg = new AggregateError([inner], 'aggregate failure');
		const wrapper = new Error('keez fetch failed');
		(wrapper as Error & { cause?: unknown }).cause = agg;
		const r = serializeError(wrapper);
		expect(r.message).toContain('keez fetch failed');
		expect(r.message).toContain('ECONNRESET');
	});
});
