import { json, error } from '@sveltejs/kit';
import { getActiveSession, startSession, stopSession, getSessionStatus } from '$lib/server/whatsapp/session-manager';
import type { RequestHandler } from './$types';

/**
 * Redeschide conexiunea WhatsApp fără să ceară iar codul QR.
 *
 * De ce e nevoie: socketul Baileys trăiește în memoria procesului, iar
 * ascultătorii lui de evenimente rămân legați de versiunea modulelor de la
 * momentul deschiderii. După o schimbare de cod în calea de primire, socketul
 * vechi continuă să ruleze codul vechi până la o redeschidere. În producție
 * asta se întâmplă la fiecare pornire de proces; în dezvoltare, nu.
 *
 * `stopSession(tenantId, false)` închide socketul fără să șteargă
 * autentificarea, deci `startSession` se reconectează din datele salvate.
 * Diferența față de „Deconectează" din interfață e exact asta: acela face
 * logout și cere iar QR.
 *
 * Admin-only, tenant-scoped. GET doar arată starea; redeschiderea cere POST,
 * fiindcă o adresă care schimbă starea la simpla vizitare poate fi declanșată de
 * pe alt site, cu o imagine ascunsă.
 *
 *   curl -X POST -b cookie.txt https://.../ots/api/_debug-whatsapp-reload
 */
function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: Admin access required');
	return event.locals.tenant.id;
}

export const GET: RequestHandler = async (event) => {
	const tenantId = requireAdmin(event);
	return json({
		ok: true,
		action: 'Trimite POST pe aceeași adresă ca să redeschizi conexiunea.',
		activeInThisProcess: !!getActiveSession(tenantId),
		status: await getSessionStatus(tenantId)
	});
};

export const POST: RequestHandler = async (event) => {
	const tenantId = requireAdmin(event);
	const hadSession = !!getActiveSession(tenantId);

	await stopSession(tenantId, false);
	try {
		await startSession(tenantId);
	} catch (err) {
		return json(
			{
				ok: false,
				hadSession,
				error: err instanceof Error ? err.message : String(err)
			},
			{ status: 502 }
		);
	}

	// Reconectarea trece prin QR-broker și evenimente, deci starea din baza de
	// date se așază cu o mică întârziere.
	await new Promise((resolve) => setTimeout(resolve, 1500));

	return json({
		ok: true,
		hadSession,
		reconnected: !!getActiveSession(tenantId),
		status: await getSessionStatus(tenantId)
	});
};
