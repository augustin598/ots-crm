/**
 * Unitățile de măsură Keez (`measureUnitId`), într-un singur loc.
 *
 * Erau trei tabele paralele: mapper-ul (corect, după nomenclatorul Keez),
 * `hooks.ts` (avea `Hours: 2` și `Days: 3` — adică „Luna om" și „An"!) și
 * `auto-push.ts`, care crea orice articol nou cu `measureUnitId: 1`. Rezultatul:
 * linia de factură pleca pe „Ora", dar articolul din nomenclator rămânea „Buc",
 * iar rapoartele din Keez arătau bucăți acolo unde vindem ore.
 *
 * Id-urile sunt cele din nomenclatorul oficial Keez:
 * https://app.keez.ro/help/api/data_measure_unit.html (nu există endpoint API
 * care să-l listeze — e o listă fixă, verificată contra documentației de testul
 * `__tests__/keez-measure-units.test.ts`).
 *
 * Stă în `constants/`, nu sub `server/plugins/keez/`, fiindcă îl folosește și
 * editorul de linii de factură, care e cod de client.
 */

export const KEEZ_MEASURE_UNIT_IDS: Record<string, number> = {
	// Denumirile scurte din nomenclatorul Keez
	Buc: 1,
	'Luna om': 2,
	An: 3,
	Zi: 4,
	Ora: 5,
	Kg: 6,
	Km: 7,
	KWh: 8,
	KW: 9,
	M: 10,
	L: 11,
	Min: 12,
	Luna: 13,
	Mp: 14,
	Oz: 15,
	Per: 16,
	Trim: 17,
	T: 18,
	Sapt: 19,
	Mc: 20,
	Cutie: 22,
	Pag: 23,
	Rola: 24,
	Coala: 25,
	Tambur: 26,
	Set: 27,
	// Aliasuri EN folosite în CRM (facturi importate, linii vechi)
	Pcs: 1,
	'Man-month': 2,
	Year: 3,
	Day: 4,
	Days: 4,
	Hour: 5,
	Hours: 5,
	Month: 13,
	Months: 13
};

/**
 * Denumirile folosite în CRM pe `invoice_line_item.unit_of_measure`. Scrise o
 * singură dată: „Ora" pe ore, „Buc" pe restul — nu string-uri împrăștiate prin
 * cod, care se scriau și „Pcs", și „Buc", pentru același lucru.
 */
export const KEEZ_UNIT = {
	PIECE: 'Buc',
	HOUR: 'Ora',
	DAY: 'Zi',
	MONTH: 'Luna'
} as const;

/** Ce primește o linie fără unitate declarată. */
export const KEEZ_DEFAULT_MEASURE_UNIT_ID = 1; // Buc

/** Denumirea CRM (`invoice_line_item.unit_of_measure`) → id-ul Keez. */
export function keezMeasureUnitId(unitOfMeasure: string | null | undefined): number {
	if (!unitOfMeasure) return KEEZ_DEFAULT_MEASURE_UNIT_ID;
	return KEEZ_MEASURE_UNIT_IDS[unitOfMeasure.trim()] ?? KEEZ_DEFAULT_MEASURE_UNIT_ID;
}

/** Invers, pentru facturile citite din Keez; `null` la un id necunoscut. */
export function keezMeasureUnitName(measureUnitId: number): string | null {
	for (const [name, id] of Object.entries(KEEZ_MEASURE_UNIT_IDS)) {
		// Prima potrivire e denumirea canonică (aliasurile EN stau la coadă).
		if (id === measureUnitId) return name;
	}
	return null;
}
