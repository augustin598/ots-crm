/**
 * Verificări pe partener ÎNAINTE de a atinge Keez.
 *
 * Context (solx.ro, 3-4 sep 2026): clientul SOLX S.R.L nu avea CUI. Hook-ul
 * crea întâi articolul în nomenclatorul Keez, apoi Keez respingea factura cu
 * `ERROR_FISCAL_NUMBER_IS_NULL` („Pentru persoane juridice codul fiscal este
 * obligatoriu!"). Rollback-ul ștergea factura și readucea șablonul la ziua
 * ratată, deci scheduler-ul reîncerca ZILNIC — un articol nou în Keez la fiecare
 * încercare, niciun semnal către staff și niciun client facturat.
 *
 * Regulile de aici oglindesc exact ce validează Keez pe `partner`, ca eșecul să
 * fie ieftin (fără apel API), explicit (mesaj în română) și acționabil.
 */

export type KeezPartnerLike = {
	name?: string | null;
	cui?: string | null;
	companyType?: string | null;
	legalType?: string | null;
	businessName?: string | null;
};

const NATURAL_PERSON_TYPES = new Set(['pf', 'pfa', 'ii', 'if']);

/**
 * Persoană juridică din perspectiva Keez — aceeași regulă ca în `mapInvoiceToKeez`:
 * `companyType` populat (import vechi), `legalType` care nu e persoană fizică
 * (checkout-ul de hosting scrie doar `legalType`) sau `businessName` completat.
 */
export function isKeezLegalPerson(client: KeezPartnerLike): boolean {
	const legalTypeLower = (client.legalType || '').toString().trim().toLowerCase();
	return (
		(client.companyType !== null && client.companyType !== undefined) ||
		(!!legalTypeLower && !NATURAL_PERSON_TYPES.has(legalTypeLower)) ||
		(!!client.businessName && legalTypeLower !== 'pf')
	);
}

export type PartnerPreflightProblem = {
	code: 'missing_cui';
	message: string;
};

/**
 * `null` = partenerul poate fi trimis la Keez; altfel motivul pentru care Keez
 * ar respinge factura. Persoanele juridice trebuie să aibă CUI.
 */
export function keezPartnerPreflight(client: KeezPartnerLike): PartnerPreflightProblem | null {
	const cui = (client.cui || '').trim();
	if (isKeezLegalPerson(client) && !cui) {
		return {
			code: 'missing_cui',
			message: `Clientul „${client.name || '?'}" este persoană juridică, dar nu are CUI — Keez refuză factura. Completează CUI-ul pe fișa clientului.`
		};
	}
	return null;
}
