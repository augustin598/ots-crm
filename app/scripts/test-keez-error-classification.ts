/**
 * Test: classifyKeezError returns correct FailureKind.
 * Run with: bun run scripts/test-keez-error-classification.ts
 */
import { classifyKeezError } from '../src/lib/server/plugins/keez/error-classification';
import { KeezClientError, KeezCredentialsCorruptError } from '../src/lib/server/plugins/keez/errors';

let passed = 0;
let failed = 0;
const results: string[] = [];

function assert(name: string, actual: string, expected: string) {
	if (actual === expected) {
		passed++;
		results.push(`  ✅ ${name}`);
	} else {
		failed++;
		results.push(`  ❌ ${name} — got "${actual}", expected "${expected}"`);
	}
}

// Transient: 5xx HTTP in error messages
assert('502 string in message', classifyKeezError(new Error('Keez API error: 502 <html>...')), 'transient');
assert('503 string in message', classifyKeezError(new Error('Keez API error: 503 Service Unavailable')), 'transient');
assert('504 string in message', classifyKeezError(new Error('504 Gateway Timeout')), 'transient');

// Transient: network errors
assert('timeout message', classifyKeezError(new Error('Request timed out')), 'transient');
assert('AbortError timeout', classifyKeezError(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })), 'transient');
assert('ECONNRESET', classifyKeezError(new Error('fetch failed: ECONNRESET')), 'transient');
assert('ENOTFOUND DNS', classifyKeezError(new Error('getaddrinfo ENOTFOUND app.keez.ro')), 'transient');
assert('generic fetch failed', classifyKeezError(new Error('fetch failed')), 'transient');

// Transient: KeezCredentialsCorruptError (Turso re-read may succeed)
assert('KeezCredentialsCorruptError', classifyKeezError(new KeezCredentialsCorruptError('t1')), 'transient');

// Transient: KeezClientError 5xx
assert('KeezClientError 500', classifyKeezError(new KeezClientError('boom', 500)), 'transient');

// Permanent: 4xx client errors
assert('KeezClientError 400', classifyKeezError(new KeezClientError('bad request', 400)), 'permanent');
assert('KeezClientError 401', classifyKeezError(new KeezClientError('unauthorized', 401)), 'permanent');
assert('KeezClientError 403', classifyKeezError(new KeezClientError('forbidden', 403)), 'permanent');
assert('KeezClientError 404', classifyKeezError(new KeezClientError('not found', 404)), 'permanent');
assert('KeezClientError 409', classifyKeezError(new KeezClientError('conflict', 409)), 'permanent');
assert('KeezClientError 422', classifyKeezError(new KeezClientError('unprocessable', 422)), 'permanent');

// Default: optimistic — unknown errors classified as transient
assert('unknown Error', classifyKeezError(new Error('something weird happened')), 'transient');
assert('non-Error value', classifyKeezError('a string'), 'transient');
assert('null', classifyKeezError(null), 'transient');

console.log(results.join('\n'));
console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
