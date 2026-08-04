/**
 * app-url.ts
 *
 * Sursa unică pentru originea publică a aplicației, folosită în toate link-urile
 * care pleacă spre oameni: emailuri de task, invitații, magic link-uri de portal,
 * link-uri de semnare contract.
 *
 * De ce există: `publicEnv.PUBLIC_APP_URL || 'http://localhost:5173'` era copiat
 * în ~20 de locuri. Pe mașina de development variabila nu e setată (nu apare nici
 * în .env.example), iar baza de date de dev E baza de PRODUCȚIE — deci un email
 * declanșat în timp ce testezi local pleca la clienți reali cu link
 * `http://localhost:5173/...`, inutilizabil pentru ei. 177 de emailuri din log au
 * plecat așa.
 *
 * Fallback-ul rămâne (dev-ul trebuie să meargă și fără configurare), dar acum
 * urlă în loguri în loc să treacă neobservat.
 */

import { env as publicEnv } from '$env/dynamic/public';
import { logWarning } from '$lib/server/logger';

const DEV_FALLBACK = 'http://localhost:5173';

let warned = false;

/**
 * Originea publică a aplicației, fără slash final.
 * Setează `PUBLIC_APP_URL` în `.env` (development) și în configul Hosted (producție).
 */
export function getAppBaseUrl(): string {
	const configured = publicEnv.PUBLIC_APP_URL?.trim();
	if (configured) return configured.replace(/\/+$/, '');

	if (!warned) {
		warned = true;
		logWarning(
			'server',
			`PUBLIC_APP_URL nu e setat — link-urile din emailuri vor arăta spre ${DEV_FALLBACK} ` +
				'și vor fi inutilizabile pentru destinatari. Setează-l în .env.'
		);
	}
	return DEV_FALLBACK;
}
