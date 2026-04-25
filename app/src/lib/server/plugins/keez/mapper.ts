import type {
	Invoice,
	InvoiceLineItem,
	Client,
	Tenant,
	InvoiceSettings
} from '$lib/server/db/schema';
import * as table from '$lib/server/db/schema';
import { db } from '$lib/server/db';
import { eq, and, or } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getLatestBnrRate } from '$lib/server/bnr/client';
import { logWarning, logError, serializeError } from '$lib/server/logger';
import type {
	KeezInvoice,
	KeezInvoiceDetail,
	KeezPartner,
	KeezInvoiceResponse,
	KeezInvoiceHeader
} from './client';

/**
 * Convert CRM invoice to Keez invoice format
 * Conforms to Keez API documentation: https://app.keez.ro/help/api/data_models_invoice_details.html
 */
export async function mapInvoiceToKeez(
	invoice: Invoice & { lineItems: InvoiceLineItem[] },
	client: Client,
	tenant: Tenant,
	externalId?: string,
	settings?: InvoiceSettings | null,
	itemExternalIds?: Map<string, string> // Map of lineItem.id -> Keez itemExternalId
): Promise<KeezInvoice> {
	// Helper function to map Romanian county name to ISO code
	const mapRomanianCounty = (
		countyName: string | null | undefined,
		country: string | null | undefined
	): string | undefined => {
		if (
			!countyName ||
			!country ||
			(country.toUpperCase() !== 'ROMÂNIA' && country.toUpperCase() !== 'RO')
		) {
			return undefined;
		}

		const countyMap: Record<string, string> = {
			ALBA: 'RO-AB',
			ARAD: 'RO-AR',
			ARGEŞ: 'RO-AG',
			ARGES: 'RO-AG',
			BACĂU: 'RO-BC',
			BACAU: 'RO-BC',
			BIHOR: 'RO-BH',
			'BISTRIŢA-NĂSĂUD': 'RO-BN',
			'BISTRITA-NASĂUD': 'RO-BN',
			BOTOŞANI: 'RO-BT',
			BOTOSANI: 'RO-BT',
			BRĂILA: 'RO-BR',
			BRAILA: 'RO-BR',
			BRAŞOV: 'RO-BV',
			BRASOV: 'RO-BV',
			BUCUREŞTI: 'RO-B',
			BUCURESTI: 'RO-B',
			BUZĂU: 'RO-BZ',
			BUZAU: 'RO-BZ',
			CĂLĂRAŞI: 'RO-CL',
			CALARASI: 'RO-CL',
			'CARAŞ-SEVERIN': 'RO-CS',
			'CARAS-SEVERIN': 'RO-CS',
			CLUJ: 'RO-CJ',
			CONSTANŢA: 'RO-CT',
			CONSTANTA: 'RO-CT',
			COVASNA: 'RO-CV',
			DÂMBOVIŢA: 'RO-DB',
			DAMBOVITA: 'RO-DB',
			DOLJ: 'RO-DJ',
			GALAŢI: 'RO-GL',
			GALATI: 'RO-GL',
			GIURGIU: 'RO-GR',
			GORJ: 'RO-GJ',
			HARGHITA: 'RO-HR',
			HUNEDOARA: 'RO-HD',
			IALOMIŢA: 'RO-IL',
			IALOMITA: 'RO-IL',
			IAŞI: 'RO-IS',
			IASI: 'RO-IS',
			ILFOV: 'RO-IF',
			MARAMUREŞ: 'RO-MM',
			MARAMURES: 'RO-MM',
			MEHEDINŢI: 'RO-MH',
			MEHEDINTI: 'RO-MH',
			MUREŞ: 'RO-MS',
			MURES: 'RO-MS',
			NEAMŢ: 'RO-NT',
			NEAMT: 'RO-NT',
			OLT: 'RO-OT',
			PRAHOVA: 'RO-PH',
			SĂLAJ: 'RO-SJ',
			SALAJ: 'RO-SJ',
			'SATU MARE': 'RO-SM',
			SIBIU: 'RO-SB',
			SUCEAVA: 'RO-SV',
			TELEORMAN: 'RO-TR',
			TIMIŞ: 'RO-TM',
			TIMIS: 'RO-TM',
			TULCEA: 'RO-TL',
			VÂLCEA: 'RO-VL',
			VALCEA: 'RO-VL',
			VASLUI: 'RO-VS',
			VRANCEA: 'RO-VN'
		};

		const countyUpper = countyName.toUpperCase().trim();
		return countyMap[countyUpper] || undefined;
	};

	// Helper function to get county name from code
	const getCountyName = (countyCode: string | undefined): string | undefined => {
		if (!countyCode) return undefined;

		const countyNames: Record<string, string> = {
			'RO-AB': 'Alba',
			'RO-AR': 'Arad',
			'RO-AG': 'Argeș',
			'RO-BC': 'Bacău',
			'RO-BH': 'Bihor',
			'RO-BN': 'Bistrița-Năsăud',
			'RO-BT': 'Botoșani',
			'RO-BR': 'Brăila',
			'RO-BV': 'Brașov',
			'RO-B': 'București',
			'RO-BZ': 'Buzău',
			'RO-CL': 'Călărași',
			'RO-CS': 'Caraș-Severin',
			'RO-CJ': 'Cluj',
			'RO-CT': 'Constanța',
			'RO-CV': 'Covasna',
			'RO-DB': 'Dâmbovița',
			'RO-DJ': 'Dolj',
			'RO-GL': 'Galați',
			'RO-GR': 'Giurgiu',
			'RO-GJ': 'Gorj',
			'RO-HR': 'Harghita',
			'RO-HD': 'Hunedoara',
			'RO-IL': 'Ialomița',
			'RO-IS': 'Iași',
			'RO-IF': 'Ilfov',
			'RO-MM': 'Maramureș',
			'RO-MH': 'Mehedinți',
			'RO-MS': 'Mureș',
			'RO-NT': 'Neamț',
			'RO-OT': 'Olt',
			'RO-PH': 'Prahova',
			'RO-SJ': 'Sălaj',
			'RO-SM': 'Satu Mare',
			'RO-SB': 'Sibiu',
			'RO-SV': 'Suceava',
			'RO-TR': 'Teleorman',
			'RO-TM': 'Timiș',
			'RO-TL': 'Tulcea',
			'RO-VL': 'Vâlcea',
			'RO-VS': 'Vaslui',
			'RO-VN': 'Vrancea'
		};

		return countyNames[countyCode] || undefined;
	};

	// Map partner data according to Keez API format
	const countyCode = mapRomanianCounty(client.county, client.country);

	// Determine country code (ISO 3166-1 alpha-2) and name
	const clientCountry = client.country || 'România';
	const isRomania =
		clientCountry === 'România' ||
		clientCountry === 'RO' ||
		clientCountry.toUpperCase() === 'ROMANIA';

	// Map country name (RO/EN) to ISO 3166-1 alpha-2 code
	const mapCountryToISO = (country: string): string => {
		const upper = country.toUpperCase().trim();
		// Already an ISO code (2 letters)
		if (/^[A-Z]{2}$/.test(upper)) return upper;
		const countryISO: Record<string, string> = {
			// Romanian names
			'ROMÂNIA': 'RO', 'ROMANIA': 'RO',
			'AFGANISTAN': 'AF', 'ALBANIA': 'AL', 'ALGERIA': 'DZ', 'ANDORRA': 'AD', 'ANGOLA': 'AO',
			'ARGENTINA': 'AR', 'ARMENIA': 'AM', 'AUSTRALIA': 'AU', 'AUSTRIA': 'AT', 'AZERBAIDJAN': 'AZ',
			'BAHRAIN': 'BH', 'BANGLADESH': 'BD', 'BARBADOS': 'BB', 'BELARUS': 'BY',
			'BELGIA': 'BE', 'BELGIUM': 'BE', 'BELIZE': 'BZ', 'BENIN': 'BJ', 'BHUTAN': 'BT',
			'BOLIVIA': 'BO', 'BOSNIA ȘI HERȚEGOVINA': 'BA', 'BOSNIA SI HERTEGOVINA': 'BA', 'BOSNIA AND HERZEGOVINA': 'BA',
			'BOTSWANA': 'BW', 'BRAZILIA': 'BR', 'BRAZIL': 'BR', 'BRUNEI': 'BN',
			'BULGARIA': 'BG', 'BURKINA FASO': 'BF', 'BURUNDI': 'BI',
			'CAMBODGIA': 'KH', 'CAMBODIA': 'KH', 'CAMERUN': 'CM', 'CAMEROON': 'CM',
			'CANADA': 'CA', 'CAPUL VERDE': 'CV', 'CAPE VERDE': 'CV',
			'CEHIA': 'CZ', 'REPUBLICA CEHĂ': 'CZ', 'REPUBLICA CEHA': 'CZ', 'CZECH REPUBLIC': 'CZ', 'CZECHIA': 'CZ',
			'CHILE': 'CL', 'CHINA': 'CN', 'CIPRU': 'CY', 'CYPRUS': 'CY',
			'COLUMBIA': 'CO', 'COLOMBIA': 'CO', 'CONGO': 'CG',
			'COSTA RICA': 'CR', 'CROAȚIA': 'HR', 'CROATIA': 'HR', 'CUBA': 'CU',
			'DANEMARCA': 'DK', 'DENMARK': 'DK', 'DJIBOUTI': 'DJ', 'DOMINICA': 'DM',
			'REPUBLICA DOMINICANĂ': 'DO', 'REPUBLICA DOMINICANA': 'DO', 'DOMINICAN REPUBLIC': 'DO',
			'ECUADOR': 'EC', 'EGIPT': 'EG', 'EGYPT': 'EG', 'EL SALVADOR': 'SV',
			'ELVEȚIA': 'CH', 'ELVETIA': 'CH', 'SWITZERLAND': 'CH',
			'EMIRATELE ARABE UNITE': 'AE', 'UNITED ARAB EMIRATES': 'AE', 'UAE': 'AE',
			'ERITREEA': 'ER', 'ESTONIA': 'EE', 'ETIOPIA': 'ET', 'ETHIOPIA': 'ET',
			'FIJI': 'FJ', 'FILIPINE': 'PH', 'PHILIPPINES': 'PH',
			'FINLANDA': 'FI', 'FINLAND': 'FI',
			'FRANȚA': 'FR', 'FRANTA': 'FR', 'FRANCE': 'FR',
			'GABON': 'GA', 'GAMBIA': 'GM', 'GEORGIA': 'GE',
			'GERMANIA': 'DE', 'GERMANY': 'DE',
			'GHANA': 'GH', 'GRECIA': 'GR', 'GREECE': 'GR', 'GRENADA': 'GD',
			'GUATEMALA': 'GT', 'GUINEEA': 'GN', 'GUINEA': 'GN', 'GUYANA': 'GY',
			'HAITI': 'HT', 'HONDURAS': 'HN', 'HONG KONG': 'HK',
			'INDIA': 'IN', 'INDONEZIA': 'ID', 'INDONESIA': 'ID',
			'IRAN': 'IR', 'IRAK': 'IQ', 'IRAQ': 'IQ',
			'IRLANDA': 'IE', 'IRELAND': 'IE', 'ISLANDA': 'IS', 'ICELAND': 'IS',
			'ISRAEL': 'IL', 'ITALIA': 'IT', 'ITALY': 'IT',
			'JAMAICA': 'JM', 'JAPONIA': 'JP', 'JAPAN': 'JP', 'IORDANIA': 'JO', 'JORDAN': 'JO',
			'KAZAHSTAN': 'KZ', 'KAZAKHSTAN': 'KZ', 'KENYA': 'KE', 'KÎRGÎZSTAN': 'KG', 'KYRGYZSTAN': 'KG',
			'KOSOVO': 'XK', 'KUWAIT': 'KW',
			'LAOS': 'LA', 'LETONIA': 'LV', 'LATVIA': 'LV', 'LIBAN': 'LB', 'LEBANON': 'LB',
			'LIBERIA': 'LR', 'LIBIA': 'LY', 'LIBYA': 'LY',
			'LIECHTENSTEIN': 'LI', 'LITUANIA': 'LT', 'LITHUANIA': 'LT',
			'LUXEMBURG': 'LU', 'LUXEMBOURG': 'LU',
			'MACAO': 'MO', 'MACEDONIA': 'MK', 'MACEDONIA DE NORD': 'MK', 'NORTH MACEDONIA': 'MK',
			'MADAGASCAR': 'MG', 'MALAEZIA': 'MY', 'MALAYSIA': 'MY', 'MALDIVE': 'MV', 'MALDIVES': 'MV',
			'MALI': 'ML', 'MALTA': 'MT', 'MAROC': 'MA', 'MOROCCO': 'MA',
			'MAURITANIA': 'MR', 'MAURITIUS': 'MU',
			'MEXIC': 'MX', 'MEXICO': 'MX',
			'REPUBLICA MOLDOVA': 'MD', 'MOLDOVA': 'MD', 'MONACO': 'MC', 'MONGOLIA': 'MN',
			'MUNTENEGRU': 'ME', 'MONTENEGRO': 'ME', 'MOZAMBIC': 'MZ', 'MOZAMBIQUE': 'MZ', 'MYANMAR': 'MM',
			'NAMIBIA': 'NA', 'NEPAL': 'NP', 'NEW ZEALAND': 'NZ', 'NOUA ZEELANDĂ': 'NZ', 'NOUA ZEELANDA': 'NZ',
			'NICARAGUA': 'NI', 'NIGER': 'NE', 'NIGERIA': 'NG',
			'NORVEGIA': 'NO', 'NORWAY': 'NO',
			'OLANDA': 'NL', 'NETHERLANDS': 'NL', 'ȚĂRILE DE JOS': 'NL', 'TARILE DE JOS': 'NL',
			'OMAN': 'OM', 'PAKISTAN': 'PK', 'PANAMA': 'PA', 'PARAGUAY': 'PY', 'PERU': 'PE',
			'POLONIA': 'PL', 'POLAND': 'PL',
			'PORTUGALIA': 'PT', 'PORTUGAL': 'PT', 'QATAR': 'QA',
			'MAREA BRITANIE': 'GB', 'REGATUL UNIT': 'GB', 'UNITED KINGDOM': 'GB', 'UK': 'GB', 'GREAT BRITAIN': 'GB', 'ENGLAND': 'GB',
			'RUSIA': 'RU', 'RUSSIA': 'RU', 'RUSSIAN FEDERATION': 'RU', 'RWANDA': 'RW',
			'ARABIA SAUDITĂ': 'SA', 'ARABIA SAUDITA': 'SA', 'SAUDI ARABIA': 'SA',
			'SENEGAL': 'SN', 'SERBIA': 'RS', 'SINGAPORE': 'SG',
			'SIRIA': 'SY', 'SYRIA': 'SY',
			'SLOVACIA': 'SK', 'SLOVAKIA': 'SK', 'SLOVENIA': 'SI',
			'SOMALIA': 'SO', 'AFRICA DE SUD': 'ZA', 'SOUTH AFRICA': 'ZA',
			'COREEA DE SUD': 'KR', 'SOUTH KOREA': 'KR', 'KOREA': 'KR',
			'SPANIA': 'ES', 'SPAIN': 'ES', 'SRI LANKA': 'LK',
			'STATELE UNITE': 'US', 'STATELE UNITE ALE AMERICII': 'US', 'UNITED STATES': 'US', 'USA': 'US',
			'SUDAN': 'SD', 'SUEDIA': 'SE', 'SWEDEN': 'SE',
			'TAIWAN': 'TW', 'TANZANIA': 'TZ', 'THAILANDA': 'TH', 'THAILAND': 'TH',
			'TUNISIA': 'TN', 'TURCIA': 'TR', 'TURKEY': 'TR', 'TÜRKIYE': 'TR', 'TURKMENISTAN': 'TM',
			'UCRAINA': 'UA', 'UKRAINE': 'UA', 'UNGARIA': 'HU', 'HUNGARY': 'HU',
			'URUGUAY': 'UY', 'UZBEKISTAN': 'UZ',
			'VATICAN': 'VA', 'VENEZUELA': 'VE', 'VIETNAM': 'VN',
			'ZAMBIA': 'ZM', 'ZIMBABWE': 'ZW',
		};
		return countryISO[upper] || 'RO';
	};

	const countryCode = mapCountryToISO(clientCountry);
	const countryName = isRomania ? 'România' : clientCountry;

	// EU member state codes (for taxAttribute logic)
	const EU_COUNTRIES = new Set([
		'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
		'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
		'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
	]);

	// Determine taxAttribute per Keez docs:
	// - Romania + plătitor TVA (CUI starts with RO): 'RO'
	// - Romania + neplătitor TVA: undefined (empty)
	// - Non-Romania: undefined (CUI already contains country prefix like CY10399119V)
	const determineTaxAttribute = (): string | undefined => {
		const cui = (client.cui || '').trim().toUpperCase();
		const vatNum = (client.vatNumber || '').trim().toUpperCase();

		if (isRomania) {
			// Romanian client: RO prefix means VAT payer
			if (cui.startsWith('RO') || vatNum.startsWith('RO')) return 'RO';
			return undefined; // Non-VAT payer
		}

		// Non-Romanian: leave empty — CUI already has country prefix (e.g., CY10399119V)
		return undefined;
	};

	const partner: KeezPartner = {
		partnerName: client.name || 'Unknown Client', // Required field
		identificationNumber: client.cui || undefined,
		taxAttribute: determineTaxAttribute(),
		registrationNumber: client.registrationNumber || undefined,
		isLegalPerson: client.companyType !== null && client.companyType !== undefined, // Required field
		countryCode, // ISO 3166-1 alpha-2 (e.g., RO, CY, DE)
		countryName: countryName,
		countyCode: countyCode,
		countyName: isRomania ? (countyCode ? getCountyName(countyCode) : client.county || undefined) : undefined,
		cityName: client.city || undefined,
		addressDetails: client.address || undefined,
		postalCode: client.postalCode || undefined,
		email: client.email || undefined,
		phone: client.phone || undefined,
		legalRepresentative: client.legalRepresentative || undefined,
		iban: client.iban || undefined,
		bankName: client.bankName || undefined
	};

	// Get invoice currency for Keez currencyCode header
	const currency =
		invoice.invoiceCurrency || invoice.currency || settings?.defaultCurrency || 'RON';
	const isRON = currency === 'RON';

	// Parse exchange rate from string format "1,0000" or use default
	let exchangeRate = 1;
	if (invoice.exchangeRate) {
		const parsedRate = parseFloat(invoice.exchangeRate.replace(',', '.'));
		if (!isNaN(parsedRate) && parsedRate > 0) {
			exchangeRate = parsedRate;
		}
	}

	// Detect non-RON currencies in line items for referenceCurrencyCode
	const nonRONCurrencies = new Set(
		invoice.lineItems.map((item) => item.currency || currency).filter((c) => c !== 'RON')
	);
	const hasNonRONItems = nonRONCurrencies.size > 0;
	// referenceCurrencyCode = the calculation/reference currency (e.g., EUR when invoice is RON)
	// Keez requires this to know which currency the Currency-suffixed amounts represent
	const referenceCurrencyCode = hasNonRONItems ? [...nonRONCurrencies][0] : undefined;
	// exchangeRate is needed whenever any non-RON currency is involved
	const needsExchangeRate = hasNonRONItems || !isRON;
	// If all currencies are the same (e.g., EUR invoice with EUR items), no conversion needed
	const allSameCurrency = !isRON && nonRONCurrencies.size <= 1 && [...nonRONCurrencies][0] === currency;
	// Ensure we have a meaningful exchange rate when needed
	if (needsExchangeRate && exchangeRate <= 1 && !allSameCurrency) {
		// Try BNR rate from DB before using hardcoded fallback
		const targetCurrency = referenceCurrencyCode || (isRON ? 'EUR' : currency);
		const bnrRate = await getLatestBnrRate(targetCurrency);
		if (bnrRate) {
			exchangeRate = bnrRate;
		} else {
			logWarning('keez', `No BNR exchange rate for ${targetCurrency} — invoice amounts may be inaccurate`, {});
			exchangeRate = 1;
		}
	}

	// Map invoice details from line items - conform to Keez API format
	const details: KeezInvoiceDetail[] =
		invoice.lineItems.length > 0
			? invoice.lineItems.map((item) => {
					// Get item external ID from map or use item ID as fallback
					const itemExternalId =
						itemExternalIds?.get(item.id) || item.keezItemExternalId || item.id;

					// Use per-item tax rate if available, otherwise use invoice tax rate
					// If taxApplicationType is 'none', force VAT to 0
					const taxAppType = invoice.taxApplicationType || 'apply';
					const itemTaxRateCents = taxAppType === 'none' ? 0 : (item.taxRate ?? invoice.taxRate ?? 1900);
					const itemVatPercent = itemTaxRateCents / 100;

					// Use item currency if available, otherwise use invoice currency
					const itemCurrency = item.currency || currency;
					const itemIsRON = itemCurrency === 'RON';

					// Convert amounts from cents to decimal
					const unitPriceCents = item.rate;
					let amountCents = item.amount || item.rate * item.quantity;
					const quantity = item.quantity || 1;

					// Calculate item subtotal before discounts
					const itemSubtotalCents = item.rate * item.quantity;

					// Apply item-level discount if present
					let itemDiscountCents = 0;
					let itemDiscountType: 'Percent' | 'Value' | undefined;
					if (
						item.discountType &&
						item.discount !== null &&
						item.discount !== undefined &&
						item.discount > 0
					) {
						if (item.discountType === 'percent') {
							itemDiscountCents = Math.round((itemSubtotalCents * item.discount) / 100);
							itemDiscountType = 'Percent';
						} else if (item.discountType === 'fixed') {
							itemDiscountCents = Math.round(item.discount * 100); // Convert to cents
							itemDiscountType = 'Value';
						}
						// Update amount after discount
						amountCents = itemSubtotalCents - itemDiscountCents;
					}

					// item.rate is in CENTS in the ITEM's currency (EUR cents if item is EUR, RON bani if RON)
					// Keez requires: non-suffixed amounts = ALWAYS RON, Currency-suffixed = reference currency
					const itemPriceDecimal = unitPriceCents / 100; // Price in item's own currency
					const itemSubtotalDecimal = itemSubtotalCents / 100;
					const itemDiscountDecimal = itemDiscountCents / 100;
					const itemNetDecimal = amountCents / 100;

					// Calculate VAT in item's currency first
					const itemOriginalVat =
						Math.round(((itemSubtotalDecimal * itemVatPercent) / 100) * 100) / 100;
					const itemDiscountVat =
						Math.round(((itemDiscountDecimal * itemVatPercent) / 100) * 100) / 100;
					const itemNetVat =
						Math.round(((itemNetDecimal * itemVatPercent) / 100) * 100) / 100;
					const itemOriginalGross = itemSubtotalDecimal + itemOriginalVat;
					const itemNetGross = itemNetDecimal + itemNetVat;

					// Convert to RON (non-suffixed) and reference currency (Currency-suffixed)
					let unitPriceRON: number;
					let originalNetAmountRON: number;
					let discountNetValueRON: number;
					let netAmountRON: number;
					let originalVatAmountRON: number;
					let discountVatValueRON: number;
					let vatAmountRON: number;
					let originalGrossAmountRON: number;
					let grossAmountRON: number;

					let unitPriceCurrency: number | undefined;
					let originalNetAmountCurrency: number | undefined;
					let originalVatAmountCurrency: number | undefined;
					let originalGrossAmountCurrency: number | undefined;
					let discountNetValueCurrency: number | undefined;
					let discountVatValueCurrency: number | undefined;
					let netAmountCurrency: number | undefined;
					let vatAmountCurrency: number | undefined;
					let grossAmountCurrency: number | undefined;

					if (itemIsRON) {
						// Item is in RON — amounts are already in RON, no conversion needed
						unitPriceRON = itemPriceDecimal;
						originalNetAmountRON = itemSubtotalDecimal;
						discountNetValueRON = itemDiscountDecimal;
						netAmountRON = itemNetDecimal;
						originalVatAmountRON = itemOriginalVat;
						discountVatValueRON = itemDiscountVat;
						vatAmountRON = itemNetVat;
						originalGrossAmountRON = itemOriginalGross;
						grossAmountRON = itemNetGross;
						// Currency-suffixed = same as RON for RON items
						originalNetAmountCurrency = itemSubtotalDecimal;
						originalVatAmountCurrency = itemOriginalVat;
						originalGrossAmountCurrency = itemOriginalGross;
						discountNetValueCurrency =
							itemDiscountDecimal > 0 ? itemDiscountDecimal : undefined;
						discountVatValueCurrency =
							itemDiscountVat > 0 ? itemDiscountVat : undefined;
						netAmountCurrency = itemNetDecimal;
						vatAmountCurrency = itemNetVat;
						grossAmountCurrency = itemNetGross;
					} else {
						// Item is in non-RON currency (e.g., EUR)
						// Non-suffixed = RON (convert: EUR × exchangeRate)
						unitPriceRON =
							Math.round(itemPriceDecimal * exchangeRate * 10000) / 10000;
						originalNetAmountRON =
							Math.round(itemSubtotalDecimal * exchangeRate * 100) / 100;
						discountNetValueRON =
							Math.round(itemDiscountDecimal * exchangeRate * 100) / 100;
						netAmountRON =
							Math.round(itemNetDecimal * exchangeRate * 100) / 100;
						originalVatAmountRON =
							Math.round(itemOriginalVat * exchangeRate * 100) / 100;
						discountVatValueRON =
							Math.round(itemDiscountVat * exchangeRate * 100) / 100;
						vatAmountRON =
							Math.round(itemNetVat * exchangeRate * 100) / 100;
						originalGrossAmountRON =
							Math.round(itemOriginalGross * exchangeRate * 100) / 100;
						grossAmountRON =
							Math.round(itemNetGross * exchangeRate * 100) / 100;
						// Currency-suffixed = original item currency (EUR as-is)
						unitPriceCurrency = itemPriceDecimal;
						originalNetAmountCurrency = itemSubtotalDecimal;
						originalVatAmountCurrency = itemOriginalVat;
						originalGrossAmountCurrency = itemOriginalGross;
						discountNetValueCurrency =
							itemDiscountDecimal > 0 ? itemDiscountDecimal : undefined;
						discountVatValueCurrency =
							itemDiscountVat > 0 ? itemDiscountVat : undefined;
						netAmountCurrency = itemNetDecimal;
						vatAmountCurrency = itemNetVat;
						grossAmountCurrency = itemNetGross;
					}

					// Map unit of measure - Keez uses measureUnitId as integer (1 = Buc)
					let measureUnitId = 1; // Default to Buc
					if (item.unitOfMeasure) {
						const unitMap: Record<string, number> = {
							// Romanian shortNames (from Keez nomenclator)
							Buc: 1, 'Luna om': 2, An: 3, Zi: 4, Ora: 5, Kg: 6, Km: 7,
							KWh: 8, KW: 9, M: 10, L: 11, Min: 12, Luna: 13, Mp: 14,
							Oz: 15, Per: 16, Trim: 17, T: 18, Sapt: 19, Mc: 20,
							Cutie: 22, Pag: 23, Rola: 24, Coala: 25, Tambur: 26, Set: 27,
							// English aliases
							Pcs: 1, 'Man-month': 2, Year: 3, Day: 4, Hour: 5,
							Hours: 5, Days: 4, Month: 13, Months: 13
						};
						measureUnitId = unitMap[item.unitOfMeasure] || 1;
					}

					// itemDescription becomes the "Notă Articol" field on the Keez
					// invoice line. Use ONLY the line note (e.g. "Transaction ID: ...")
					// — keep it separate from the article name. The previous logic
					// concatenated description + note into the note field which was
					// confusing for users (note showed both the article name and the
					// transaction id).
					const itemDescription = item.note ? String(item.note).trim() : '';

					// NOTE: When itemExternalId is set, Keez ignores itemName and uses
					// the article name from its nomenclator. The auto-push helper
					// (plugins/keez/auto-push.ts) updates the article name in Keez
					// before sending the invoice if it has drifted from the CRM
					// line-item description, so by the time we get here the names
					// are aligned.
					const detail: KeezInvoiceDetail = {
						itemExternalId,
						itemName: item.description || 'Item',
						itemDescription: itemDescription !== '' ? itemDescription : undefined,
						measureUnitId,
						quantity: Math.round(quantity * 100) / 100, // 2 decimals
						unitPrice: Math.round(unitPriceRON * 10000) / 10000, // 4 decimals
						unitPriceCurrency: unitPriceCurrency
							? Math.round(unitPriceCurrency * 10000) / 10000
							: undefined,
						vatPercent: Math.round(itemVatPercent * 100) / 100, // 2 decimals
						discountType: itemDiscountType,
						discountPercent:
							itemDiscountType === 'Percent' && item.discount
								? Math.round(item.discount * 100) / 100
								: undefined,
						originalNetAmount: Math.round(originalNetAmountRON * 100) / 100, // 2 decimals
						originalVatAmount: Math.round(originalVatAmountRON * 100) / 100, // 2 decimals
						discountNetValue:
							discountNetValueRON > 0 ? Math.round(discountNetValueRON * 100) / 100 : undefined,
						discountVatValue:
							discountVatValueRON > 0 ? Math.round(discountVatValueRON * 100) / 100 : undefined,
						netAmount: Math.round(netAmountRON * 100) / 100, // 2 decimals
						vatAmount: Math.round(vatAmountRON * 100) / 100, // 2 decimals
						grossAmount: Math.round(grossAmountRON * 100) / 100, // 2 decimals
						originalNetAmountCurrency: originalNetAmountCurrency
							? Math.round(originalNetAmountCurrency * 100) / 100
							: undefined,
						originalVatAmountCurrency: originalVatAmountCurrency
							? Math.round(originalVatAmountCurrency * 100) / 100
							: undefined,
						discountNetValueCurrency: discountNetValueCurrency
							? Math.round(discountNetValueCurrency * 100) / 100
							: undefined,
						discountVatValueCurrency: discountVatValueCurrency
							? Math.round(discountVatValueCurrency * 100) / 100
							: undefined,
						netAmountCurrency: netAmountCurrency
							? Math.round(netAmountCurrency * 100) / 100
							: undefined,
						vatAmountCurrency: vatAmountCurrency
							? Math.round(vatAmountCurrency * 100) / 100
							: undefined,
						grossAmountCurrency: grossAmountCurrency
							? Math.round(grossAmountCurrency * 100) / 100
							: undefined
					};

					return detail;
				})
			: (() => {
					// If no line items, create a generic one from invoice totals
					const fallbackVatPercent = (invoice.taxRate ?? 1900) / 100;
					const fallbackNetRON = Math.round(((invoice.amount || 0) / 100) * 100) / 100;
					const fallbackVatRON = Math.round(((invoice.taxAmount || 0) / 100) * 100) / 100;
					const fallbackGrossRON = Math.round(((invoice.totalAmount || 0) / 100) * 100) / 100;
					const fallbackNetCurrency = isRON
						? fallbackNetRON
						: Math.round((fallbackNetRON / exchangeRate) * 100) / 100;
					const fallbackVatCurrency = isRON
						? fallbackVatRON
						: Math.round((fallbackVatRON / exchangeRate) * 100) / 100;
					const fallbackGrossCurrency = isRON
						? fallbackGrossRON
						: Math.round((fallbackGrossRON / exchangeRate) * 100) / 100;
					return [
						{
							itemExternalId: invoice.id,
							itemName: 'Invoice Total',
							itemDescription: invoice.notes || undefined,
							measureUnitId: 1,
							quantity: 1,
							unitPrice: Math.round(fallbackNetRON * 10000) / 10000,
							unitPriceCurrency: !isRON ? Math.round(fallbackNetCurrency * 10000) / 10000 : undefined,
							vatPercent: Math.round(fallbackVatPercent * 100) / 100,
							originalNetAmount: fallbackNetRON,
							originalVatAmount: fallbackVatRON,
							netAmount: fallbackNetRON,
							vatAmount: fallbackVatRON,
							grossAmount: fallbackGrossRON,
							originalNetAmountCurrency: fallbackNetCurrency,
							originalVatAmountCurrency: fallbackVatCurrency,
							netAmountCurrency: fallbackNetCurrency,
							vatAmountCurrency: fallbackVatCurrency,
							grossAmountCurrency: fallbackGrossCurrency
						}
					];
				})();

	// Format dates to YYYYMMDD as integer (Keez API requires integer format, e.g., 20190102)
	const formatDateYYYYMMDD = (date: Date | null | undefined): number => {
		if (!date) {
			const today = new Date();
			return parseInt(
				today.getFullYear().toString() +
				(today.getMonth() + 1).toString().padStart(2, '0') +
				today.getDate().toString().padStart(2, '0'),
				10
			);
		}
		const d = date instanceof Date ? date : new Date(date);
		return parseInt(
			d.getFullYear().toString() +
			(d.getMonth() + 1).toString().padStart(2, '0') +
			d.getDate().toString().padStart(2, '0'),
			10
		);
	};

	// Extract invoice number and series
	let series: string | undefined;
	let number: number | undefined;

	if (settings?.keezSeries) {
		series = settings.keezSeries.trim();
		// Extract number from invoiceNumber (e.g., "OTS 520" -> 520)
		if (invoice.invoiceNumber) {
			const match = invoice.invoiceNumber.match(/(\d+)$/);
			if (match) {
				number = parseInt(match[1], 10);
			} else if (settings.keezStartNumber) {
				number = parseInt(settings.keezStartNumber, 10) || undefined;
			}
		} else if (settings.keezStartNumber) {
			number = parseInt(settings.keezStartNumber, 10) || undefined;
		}
	}

	// Handle invoice-level discounts
	let invoiceDiscountType: 'Percent' | 'Value' | undefined;
	let invoiceDiscountPercent: number | undefined;
	let invoiceDiscountValue: number | undefined;

	if (
		invoice.discountType &&
		invoice.discountType !== 'none' &&
		invoice.discountValue !== null &&
		invoice.discountValue !== undefined
	) {
		if (invoice.discountType === 'percent') {
			invoiceDiscountType = 'Percent';
			// discountValue is stored in basis points (e.g., 1500 = 15%), convert to percentage
			invoiceDiscountPercent = invoice.discountValue / 100;
		} else if (invoice.discountType === 'value') {
			invoiceDiscountType = 'Value';
			// discountValue is stored in cents, convert to RON
			invoiceDiscountValue = invoice.discountValue / 100;
		}
	}

	// Calculate invoice-level totals from details (required by Keez API)
	const invoiceTotalNetRON = Math.round(details.reduce((s, d) => s + d.netAmount, 0) * 100) / 100;
	const invoiceTotalVatRON = Math.round(details.reduce((s, d) => s + d.vatAmount, 0) * 100) / 100;
	const invoiceTotalGrossRON = Math.round(details.reduce((s, d) => s + d.grossAmount, 0) * 100) / 100;
	const invoiceTotalNetCurrency = Math.round(details.reduce((s, d) => s + (d.netAmountCurrency ?? d.netAmount), 0) * 100) / 100;
	const invoiceTotalVatCurrency = Math.round(details.reduce((s, d) => s + (d.vatAmountCurrency ?? d.vatAmount), 0) * 100) / 100;
	const invoiceTotalGrossCurrency = Math.round(details.reduce((s, d) => s + (d.grossAmountCurrency ?? d.grossAmount), 0) * 100) / 100;

	// Map CRM paymentMethod to Keez paymentTypeId
	// Keez payment types: 1=BFCash, 2=BFCard, 3=Bank, 4=ChitCash, 5=Ramburs, 6=ProcesatorPlati, 7=PlatformaDistributie, 8=VoucherVacantaCard, 9=VoucherVacantaTichet
	const settingsDefaultPaymentTypeId = settings?.keezDefaultPaymentTypeId ?? 3;
	const mapPaymentTypeId = (paymentMethod: string | null | undefined): number => {
		if (!paymentMethod) return settingsDefaultPaymentTypeId;
		const pm = paymentMethod.toLowerCase().trim();
		// Exact Keez code matches
		if (pm === 'bfcash') return 1;
		if (pm === 'bfcard') return 2;
		if (pm === 'chitcash' || pm === 'chitantacash') return 4;
		if (pm === 'ramburs') return 5;
		if (pm === 'procesatorplati') return 6;
		if (pm === 'platformadistributie') return 7;
		if (pm === 'vouchervacantacard') return 8;
		if (pm === 'vouchervacantatichet') return 9;
		// Fuzzy matches for legacy/external values
		if (pm.includes('bank') || pm.includes('transfer') || pm.includes('virament')) return 3;
		if (pm.includes('card')) return 2;
		if (pm.includes('chitanta') || pm.includes('chit')) return 4;
		if (pm.includes('numerar') || pm.includes('cash')) return 4;
		if (pm.includes('payu') || pm.includes('netopia') || pm.includes('euplatesc') || pm.includes('online')) return 6;
		if (pm.includes('emag') || pm.includes('platforma')) return 7;
		return 3; // Default: Bank Transfer
	};

	const keezInvoice: KeezInvoice = {
		externalId,
		series,
		number,
		partner,
		documentDate: formatDateYYYYMMDD(invoice.issueDate),
		issueDate: formatDateYYYYMMDD(invoice.issueDate),
		dueDate: formatDateYYYYMMDD(invoice.dueDate),
		deliveryDate: formatDateYYYYMMDD(invoice.issueDate),
		currencyCode: currency,
		currency: currency,
		referenceCurrencyCode: referenceCurrencyCode,
		exchangeRate: needsExchangeRate ? Math.round(exchangeRate * 10000) / 10000 : undefined,
		vatOnCollection: invoice.vatOnCollection || false,
		paymentTypeId: mapPaymentTypeId(invoice.paymentMethod),
		discountType: invoiceDiscountType,
		discountPercent: invoiceDiscountPercent,
		discountValue: invoiceDiscountValue,
		originalNetAmount: invoiceTotalNetRON,
		originalVatAmount: invoiceTotalVatRON,
		originalNetAmountCurrency: invoiceTotalNetCurrency,
		originalVatAmountCurrency: invoiceTotalVatCurrency,
		netAmount: invoiceTotalNetRON,
		vatAmount: invoiceTotalVatRON,
		grossAmount: invoiceTotalGrossRON,
		netAmountCurrency: invoiceTotalNetCurrency,
		vatAmountCurrency: invoiceTotalVatCurrency,
		grossAmountCurrency: invoiceTotalGrossCurrency,
		invoiceDetails: details,
		notes: invoice.notes || undefined
	};

	return keezInvoice;
}

