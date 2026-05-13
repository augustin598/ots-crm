/**
 * Validator pentru Cod Unic de Înregistrare (CUI) românesc.
 *
 * Algoritm oficial ANAF: CUI = 2-10 cifre. Ultima cifră e check digit, calculat
 * peste primele 9 (sau N-1) cifre cu ponderi [7,5,3,2,1,7,5,3,2] (de la stânga).
 *
 *   sum = Σ (digit[i] * weight[i])
 *   check = (sum * 10) mod 11
 *   if check == 10 → check = 0
 *   check trebuie să fie egal cu ultima cifră
 *
 * Plătitorii de TVA prefixează CUI cu "RO" (ex: "RO12345678"). Validarea ignoră
 * prefixul. Stripe tax_id type 'eu_vat' cere format "RO<cifre>".
 *
 * Refs:
 *  - https://static.anaf.ro/static/10/Anaf/AsistentaContribuabili_r/Calcul_CUI.htm
 */

const WEIGHTS = [7, 5, 3, 2, 1, 7, 5, 3, 2];

/**
 * Curăță prefixul "RO" și spațiile dintr-un CUI. Nu validează — folosește
 * `isValidRomanianCui` pentru asta.
 */
export function normalizeCui(input: string): string {
	return input
		.trim()
		.toUpperCase()
		.replace(/^RO\s*/, '')
		.replace(/\s+/g, '');
}

/**
 * Verifică dacă un CUI românesc e valid algoritmic (check digit).
 *
 * Acceptă cu sau fără prefix "RO". Returnează `true` doar dacă:
 *  - Conține doar cifre după normalize
 *  - Are între 2 și 10 cifre
 *  - Check digit corect
 *
 * **Important**: validarea algoritmică NU înseamnă că CUI există realmente
 * la ANAF — doar că structura matematică e corectă. Pentru existență, apelează
 * `getCompanyData(cui)` din `anaf.remote.ts`.
 *
 * Algoritmul oficial ANAF cere ponderile aliniate la DREAPTA — cifrele body-ului
 * se aliniază cu sfârșitul vectorului `WEIGHTS`. Pentru un CUI cu N cifre (body
 * de N-1 cifre), folosim ultimele N-1 ponderi din vector.
 *
 * Verificare cu `39988493`:
 *  - body = [3,9,9,8,8,4,9] (7 cifre)
 *  - ponderi aliniate dreapta = [3,2,1,7,5,3,2]
 *  - sum = 9+18+9+56+40+12+18 = 162
 *  - (162*10) % 11 = 3 = ultima cifră ✓
 */
export function isValidRomanianCui(input: string | null | undefined): boolean {
	if (!input) return false;
	const cui = normalizeCui(input);
	if (!/^\d{2,10}$/.test(cui)) return false;

	const digits = cui.split('').map(Number);
	const checkDigit = digits[digits.length - 1];
	const body = digits.slice(0, -1);

	// Aliniere la DREAPTA: body[0] se aliniază cu WEIGHTS[len-bodyLen].
	const offset = WEIGHTS.length - body.length;
	if (offset < 0) return false; // body prea lung (CUI > 10 cifre)

	let sum = 0;
	for (let i = 0; i < body.length; i++) {
		sum += body[i] * WEIGHTS[offset + i];
	}
	let computed = (sum * 10) % 11;
	if (computed === 10) computed = 0;
	return computed === checkDigit;
}

/**
 * Convenience: validează și întoarce eroare descriptivă în RO.
 * Returnează `null` dacă CUI e valid, altfel mesajul de eroare.
 */
export function validateCuiOrReason(input: string | null | undefined): string | null {
	if (!input || !input.trim()) return 'CUI obligatoriu';
	const cui = normalizeCui(input);
	if (!/^\d+$/.test(cui)) return 'CUI trebuie să conțină doar cifre (cu sau fără prefixul RO)';
	if (cui.length < 2 || cui.length > 10) return 'CUI trebuie să aibă între 2 și 10 cifre';
	if (!isValidRomanianCui(cui)) return 'CUI invalid (eroare cifră de control)';
	return null;
}
