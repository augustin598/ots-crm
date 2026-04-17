/**
 * Test script for report PDF generation and date range calculation.
 * Run with: bun --bun test-report-pdf.ts
 * No database needed — tests pure functions only.
 *
 * Note: getDateRange is tested by inlining its logic here because importing
 * pdf-report-send.ts pulls in DB dependencies that require SvelteKit env.
 */
import { generateReportPdf, type ReportPlatformData } from './src/lib/server/report-pdf-generator';

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

// ===== Inline getDateRange for testing (mirrors pdf-report-send.ts) =====
function getDateRange(frequency: string, now: Date): { since: string; until: string; label: string } {
	const pad = (n: number) => String(n).padStart(2, '0');
	const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

	if (frequency === 'weekly') {
		const lastSunday = new Date(now);
		lastSunday.setDate(now.getDate() - (now.getDay() === 0 ? 0 : now.getDay()));
		const lastMonday = new Date(lastSunday);
		lastMonday.setDate(lastSunday.getDate() - 6);
		const label = `${lastMonday.getDate()} - ${lastSunday.getDate()} ${lastSunday.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })}`;
		return { since: fmt(lastMonday), until: fmt(lastSunday), label };
	}

	const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
	const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
	const label = lastMonth.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
	return { since: fmt(lastMonth), until: fmt(lastMonthEnd), label };
}

// ===== getDateRange tests =====
console.log('\n📅 getDateRange tests\n');

// Weekly — Wednesday 2026-04-15
{
	const wed = new Date(2026, 3, 15); // April 15, 2026 = Wednesday
	const r = getDateRange('weekly', wed);
	assert('weekly wed: since is Monday', r.since === '2026-04-06');
	assert('weekly wed: until is Sunday', r.until === '2026-04-12');
	assert('weekly wed: label contains range', r.label.includes('6') && r.label.includes('12'));
}

// Weekly — Monday 2026-04-13
{
	const mon = new Date(2026, 3, 13); // April 13, 2026 = Monday
	const r = getDateRange('weekly', mon);
	assert('weekly mon: since is prev Monday', r.since === '2026-04-06');
	assert('weekly mon: until is prev Sunday', r.until === '2026-04-12');
}

// Weekly — Sunday 2026-04-12 (edge case getDay() === 0)
{
	const sun = new Date(2026, 3, 12); // April 12, 2026 = Sunday
	const r = getDateRange('weekly', sun);
	assert('weekly sun: since is Monday of that week', r.since === '2026-04-06');
	assert('weekly sun: until is that Sunday', r.until === '2026-04-12');
}

// Monthly — April 2026
{
	const apr = new Date(2026, 3, 15); // April 15
	const r = getDateRange('monthly', apr);
	assert('monthly apr: since is March 1', r.since === '2026-03-01');
	assert('monthly apr: until is March 31', r.until === '2026-03-31');
	assert('monthly apr: label contains martie', r.label.toLowerCase().includes('mart'));
}

// Monthly — January (should return December of previous year)
{
	const jan = new Date(2026, 0, 15); // January 15, 2026
	const r = getDateRange('monthly', jan);
	assert('monthly jan: since is Dec 1 prev year', r.since === '2025-12-01');
	assert('monthly jan: until is Dec 31 prev year', r.until === '2025-12-31');
	assert('monthly jan: label contains decembrie', r.label.toLowerCase().includes('dec'));
}

// Monthly — March (February end — non-leap year 2026)
{
	const mar = new Date(2026, 2, 10); // March 10, 2026
	const r = getDateRange('monthly', mar);
	assert('monthly mar: since is Feb 1', r.since === '2026-02-01');
	assert('monthly mar: until is Feb 28 (non-leap)', r.until === '2026-02-28');
}

// Monthly — March 2024 (February end — leap year)
{
	const mar24 = new Date(2024, 2, 10); // March 10, 2024
	const r = getDateRange('monthly', mar24);
	assert('monthly mar 2024: until is Feb 29 (leap)', r.until === '2024-02-29');
}

