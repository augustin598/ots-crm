/**
 * Unit test: zero-VAT classification + note builder.
 *
 * Covers:
 *   - classifyZeroVat across the 5 outcomes
 *   - buildZeroVatNote text + prefix + settings override
 *   - shouldForceTaxApplicationNone gates
 *   - appendZeroVatNote handles null + non-null + multi-line existing notes
 *   - isEuCountry / isOtherEuCountry alphabet
 *
 * Run:
 *   bun --preload ./scripts/_test-preload.ts ./scripts/test-whmcs-zero-vat.ts
 */
import {
	classifyZeroVat,
	buildZeroVatNote,
	shouldForceTaxApplicationNone,
	appendZeroVatNote,
	DEFAULT_INTRACOM_NOTE,
	DEFAULT_EXPORT_NOTE,
	ZERO_VAT_NOTE_PREFIX
} from '../src/lib/server/whmcs/zero-vat-detection';
import { isEuCountry, isOtherEuCountry } from '../src/lib/server/whmcs/eu-countries';
import type { WhmcsInvoicePayload } from '../src/lib/server/whmcs/types';

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean) {
	if (cond) {
		console.log(`  ✅ ${label}`);
		passed++;
	} else {
		console.log(`  ❌ ${label}`);
		failed++;
	}
}

