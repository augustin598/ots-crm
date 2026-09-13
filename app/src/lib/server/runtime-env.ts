import { env } from '$env/dynamic/private';

/**
 * Singura instanță care rulează joburi programate (facturi recurente, reînnoiri
 * hosting, sync-uri, remindere) e producția: `APP_ENV=production` din
 * app-config.json (configs[0].data).
 *
 * Staging (`APP_ENV=staging`) are baza clonată din prod, deci moștenește
 * integrarea Keez, token-urile OAuth și șabloanele recurente — cu același
 * ENCRYPTION_SECRET, credențialele se decriptează. Localhost lucrează direct pe
 * baza de prod. Oricare dintre ele, cu scheduler-ul pornit, emite documente
 * REALE în Keez (incident 2026-09-12: OTS 560, dublura lui OTS 559).
 *
 * Lipsa variabilei înseamnă „nu e producție" — nu invers.
 */
export function isProductionInstance(): boolean {
	return env.APP_ENV === 'production';
}