results.forEach((r) => console.log(r));
results.length = 0;

// ===== generateReportPdf tests =====
console.log('\n📄 generateReportPdf tests\n');

const samplePlatform: ReportPlatformData = {
	name: 'Meta Ads',
	spend: 1500.50,
	impressions: 250000,
	clicks: 3200,
	conversions: 45,
	currency: 'RON'
};

const samplePlatforms: ReportPlatformData[] = [
	samplePlatform,
	{ name: 'Google Ads', spend: 2300, impressions: 180000, clicks: 4100, conversions: 62, currency: 'RON' },
	{ name: 'TikTok Ads', spend: 800, impressions: 120000, clicks: 1500, conversions: 18, currency: 'RON' }
];

// Test: returns a buffer with content
{
	const buf = await generateReportPdf({
		tenantName: 'Test Agency',
		clientName: 'Client Test',
		period: { since: '2026-03-01', until: '2026-03-31', label: 'martie 2026' },
		platforms: [samplePlatform],
		generatedAt: new Date()
	});
	assert('single platform: returns Buffer', Buffer.isBuffer(buf));
	assert('single platform: buffer has content', buf.length > 0);

	// PDF magic bytes: %PDF
	assert('single platform: starts with %PDF', buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
}

// Test: 3 platforms — should produce larger PDF
{
	const bufSingle = await generateReportPdf({
		tenantName: 'Test Agency',
		clientName: 'Client Test',
		period: { since: '2026-03-01', until: '2026-03-31', label: 'martie 2026' },
		platforms: [samplePlatform],
		generatedAt: new Date()
	});

	const bufMulti = await generateReportPdf({
		tenantName: 'Test Agency',
		clientName: 'Client Test',
		period: { since: '2026-03-01', until: '2026-03-31', label: 'martie 2026' },
		platforms: samplePlatforms,
		generatedAt: new Date()
	});

	assert('3 platforms: returns Buffer', Buffer.isBuffer(bufMulti));
	assert('3 platforms: starts with %PDF', bufMulti[0] === 0x25 && bufMulti[1] === 0x50);
	assert('3 platforms: larger than single', bufMulti.length > bufSingle.length);
}

// Test: empty platforms (edge case)
{
	const buf = await generateReportPdf({
		tenantName: 'Test Agency',
		clientName: 'Client Test',
		period: { since: '2026-03-01', until: '2026-03-31', label: 'martie 2026' },
		platforms: [],
		generatedAt: new Date()
	});
	assert('empty platforms: returns Buffer without crash', Buffer.isBuffer(buf));
	assert('empty platforms: valid PDF', buf[0] === 0x25 && buf[1] === 0x50);
}

// Test: zero values (no spend, no clicks)
{
	const buf = await generateReportPdf({
		tenantName: 'Test Agency',
		clientName: 'Client Test',
		period: { since: '2026-03-01', until: '2026-03-31', label: 'martie 2026' },
		platforms: [{ name: 'Meta Ads', spend: 0, impressions: 0, clicks: 0, conversions: 0, currency: 'RON' }],
		generatedAt: new Date()
	});
	assert('zero values: returns Buffer without crash', Buffer.isBuffer(buf));
	assert('zero values: valid PDF', buf[0] === 0x25 && buf[1] === 0x50);
}

// Test: special characters in client name
{
	const buf = await generateReportPdf({
		tenantName: 'Agenție Test România',
		clientName: 'Ștefan & Asociații S.R.L.',
		period: { since: '2026-03-01', until: '2026-03-31', label: 'martie 2026' },
		platforms: [samplePlatform],
		generatedAt: new Date()
	});
	assert('special chars: returns valid PDF', Buffer.isBuffer(buf) && buf.length > 0);
}

results.forEach((r) => console.log(r));

// ===== Summary =====
console.log(`\n${'='.repeat(50)}`);
console.log(`  Total: ${passed + failed} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
