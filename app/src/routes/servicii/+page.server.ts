/**
 * `/servicii` — catalogul public de pachete OTS, protejat cu o parolă comună
 * setată din CRM (`/ots/services` → tab „Pagina publică").
 *
 * Fluxul:
 *   1. Pagina nu e activată sau n-are parolă → 404 (nu confirmăm că există).
 *   2. Vizitator fără cookie valid → se randează DOAR formularul de parolă.
 *      Datele catalogului nu pleacă de pe server în acest caz.
 *   3. După parola corectă → cookie semnat HMAC (30 zile) și catalogul complet.
 *
 * De ce vine catalogul din `load` și nu dintr-un import în componentă: un import
 * static ar ajunge într-un chunk JS public, deci prețurile s-ar putea citi fără
 * parolă. Aici constantele sunt importate exclusiv pe server.
 */

import { error, fail, redirect } from '@sveltejs/kit';
import {
	CATEGORIES,
	CATEGORY_GROUPS,
	CRM_FEATURES,
	TIERS,
	TIER_LABELS,
	TIER_COLORS,
	HOURLY_RATES,
	WEB_DEV_SLUGS,
	SETUP_DEFAULT_DESCRIPTION,
	BUNDLE_TIERS_RULE,
	BUNDLES
} from '$lib/constants/ots-catalog';
import {
	PUBLIC_SERVICES_PAGE_KEY,
	clearGateCookie,
	getPublicPageAccess,
	hasValidGateCookie,
	issueGateCookie,
	resolvePublicTenantId,
	verifyPublicPagePassword
} from '$lib/server/public-page-access';
import { checkFixedWindowLimit } from '$lib/server/rate-limiter';
import { rateLimit } from '$lib/server/redis';
import { logInfo, logWarning } from '$lib/server/logger';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import type { PublicCatalog, PublicCompany } from './types';
import { buildPublicCatalog, loadPublicCompany } from './catalog.server';
import type { Actions, PageServerLoad } from './$types';

/** Încercări de parolă per IP: 10 / 15 min în proces, 40 / oră în Redis. */
const ATTEMPTS_PER_IP = { max: 10, windowMs: 15 * 60 * 1000 };
const REDIS_ATTEMPTS_PER_IP = { limit: 40, windowSec: 60 * 60 };

function clientIp(event: RequestEvent): string {
	try {
		return event.getClientAddress();
	} catch {
		return event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
	}
}



export const load: PageServerLoad = async (event) => {
	const tenantId = await resolvePublicTenantId();
	const access = await getPublicPageAccess(tenantId, PUBLIC_SERVICES_PAGE_KEY);

	// Pagina închisă (sau parolă neconfigurată) = inexistentă pentru public.
	if (!access?.enabled || !access.passwordHash) {
		throw error(404, 'Pagina nu este disponibilă.');
	}

	if (!hasValidGateCookie(event, PUBLIC_SERVICES_PAGE_KEY, access)) {
		return { unlocked: false as const };
	}

	return {
		unlocked: true as const,
		catalog: buildPublicCatalog(),
		company: await loadPublicCompany(tenantId)
	};
};

export const actions: Actions = {
	unlock: async (event) => {
		const formData = await event.request.formData();
		const password = formData.get('password');

		if (typeof password !== 'string' || password.length === 0 || password.length > 255) {
			return fail(400, { message: 'Introdu parola primită de la echipa OTS.' });
		}

		const ip = clientIp(event);

		// Limitare ÎNAINTE de argon2 (verificarea e intenționat scumpă).
		if (checkFixedWindowLimit(`public-gate:services:${ip}`, ATTEMPTS_PER_IP)) {
			logWarning('packages', 'pagina publică servicii: prea multe încercări de parolă', {
				metadata: { ip }
			});
			return fail(429, { message: 'Prea multe încercări. Încearcă din nou peste 15 minute.' });
		}
		const distributed = await rateLimit({
			kind: 'public-gate-services',
			ip,
			limit: REDIS_ATTEMPTS_PER_IP.limit,
			windowSec: REDIS_ATTEMPTS_PER_IP.windowSec
		});
		if (!distributed.allowed) {
			return fail(429, { message: 'Prea multe încercări. Încearcă din nou mai târziu.' });
		}

		const tenantId = await resolvePublicTenantId();
		const access = await getPublicPageAccess(tenantId, PUBLIC_SERVICES_PAGE_KEY);

		if (!access?.enabled || !access.passwordHash || !access.cookieSecret) {
			// Rulăm oricum verificarea (hash fictiv) ca să nu diferim în timp.
			await verifyPublicPagePassword(null, password);
			throw error(404, 'Pagina nu este disponibilă.');
		}

		const ok = await verifyPublicPagePassword(access, password);
		if (!ok) {
			logWarning('packages', 'pagina publică servicii: parolă greșită', {
				tenantId,
				metadata: { ip }
			});
			return fail(400, { message: 'Parolă incorectă.' });
		}

		issueGateCookie(event, PUBLIC_SERVICES_PAGE_KEY, access.cookieSecret);
		logInfo('packages', 'pagina publică servicii deblocată', { tenantId, metadata: { ip } });

		throw redirect(303, '/servicii');
	},

	lock: async (event) => {
		clearGateCookie(event, PUBLIC_SERVICES_PAGE_KEY);
		throw redirect(303, '/servicii');
	}
};
