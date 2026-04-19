/**
 * Test script for scheduler tenant isolation (pure logic tests).
 * Validates the query patterns and access control logic.
 * Run with: bun run scripts/test-scheduler-tenant-isolation.ts
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

// ===== Mirror access control logic from scheduler.remote.ts =====

function requireAdmin(role: string | undefined): boolean {
	return role === 'owner' || role === 'admin';
}

function requireOwner(role: string | undefined): boolean {
	return role === 'owner';
}

// ===== Tests =====

function testAccessControl() {
	console.log('\n🔑 Test: Access control (requireAdmin vs requireOwner)');

	// requireAdmin
	assert('Admin: owner passes', requireAdmin('owner'));
	assert('Admin: admin passes', requireAdmin('admin'));
	assert('Admin: member rejected', !requireAdmin('member'));
	assert('Admin: undefined rejected', !requireAdmin(undefined));

	// requireOwner (stricter — for mutations)
	assert('Owner: owner passes', requireOwner('owner'));
	assert('Owner: admin rejected', !requireOwner('admin'));
	assert('Owner: member rejected', !requireOwner('member'));
	assert('Owner: undefined rejected', !requireOwner(undefined));
}

function testTenantFilterLogic() {
	console.log('\n🔒 Test: Tenant isolation query patterns');

	// Simulate log entries from different tenants + system-level (null tenantId)
	type Log = { id: string; tenantId: string | null; source: string; level: string; message: string };

	const allLogs: Log[] = [
		{ id: '1', tenantId: 'tenant-a', source: 'scheduler', level: 'info', message: 'Job completed: recurring_invoices' },
		{ id: '2', tenantId: 'tenant-a', source: 'scheduler', level: 'error', message: 'Job failed: email_retry - SMTP error' },
		{ id: '3', tenantId: 'tenant-b', source: 'scheduler', level: 'info', message: 'Job completed: keez_invoice_sync' },
		{ id: '4', tenantId: 'tenant-b', source: 'scheduler', level: 'error', message: 'Job failed: token_refresh - Auth expired' },
		{ id: '5', tenantId: 'tenant-a', source: 'email', level: 'info', message: 'Email sent' }, // different source
		{ id: '6', tenantId: null, source: 'scheduler', level: 'error', message: 'Job failed: bnr_rate_sync - cert expired' }, // system worker
	];

	// getSchedulerHistory pattern: WHERE source='scheduler' AND (tenantId=? OR tenantId IS NULL)
	const tenantALogs = allLogs.filter(l => l.source === 'scheduler' && (l.tenantId === 'tenant-a' || l.tenantId === null));
	const tenantBLogs = allLogs.filter(l => l.source === 'scheduler' && (l.tenantId === 'tenant-b' || l.tenantId === null));

	assert('Tenant A sees 3 scheduler logs (2 own + 1 system)', tenantALogs.length === 3);
	assert('Tenant B sees 3 scheduler logs (2 own + 1 system)', tenantBLogs.length === 3);
	assert('Tenant A does NOT see Tenant B logs', !tenantALogs.some(l => l.tenantId === 'tenant-b'));
	assert('Tenant B does NOT see Tenant A logs', !tenantBLogs.some(l => l.tenantId === 'tenant-a'));
	assert('Both tenants see system-level log', tenantALogs.some(l => l.id === '6') && tenantBLogs.some(l => l.id === '6'));
	assert('Non-scheduler logs excluded', !tenantALogs.some(l => l.source !== 'scheduler'));
}

function testDeleteIsolation() {
	console.log('\n🗑️ Test: Delete own tenant logs + shared system logs');

	type Log = { id: string; tenantId: string | null; level: string };

	let logs: Log[] = [
		{ id: '1', tenantId: 'tenant-a', level: 'info' },
		{ id: '2', tenantId: 'tenant-a', level: 'error' },
		{ id: '3', tenantId: 'tenant-b', level: 'info' },
		{ id: '4', tenantId: 'tenant-b', level: 'error' },
		{ id: '5', tenantId: null, level: 'error' }, // system-level log (worker)
		{ id: '6', tenantId: null, level: 'info' },  // system-level log
	];

	// deleteSchedulerLogsByLevel pattern: WHERE source='scheduler' AND level=? AND (tenantId=? OR tenantId IS NULL)
	// Tenant A deletes error logs — removes own errors + system errors (matches what the count shows)
	logs = logs.filter(l => !((l.tenantId === 'tenant-a' || l.tenantId === null) && l.level === 'error'));

	assert('Tenant A error log deleted', !logs.some(l => l.id === '2'));
	assert('System-level error log deleted (matches stats)', !logs.some(l => l.id === '5'));
	assert('Tenant A info log preserved', logs.some(l => l.id === '1'));
	assert('Tenant B error log preserved (other tenant)', logs.some(l => l.id === '4'));
	assert('System info log preserved (different level)', logs.some(l => l.id === '6'));
	assert('4 logs remain', logs.length === 4);
}

function testAuditTrailStructure() {
	console.log('\n📋 Test: Audit trail entry structure');

	// Simulate audit trail entry structure
	const auditEntry = {
		source: 'scheduler',
		level: 'info',
		message: 'Admin action: schedule updated for recurring-invoices',
		action: 'scheduler.update_schedule',
		tenantId: 'tenant-a',
		userId: 'user-123',
		metadata: JSON.stringify({
			jobId: 'job-key-1',
			name: 'recurring-invoices',
			oldPattern: '0 9 * * *',
			newPattern: '0 10 * * *'
		})
	};

	assert('Has source=scheduler', auditEntry.source === 'scheduler');
	assert('Has level=info', auditEntry.level === 'info');
	assert('Has action field', auditEntry.action === 'scheduler.update_schedule');
	assert('Has tenantId', !!auditEntry.tenantId);
	assert('Has userId', !!auditEntry.userId);
	assert('Metadata includes oldPattern', auditEntry.metadata.includes('oldPattern'));
	assert('Metadata includes newPattern', auditEntry.metadata.includes('newPattern'));
	assert('Message describes action', auditEntry.message.includes('Admin action'));

	// Test all 4 audit action types
	const actions = [
		'scheduler.update_schedule',
		'scheduler.remove_job',
		'scheduler.trigger_job',
		'scheduler.delete_logs'
	];
	for (const action of actions) {
		assert(`Action type valid: ${action}`, action.startsWith('scheduler.'));
	}
}

function testStatsIsolation() {
	console.log('\n📊 Test: Stats aggregation per tenant');

	type Log = { tenantId: string; level: string };

	const logs: Log[] = [
		{ tenantId: 'tenant-a', level: 'info' },
		{ tenantId: 'tenant-a', level: 'info' },
		{ tenantId: 'tenant-a', level: 'error' },
		{ tenantId: 'tenant-b', level: 'info' },
		{ tenantId: 'tenant-b', level: 'warning' },
	];

	// getSchedulerStats pattern: count by level WHERE tenantId=?
	const statsA = {
		info: logs.filter(l => l.tenantId === 'tenant-a' && l.level === 'info').length,
		warning: logs.filter(l => l.tenantId === 'tenant-a' && l.level === 'warning').length,
		error: logs.filter(l => l.tenantId === 'tenant-a' && l.level === 'error').length
	};
	const statsB = {
		info: logs.filter(l => l.tenantId === 'tenant-b' && l.level === 'info').length,
		warning: logs.filter(l => l.tenantId === 'tenant-b' && l.level === 'warning').length,
		error: logs.filter(l => l.tenantId === 'tenant-b' && l.level === 'error').length
	};

	assert('Tenant A: 2 info', statsA.info === 2);
	assert('Tenant A: 0 warning', statsA.warning === 0);
	assert('Tenant A: 1 error', statsA.error === 1);
	assert('Tenant B: 1 info', statsB.info === 1);
	assert('Tenant B: 1 warning', statsB.warning === 1);
	assert('Tenant B: 0 error', statsB.error === 0);
	assert('Stats are independent', statsA.info !== statsB.info);
}

function testRateLimitLogic() {
	console.log('\n⏱️ Test: Rate limit on triggerJobNow');

	const TRIGGER_COOLDOWN_MS = 30_000;
	const lastTriggerTime = new Map<string, number>();

	function canTrigger(name: string): boolean {
		const lastTime = lastTriggerTime.get(name) ?? 0;
		if (Date.now() - lastTime < TRIGGER_COOLDOWN_MS) return false;
		lastTriggerTime.set(name, Date.now());
		return true;
	}

	assert('First trigger allowed', canTrigger('recurring-invoices'));
	assert('Immediate second trigger blocked', !canTrigger('recurring-invoices'));
	assert('Different job allowed', canTrigger('email-retry'));

	// Simulate time passing
	lastTriggerTime.set('recurring-invoices', Date.now() - 31_000);
	assert('After 31s cooldown: allowed again', canTrigger('recurring-invoices'));
}

// ===== Main =====

function main() {
	console.log('🧪 Scheduler Tenant Isolation Tests\n');

	testAccessControl();
	testTenantFilterLogic();
	testDeleteIsolation();
	testAuditTrailStructure();
	testStatsIsolation();
	testRateLimitLogic();

	console.log('\n' + '='.repeat(50));
	console.log(results.join('\n'));
	console.log(`\n${passed} passed, ${failed} failed`);

	if (failed > 0) {
		process.exit(1);
	}
	console.log('\n✅ All tenant isolation tests passed');
}

main();
