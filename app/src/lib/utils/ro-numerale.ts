/**
 * Acordul numeralului cu substantivul, în română.
 *
 * Norma: de la 20 în sus se pune „de" („40 de participanți"), în afară de
 * compusele care se termină în 1–19 („202 persoane", „1203 membri"). Decide
 * ultimele două cifre: 0 sau 20–99 cer „de", 1–19 nu.
 */
export function needsDe(n: number): boolean {
	const abs = Math.abs(Math.trunc(n));
	if (abs < 20) return false;
	const lastTwo = abs % 100;
	return lastTwo === 0 || lastTwo >= 20;
}

/**
 * „1 membru", „7 membri", „1267 de membri".
 * `singular` și `plural` sunt formele substantivului, fără număr.
 */
export function numarSi(n: number, singular: string, plural: string): string {
	const abs = Math.abs(Math.trunc(n));
	if (abs === 1) return `${n} ${singular}`;
	return needsDe(abs) ? `${n} de ${plural}` : `${n} ${plural}`;
}
