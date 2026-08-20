/**
 * Endpoint public pentru pagina `/servicii` — trimiterea unei cereri de ofertă.
 *
 * Securitate:
 *  - fără autentificare, dar CU poarta paginii: cerem cookie-ul de deblocare
 *    valid (deci vizitatorul a introdus parola). Fără el → 403.
 *  - rate limit per IP (Redis, distribuit) peste limita de deblocare.
 *  - categoria și tier-ul sunt validate față de catalogul din cod, nu preluate
 *    orbește din payload.
 *  - tenantul vine din env/DB (`resolvePublicTenantId`), niciodată din client.
 *  - inserăm cu `clientId = null`: o cerere publică nu se leagă singură de un
 *    client existent (ar fi o cale de a scrie în contul altcuiva). Legarea o
 *    face staff-ul din CRM.
 */

import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { getCategory, TIERS } from '$lib/constants/ots-catalog';
import {
	PUBLIC_SERVICES_PAGE_KEY,
	requireUnlockedPublicPage
} from '$lib/server/public-page-access';
import { notifyAdminsOfPackageRequestInBackground } from '$lib/server/package-requests';
import { rateLimit } from '$lib/server/redis';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';

/** Cereri de ofertă acceptate de la același IP. */
const SUBMIT_LIMIT = { limit: 8, windowSec: 60 * 60 };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const requestSchema = v.object({
	categorySlug: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
	tier: v.picklist(TIERS),
	contactName: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(120)),
	contactEmail: v.pipe(v.string(), v.trim(), v.maxLength(255), v.regex(EMAIL_REGEX)),
	contactPhone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
	companyName: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(160))),
	note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)))
});

function generateRequestId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export const submitPublicPackageRequest = command(requestSchema, async (data) => {
	const event = getRequestEvent();

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
		logWarning('packages', 'cerere ofertă publică rate-limited', {
			tenantId: gate.tenantId,
			metadata: { ip, count: rl.count }
		});
		throw error(429, 'Prea multe cereri trimise. Te rugăm să încerci din nou peste o oră.');
	}

	const category = getCategory(data.categorySlug);
	if (!category) {
		throw error(400, 'Serviciul selectat nu mai este disponibil.');
	}

	const requestId = generateRequestId();

	try {
		await db.insert(table.servicePackageRequest).values({
			id: requestId,
			tenantId: gate.tenantId,
			clientId: null,
			clientUserId: null,
			categorySlug: category.slug,
			bundleId: null,
			services: null,
			tier: data.tier,
			note: data.note || null,
			source: 'public',
			contactName: data.contactName,
			contactEmail: data.contactEmail.toLowerCase(),
			contactPhone: data.contactPhone || null,
			companyName: data.companyName || null,
			status: 'pending'
		});
	} catch (err) {
		const { message, stack } = serializeError(err);
		logError('packages', `cerere ofertă publică: INSERT eșuat — ${message}`, {
			tenantId: gate.tenantId,
			stackTrace: stack,
			metadata: { categorySlug: category.slug, tier: data.tier }
		});
		throw error(500, 'Nu am putut salva cererea. Te rugăm să încerci din nou.');
	}

	logInfo('packages', 'cerere ofertă publică primită', {
		tenantId: gate.tenantId,
		metadata: {
			requestId,
			categorySlug: category.slug,
			tier: data.tier,
			contactEmail: data.contactEmail
		}
	});

	notifyAdminsOfPackageRequestInBackground(gate.tenantId, requestId);

	return { success: true as const, requestId };
});
