import { logInfo } from '$lib/server/logger';

/**
 * Verifică la două minute că cineva chiar ține socketul Baileys.
 *
 * Rulează pe fiecare instanță; preluarea se revendică printr-un UPDATE
 * condiționat, deci două pod-uri nu pot prelua amândouă și nu se mai bat pe
 * sesiune. Toată logica e în `whatsapp/session-health.ts`; aici e doar cârligul
 * de scheduler.
 */
export async function processWhatsappSessionGuard(): Promise<{ checked: number; takenOver: number }> {
	const { runSessionGuard } = await import('$lib/server/whatsapp/session-health');
	const result = await runSessionGuard();
	if (result.takenOver > 0) {
		logInfo('scheduler', `whatsapp-session-guard: ${result.takenOver} sesiune(i) preluate`);
	}
	return result;
}
