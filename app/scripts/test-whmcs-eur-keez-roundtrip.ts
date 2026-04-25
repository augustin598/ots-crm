/**
 * LIVE Keez API integration test for EUR + 0% VAT mapping.
 *
 * Builds a synthetic CRM invoice (EUR currency, 0% VAT, German B2B partner
 * with VAT ID) and runs it through `mapInvoiceToKeez` → `createInvoice` to
 * verify Keez accepts the structure end-to-end. Then GETs the invoice from
 * Keez to inspect what was stored, and DELETEs the Draft to clean up.
 *
 * SAFETY:
 *   - Only ever creates a Draft (never validates → no fiscal document).
 *   - Externalid prefix `EUR_TEST_` so any leftover is obvious in Keez UI.
 *   - DELETE is in a finally{} so cleanup runs even if assertions fail.
 *   - Requires WHMCS_EUR_TEST_TENANT env var to opt-in. Without it, aborts.
 *
 * Run:
 *   cd app
 *   WHMCS_EUR_TEST_TENANT=ots bun --preload ./scripts/_test-preload.ts \
 *     ./scripts/test-whmcs-eur-keez-roundtrip.ts
 */
import { eq } from 'drizzle-orm';

import { db } from '../src/lib/server/db';
import * as table from '../src/lib/server/db/schema';
import { createKeezClientForTenant } from '../src/lib/server/plugins/keez/factory';
import { mapInvoiceToKeez } from '../src/lib/server/plugins/keez/mapper';
import {
	classifyZeroVat,
	buildZeroVatNote,
	appendZeroVatNote,
	ZERO_VAT_NOTE_PREFIX
} from '../src/lib/server/whmcs/zero-vat-detection';
import type { WhmcsInvoicePayload } from '../src/lib/server/whmcs/types';

const tenantSlug = process.env.WHMCS_EUR_TEST_TENANT;
if (!tenantSlug) {
	console.error(
		'❌ WHMCS_EUR_TEST_TENANT not set. Refusing to push to live Keez without explicit tenant slug.'
	);
	process.exit(2);
}

const externalId = `EUR_TEST_${Date.now().toString(16)}`;
const itemCode = `EUR_TEST_ITEM_${Date.now().toString(16)}`;
let draftCleanupNeeded = false;
let articleCleanupNeeded = false;
let createdItemExternalId: string | null = null;
// Keez may return its own externalId in the create response; track it for cleanup.
let actualDraftExternalId: string | null = null;
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

