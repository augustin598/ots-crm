import { extractText, getDocumentProxy } from 'unpdf';

export interface ClientExtractedInfo {
	cui: string;
	registrationNumber: string;
	email: string;
	phone: string;
	address: string;
	city: string;
	county: string;
	postalCode: string;
	iban: string;
	bankName: string;
	legalRepresentative: string;
}

export interface TenantInfo {
	cui?: string | null;
	registrationNumber?: string | null;
	email?: string | null;
	phone?: string | null;
	address?: string | null;
	city?: string | null;
	county?: string | null;
	postalCode?: string | null;
	iban?: string | null;
	ibanEuro?: string | null;
	bankName?: string | null;
	legalRepresentative?: string | null;
}

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
	const pdf = await getDocumentProxy(new Uint8Array(buffer));
	const { text } = await extractText(pdf, { mergePages: true });
	return text;
}

function cleanValue(val: string): string {
	return val.replace(/\s+/g, ' ').replace(/[,;:\s]+$/, '').trim();
}

function normalize(val: string): string {
	return val.replace(/[\s.\-\/(),;:]/g, '').toLowerCase();
}

/**
 * Normalize CUI values: strip "RO" prefix and whitespace for comparison.
 */
function normalizeCui(val: string): string {
	return val.replace(/^RO\s*/i, '').replace(/\s+/g, '').trim();
}

/**
 * Check if an extracted value matches a tenant value.
 * Uses normalized comparison + word-based fallback.
 * Word-based: all significant tenant words (>=4 chars) must appear in extracted value.
 * Handles cases like tenant DB "Str. Tineretului 6" vs extracted "Tineretului, nr. 6, bl. 86".
 */
function matchesTenant(extracted: string, tenantValue: string | null | undefined): boolean {
	if (!tenantValue) return false;
	const normExtracted = normalize(extracted);
	const normTenant = normalize(tenantValue);
	if (normExtracted === normTenant || normExtracted.includes(normTenant) || normTenant.includes(normExtracted)) {
		return true;
	}
	// Word-based fallback: all significant words from tenant must appear in extracted
	const getWords = (s: string) => s.toLowerCase().replace(/[^\p{L}\d]/gu, ' ').split(/\s+/).filter(w => w.length >= 4);
	const tenantWords = getWords(tenantValue);
	if (tenantWords.length === 0) return false;
	const extractedLower = extracted.toLowerCase();
	return tenantWords.every(tw => extractedLower.includes(tw));
}

/**
 * Check match with CUI-specific normalization (strips RO prefix).
 */
function matchesTenantCui(extracted: string, tenantValue: string | null | undefined): boolean {
	if (!tenantValue) return false;
	return normalizeCui(extracted) === normalizeCui(tenantValue);
}

/**
 * From a list of extracted values, pick the one that does NOT belong to the tenant.
 * Romanian contracts: section 1.1 (prestator) comes before 1.2 (beneficiar).
 * When some values match the tenant, return the first non-tenant value.
 * When NONE match (tenant data in DB differs from PDF), return the LAST value
 * since it's most likely from section 1.2 (beneficiar = client).
 */
function pickClientValue(values: string[], tenantValues: (string | null | undefined)[]): string | undefined {
	const nonTenantValues = values.filter(
		(v) => !tenantValues.some((tv) => tv && matchesTenant(v, tv))
	);
	if (nonTenantValues.length === values.length && values.length > 1) {
		// None matched tenant → pick last (beneficiar = section 1.2)
		return nonTenantValues[nonTenantValues.length - 1];
	}
	return nonTenantValues[0];
}

/**
 * Extract all client info from PDF text by finding ALL occurrences of each field
 * and filtering out the ones that match the tenant (prestator).
 * Whatever doesn't match the tenant = client data.
 */