/**
 * Convert Keez invoice to CRM invoice data
 */
export function mapKeezInvoiceToCRM(
	keezInvoice: KeezInvoice,
	keezHeader: KeezInvoiceHeader,
	tenantId: string,
	clientId: string | null,
	userId: string
): Partial<Invoice> {
	// Calculate amounts from Keez
	// For EUR invoices, Keez may return amounts in EUR (not RON) from the list endpoint
	// Only if detail-level has netAmountCurrency can we get RON amounts
	const invoiceCurrencyCode = keezInvoice.currencyCode || keezInvoice.currency || keezHeader.currencyCode || keezHeader.currency;
	const hasRealExchangeRate = keezInvoice.exchangeRate && keezInvoice.exchangeRate > 1;
	const isNonRonInvoice = invoiceCurrencyCode && invoiceCurrencyCode !== 'RON';
	const detailHasRonBreakdown = !!keezInvoice.invoiceDetails?.[0]?.netAmountCurrency;

	let amount = 0;
	let taxAmount = 0;
	let totalAmount = 0;

	if (isNonRonInvoice && detailHasRonBreakdown) {
		// EUR invoice with detail-level RON breakdown — use netAmount (RON)
		for (const detail of keezInvoice.invoiceDetails) {
			const detailAmount = detail.netAmount || detail.unitPrice * detail.quantity;
			amount += detailAmount;
			if (detail.vatAmount) {
				taxAmount += detail.vatAmount;
			} else if (detail.vatPercent) {
				taxAmount += detailAmount * (detail.vatPercent / 100);
			}
		}
	} else if (keezHeader.grossAmount && keezHeader.grossAmount > 0) {
		// Header-level amounts (may be EUR for non-RON invoices without breakdown)
		amount = keezHeader.netAmount ?? 0;
		taxAmount = keezHeader.vatAmount ?? 0;
		totalAmount = keezHeader.grossAmount;
	} else {
		// Fallback to detail-level amounts
		for (const detail of keezInvoice.invoiceDetails) {
			const detailAmount = detail.netAmount || detail.unitPrice * detail.quantity;
			amount += detailAmount;

			if (detail.vatAmount) {
				taxAmount += detail.vatAmount;
			} else if (detail.vatPercent) {
				taxAmount += detailAmount * (detail.vatPercent / 100);
			}
		}
		totalAmount = amount + taxAmount;
	}

	// Convert to cents
	amount = Math.round(amount * 100);
	taxAmount = Math.round(taxAmount * 100);
	totalAmount = Math.round(totalAmount * 100);

	// Determine tax rate (use first detail's tax rate or default to 19%)
	const firstVat = keezInvoice.invoiceDetails[0]?.vatPercent;
	const taxRate = firstVat !== undefined && firstVat !== null
		? Math.round(firstVat * 100)
		: 1900;

	// Parse dates
	// Keez API returns dates in YYYYMMDD format as numbers (e.g., 20260112 = 2026-01-12)
	const parseDate = (dateValue: string | number | undefined): Date | null => {
		if (dateValue === null || dateValue === undefined) {
			return null;
		}

		try {
			// Handle numeric format (YYYYMMDD) from Keez API
			if (typeof dateValue === 'number') {
				const dateNum = dateValue;
				// Check if it's a valid YYYYMMDD format (8 digits)
				if (dateNum >= 10000101 && dateNum <= 99991231) {
					const dateStr = String(dateNum);
					const year = parseInt(dateStr.substring(0, 4), 10);
					const month = parseInt(dateStr.substring(4, 6), 10) - 1; // Month is 0-indexed
					const day = parseInt(dateStr.substring(6, 8), 10);

					const date = new Date(year, month, day);
					if (!isNaN(date.getTime()) && date.getFullYear() === year) {
						return date;
					}
				}
				return null;
			}

			// Handle string format
			const dateStrTrimmed = String(dateValue).trim();
			if (
				!dateStrTrimmed ||
				dateStrTrimmed === 'null' ||
				dateStrTrimmed === 'undefined' ||
				dateStrTrimmed === '0000-00-00'
			) {
				return null;
			}

			const date = new Date(dateStrTrimmed);
			// Check if date is valid and not epoch (1970-01-01)
			if (!isNaN(date.getTime()) && date.getFullYear() > 1970) {
				return date;
			}
			return null;
		} catch (error) {
			const parseErr = serializeError(error);
			logError('keez', `Mapper parseDate error: ${parseErr.message}`, { metadata: { dateValue } });
			return null;
		}
	};

	// Use documentDate from header if issueDate is not available in invoice
	// documentDate is the field used in invoice list according to Keez documentation
	// Try multiple sources: header documentDate, header issueDate, invoice issueDate
	const issueDateSource = keezHeader.documentDate || keezHeader.issueDate || keezInvoice.issueDate;
	const issueDate = parseDate(issueDateSource);

	// Use dueDate from header if not available in invoice
	const dueDateSource = keezHeader.dueDate || keezInvoice.dueDate;
	const dueDate = parseDate(dueDateSource);

	// Log warnings only if dates are missing when sources exist
	if (!issueDate && issueDateSource) {
		logWarning('keez', `Mapper could not parse issueDate`, { metadata: { source: issueDateSource, type: typeof issueDateSource } });
	}
	if (!dueDate && dueDateSource) {
		logWarning('keez', `Mapper could not parse dueDate`, { metadata: { source: dueDateSource, type: typeof dueDateSource } });
	}

	// Determine status based on Keez status + remainingAmount
	const keezStatus = keezHeader.status || keezInvoice.status;
	let invoiceStatus: 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled' = 'sent';
	let remainingAmountCents: number | null = null;

	if (keezStatus === 'Cancelled') {
		invoiceStatus = 'cancelled';
	} else if (keezStatus === 'Draft') {
		// Proforma — keep as draft, do NOT mark as paid
		invoiceStatus = 'draft';
	} else if (keezStatus === 'Valid') {
		// Validated fiscal invoice — check remainingAmount for payment status
		if (keezHeader.remainingAmount !== undefined) {
			remainingAmountCents = Math.round(keezHeader.remainingAmount * 100);
			if (remainingAmountCents === 0) {
				invoiceStatus = 'paid';
			} else if (remainingAmountCents > 0 && remainingAmountCents < totalAmount) {
				invoiceStatus = 'partially_paid';
			} else if (remainingAmountCents > 0) {
				if (dueDate && dueDate < new Date()) {
					invoiceStatus = 'overdue';
				} else {
					invoiceStatus = 'sent';
				}
			}
		} else {
			invoiceStatus = 'sent';
		}
	} else {
		// Unknown status — fallback
		if (keezHeader.remainingAmount !== undefined) {
			remainingAmountCents = Math.round(keezHeader.remainingAmount * 100);
			if (remainingAmountCents === 0 && keezStatus) {
				invoiceStatus = 'paid';
			} else if (remainingAmountCents > 0 && remainingAmountCents < totalAmount) {
				invoiceStatus = 'partially_paid';
			} else if (remainingAmountCents > 0) {
				if (dueDate && dueDate < new Date()) {
					invoiceStatus = 'overdue';
				} else {
					invoiceStatus = 'sent';
				}
			}
		}
	}

	return {
		tenantId,
		clientId: clientId || '',
		invoiceNumber: keezHeader.series && keezHeader.number
			? `${keezHeader.series} ${keezHeader.number}`
			: keezHeader.number ? String(keezHeader.number) : keezHeader.externalId,
		status: invoiceStatus,
		remainingAmount: remainingAmountCents,
		amount,
		taxRate,
		taxAmount,
		totalAmount,
		issueDate,
		dueDate,
		currency: (() => {
			if (isNonRonInvoice) {
				// If we have RON amounts (real exchange rate or detail breakdown), store as RON
				if (hasRealExchangeRate || detailHasRonBreakdown) return 'RON';
				// Otherwise amounts are in foreign currency
				return invoiceCurrencyCode;
			}
			return 'RON';
		})(),
		invoiceCurrency: (() => {
			if (isNonRonInvoice && (hasRealExchangeRate || detailHasRonBreakdown)) {
				return invoiceCurrencyCode;
			}
			return undefined;
		})(),
		exchangeRate: (() => {
			if (isNonRonInvoice && (hasRealExchangeRate || detailHasRonBreakdown) && keezInvoice.exchangeRate) {
				return String(keezInvoice.exchangeRate);
			}
			return undefined;
		})(),
		notes: keezInvoice.notes || undefined,
		keezStatus: keezStatus || null,
		keezInvoiceId: keezHeader.externalId || null,
		keezExternalId: keezHeader.externalId || null,
		createdByUserId: userId
	};
}

