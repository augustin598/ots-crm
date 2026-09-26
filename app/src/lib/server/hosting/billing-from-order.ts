import { normalizeCui } from '$lib/server/cui-validator';

/**
 * Datele de facturare dintr-o comandă de hosting → patch pe rândul `client`.
 *
 * Folosit când un client logat (cont de self-signup, fără CUI/adresă) comandă
 * din checkout: în loc să creăm un client nou, îi completăm datele pe cel
 * existent. Câmpurile de adresă lipsă NU apar în patch, ca să nu suprascriem cu
 * gol ce avea deja; câmpurile de firmă se setează explicit (inclusiv pe null la
 * persoană fizică) pentru că definesc identitatea fiscală a comenzii.
 */
export type OrderBillingInput = {
	billingType: 'company' | 'person';
	cui?: string;
	vatPayer?: boolean;
	companyName?: string;
	registrationNumber?: string;
	firstName?: string;
	lastName?: string;
	phone?: string;
	address?: string;
	city?: string;
	county?: string;
	postalCode?: string;
};

export type ClientBillingUpdate = {
	name: string;
	businessName: string | null;
	cui: string | null;
	vatNumber: string | null;
	registrationNumber?: string | null;
	legalType: 'srl' | 'pf';
	country: 'RO';
	phone?: string;
	address?: string;
	city?: string;
	county?: string;
	postalCode?: string;
};

const ADDRESS_FIELDS = ['phone', 'address', 'city', 'county', 'postalCode'] as const;

/** Doar câmpurile de contact/adresă — fără identitatea fiscală. */
export type ClientAddressUpdate = Pick<ClientBillingUpdate, (typeof ADDRESS_FIELDS)[number]>;

/** Ce știm despre clientul logat când judecăm o comandă. */
export type PortalOrderContext = {
	isPrimary: boolean;
	email: string | null;
	cui: string | null;
};

/**
 * Cine e la tastatură și ce are voie să schimbe pe rândul clientului.
 *
 * - `ordersOnOwnAccount`: contactul PRIMAR al clientului, logat, comandă cu
 *   emailul contului → comanda se leagă de rândul lui. Un contact secundar
 *   (email diferit de al clientului, sau isPrimary=false) rămâne pe calea
 *   anonimă: atașare fără să atingem rândul.
 * - `canPatchIdentity`: identitatea fiscală (nume, firmă, CUI, formă juridică)
 *   se scrie doar pe conturile care încă n-au CUI (self-signup / PF). Un client
 *   cu CUI deja setat — de regulă cu facturi și partener Keez — nu-și poate
 *   rescrie identitatea din checkout; primește doar adresa/telefonul.
 */
export function decideOrderOwnership(
	portalClient: PortalOrderContext | null,
	submittedEmail: string
): { ordersOnOwnAccount: boolean; canPatchIdentity: boolean } {
	const email = submittedEmail.trim().toLowerCase();
	const ordersOnOwnAccount =
		!!portalClient &&
		portalClient.isPrimary &&
		email.length > 0 &&
		(portalClient.email ?? '').trim().toLowerCase() === email;
	const canPatchIdentity = ordersOnOwnAccount && !(portalClient?.cui ?? '').trim();
	return { ordersOnOwnAccount, canPatchIdentity };
}

/** Doar adresa/telefonul din comandă (pentru clienții cu identitate fiscală deja setată). */
export function buildAddressUpdateFromOrder(data: OrderBillingInput): ClientAddressUpdate {
	const out: ClientAddressUpdate = {};
	for (const key of ADDRESS_FIELDS) {
		const value = data[key]?.trim();
		if (value) out[key] = value;
	}
	return out;
}

export function buildBillingUpdateFromOrder(data: OrderBillingInput): ClientBillingUpdate {
	let out: ClientBillingUpdate;
	if (data.billingType === 'company') {
		const cui = normalizeCui(data.cui ?? '');
		const companyName = (data.companyName ?? '').trim();
		out = {
			name: companyName,
			businessName: companyName,
			cui,
			vatNumber: data.vatPayer ? `RO${cui}` : cui,
			legalType: 'srl',
			country: 'RO'
		};
		const reg = data.registrationNumber?.trim();
		if (reg) out.registrationNumber = reg;
	} else {
		out = {
			name: `${(data.firstName ?? '').trim()} ${(data.lastName ?? '').trim()}`.trim(),
			businessName: null,
			cui: null,
			vatNumber: null,
			registrationNumber: null,
			legalType: 'pf',
			country: 'RO'
		};
	}
	Object.assign(out, buildAddressUpdateFromOrder(data));
	return out;
}
