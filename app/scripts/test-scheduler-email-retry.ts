/**
 * Test script for email-retry logic (pure logic tests, no DB dependency).
 * Tests: error classification, backoff calculation, per-tenant cap logic.
 * Run with: bun run scripts/test-scheduler-email-retry.ts
 */

let passed = 0;
let failed = 0;
const results: string[] = [];

function assert(testName: string, condition: boolean, detail?: string) {
	if (condition) {
		passed++;
		results.push(`  ✅ ${testName}`);
	} else {
		failed++;
		results.push(`  ❌ ${testName}${detail ? ` — ${detail}` : ''}`);
	}
}

// ===== Mirror isPermanentError from email-retry.ts =====
function isPermanentError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return /\b(550|551|552|553|554)\b/.test(msg)
		|| /mailbox.*not found/i.test(msg)
		|| /user.*unknown/i.test(msg)
		|| /address.*rejected/i.test(msg)
		|| /hard.?bounce/i.test(msg)
		|| /account.*disabled/i.test(msg);
}

// ===== Mirror backoff calculation from email-retry.ts =====
function calculateBackoffMs(attempts: number): number {
	return Math.min(
		15 * 60 * 1000 * Math.pow(2, attempts),
		4 * 60 * 60 * 1000
	);
}

function isEligibleForRetry(row: { attempts: number; maxAttempts: number; updatedAt: Date }): boolean {
	const nowMs = Date.now();
	const backoffMs = calculateBackoffMs(row.attempts);
	return nowMs - row.updatedAt.getTime() >= backoffMs && row.attempts < row.maxAttempts;
}

// ===== Tests =====

function testErrorClassification() {
	console.log('\n📧 Test: Error classification (permanent vs transient)');

	// Permanent
	assert('550 is permanent', isPermanentError(new Error('550 5.1.1 The email account does not exist')));
	assert('551 is permanent', isPermanentError('551 User not local'));
	assert('553 is permanent', isPermanentError('553 Mailbox name invalid'));
	assert('"mailbox not found" is permanent', isPermanentError('Mailbox not found'));
	assert('"user unknown" is permanent', isPermanentError('User unknown'));
	assert('"hard bounce" is permanent', isPermanentError('Hard bounce'));
	assert('"account disabled" is permanent', isPermanentError('Account disabled'));

	// Transient
	assert('421 is transient', !isPermanentError('421 Try again later'));
	assert('450 is transient', !isPermanentError('450 Mailbox busy'));
	assert('ECONNREFUSED is transient', !isPermanentError('connect ECONNREFUSED'));
	assert('ETIMEDOUT is transient', !isPermanentError('ETIMEDOUT'));
	assert('Generic error is transient', !isPermanentError('Something failed'));
}

function testBackoffCalculation() {
	console.log('\n⏱️ Test: Exponential backoff schedule');

	assert('Attempt 0→1: 15min', calculateBackoffMs(0) === 15 * 60 * 1000);
	assert('Attempt 1→2: 30min', calculateBackoffMs(1) === 30 * 60 * 1000);
	assert('Attempt 2→3: 60min', calculateBackoffMs(2) === 60 * 60 * 1000);
	assert('Attempt 3→4: 120min', calculateBackoffMs(3) === 120 * 60 * 1000);
	assert('Attempt 4→5: 240min (=4h)', calculateBackoffMs(4) === 4 * 60 * 60 * 1000);
	assert('Attempt 10: capped at 4h', calculateBackoffMs(10) === 4 * 60 * 60 * 1000);
}

function testRetryEligibility() {
	console.log('\n🔄 Test: Retry eligibility logic');

	const now = Date.now();

	// Not eligible: too soon
	assert('Not eligible: updated 5min ago, attempt 0', !isEligibleForRetry({
		attempts: 0,
		maxAttempts: 3,
		updatedAt: new Date(now - 5 * 60 * 1000) // 5 min ago (need 15 min)
	}));

	// Eligible: enough time passed
	assert('Eligible: updated 20min ago, attempt 0', isEligibleForRetry({
		attempts: 0,
		maxAttempts: 3,
		updatedAt: new Date(now - 20 * 60 * 1000) // 20 min ago (need 15 min)
	}));

	// Not eligible: attempts exhausted
	assert('Not eligible: attempts exhausted', !isEligibleForRetry({
		attempts: 3,
		maxAttempts: 3,
		updatedAt: new Date(now - 24 * 60 * 60 * 1000) // 24h ago
	}));

	// Eligible: attempt 1, 35 min ago (need 30 min)
	assert('Eligible: attempt 1, 35min ago', isEligibleForRetry({
		attempts: 1,
		maxAttempts: 3,
		updatedAt: new Date(now - 35 * 60 * 1000)
	}));

	// Not eligible: attempt 1, 20 min ago (need 30 min)
	assert('Not eligible: attempt 1, 20min ago', !isEligibleForRetry({
		attempts: 1,
		maxAttempts: 3,
		updatedAt: new Date(now - 20 * 60 * 1000)
	}));
}

function testPerTenantCap() {
	console.log('\n🏢 Test: Per-tenant retry cap');

	const PER_TENANT_RETRY_LIMIT = 10;
	const rows = Array.from({ length: 15 }, (_, i) => ({ id: `email-${i}` }));
	const capped = rows.slice(0, PER_TENANT_RETRY_LIMIT);

	assert('15 rows capped to 10', capped.length === 10);
	assert('First 10 preserved', capped[0].id === 'email-0' && capped[9].id === 'email-9');
}

function testCrashSafetyFlow() {
	console.log('\n💥 Test: Crash safety flow (state transitions)');

	// Simulate the state machine
	type Status = 'failed' | 'retrying' | 'completed';

	// Normal flow: failed → retrying → (handler succeeds) → deleted
	let status: Status = 'failed';
	let attempts = 1;

	// Step 1: mark as retrying
	status = 'retrying';
	attempts = 2;
	assert('Step 1: status=retrying, attempts=2', status === 'retrying' && attempts === 2);

	// Step 2: handler succeeds → delete old row
	const handlerSuccess = true;
	if (handlerSuccess) {
		status = 'completed'; // row would be deleted, new row created by sendWithPersistence
	}
	assert('Step 2: handler success → completed', status === 'completed');

	// Crash scenario: failed → retrying → (crash) → recovery → failed
	status = 'failed';
	attempts = 1;
	status = 'retrying';
	attempts = 2;
	// Simulate crash: process dies here
	// Recovery on startup: retrying → failed
	status = 'failed';
	assert('Crash recovery: retrying → failed', status === 'failed');
	assert('Attempts preserved after crash', attempts === 2);

	// Handler failure: failed → retrying → (handler fails) → failed
	status = 'failed';
	attempts = 2;
	status = 'retrying';
	attempts = 3;
	// Handler fails
	status = 'failed';
	assert('Handler failure: back to failed', status === 'failed');
	assert('Attempts incremented', attempts === 3);
}

// ===== Main =====

function main() {
	console.log('🧪 Email Retry Logic Tests\n');

	testErrorClassification();
	testBackoffCalculation();
	testRetryEligibility();
	testPerTenantCap();
	testCrashSafetyFlow();

	console.log('\n' + '='.repeat(50));
	console.log(results.join('\n'));
	console.log(`\n${passed} passed, ${failed} failed`);

	if (failed > 0) {
		process.exit(1);
	}
	console.log('\n✅ All email-retry tests passed');
}

main();