/**
 * Convert Keez partner to CRM client
 */
export function mapKeezPartnerToClient(
	keezPartner: KeezPartner,
	tenantId: string
): Omit<Client, 'id' | 'createdAt' | 'updatedAt'> {
	return {
		tenantId,
		name: keezPartner.partnerName,
		businessName: keezPartner.partnerName,
		status: 'active',
		companyType: keezPartner.isLegalPerson ? 'SRL' : null, // Default to SRL for legal entities
		cui: keezPartner.identificationNumber || null,
		vatNumber: keezPartner.taxAttribute && keezPartner.identificationNumber
			? `${keezPartner.taxAttribute}${keezPartner.identificationNumber}`
			: keezPartner.taxAttribute || null,
		registrationNumber: keezPartner.registrationNumber || null,
		tradeRegister: null,
		address: keezPartner.addressDetails || null,
		city: keezPartner.cityName || null,
		county: keezPartner.countyName || null,
		postalCode: keezPartner.postalCode || null,
		country: keezPartner.countryName || 'România',
		email: keezPartner.email || null,
		phone: keezPartner.phone || null,
		legalRepresentative: keezPartner.legalRepresentative || null,
		iban: keezPartner.iban || null,
		bankName: keezPartner.bankName || null,
		keezPartnerId: keezPartner.partnerName || null,
		website: null,
		notes: null,
		googleAdsCustomerId: null,
		restrictedAccess: null,
		monthlyBudget: null,
		budgetWarningThreshold: null,
		avatarPath: null,
		avatarSource: 'whatsapp',
		whmcsClientId: null
	};
}

