/**
 * Unit tests: WHMCS HMAC signing + verification.
 *
 * Covers:
 *   - Determinism: same inputs → same signature
 *   - Positive verify: signed-then-verified roundtrip returns true
 *   - Cross-tenant replay regression: changing tenantId between sign/verify fails
 *     (Gemini gap #3 — previously a header-only attack vector)
 *   - Nonce in canonical: changing nonce between sign/verify fails
 *   - Timestamp in canonical: changing timestamp between sign/verify fails
 *   - Body-bit flip: any body mutation fails verify
 *   - Bad hex / length mismatch: returns false, never throws
 *   - Secret generation: hex 64 chars, unique
 *   - buildSignedHeaders round-trip
 *
 * Run: bun run scripts/test-whmcs-hmac.ts
 */
import {
	signRequest,
	verifySignature,
	buildSignedHeaders,
	generateSecret,
	TIMESTAMP_WINDOW_SECONDS,
	NONCE_TTL_SECONDS
} from '../src/lib/server/whmcs/hmac';

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

// Realistic fixtures (Romanian CUI, real-looking tenant ID, Stripe txn)
const SECRET = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);
const TENANT_A = 'ots-romania-srl';
const TENANT_B = 'other-tenant-xyz';
const NONCE_1 = '8e6c9d42-1a6f-4b8b-9a3a-c5f2ab1234ef';
const NONCE_2 = 'f1e2d3c4-b5a6-4987-8765-432101234567';
const TIMESTAMP = 1777430118;
const METHOD = 'POST';
const PATH = '/ots-romania-srl/api/webhooks/whmcs/invoices';
const BODY = JSON.stringify({
	event: 'created',
	whmcsInvoiceId: 555,
	client: { taxId: '40015841', companyName: 'ONE TOP SOLUTION S.R.L' },
	transactionId: 'txn_3TP2JeHcO0rcngck1pJbyYcu'
});

// ─────────────────────────────────────────────
// Core determinism + positive path
// ─────────────────────────────────────────────

const sig = signRequest(SECRET, TIMESTAMP, METHOD, PATH, TENANT_A, NONCE_1, BODY);
assert('signRequest returns 64-char hex', /^[0-9a-f]{64}$/.test(sig), `got: ${sig}`);

const sigAgain = signRequest(SECRET, TIMESTAMP, METHOD, PATH, TENANT_A, NONCE_1, BODY);
assert('signRequest is deterministic', sig === sigAgain);

assert(
	'verifySignature: positive roundtrip',
	verifySignature(SECRET, TIMESTAMP, METHOD, PATH, TENANT_A, NONCE_1, BODY, sig)
);

// ─────────────────────────────────────────────
// Negative cases — one factor changed at a time
// ─────────────────────────────────────────────

assert(
	'verify fails: different secret',
	!verifySignature(SECRET_B, TIMESTAMP, METHOD, PATH, TENANT_A, NONCE_1, BODY, sig)
);

assert(
	'verify fails: different timestamp (1s drift)',
	!verifySignature(SECRET, TIMESTAMP + 1, METHOD, PATH, TENANT_A, NONCE_1, BODY, sig)
);

assert(
	'verify fails: different method',
	!verifySignature(SECRET, TIMESTAMP, 'GET', PATH, TENANT_A, NONCE_1, BODY, sig)
);

assert(
	'verify fails: different path',
	!verifySignature(SECRET, TIMESTAMP, METHOD, PATH + '/extra', TENANT_A, NONCE_1, BODY, sig)
);

// CRITICAL REGRESSION TEST: cross-tenant replay (Gemini gap #3)
// Before fix: X-OTS-Tenant was header-only, so Tenant A's signed request
// could be replayed against Tenant B by just swapping the header.
// After fix: tenantId is in the canonical payload → signature fails.
assert(
	'verify fails: cross-tenant replay (DIFFERENT TENANT_ID)',
	!verifySignature(SECRET, TIMESTAMP, METHOD, PATH, TENANT_B, NONCE_1, BODY, sig),
	'Cross-tenant replay attack MUST be blocked — this is the headline security invariant'
);

assert(
	'verify fails: replayed request with different nonce',
	!verifySignature(SECRET, TIMESTAMP, METHOD, PATH, TENANT_A, NONCE_2, BODY, sig)
);

assert(
	'verify fails: body tampered (bit flip)',
	!verifySignature(SECRET, TIMESTAMP, METHOD, PATH, TENANT_A, NONCE_1, BODY.replace('555', '556'), sig)
);

// ─────────────────────────────────────────────
// Robustness — no throws, even on garbage input
// ─────────────────────────────────────────────

assert(
	'verify returns false (not throws) on empty signature',
	verifySignature(SECRET, TIMESTAMP, METHOD, PATH, TENANT_A, NONCE_1, BODY, '') === false
);

assert(
	'verify returns false on bad hex',
	verifySignature(SECRET, TIMESTAMP, METHOD, PATH, TENANT_A, NONCE_1, BODY, 'not-hex!@#$') === false
);

assert(
	'verify returns false on short signature (length mismatch)',
	verifySignature(SECRET, TIMESTAMP, METHOD, PATH, TENANT_A, NONCE_1, BODY, 'abcd') === false
);

// ─────────────────────────────────────────────
// Secret generation
// ─────────────────────────────────────────────

const s1 = generateSecret();
const s2 = generateSecret();
assert('generateSecret: 64 hex chars', /^[0-9a-f]{64}$/.test(s1));
assert('generateSecret: unique across calls', s1 !== s2);

// ─────────────────────────────────────────────
// buildSignedHeaders integration
// ─────────────────────────────────────────────

const headers = buildSignedHeaders(SECRET, METHOD, PATH, TENANT_A, BODY);
assert('buildSignedHeaders includes X-OTS-Timestamp', typeof headers['X-OTS-Timestamp'] === 'string');
assert('buildSignedHeaders includes X-OTS-Signature', /^[0-9a-f]{64}$/.test(headers['X-OTS-Signature'] ?? ''));
assert('buildSignedHeaders includes X-OTS-Tenant', headers['X-OTS-Tenant'] === TENANT_A);
assert(
	'buildSignedHeaders includes X-OTS-Nonce (UUID)',
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(headers['X-OTS-Nonce'] ?? '')
);
assert('buildSignedHeaders Content-Type json', headers['Content-Type'] === 'application/json');

// Verify headers roundtrip with the same body
const ts = parseInt(headers['X-OTS-Timestamp'] ?? '0', 10);
assert(
	'buildSignedHeaders → verifySignature roundtrip',
	verifySignature(
		SECRET,
		ts,
		METHOD,
		PATH,
		TENANT_A,
		headers['X-OTS-Nonce'] ?? '',
		BODY,
		headers['X-OTS-Signature'] ?? ''
	)
);

// Timestamp within tolerance
const now = Math.floor(Date.now() / 1000);
assert(
	'buildSignedHeaders timestamp within tolerance window',
	Math.abs(now - ts) <= TIMESTAMP_WINDOW_SECONDS
);

// ─────────────────────────────────────────────
// Constants sanity
// ─────────────────────────────────────────────

assert('TIMESTAMP_WINDOW_SECONDS > 0', TIMESTAMP_WINDOW_SECONDS > 0);
assert(
	'NONCE_TTL_SECONDS > TIMESTAMP_WINDOW_SECONDS',
	NONCE_TTL_SECONDS > TIMESTAMP_WINDOW_SECONDS,
	'Nonce must be remembered longer than timestamp freshness window'
);

// ─────────────────────────────────────────────

console.log(results.join('\n'));
console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