export function extractClientInfoFromText(text: string, tenant: TenantInfo): Partial<ClientExtractedInfo> {
	const result: Partial<ClientExtractedInfo> = {};

	// --- CUI / CIF / cod fiscal ---
	// Collect CUIs with their context to deduplicate header vs body
	const cuiSet = new Set<string>();
	const cuiRegex = /(?:C\.?\s*U\.?\s*I\.?|C\.?\s*I\.?\s*F\.?|cod\s+fiscal|cod\s+unic\s+de\s+[iî]nregistrare)\s*[:\-–]?\s*(?:RO\s*)?(\d{2,10})/gi;
	let m;
	while ((m = cuiRegex.exec(text)) !== null) {
		cuiSet.add(m[1].trim());
	}
	const allCuis = Array.from(cuiSet);
	// Filter CUIs using CUI-specific normalization (strips RO prefix)
	const clientCuis = allCuis.filter(
		(v) => !matchesTenantCui(v, tenant.cui)
	);
	if (clientCuis.length === 1) {
		// Only one non-tenant CUI found - use it
		result.cui = clientCuis[0];
	} else if (clientCuis.length > 1) {
		// Multiple non-tenant CUIs - pick the one from "cod fiscal" label (beneficiar pattern)
		const codFiscalMatch = text.match(/cod\s+fiscal\s*[:\-–]?\s*(?:RO\s*)?(\d{2,10})/i);
		if (codFiscalMatch && clientCuis.includes(codFiscalMatch[1].trim())) {
			result.cui = codFiscalMatch[1].trim();
		} else {
			result.cui = clientCuis[clientCuis.length - 1]; // last one is usually beneficiar (section 1.2)
		}
	}

	// --- Registration Number ---
	const allRegs: string[] = [];
	const regRegex = /(?:num[aă]rul\s+de\s+[iî]nregistrare|nr\.?\s*(?:[iî]nregistrare|reg\.?\s*com\.?)|reg\.?\s*com\.?)\s*[:\-–]?\s*(J\s*\d[\d\s/]*\d)/gi;
	while ((m = regRegex.exec(text)) !== null) {
		allRegs.push(cleanValue(m[1]));
	}
	const clientReg = pickClientValue(allRegs, [tenant.registrationNumber]);
	if (clientReg) result.registrationNumber = clientReg;

	// --- Email ---
	const allEmails: string[] = [];
	const emailRegex = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
	while ((m = emailRegex.exec(text)) !== null) {
		allEmails.push(m[1].trim().toLowerCase());
	}
	const clientEmail = pickClientValue(allEmails, [tenant.email]);
	if (clientEmail) result.email = clientEmail;

	// --- Phone ---
	const allPhones: string[] = [];
	const phoneRegex = /(?:telefon|tel\.?)\s*[:\-–]?\s*(\+?\d[\d\s.\-()]{7,17}\d)/gi;
	while ((m = phoneRegex.exec(text)) !== null) {
		allPhones.push(cleanValue(m[1]));
	}
	const clientPhone = pickClientValue(allPhones, [tenant.phone]);
	if (clientPhone) result.phone = clientPhone;

	// --- IBAN (Romanian: RO + 2 digits + 4 letters + 16 alphanumeric = 24 chars) ---
	const allIbans: string[] = [];
	const ibanRegex = /(RO\s*\d{2}\s*[A-Z]{4}\s*(?:[A-Z0-9]\s*){16})/gi;
	while ((m = ibanRegex.exec(text)) !== null) {
		const cleaned = m[1].replace(/\s+/g, '').toUpperCase();
		if (cleaned.length === 24) {
			allIbans.push(cleaned);
		}
	}
	const clientIban = pickClientValue(allIbans, [tenant.iban, tenant.ibanEuro]);
	if (clientIban) result.iban = clientIban;

	// --- Bank Name ---
	const allBanks: string[] = [];
	const bankRegex = /(?:deschis[aă]?\s+la|banc[aă])\s*[:\-–]?\s*([A-Za-zÀ-ÿșțȘȚăâîĂÂÎ\s.\-]+?)(?:\s*[,;]|\s*\n|\s*(?:date\s+de|telefon|tel\.?|e[\s-]*mail|CUI|C\.?U\.?I|cod|reprezentat|sucursala|ag\.?|filiala))/gi;
	while ((m = bankRegex.exec(text)) !== null) {
		const bank = cleanValue(m[1]);
		if (bank.length >= 2) {
			allBanks.push(bank);
		}
	}
	const clientBank = pickClientValue(allBanks, [tenant.bankName]);
	if (clientBank) result.bankName = clientBank;

	// --- Legal Representative ---
	const allReprs: string[] = [];
	// Pattern: "reprezentată de [administratorul] Nume Prenume, cu funcția de..."
	const reprRegex1 = /reprezentat[aă]\s+de\s+(?:administratorul\s+|administrator\s+|dl\.?\s+|d-na\.?\s+)?([A-Za-zÀ-ÿșțȘȚăâîĂÂÎ\s.\-]+?)(?:\s*,\s*(?:cu\s+func[tț]ia|[iî]n\s+calitate))/gi;
	while ((m = reprRegex1.exec(text)) !== null) {
		const repr = cleanValue(m[1]);
		if (repr.length >= 3) allReprs.push(repr);
	}
	// Pattern: "Reprezentant legal: Nume" or "Administrator: Nume"
	const reprRegex2 = /(?:reprezentant\s+legal|administrator)\s*[:\-–]\s*([A-Za-zÀ-ÿșțȘȚăâîĂÂÎ\s.\-]+?)(?:\s*[,;]|\s*$|\s*\n)/gi;
	while ((m = reprRegex2.exec(text)) !== null) {
		const repr = cleanValue(m[1]);
		if (repr.length >= 3) allReprs.push(repr);
	}
	const clientRepr = pickClientValue(allReprs, [tenant.legalRepresentative]);
	if (clientRepr) result.legalRepresentative = clientRepr;

	// --- Address: extract street part after city name ---
	// Pattern: "cu sediul [social] în [municipiul] CityName, [Strada] Str. X nr. Y, Et. Z"
	const allAddresses: string[] = [];
	const addrRegex = /cu\s+sediul\s+(?:social\s+)?[iî]n\s+(?:municipiul\s+)?[A-Za-zÀ-ÿșțȘȚăâîĂÂÎ\-]+\s*,\s*(?:[Ss]trada\s+)?(.+?)(?:\s*,\s*(?:cod\s+po[sș]tal|av[aâ]nd|jude[tț]|jud\.?)|\s*\n)/gi;
	while ((m = addrRegex.exec(text)) !== null) {
		const addr = cleanValue(m[1]);
		if (addr.length >= 3) allAddresses.push(addr);
	}
	// Fallback: "Adresa: ..." or "Sediul social: ..."
	if (allAddresses.length === 0) {
		const addrFallback = /(?:adresa|sediul(?:\s+social)?)\s*[:\-–]?\s*(.+?)(?:\s*[,;]\s*(?:cod|jude[tț]|jud\.|av[aâ]nd)|\s*\n)/gi;
		while ((m = addrFallback.exec(text)) !== null) {
			const addr = cleanValue(m[1]);
			if (addr.length >= 3) allAddresses.push(addr);
		}
	}
	const clientAddr = pickClientValue(allAddresses, [tenant.address]);
	if (clientAddr) result.address = clientAddr;

	// --- City (from "cu sediul [social] în [municipiul] CityName, ...") ---
	const allCities: string[] = [];
	const cityRegex = /cu\s+sediul\s+(?:social\s+)?[iî]n\s+(?:municipiul\s+)?([A-Za-zÀ-ÿșțȘȚăâîĂÂÎ\s\-]+?)(?:\s*,)/gi;
	while ((m = cityRegex.exec(text)) !== null) {
		allCities.push(cleanValue(m[1]));
	}
	const clientCity = pickClientValue(allCities, [tenant.city]);
	if (clientCity) result.city = clientCity;

	// --- County ---
	const allCounties: string[] = [];
	const countyRegex = /(?:^|[\s,;.])(?:jude[tț](?:ul)?|jud\.?)\s*[:\-–]?\s*([A-Za-zÀ-ÿșțȘȚăâîĂÂÎ\s\-]+?)(?:\s*[,;]|\s*$|\s*\n)/gi;
	while ((m = countyRegex.exec(text)) !== null) {
		const county = cleanValue(m[1]);
		if (county.length >= 2 && county.length <= 30) allCounties.push(county);
	}
	const clientCounty = pickClientValue(allCounties, [tenant.county]);
	if (clientCounty) result.county = clientCounty;

	// --- Postal Code ---
	const allPostalCodes: string[] = [];
	const postalRegex = /cod\s+po[sș]tal\s*[:\-–]?\s*(\d{5,6})/gi;
	while ((m = postalRegex.exec(text)) !== null) {
		allPostalCodes.push(m[1].trim());
	}
	const clientPostal = pickClientValue(allPostalCodes, [tenant.postalCode]);
	if (clientPostal) result.postalCode = clientPostal;

	return result;
}