async function run() {
	console.log(`\n[setup] Resolving tenant '${tenantSlug}'...`);
	const tenant = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug!))
		.get();
	if (!tenant) {
		console.error(`❌ Tenant '${tenantSlug}' not found in DB. Aborting.`);
		process.exit(2);
	}
	console.log(`  ✅ tenantId=${tenant.id}`);

	const integration = await db
		.select()
		.from(table.keezIntegration)
		.where(eq(table.keezIntegration.tenantId, tenant.id))
		.get();
	if (!integration?.isActive) {
		console.error(`❌ Keez integration not active for tenant '${tenantSlug}'. Aborting.`);
		process.exit(2);
	}
	console.log('  ✅ Keez integration active');

	const settings = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenant.id))
		.get();

	console.log('\n[step 1] Build synthetic WHMCS payload (DE B2B, EUR, 0% VAT)');
	const payload: WhmcsInvoicePayload = {
		event: 'paid',
		whmcsInvoiceId: 999_900_001,
		whmcsInvoiceNumber: 'EURTEST',
		issueDate: new Date().toISOString().slice(0, 10),
		status: 'paid',
		subtotal: 100,
		tax: 0,
		total: 100,
		currency: 'EUR',
		paymentMethod: 'ProcesatorPlati',
		client: {
			whmcsClientId: 999_900,
			email: 'eur-test@example.de',
			isLegal: true,
			companyName: 'Test EUR GmbH',
			countryCode: 'DE',
			countryName: 'Germania',
			taxId: 'DE123456789',
			address1: 'Musterstraße 1',
			city: 'Berlin',
			postcode: '10115',
			phone: null,
			firstName: null,
			lastName: null
		} as WhmcsInvoicePayload['client'],
		items: [
			{
				whmcsItemId: 1,
				description: 'EUR roundtrip test — hosting service',
				quantity: 1,
				unitPrice: 100,
				vatPercent: 0,
				externalItemId: null
			} as WhmcsInvoicePayload['items'][number]
		]
	};

	const classification = classifyZeroVat(payload);
	const note = buildZeroVatNote(classification, {
		intracomNote: settings?.whmcsZeroVatNoteIntracom,
		exportNote: settings?.whmcsZeroVatNoteExport
	});
	const finalNotes = appendZeroVatNote(null, note);
	console.log(`  classification: ${classification}`);
	console.log(`  note: ${finalNotes}`);
	assert("classification === 'intracom'", classification === 'intracom');
	assert(
		'note starts with [Scutire TVA] prefix',
		finalNotes !== null && finalNotes.startsWith(ZERO_VAT_NOTE_PREFIX)
	);

	console.log('\n[step 2] Synthesize CRM-shaped invoice + line items in memory');
	const fakeClient: any = {
		id: 'eur_test_client_' + Date.now().toString(16),
		tenantId: tenant.id,
		email: payload.client.email,
		companyName: payload.client.companyName,
		isLegal: true,
		country: 'Germania',
		countryCode: 'DE',
		taxId: 'DE123456789',
		county: null,
		city: payload.client.city ?? null,
		address: payload.client.address1 ?? null,
		postalCode: payload.client.postcode ?? null,
		phone: null,
		firstName: null,
		lastName: null,
		createdByUserId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		whmcsClientId: payload.client.whmcsClientId,
		clientType: 'business',
		notes: null,
		gdprConsentAt: null,
		gdprConsentSource: null
	};

	const invoiceId = 'eur_test_inv_' + Date.now().toString(16);
	// Use a dedicated test series so we don't collide with the production
	// 'OTS' series ordering rules. Keez accepts new series automatically.
	const TEST_SERIES = 'EURTST';
	void TEST_SERIES;
	const fakeInvoice: any = {
		id: invoiceId,
		tenantId: tenant.id,
		clientId: fakeClient.id,
		invoiceNumber: `${TEST_SERIES}-${Date.now().toString(36).slice(-6).toUpperCase()}`,
		status: 'paid',
		amount: 10000,
		taxRate: 0,
		taxAmount: 0,
		totalAmount: 10000,
		issueDate: new Date(),
		dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
		paidDate: new Date(),
		currency: 'EUR',
		notes: finalNotes,
		invoiceSeries: TEST_SERIES,
		invoiceCurrency: null,
		paymentTerms: null,
		paymentMethod: 'ProcesatorPlati',
		exchangeRate: null,
		vatOnCollection: false,
		isCreditNote: false,
		taxApplicationType: 'none',
		discountType: null,
		discountValue: null,
		smartbillSeries: null,
		smartbillNumber: null,
		remainingAmount: null,
		keezInvoiceId: null,
		keezExternalId: null,
		keezStatus: null,
		spvId: null,
		externalSource: 'whmcs',
		externalInvoiceId: payload.whmcsInvoiceId,
		externalTransactionId: null,
		createdByUserId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		lineItems: [
			{
				id: 'eur_test_li_' + Date.now().toString(16),
				invoiceId,
				serviceId: null,
				description: 'EUR roundtrip test — hosting service',
				quantity: 1,
				rate: 10000,
				amount: 10000,
				taxRate: 0,
				discount: null,
				discountType: null,
				note: 'Pushed by test-whmcs-eur-keez-roundtrip.ts',
				currency: 'EUR',
				unitOfMeasure: null,
				keezItemExternalId: null
			}
		]
	};

	// Override the tenant's main keezSeries with our test series so we don't
	// collide with the production fiscal-numbering monotonicity rules in Keez.
	const overrideSettings: any = settings
		? { ...settings, keezSeries: TEST_SERIES, keezSeriesHosting: null }
		: ({
				id: 'fake_settings',
				tenantId: tenant.id,
				keezSeries: TEST_SERIES,
				defaultCurrency: 'RON',
				defaultTaxRate: 19
			} as any);

	console.log('\n[step 3] mapInvoiceToKeez → assert structure');
	const keezInvoice = await mapInvoiceToKeez(
		fakeInvoice,
		fakeClient,
		tenant as any,
		externalId,
		overrideSettings
	);
	console.log(`  keezInvoice.currencyCode = ${keezInvoice.currencyCode}`);
	console.log(`  keezInvoice.referenceCurrencyCode = ${keezInvoice.referenceCurrencyCode ?? '∅'}`);
	console.log(`  keezInvoice.exchangeRate = ${keezInvoice.exchangeRate ?? '∅'}`);
	console.log(`  keezInvoice.paymentTypeId = ${keezInvoice.paymentTypeId}`);
	const firstDetail = keezInvoice.invoiceDetails[0];
	console.log(`  detail[0].vatPercent = ${firstDetail?.vatPercent}`);
	console.log(`  detail[0].vatAmount = ${firstDetail?.vatAmount}`);

	// Pure-EUR invoice (invoice EUR + items EUR) → mapper passes through as
	// EUR without RON conversion. The "RON breakdown + referenceCurrencyCode"
	// path only fires for mixed-currency or EUR-invoice-with-RON-items cases.
	// What matters here: Keez accepts the document and VAT is 0%.
	assert(
		"currencyCode = 'EUR' (pure-EUR invoice, no conversion needed)",
		keezInvoice.currencyCode === 'EUR'
	);
	assert(
		"paymentTypeId === 6 (ProcesatorPlati)",
		keezInvoice.paymentTypeId === 6
	);
	assert('detail[0].vatPercent === 0', firstDetail?.vatPercent === 0);
	assert('detail[0].vatAmount === 0', firstDetail?.vatAmount === 0);

	console.log('\n[step 4a] LIVE: create test article in Keez nomenclator');
	const keezClient = await createKeezClientForTenant(tenant.id, {
		clientEid: integration.clientEid,
		applicationId: integration.applicationId,
		secret: integration.secret,
		accessToken: integration.accessToken,
		tokenExpiresAt: integration.tokenExpiresAt
	});
	const article = await keezClient.createItem({
		code: itemCode,
		name: `EUR roundtrip test · #${itemCode.slice(-8)}`,
		description: 'Test article — safe to delete',
		currencyCode: 'EUR',
		measureUnitId: 1,
		vatRate: 0,
		isActive: true,
		categoryExternalId: 'MISCSRV'
	});
	createdItemExternalId = article.externalId;
	articleCleanupNeeded = true;
	console.log(`  ✅ Article created externalId=${createdItemExternalId}`);
	// Re-build keezInvoice with the real article externalId resolved per line item.
	const itemExternalIdsMap = new Map<string, string>();
	itemExternalIdsMap.set(fakeInvoice.lineItems[0].id, createdItemExternalId);
	const keezInvoiceWithArticle = await mapInvoiceToKeez(
		fakeInvoice,
		fakeClient,
		tenant as any,
		externalId,
		overrideSettings,
		itemExternalIdsMap
	);

	console.log('\n[step 4b] LIVE: create Draft on Keez');
	const created = await keezClient.createInvoice(keezInvoiceWithArticle);
	actualDraftExternalId = created.externalId;
	draftCleanupNeeded = true;
	console.log(`  ✅ Created Keez Draft externalId=${created.externalId}`);
	assert('Keez accepted the invoice', !!created.externalId);

	console.log('\n[step 5] LIVE: fetch invoice back from Keez');
	const fetched = await keezClient.getInvoice(created.externalId);
	console.log(`  fetched.currencyCode = ${(fetched as any).currencyCode}`);
	console.log(`  fetched.exchangeRate = ${(fetched as any).exchangeRate}`);
	console.log(`  fetched.paymentTypeId = ${(fetched as any).paymentTypeId}`);
	const fetchedDetail = (fetched as any).invoiceDetails?.[0];
	console.log(`  fetched.invoiceDetails[0].vatPercent = ${fetchedDetail?.vatPercent}`);
	console.log(`  fetched.invoiceDetails[0].vatAmount = ${fetchedDetail?.vatAmount}`);

	// Pure-EUR invoice → Keez stores it as EUR (no RON conversion). The
	// "store as RON + invoiceCurrency=EUR" path is for mixed-currency or
	// EUR invoice with detail-level RON breakdown.
	assert(
		"Keez stored currencyCode='EUR' (pure-EUR pass-through)",
		(fetched as any).currencyCode === 'EUR' || (fetched as any).currency === 'EUR'
	);
	assert(
		'Keez stored vatPercent=0 on detail',
		fetchedDetail?.vatPercent === 0
	);
	assert(
		'Keez stored vatAmount=0 on detail',
		Math.abs((fetchedDetail?.vatAmount ?? 0)) < 0.01
	);
}

