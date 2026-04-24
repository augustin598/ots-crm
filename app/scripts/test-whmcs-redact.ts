/**
 * Unit tests: WHMCS payload redaction.
 *
 * Covers:
 *   - Key-name matching (case-insensitive, substring)
 *   - Recursive traversal of nested objects + arrays
 *   - Value types left alone (strings, numbers, booleans, null)
 *   - Depth ceiling (MAX_DEPTH) — deep structures truncated
 *   - Size ceiling (MAX_BYTES) — large payloads replaced with preview
 *   - Edge cases: null input, primitive input, array of primitives
 *   - No throws on circular-looking or unusual input
 *
 * Run: bun run scripts/test-whmcs-redact.ts
 */
import { redact, redactAndStringify } from '../src/lib/server/whmcs/redact';

let passed = 0;
let failed = 0;
const results: string[] = [];

function assert(name: string, condition: boolean, detail?: string) {
	if (condition) {
		passed++;
		results.push(`  ✅ ${name}`);
	} else {
		failed++;
		results.push(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
	}
}

// ─────────────────────────────────────────────
// Sensitive-key matching (the core contract)
// ─────────────────────────────────────────────

const basic = redact({
	username: 'augustin',
	password: 'hunter2',
	api_key: 'sk_live_abc123',
	apiKey: 'sk_live_def456',
	access_token: 'ya29.xyz',
	refreshToken: 'refresh-abc',
	secret: 'deadbeef',
	sharedSecret: 'abc123',
	authorization: 'Bearer xxx',
	Cookie: 'sessionId=abc',
	bearer: 'token-xyz',
	privateKey: '-----BEGIN RSA-----'
}) as Record<string, unknown>;

assert('username kept (not sensitive)', basic.username === 'augustin');
assert('password redacted', basic.password === '[REDACTED]');
assert('api_key redacted (snake_case)', basic.api_key === '[REDACTED]');
assert('apiKey redacted (camelCase)', basic.apiKey === '[REDACTED]');
assert('access_token redacted', basic.access_token === '[REDACTED]');
assert('refreshToken redacted', basic.refreshToken === '[REDACTED]');
assert('secret redacted', basic.secret === '[REDACTED]');
assert('sharedSecret redacted', basic.sharedSecret === '[REDACTED]');
assert('authorization redacted', basic.authorization === '[REDACTED]');
assert('Cookie redacted (case-insensitive)', basic.Cookie === '[REDACTED]');
assert('bearer redacted', basic.bearer === '[REDACTED]');
assert('privateKey redacted', basic.privateKey === '[REDACTED]');

// ─────────────────────────────────────────────
// Recursive traversal
// ─────────────────────────────────────────────

const nested = redact({
	event: 'created',
	client: {
		email: 'office@onetopsolution.ro',
		password: 'nope',
		credentials: {
			api_key: 'sk_live_deep',
			nestedDeep: { secret: 'mega' }
		}
	},
	items: [
		{ description: 'Hosting', amount: 80.0, token: 'line-item-token' },
		{ description: 'Domeniu', amount: 20.0 }
	],
	transactionId: 'txn_3TP2JeHcO0rcngck1pJbyYcu' // NOT sensitive (does not match patterns)
}) as Record<string, unknown>;

const client = nested.client as Record<string, unknown>;
assert('nested: client.email kept', client.email === 'office@onetopsolution.ro');
assert('nested: client.password redacted', client.password === '[REDACTED]');

const creds = client.credentials as Record<string, unknown>;
assert('nested: client.credentials.api_key redacted', creds.api_key === '[REDACTED]');

const deep = creds.nestedDeep as Record<string, unknown>;
assert('nested: deep secret redacted', deep.secret === '[REDACTED]');

const items = nested.items as Array<Record<string, unknown>>;
assert('nested: items[0].description kept', items[0].description === 'Hosting');
assert('nested: items[0].amount kept (number)', items[0].amount === 80.0);
assert('nested: items[0].token redacted (array element)', items[0].token === '[REDACTED]');
assert('nested: items[1].description kept', items[1].description === 'Domeniu');
assert(
	'nested: transactionId kept (not a secret-like key)',
	nested.transactionId === 'txn_3TP2JeHcO0rcngck1pJbyYcu'
);

// ─────────────────────────────────────────────
// Primitives + edge cases (never throw)
// ─────────────────────────────────────────────

assert('redact(null) returns null', redact(null) === null);
assert('redact(undefined) returns undefined', redact(undefined) === undefined);
assert('redact("str") returns "str"', redact('str') === 'str');
assert('redact(42) returns 42', redact(42) === 42);
assert('redact(false) returns false', redact(false) === false);

const arrOfPrims = redact([1, 'two', null, true]) as unknown[];
assert(
	'array of primitives preserved',
	arrOfPrims.length === 4 && arrOfPrims[0] === 1 && arrOfPrims[1] === 'two'
);

// Value type preserved even for sensitive key (just replaced with string)
const numericSecret = redact({ apiKey: 12345 }) as Record<string, unknown>;
assert('numeric sensitive value redacted to string', numericSecret.apiKey === '[REDACTED]');

// ─────────────────────────────────────────────
// Depth ceiling (MAX_DEPTH = 5)
// ─────────────────────────────────────────────

// Build depth-6 object: a.b.c.d.e.f = 'leaf'
// Depth counter (in redact): root-object=0, a-value=1, b-value=2, c-value=3,
// d-value=4, e-value=5, f-value=6 → at depth>5 truncation fires, so `f` becomes a string marker.
const depthSix = { a: { b: { c: { d: { e: { f: 'leaf' } } } } } };
const depthResult = redact(depthSix) as any;
assert(
	'depth ceiling enforced: leaf at depth 6 truncated',
	typeof depthResult.a.b.c.d.e.f === 'string' && depthResult.a.b.c.d.e.f.includes('TRUNCATED')
);
assert(
	'depth ceiling: depth 5 still traversed (object preserved)',
	typeof depthResult.a.b.c.d.e === 'object' && depthResult.a.b.c.d.e !== null
);

// Shallow structure still works perfectly
const shallow = redact({ a: { b: { c: 'ok' } } }) as any;
assert('shallow structure preserved (depth 3)', shallow.a.b.c === 'ok');

// ─────────────────────────────────────────────
// redactAndStringify — JSON output + size cap
// ─────────────────────────────────────────────

const small = redactAndStringify({ event: 'created', password: 'secret' });
assert('redactAndStringify returns valid JSON string', typeof small === 'string');
const parsed = JSON.parse(small);
assert('redactAndStringify redacts keys in JSON output', parsed.password === '[REDACTED]');
assert('redactAndStringify preserves non-sensitive', parsed.event === 'created');

// Oversized payload → truncation
const huge = { bigField: 'x'.repeat(60 * 1024) };  // 60 KB > MAX_BYTES
const hugeJson = redactAndStringify(huge);
const hugeParsed = JSON.parse(hugeJson);
assert('huge payload truncated', hugeParsed.__truncated === true);
assert('huge payload preview present', typeof hugeParsed.preview === 'string');
assert('huge payload originalBytes reported', typeof hugeParsed.__originalBytes === 'number');

// redactAndStringify should never throw even on weird input
const weird = redactAndStringify(undefined);
assert('redactAndStringify handles undefined', typeof weird === 'string');

// ─────────────────────────────────────────────

console.log(results.join('\n'));
console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
