/**
 * Garda formularelor publice de pe /servicii: poarta cu parolă + rate-limit
 * per IP. TOATE command-urile publice ale paginii (cerere de ofertă, cumpărare
 * de ore) împart aceeași găleată `public-services-request` — altfel un
 * vizitator și-ar dubla limita alternând formularele.
 *
 * Extrasă din `public-services.remote.ts` ca s-o poată folosi și
 * `public-hours.remote.ts` fără ca testele unuia să tragă dependențele
 * (Stripe, client find-or-create) ale celuilalt.
 */
import { error, type RequestEvent } from '@sveltejs/kit';
import {
	PUBLIC_SERVICES_PAGE_KEY,
	requireUnlockedPublicPage
} from '$lib/server/public-page-access';
import { rateLimit } from '$lib/server/redis';
import { logWarning } from '$lib/server/logger';

/** Cereri acceptate de la același IP, indiferent de formular. */
const SUBMIT_LIMIT = { limit: 8, windowSec: 60 * 60 };

export async function guardPublicServicesSubmission(
	event: RequestEvent
): Promise<{ tenantId: string; ip: string }> {
	const gate = await requireUnlockedPublicPage(event, PUBLIC_SERVICES_PAGE_KEY);
	if (!gate) {
		throw error(403, 'Sesiunea a expirat. Reîncarcă pagina și introdu parola din nou.');
	}

	const ip =
		event.getClientAddress?.() ??
		event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown';

	const rl = await rateLimit({
		kind: 'public-services-request',
		ip,
		limit: SUBMIT_LIMIT.limit,
		windowSec: SUBMIT_LIMIT.windowSec
	});
	if (!rl.allowed) {
		logWarning('packages', 'cerere publică /servicii rate-limited', {
			tenantId: gate.tenantId,
			metadata: { ip, count: rl.count }
		});
		throw error(429, 'Prea multe cereri trimise. Te rugăm să încerci din nou peste o oră.');
	}

	return { tenantId: gate.tenantId, ip };
}