(async () => {
	try {
		await run();
	} catch (err) {
		console.error('❌ Test threw:', err instanceof Error ? err.message : String(err));
		failed++;
	} finally {
		if (draftCleanupNeeded || articleCleanupNeeded) {
			console.log('\n[cleanup] Tearing down Keez side effects');
			try {
				const tenant = await db
					.select()
					.from(table.tenant)
					.where(eq(table.tenant.slug, tenantSlug!))
					.get();
				const integration = tenant
					? await db
							.select()
							.from(table.keezIntegration)
							.where(eq(table.keezIntegration.tenantId, tenant.id))
							.get()
					: null;
				const keezClient =
					tenant && integration
						? await createKeezClientForTenant(tenant.id, {
								clientEid: integration.clientEid,
								applicationId: integration.applicationId,
								secret: integration.secret,
								accessToken: integration.accessToken,
								tokenExpiresAt: integration.tokenExpiresAt
							})
						: null;

				if (keezClient && draftCleanupNeeded) {
					// Keez may rewrite externalId on create — try the response value
					// first, then fall back to the original requested id.
					const candidates = [actualDraftExternalId, externalId].filter(
						(v): v is string => typeof v === 'string' && v.length > 0
					);
					let deleted = false;
					for (const eid of candidates) {
						try {
							await keezClient.deleteInvoice(eid);
							console.log(`  ✅ Draft deleted (externalId=${eid})`);
							deleted = true;
							break;
						} catch (e) {
							console.error(
								`  ⚠️  Draft delete failed for ${eid}: ${e instanceof Error ? e.message : String(e)}`
							);
						}
					}
					if (!deleted) {
						console.error(`  ⚠️  Manually delete Draft in Keez UI. Tried: ${candidates.join(', ')}`);
					}
				}

				if (keezClient && articleCleanupNeeded && createdItemExternalId) {
					// Keez has no deleteItem endpoint. Mark inactive so it stops
					// appearing in active-article searches.
					try {
						await keezClient.updateItem(createdItemExternalId, {
							code: itemCode,
							name: `EUR roundtrip test · #${itemCode.slice(-8)} (deactivated)`,
							currencyCode: 'EUR',
							measureUnitId: 1,
							vatRate: 0,
							isActive: false,
							categoryExternalId: 'MISCSRV'
						});
						console.log(`  ✅ Article deactivated (externalId=${createdItemExternalId})`);
					} catch (e) {
						console.error(
							`  ⚠️  Article deactivate failed: ${e instanceof Error ? e.message : String(e)}`
						);
						console.error(`  ⚠️  Manually deactivate article ${itemCode} in Keez UI.`);
					}
				}
			} catch (cleanupErr) {
				console.error(
					`  ⚠️  Cleanup failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`
				);
				console.error(`  ⚠️  Manually delete Draft externalId=${externalId} from Keez UI.`);
			}
		}
		console.log(`\nResult: ${passed} passed, ${failed} failed`);
		process.exit(failed > 0 ? 1 : 0);
	}
})();