/**
 * Convert CRM client to Keez partner format
 */
export function mapClientToKeezPartner(client: Client): KeezPartner {
	return {
		partnerName: client.businessName || client.name,
		taxAttribute: client.vatNumber || client.cui || undefined,
		registrationNumber: client.registrationNumber || undefined,
		addressDetails: client.address || undefined,
		cityName: client.city || undefined,
		countyName: client.county || undefined,
		postalCode: client.postalCode || undefined,
		countryName: client.country || 'România',
		email: client.email || undefined,
		phone: client.phone || undefined,
		isLegalPerson: !!client.companyType && !['PF', 'Persoana Fizica'].includes(client.companyType),
		legalRepresentative: client.legalRepresentative || undefined,
		iban: client.iban || undefined,
		bankName: client.bankName || undefined
	};
}

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Find an existing CRM client matching a Keez partner, or create a new one.
 * Matching priority: CUI → VAT number → Name → Create new
 */
export async function findOrCreateClientForKeezPartner(
	partner: KeezPartner,
	tenantId: string
): Promise<string | null> {
	const cui = partner.identificationNumber?.trim() || '';
	const partnerName = partner.partnerName?.trim() || '';

	if (!cui && !partnerName) {
		return null;
	}

	// 1. Match by CUI (most reliable)
	if (cui) {
		const [byCui] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.tenantId, tenantId), eq(table.client.cui, cui)))
			.limit(1);

		if (byCui) {
			// Backfill missing fields
			const updates: Record<string, any> = {};
			if (!byCui.businessName && partnerName) updates.businessName = partnerName;
			if (!byCui.address && partner.addressDetails) updates.address = partner.addressDetails;
			if (!byCui.email && partner.email) updates.email = partner.email;
			if (!byCui.phone && partner.phone) updates.phone = partner.phone;
			if (!byCui.registrationNumber && partner.registrationNumber)
				updates.registrationNumber = partner.registrationNumber;
			if (Object.keys(updates).length > 0) {
				updates.updatedAt = new Date();
				await db.update(table.client).set(updates).where(eq(table.client.id, byCui.id));
			}
			return byCui.id;
		}

		// 2. Match by VAT number (RO + CUI)
		if (partner.taxAttribute) {
			const fullVat = (partner.taxAttribute + cui).trim();
			const [byVat] = await db
				.select()
				.from(table.client)
				.where(and(eq(table.client.tenantId, tenantId), eq(table.client.vatNumber, fullVat)))
				.limit(1);

			if (byVat) {
				const updates: Record<string, any> = {};
				if (!byVat.cui) updates.cui = cui;
				if (!byVat.businessName && partnerName) updates.businessName = partnerName;
				if (Object.keys(updates).length > 0) {
					updates.updatedAt = new Date();
					await db.update(table.client).set(updates).where(eq(table.client.id, byVat.id));
				}
				return byVat.id;
			}
		}
	}

	// 3. Fallback to name matching
	if (partnerName) {
		const [byName] = await db
			.select()
			.from(table.client)
			.where(
				and(
					eq(table.client.tenantId, tenantId),
					or(eq(table.client.name, partnerName), eq(table.client.businessName, partnerName))
				)
			)
			.limit(1);

		if (byName) {
			// Backfill CUI and other missing fields
			const updates: Record<string, any> = {};
			if (!byName.cui && cui) updates.cui = cui;
			if (!byName.vatNumber && partner.taxAttribute && cui)
				updates.vatNumber = (partner.taxAttribute + cui).trim();
			if (!byName.registrationNumber && partner.registrationNumber)
				updates.registrationNumber = partner.registrationNumber;
			if (!byName.address && partner.addressDetails) updates.address = partner.addressDetails;
			if (!byName.city && partner.cityName) updates.city = partner.cityName;
			if (!byName.county && partner.countyName) updates.county = partner.countyName;
			if (!byName.email && partner.email) updates.email = partner.email;
			if (!byName.phone && partner.phone) updates.phone = partner.phone;
			if (Object.keys(updates).length > 0) {
				updates.updatedAt = new Date();
				await db.update(table.client).set(updates).where(eq(table.client.id, byName.id));
			}
			return byName.id;
		}
	}

	// 4. No match — create new client
	const newClientId = generateId();
	const clientData = mapKeezPartnerToClient(partner, tenantId);
	await db.insert(table.client).values({ id: newClientId, ...clientData });
	return newClientId;
}

