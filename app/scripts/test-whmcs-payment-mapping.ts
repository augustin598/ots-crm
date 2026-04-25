/**
 * Unit test: paymentMethod → Keez paymentTypeId mapping.
 *
 * Why this exists: a Stripe-paid WHMCS invoice was landing on a Keez proforma
 * with paymentTypeId=3 (Bank) instead of 6 (ProcesatorPlati). Two layers were
 * misrouting:
 *
 *   1. WHMCS PHP InvoiceMapper.PAYMENT_MAP mapped `stripe` → `'Bank'`
 *   2. CRM mapper.ts fuzzy `card → 2` (BFCard) — wrong for invoice context
 *
 * Both fixed in commit 346a7f7. This script asserts the CRM-side outcome
 * directly via the extracted `mapPaymentTypeIdForKeez` function.
 *
 * Keez paymentTypeId reference:
 *   1 BFCash, 2 BFCard, 3 Bank, 4 ChitCash, 5 Ramburs,
 *   6 ProcesatorPlati, 7 PlatformaDistributie,
 *   8 VoucherVacantaCard, 9 VoucherVacantaTichet
 *
 * Run:
 *   bun --preload ./scripts/_test-preload.ts ./scripts/test-whmcs-payment-mapping.ts
 */
import { mapPaymentTypeIdForKeez } from '../src/lib/server/plugins/keez/mapper';

let passed = 0;
let failed = 0;

function assert(label: string, actual: number, expected: number) {
	if (actual === expected) {
		console.log(`  ✅ ${label} → ${actual}`);
		passed++;
	} else {
		console.log(`  ❌ ${label} → got ${actual}, expected ${expected}`);
		failed++;
	}
}

console.log('\n[1] Exact Keez code names (what WHMCS PHP normalizer sends post-fix):');
assert("'Bank'", mapPaymentTypeIdForKeez('Bank'), 3);
assert("'ProcesatorPlati'", mapPaymentTypeIdForKeez('ProcesatorPlati'), 6);
assert("'BFCash'", mapPaymentTypeIdForKeez('BFCash'), 1);
assert("'BFCard'", mapPaymentTypeIdForKeez('BFCard'), 2);
assert("'ChitCash'", mapPaymentTypeIdForKeez('ChitCash'), 4);
assert("'Ramburs'", mapPaymentTypeIdForKeez('Ramburs'), 5);
assert("'PlatformaDistributie'", mapPaymentTypeIdForKeez('PlatformaDistributie'), 7);
assert("'VoucherVacantaCard'", mapPaymentTypeIdForKeez('VoucherVacantaCard'), 8);
assert("'VoucherVacantaTichet'", mapPaymentTypeIdForKeez('VoucherVacantaTichet'), 9);

console.log(
	'\n[2] Raw WHMCS gateway slugs (when PHP normalizer is bypassed / older WHMCS payload):'
);
// All of these MUST land on 6 ProcesatorPlati after the fix:
assert("'stripe'", mapPaymentTypeIdForKeez('stripe'), 6);
assert("'paypal'", mapPaymentTypeIdForKeez('paypal'), 6);
assert("'payu'", mapPaymentTypeIdForKeez('payu'), 6);
assert("'netopia'", mapPaymentTypeIdForKeez('netopia'), 6);
assert("'euplatesc'", mapPaymentTypeIdForKeez('euplatesc'), 6);
assert("'mobilpay'", mapPaymentTypeIdForKeez('mobilpay'), 6);
assert("'card' (raw, no 'bon fiscal' prefix)", mapPaymentTypeIdForKeez('card'), 6);

assert("'banktransfer'", mapPaymentTypeIdForKeez('banktransfer'), 3);
assert("'wire'", mapPaymentTypeIdForKeez('wire'), 3);

assert("'cash'", mapPaymentTypeIdForKeez('cash'), 4);
assert("'mailin'", mapPaymentTypeIdForKeez('mailin'), 4);
assert("'cod'", mapPaymentTypeIdForKeez('cod'), 5);

console.log('\n[3] Romanian-language UI labels (case-insensitive):');
assert("'Plata cu cardul'", mapPaymentTypeIdForKeez('Plata cu cardul'), 6);
assert("'Transfer Bancar'", mapPaymentTypeIdForKeez('Transfer Bancar'), 3);
assert("'transfer bancar'", mapPaymentTypeIdForKeez('transfer bancar'), 3);
assert("'plată numerar'", mapPaymentTypeIdForKeez('plată numerar'), 4);
assert("'Chitanță'", mapPaymentTypeIdForKeez('Chitanță'), 4);
assert("'Procesator plăți'", mapPaymentTypeIdForKeez('Procesator plăți'), 6);
assert("'Plata online'", mapPaymentTypeIdForKeez('Plata online'), 6);

console.log('\n[4] Bon Fiscal disambiguation (retail POS, NOT online card):');
assert("'Bon Fiscal Card'", mapPaymentTypeIdForKeez('Bon Fiscal Card'), 2);
assert("'bon fiscal cash'", mapPaymentTypeIdForKeez('bon fiscal cash'), 1);
assert("'bon fiscal numerar'", mapPaymentTypeIdForKeez('bon fiscal numerar'), 1);

console.log('\n[5] Order sensitivity — bank* must beat card*:');
assert("'bank card' → Bank not ProcesatorPlati", mapPaymentTypeIdForKeez('bank card'), 3);

console.log('\n[6] Edge cases:');
assert('null → default 3', mapPaymentTypeIdForKeez(null), 3);
assert('undefined → default 3', mapPaymentTypeIdForKeez(undefined), 3);
assert("'' → default 3", mapPaymentTypeIdForKeez(''), 3);
assert("'   ' → default 3", mapPaymentTypeIdForKeez('   '), 3);
assert(
	"'totally unknown gateway' → default (no fuzzy match)",
	mapPaymentTypeIdForKeez('totally unknown gateway'),
	3
);
assert(
	"'totally unknown gateway' with custom default 6",
	mapPaymentTypeIdForKeez('totally unknown gateway', 6),
	6
);
assert(
	"null with custom default 5",
	mapPaymentTypeIdForKeez(null, 5),
	5
);

console.log('\n[7] Real-world scenarios that prompted this work:');
// User's WHMCS gateway: stripe → PHP normalizer maps to 'ProcesatorPlati'
// → CRM exact match → 6. End-to-end:
assert(
	"end-to-end Stripe (post-PHP-fix): 'ProcesatorPlati' → 6",
	mapPaymentTypeIdForKeez('ProcesatorPlati'),
	6
);
// Pre-fix scenario: PHP sends 'Bank' for Stripe → ends up as 3 (the bug)
assert(
	"pre-fix bug evidence: 'Bank' from Stripe wouldn't recover to 6",
	mapPaymentTypeIdForKeez('Bank'),
	3
);
// User's other WHMCS gateway: banktransfer → 'Bank' → 3
assert(
	"end-to-end Bank Transfer: 'Bank' → 3",
	mapPaymentTypeIdForKeez('Bank'),
	3
);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
