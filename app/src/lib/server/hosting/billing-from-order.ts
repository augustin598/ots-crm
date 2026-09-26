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
	for (const key of ADDRESS_FIELDS) {
		const value = data[key]?.trim();
		if (value) out[key] = value;
	}
	return out;
}