/**
 * Convert Keez invoice details to CRM invoice line items
 */
export function mapKeezDetailsToLineItems(
	details: KeezInvoiceDetail[],
	invoiceId: string
): Array<Omit<InvoiceLineItem, 'id' | 'createdAt'>> {
	return details.map((detail) => {
		// Use itemName as primary source (Keez API uses this), fallback to itemDescription
		const description = detail.itemName || detail.itemDescription || 'Item';

		// Calculate amount: prefer RON amounts (netAmount) over foreign currency (netAmountCurrency)
		// netAmount = always RON, netAmountCurrency = foreign currency (e.g. EUR)
		let amount: number;
		if (detail.netAmount !== undefined && detail.netAmount !== null) {
			amount = detail.netAmount;
		} else if (detail.netAmountCurrency !== undefined && detail.netAmountCurrency !== null) {
			amount = detail.netAmountCurrency;
		} else {
			// Fallback: calculate from unitPrice * quantity
			amount = (detail.unitPrice || 0) * (detail.quantity || 1);
		}

		// Use unitPrice (RON) first, fallback to unitPriceCurrency (foreign currency)
		const unitPrice =
			detail.unitPrice !== undefined && detail.unitPrice !== null
				? detail.unitPrice
				: detail.unitPriceCurrency || 0;

		// Extract tax rate from vatPercent (convert from percentage to cents: 19 -> 1900)
		const taxRate = detail.vatPercent !== undefined && detail.vatPercent !== null
			? Math.round(detail.vatPercent * 100) : null;

		// Extract discount information
		let discountType: string | null = null;
		let discount: number | null = null;
		if (detail.discountType) {
			discountType = detail.discountType === 'Percent' ? 'percent' : 'fixed';
			if (detail.discountPercent !== undefined) {
				discount = detail.discountPercent;
			} else if (detail.discountNetValue !== undefined && detail.originalNetAmount && detail.originalNetAmount > 0) {
				// Calculate discount percentage from discount value
				discount = (detail.discountNetValue / detail.originalNetAmount) * 100;
			}
		}

		// Map unit of measure - reverse mapping from Keez measureUnitId (integer)
		const unitMap: Record<number, string> = {
			1: 'Buc', 2: 'Luna om', 3: 'An', 4: 'Zi', 5: 'Ora', 6: 'Kg', 7: 'Km',
			8: 'KWh', 9: 'KW', 10: 'M', 11: 'L', 12: 'Min', 13: 'Luna', 14: 'Mp',
			15: 'Oz', 16: 'Per', 17: 'Trim', 18: 'T', 19: 'Sapt', 20: 'Mc',
			22: 'Cutie', 23: 'Pag', 24: 'Rola', 25: 'Coala', 26: 'Tambur', 27: 'Set'
		};
		const unitOfMeasure = unitMap[detail.measureUnitId] || null;

		// Extract note from itemDescription if it's different from itemName
		const note =
			detail.itemDescription && detail.itemDescription !== detail.itemName
				? detail.itemDescription.replace(detail.itemName, '').replace(/^[\s-]+/, '')
				: null;

		return {
			invoiceId,
			serviceId: null,
			description,
			quantity: detail.quantity || 1,
			rate: Math.round(unitPrice * 100), // Convert to cents
			amount: Math.round(amount * 100), // Convert to cents
			taxRate,
			discountType,
			discount: discount ? Math.round(discount * 100) : null, // Convert to cents if fixed, or keep as percentage
			note,
			currency: null, // Currency is at invoice level
			unitOfMeasure,
			keezItemExternalId: detail.itemExternalId || null
		};
	});
}

/**
 * Generate next invoice number by incrementing the last synced number
 */
export function generateNextInvoiceNumber(lastNumber: string | null | undefined): string {
	if (!lastNumber) {
		return '0001';
	}

	// Extract numeric part
	const match = lastNumber.match(/(\d+)$/);
	if (!match) {
		return '0001';
	}

	const num = parseInt(match[1], 10);
	const nextNum = num + 1;

	// Preserve leading zeros
	const padding = match[1].length;
	return nextNum.toString().padStart(padding, '0');
}
