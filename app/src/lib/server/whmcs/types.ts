/**
 * Canonical payload shapes received from the WHMCS `ots_crm_connector`
 * PHP module. KEEP IN SYNC with that module's mappers:
 *   /modules/addons/ots_crm_connector/lib/Mappers/{Client,Invoice,Product,Transaction}Mapper.php
 *
 * Any change here is a wire-format change — bump the connectorVersion
 * constant in health/+server.ts and release both sides together.
 *
 * Design notes:
 *   - We accept nullable fields for nearly everything non-identifying. WHMCS
 *     installs in the wild leave optional fields empty; the CRM decides how
 *     to fill gaps (ANAF lookup, fallbacks, etc.) rather than rejecting.
 *   - `taxId` is the Romanian CUI (without the `RO` prefix) when the WHMCS
 *     client is a legal person. For natural persons it may be a CNP or
 *     empty. The matcher treats empty/null as "no CUI available" and falls
 *     through to email.
 *   - Amounts are sent as major-unit decimals (e.g. 96.80 RON), not minor
 *     units. Conversion to cents happens on the CRM side where we enter
 *     the `invoice.amount` integer field.
 *   - Dates are ISO `YYYY-MM-DD` (no time component).
 */

// ─────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────

export type WhmcsClientEvent = 'added' | 'updated';

export interface WhmcsClientPayload {
	event: WhmcsClientEvent;
	whmcsClientId: number;

	// Identity
	taxId?: string | null;              // CUI (legal person) or CNP (natural person)
	companyName?: string | null;
	firstName?: string | null;
	lastName?: string | null;
	isLegalPerson: boolean;

	// Contact
	email?: string | null;
	phone?: string | null;

	// Address
	address?: string | null;
	city?: string | null;
	countyName?: string | null;
	countyCode?: string | null;         // ISO 3166-2 e.g. "RO-SV"
	postalCode?: string | null;
	countryCode?: string | null;        // ISO 3166-1 alpha-2 e.g. "RO"
	countryName?: string | null;

	// Status hint from WHMCS — CRM maps to its own status field
	status?: 'Active' | 'Inactive' | 'Closed' | string | null;
}

// ─────────────────────────────────────────────
// Invoice (sketch — filled in when we build /invoices in a later step)
// ─────────────────────────────────────────────

export type WhmcsInvoiceEvent = 'created' | 'paid' | 'cancelled' | 'refunded';

export interface WhmcsInvoiceItemPayload {
	whmcsItemId: number;
	externalItemId: string;             // GUID used as keezItemExternalId on the CRM side
	description: string;
	quantity: number;
	unitPrice: number;                  // major units
	vatPercent: number;
	relId?: number | null;
	relIdType?: string | null;
}

export interface WhmcsInvoicePayload {
	event: WhmcsInvoiceEvent;
	whmcsInvoiceId: number;
	whmcsInvoiceNumber?: string | null;
	issueDate: string;                  // ISO YYYY-MM-DD
	dueDate?: string | null;
	status: string;
	subtotal: number;
	tax: number;
	total: number;
	currency: string;                   // ISO 4217
	paymentMethod?: string | null;
	transactionId?: string | null;      // Stripe txn_… or other gateway ref
	notes?: string | null;
	client: WhmcsClientPayload;         // WHMCS sends the full client snapshot
	items: WhmcsInvoiceItemPayload[];
}

// ─────────────────────────────────────────────
// Matcher result (internal — used between client-matching + invoice flow)
// ─────────────────────────────────────────────

/**
 * Where a CRM client came from during a WHMCS sync. Stored in
 * `whmcs_client_sync.match_type` and `whmcs_invoice_sync.match_type`
 * for audit + observability (alert on consecutive 'NEW' runs per tenant).
 */
export type WhmcsMatchType = 'WHMCS_ID' | 'CUI' | 'EMAIL' | 'NEW';
