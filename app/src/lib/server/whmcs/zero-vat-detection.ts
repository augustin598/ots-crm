/**
 * Zero-VAT classification for inbound WHMCS invoices.
 *
 * When `payload.tax === 0` we need to know WHY VAT is zero so we can:
 *   - append the legally-required note to the Romanian fiscal invoice
 *   - set Keez `taxApplicationType='none'` only when truly applicable
 *     (NOT for RO-domestic reverse charge, which we don't auto-detect)
 *
 * Three legitimate "0% VAT" scenarios from a Romanian seller's perspective:
 *
 *   intracom — EU B2B with a valid VAT ID. 0% under reverse charge,
 *              ANAF rule: art. 278 alin. (2) Cod Fiscal. Note required.
 *   export   — Customer outside the EU. 0% under "operațiune neimpozabilă",
 *              art. 278 alin. (1) Cod Fiscal. Note required.
 *   ro_reverse_charge — Romanian domestic reverse charge (wood, electronics,
 *              specific industries per art. 331). We do NOT auto-detect this
 *              because misclassifying a normal RO B2B as reverse charge would
 *              skip VAT collection illegally. Operator must handle manually.
 *
 * Plus one defensive case:
 *   unknown — country missing or zero-value invoice. Default per Gemini
 *             review: treat as export (safer) but log a warning so operator
 *             reviews; OR skip (zero-value invoice = no taxable base).
 */

import { isOtherEuCountry } from './eu-countries';
import type { WhmcsInvoicePayload } from './types';

export type ZeroVatClassification =
	| 'intracom'
	| 'export'
	| 'ro_reverse_charge_or_domestic'
	| 'zero_value'
	| 'unknown';

export interface ZeroVatNoteSettings {
	intracomNote?: string | null;
	exportNote?: string | null;
	autoDetect?: boolean | null;
}

/** Default texts used when settings don't override. Wording cleared with
 * Romanian fiscal practice; operator can replace per tenant. */
export const DEFAULT_INTRACOM_NOTE =
	'Taxare inversă conform art. 278 alin. (2) Cod Fiscal — operațiune intracomunitară.';
export const DEFAULT_EXPORT_NOTE =
	'Operațiune neimpozabilă în România conform art. 278 alin. (1) Cod Fiscal — export.';

/** Prefix used when appending the note to invoice.notes so future readers
 *  (humans, log diffs, support) immediately recognise why the text exists. */
export const ZERO_VAT_NOTE_PREFIX = '[Scutire TVA] ';

export function classifyZeroVat(payload: WhmcsInvoicePayload): ZeroVatClassification {
	if (payload.tax !== 0) {
		throw new Error('classifyZeroVat called with payload.tax != 0 — caller must guard');
	}

	// Zero-value invoice (free trial, $0 line) — no taxable base, skip note.
	if (payload.subtotal === 0 && payload.total === 0) {
		return 'zero_value';
	}

	const country = payload.client?.countryCode?.trim().toUpperCase();
	const taxId = payload.client?.taxId?.trim();

	// No country in payload → can't classify reliably. Default to 'unknown'
	// (caller chooses fallback). Don't blanket-export because a missing country
	// on a EUR/RO invoice probably means a bigger data quality problem.
	if (!country) {
		return 'unknown';
	}

	// RO domestic — could be reverse charge OR a misconfigured normal invoice
	// where WHMCS sent tax=0 by mistake. We do NOT auto-classify either way.
	if (country === 'RO') {
		return 'ro_reverse_charge_or_domestic';
	}

	// EU member state (excl. RO) — intracommunity supply. Even without a
	// VAT ID we still classify as intracom so the legal text appears; operator
	// is responsible for ensuring the customer was VAT-validated upstream.
	// (Not requiring `taxId` matches WHMCS practice — some legitimate EU
	// micro-businesses lack one.)
	if (isOtherEuCountry(country)) {
		return 'intracom';
	}

	// Anything else (US, UK, CA, AU, ...) → export.
	return 'export';
}

/**
 * Build the note text to append to invoice.notes for the given classification.
 * Returns null when no note should be added (zero_value, ro_reverse_charge,
 * or unknown when settings don't have a fallback text).
 *
 * Note text always carries the `[Scutire TVA]` prefix for traceability.
 */
export function buildZeroVatNote(
	classification: ZeroVatClassification,
	settings: ZeroVatNoteSettings | null | undefined
): string | null {
	if (classification === 'zero_value' || classification === 'ro_reverse_charge_or_domestic') {
		return null;
	}

	if (classification === 'intracom') {
		const text = settings?.intracomNote?.trim() || DEFAULT_INTRACOM_NOTE;
		return ZERO_VAT_NOTE_PREFIX + text;
	}

	if (classification === 'export') {
		const text = settings?.exportNote?.trim() || DEFAULT_EXPORT_NOTE;
		return ZERO_VAT_NOTE_PREFIX + text;
	}

	// 'unknown' — Gemini suggested defaulting to export (safer than blank).
	// We honour that but use the export template since the customer is
	// effectively un-classifiable. Caller logs a warning separately.
	const text = settings?.exportNote?.trim() || DEFAULT_EXPORT_NOTE;
	return ZERO_VAT_NOTE_PREFIX + text;
}

/**
 * Return true when the classification should also flip the CRM invoice's
 * taxApplicationType to 'none' (forces 0% on every Keez line, defensive
 * against per-item rate inconsistencies). Excludes ro_reverse_charge to
 * avoid masking a misconfigured RO domestic invoice as 0% intentionally.
 */
export function shouldForceTaxApplicationNone(
	classification: ZeroVatClassification
): boolean {
	return (
		classification === 'intracom' ||
		classification === 'export' ||
		classification === 'unknown'
	);
}

/**
 * Append the note to existing invoice notes with a newline separator if both
 * are non-empty. Preserves earlier content (e.g. "Transaction ID: txn_…")
 * which the WHMCS handler also writes into invoice.notes.
 */
export function appendZeroVatNote(
	existingNotes: string | null | undefined,
	noteToAppend: string | null
): string | null {
	if (!noteToAppend) return existingNotes ?? null;
	if (!existingNotes || existingNotes.trim() === '') return noteToAppend;
	return existingNotes.trimEnd() + '\n\n' + noteToAppend;
}