function assertEq<T>(label: string, actual: T, expected: T) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (ok) {
		console.log(`  ✅ ${label}`);
		passed++;
	} else {
		console.log(`  ❌ ${label} → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
		failed++;
	}
}

// Helper to build a payload skeleton with a 0 VAT
function payload(opts: {
	tax?: number;
	subtotal?: number;
	total?: number;
	countryCode?: string | null;
	taxId?: string | null;
}): WhmcsInvoicePayload {
	return {
		event: 'paid',
		whmcsInvoiceId: 1,
		issueDate: '2026-04-26',
		status: 'paid',
		subtotal: opts.subtotal ?? 100,
		tax: opts.tax ?? 0,
		total: opts.total ?? 100,
		currency: 'EUR',
		client: {
			whmcsClientId: 1,
			email: 'x@y.com',
			isLegal: true,
			companyName: 'Acme',
			countryCode: opts.countryCode ?? null,
			taxId: opts.taxId ?? null
		} as WhmcsInvoicePayload['client'],
		items: []
	};
}

console.log('\n[1] isEuCountry / isOtherEuCountry coverage:');
assert("isEuCountry('DE') = true", isEuCountry('DE'));
assert("isEuCountry('de') = true (case-insensitive)", isEuCountry('de'));
assert("isEuCountry(' RO ') = true (trim)", isEuCountry(' RO '));
assert("isEuCountry('US') = false", !isEuCountry('US'));
assert("isEuCountry('GB') = false (post-Brexit)", !isEuCountry('GB'));
assert("isEuCountry(null) = false", !isEuCountry(null));
assert("isEuCountry('') = false", !isEuCountry(''));
assert("isOtherEuCountry('DE') = true", isOtherEuCountry('DE'));
assert("isOtherEuCountry('RO') = false (excluded)", !isOtherEuCountry('RO'));
assert("isOtherEuCountry('US') = false", !isOtherEuCountry('US'));
// Sample of all 27 — spot check a few less obvious ones
assert("isEuCountry('HR') = true (Croatia)", isEuCountry('HR'));
assert("isEuCountry('LU') = true (Luxembourg)", isEuCountry('LU'));
assert("isEuCountry('MT') = true (Malta)", isEuCountry('MT'));
assert("isEuCountry('CY') = true (Cyprus)", isEuCountry('CY'));
assert("isEuCountry('CH') = false (Switzerland not in EU)", !isEuCountry('CH'));
assert("isEuCountry('NO') = false (Norway not in EU)", !isEuCountry('NO'));

console.log('\n[2] classifyZeroVat across all 5 outcomes:');
assertEq(
	"DE B2B with VAT ID → intracom",
	classifyZeroVat(payload({ countryCode: 'DE', taxId: 'DE123456789' })),
	'intracom'
);
assertEq(
	"FR B2B without VAT ID → still intracom (EU country wins)",
	classifyZeroVat(payload({ countryCode: 'FR' })),
	'intracom'
);
assertEq(
	"US client → export",
	classifyZeroVat(payload({ countryCode: 'US' })),
	'export'
);
assertEq(
	"GB client (post-Brexit, treated as non-EU) → export",
	classifyZeroVat(payload({ countryCode: 'GB' })),
	'export'
);
assertEq(
	"CA client → export",
	classifyZeroVat(payload({ countryCode: 'CA' })),
	'export'
);
assertEq(
	"RO client (domestic) → ro_reverse_charge_or_domestic",
	classifyZeroVat(payload({ countryCode: 'RO' })),
	'ro_reverse_charge_or_domestic'
);
assertEq(
	"missing country → unknown",
	classifyZeroVat(payload({ countryCode: null })),
	'unknown'
);
assertEq(
	"empty country → unknown",
	classifyZeroVat(payload({ countryCode: '' })),
	'unknown'
);
assertEq(
	"zero-value invoice → zero_value (skip note)",
	classifyZeroVat(payload({ subtotal: 0, total: 0, countryCode: 'DE' })),
	'zero_value'
);

// Guard: classifyZeroVat must throw if called with non-zero tax.
let threw = false;
try {
	classifyZeroVat(payload({ tax: 19, subtotal: 100, total: 119 }));
} catch {
	threw = true;
}
assert('classifyZeroVat throws on non-zero tax (caller guard)', threw);

console.log('\n[3] buildZeroVatNote text and settings override:');
assertEq(
	'intracom + no settings → DEFAULT prefixed',
	buildZeroVatNote('intracom', null),
	ZERO_VAT_NOTE_PREFIX + DEFAULT_INTRACOM_NOTE
);
assertEq(
	'export + no settings → DEFAULT prefixed',
	buildZeroVatNote('export', null),
	ZERO_VAT_NOTE_PREFIX + DEFAULT_EXPORT_NOTE
);
assertEq(
	'intracom + custom settings → custom prefixed',
	buildZeroVatNote('intracom', { intracomNote: 'Reverse charge per Art 196 VAT Directive', exportNote: null }),
	ZERO_VAT_NOTE_PREFIX + 'Reverse charge per Art 196 VAT Directive'
);
assertEq(
	'export + custom settings → custom prefixed',
	buildZeroVatNote('export', { intracomNote: null, exportNote: 'Export operation, art. X' }),
	ZERO_VAT_NOTE_PREFIX + 'Export operation, art. X'
);
assertEq(
	'intracom + whitespace-only settings → falls back to DEFAULT',
	buildZeroVatNote('intracom', { intracomNote: '   ', exportNote: null }),
	ZERO_VAT_NOTE_PREFIX + DEFAULT_INTRACOM_NOTE
);
assertEq(
	'unknown → uses export DEFAULT (safer fallback per Gemini)',
	buildZeroVatNote('unknown', null),
	ZERO_VAT_NOTE_PREFIX + DEFAULT_EXPORT_NOTE
);
assertEq('zero_value → null (no note)', buildZeroVatNote('zero_value', null), null);
assertEq(
	'ro_reverse_charge_or_domestic → null (no auto note)',
	buildZeroVatNote('ro_reverse_charge_or_domestic', null),
	null
);

console.log('\n[4] shouldForceTaxApplicationNone gates:');
assert('intracom forces taxApplicationType=none', shouldForceTaxApplicationNone('intracom'));
assert('export forces taxApplicationType=none', shouldForceTaxApplicationNone('export'));
assert('unknown forces taxApplicationType=none', shouldForceTaxApplicationNone('unknown'));
assert(
	'ro_reverse_charge_or_domestic does NOT force (operator review)',
	!shouldForceTaxApplicationNone('ro_reverse_charge_or_domestic')
);
assert('zero_value does NOT force', !shouldForceTaxApplicationNone('zero_value'));

console.log('\n[5] appendZeroVatNote: combines existing notes with new note:');
assertEq('null existing + null new → null', appendZeroVatNote(null, null), null);
assertEq('null existing + new → new', appendZeroVatNote(null, '[Scutire TVA] X'), '[Scutire TVA] X');
assertEq(
	'existing + null → existing unchanged',
	appendZeroVatNote('Transaction ID: txn_xyz', null),
	'Transaction ID: txn_xyz'
);
assertEq(
	'both → joined with double newline',
	appendZeroVatNote('Transaction ID: txn_xyz', '[Scutire TVA] X'),
	'Transaction ID: txn_xyz\n\n[Scutire TVA] X'
);
assertEq(
	'existing with trailing whitespace → trimmed before join',
	appendZeroVatNote('Transaction ID: txn_xyz   \n  ', '[Scutire TVA] X'),
	'Transaction ID: txn_xyz\n\n[Scutire TVA] X'
);
assertEq(
	'empty string existing → treated as null',
	appendZeroVatNote('   ', '[Scutire TVA] X'),
	'[Scutire TVA] X'
);

console.log('\n[6] End-to-end real scenarios:');
// A German B2B client paying in EUR with valid VAT — most common intracom case
{
	const p = payload({ countryCode: 'DE', taxId: 'DE123456789' });
	const cls = classifyZeroVat(p);
	const note = buildZeroVatNote(cls, null);
	assertEq('DE+VAT classification', cls, 'intracom');
	assert('DE+VAT note has prefix', note?.startsWith('[Scutire TVA]') === true);
	assert('DE+VAT forces taxApplicationType', shouldForceTaxApplicationNone(cls));
}
// A US individual buying hosting (no VAT obligation) — common export case
{
	const p = payload({ countryCode: 'US' });
	const cls = classifyZeroVat(p);
	const note = buildZeroVatNote(cls, null);
	assertEq('US classification', cls, 'export');
	assert('US note contains Romanian legal text', note?.includes('art. 278 alin. (1)') === true);
}
// RO domestic invoice with tax=0 — could be misconfigured WHMCS or domestic
// reverse charge. We don't auto-classify either way.
{
	const p = payload({ countryCode: 'RO' });
	const cls = classifyZeroVat(p);
	const note = buildZeroVatNote(cls, null);
	assertEq('RO classification', cls, 'ro_reverse_charge_or_domestic');
	assertEq('RO note → null (operator review)', note, null);
	assert('RO does NOT force taxApplicationType=none', !shouldForceTaxApplicationNone(cls));
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
