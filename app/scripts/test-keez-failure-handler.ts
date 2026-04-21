/**
 * Test: decideFailureAction returns correct action for transient/permanent errors at each counter.
 * Run with: bun run scripts/test-keez-failure-handler.ts
 *
 * Focused on the PURE decision function (retry-policy.ts). DB + BullMQ side
 * effects in failure-handler.ts are exercised manually during rollout.
 */
import { decideFailureAction } from '../src/lib/server/plugins/keez/retry-policy';
import { KeezClientError } from '../src/lib/server/plugins/keez/errors';

let passed = 0;
let failed = 0;
const results: string[] = [];

function assert(name: string, cond: boolean, detail = '') {
	if (cond) { passed++; results.push(`  ✅ ${name}`); }
	else { failed++; results.push(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// Transient, first failure → retry at +10min
let action = decideFailureAction(new Error('502 Bad Gateway'), 0);
assert(
	'1st transient failure → schedule retry at +10 min',
	action.kind === 'schedule_retry' && action.delayMs === 10 * 60_000,
	`got ${JSON.stringify(action)}`
);

// Transient, second failure → retry at +1h
action = decideFailureAction(new Error('503'), 1);
assert(
	'2nd transient failure → schedule retry at +1 h',
	action.kind === 'schedule_retry' && action.delayMs === 60 * 60_000,
	`got ${JSON.stringify(action)}`
);

// Transient, third failure → degraded (no more retries)
action = decideFailureAction(new Error('504 Gateway Timeout'), 2);
assert('3rd transient failure → mark_degraded', action.kind === 'mark_degraded');

// Transient, fourth+ failure → degraded
action = decideFailureAction(new Error('timeout'), 5);
assert('5th transient failure → mark_degraded (still)', action.kind === 'mark_degraded');

// Permanent on first failure → degraded immediately, no retry
action = decideFailureAction(new KeezClientError('forbidden', 403), 0);
assert('Permanent 403 on 1st failure → mark_degraded', action.kind === 'mark_degraded');

// Permanent on later failure → still degraded
action = decideFailureAction(new KeezClientError('bad request', 400), 1);
assert('Permanent 400 on 2nd failure → mark_degraded', action.kind === 'mark_degraded');

// Permanent 401 (post-refresh) → degraded
action = decideFailureAction(new KeezClientError('unauthorized', 401), 0);
assert('Permanent 401 on 1st failure → mark_degraded', action.kind === 'mark_degraded');

console.log(results.join('\n'));
console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
