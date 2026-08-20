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
import { error, type RequestEvent } from '@sveltejs/kit';
import * as v from 'valibot';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { BUNDLE_TIERS_RULE, CATEGORIES, getCategory, TIERS } from '$lib/constants/ots-catalog';
import { computeQuoteSummary, isTierOffered } from '$lib/logic/quote-pricing';
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

/**
 * Garda comună a formularelor publice: poarta cu parolă + rate-limit per IP.
 * Ambele command-uri (serviciu simplu și ofertă multi-serviciu) împart aceeași
 * găleată — altfel un vizitator ar avea dublul limitei doar alternând formularele.
 */
async function guardPublicSubmission(
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
		logWarning('packages', 'cerere ofertă publică rate-limited', {
			tenantId: gate.tenantId,
			metadata: { ip, count: rl.count }
		});
		throw error(429, 'Prea multe cereri trimise. Te rugăm să încerci din nou peste o oră.');
	}

	return { tenantId: gate.tenantId, ip };
}

/**
 * @deprecated UI-ul public folosește `submitPublicQuoteRequest` (coș multi-serviciu).
 * Rămâne până se confirmă că nu mai există apelanți; se șterge într-un PR separat.
 */
export const submitPublicPackageRequest = command(requestSchema, async (data) => {
	const event = getRequestEvent();
	const { tenantId } = await guardPublicSubmission(event);

	const category = getCategory(data.categorySlug);
	if (!category) {
		throw error(400, 'Serviciul selectat nu mai este disponibil.');
	}

	const requestId = generateRequestId();

	try {
		await db.insert(table.servicePackageRequest).values({
			id: requestId,
			tenantId,
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
			tenantId,
			stackTrace: stack,
			metadata: { categorySlug: category.slug, tier: data.tier }
		});
		throw error(500, 'Nu am putut salva cererea. Te rugăm să încerci din nou.');
	}

	logInfo('packages', 'cerere ofertă publică primită', {
		tenantId,
		metadata: {
			requestId,
			categorySlug: category.slug,
			tier: data.tier,
			contactEmail: data.contactEmail
		}
	});

	notifyAdminsOfPackageRequestInBackground(tenantId, requestId);

	return { success: true as const, requestId };
});

const quoteItemSchema = v.object({
	categorySlug: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
	tier: v.picklist(TIERS)
});

const quoteSchema = v.object({
	// Plafonul e generos (catalogul are ~15 categorii), dar există ca payload-ul
	// să nu poată fi umflat arbitrar.
	items: v.pipe(v.array(quoteItemSchema), v.minLength(1), v.maxLength(20)),
	contactName: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(120)),
	contactEmail: v.pipe(v.string(), v.trim(), v.maxLength(255), v.regex(EMAIL_REGEX)),
	contactPhone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
	companyName: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(160))),
	note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)))
});

/**
 * Cerere de ofertă pentru un coș de servicii (fiecare cu tier-ul lui).
 *
 * Un singur rând `service_package_request`:
 *  - `categorySlug`/`tier` = primul serviciu (pivot) și `services` = toate
 *    slug-urile — forma pe care o înțeleg deja admin-ul, emailul și portalul;
 *  - `items` = tier-ul și prețurile fiecărui serviciu la momentul cererii;
 *  - `discountPct` = calculat AICI, din aceleași reguli ca sumarul din browser,
 *    nu preluat din payload.
 */
export const submitPublicQuoteRequest = command(quoteSchema, async (data) => {
	const event = getRequestEvent();
	const { tenantId } = await guardPublicSubmission(event);

	const seen = new Set<string>();
	for (const item of data.items) {
		const category = getCategory(item.categorySlug);
		if (!category) {
			throw error(400, 'Unul dintre serviciile selectate nu mai este disponibil.');
		}
		if (!isTierOffered(category, item.tier)) {
			throw error(400, `Pachetul ales nu este disponibil pentru ${category.name}.`);
		}
		if (seen.has(item.categorySlug)) {
			throw error(400, 'Un serviciu apare de două ori în cerere.');
		}
		seen.add(item.categorySlug);
	}

	const summary = computeQuoteSummary(data.items, CATEGORIES, BUNDLE_TIERS_RULE);
	const pivot = data.items[0];
	const requestId = generateRequestId();

	try {
		await db.insert(table.servicePackageRequest).values({
			id: requestId,
			tenantId,
			clientId: null,
			clientUserId: null,
			categorySlug: pivot.categorySlug,
			bundleId: null,
			services: JSON.stringify(data.items.map((i) => i.categorySlug)),
			tier: pivot.tier,
			items: JSON.stringify(
				summary.lines.map((l) => ({
					categorySlug: l.categorySlug,
					tier: l.tier,
					monthlyEur: l.monthlyEur,
					setupEur: l.setupEur
				}))
			),
			discountPct: summary.discountPct,
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
		logError('packages', `cerere ofertă publică (coș): INSERT eșuat — ${message}`, {
			tenantId,
			stackTrace: stack,
			metadata: { items: data.items }
		});
		throw error(500, 'Nu am putut salva cererea. Te rugăm să încerci din nou.');
	}

	logInfo('packages', 'cerere ofertă publică (coș) primită', {
		tenantId,
		metadata: {
			requestId,
			serviceCount: summary.serviceCount,
			discountPct: summary.discountPct,
			contactEmail: data.contactEmail
		}
	});

	notifyAdminsOfPackageRequestInBackground(tenantId, requestId);

	return { success: true as const, requestId };
});
