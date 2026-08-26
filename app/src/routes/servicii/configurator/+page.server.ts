/**
 * `/servicii/configurator` — wizardul public de recomandare pachete.
 *
 * Aceleași reguli de acces ca `/servicii`: pagina neactivată sau fără parolă
 * răspunde 404 (nu confirmăm că există), iar fără cookie valid trimitem
 * vizitatorul la formularul de parolă în loc să randăm ceva.
 *
 * Catalogul e construit pe server și trimis prin `load`. Wizardul îl primește ca
 * prop — nu importă `ots-catalog` în client, ca prețurile să nu ajungă într-un
 * chunk JS accesibil fără parolă.
 */

import { error, redirect } from '@sveltejs/kit';
import {
	PUBLIC_SERVICES_PAGE_KEY,
	getPublicPageAccess,
	hasValidGateCookie,
	resolvePublicTenantId
} from '$lib/server/public-page-access';
import { buildPublicCatalog, loadPublicCompany } from '../catalog.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const tenantId = await resolvePublicTenantId();
	const access = await getPublicPageAccess(tenantId, PUBLIC_SERVICES_PAGE_KEY);

	if (!access?.enabled || !access.passwordHash) {
		throw error(404, 'Pagina nu este disponibilă.');
	}

	// Fără parolă introdusă, formularul stă pe /servicii — acolo îl trimitem.
	if (!hasValidGateCookie(event, PUBLIC_SERVICES_PAGE_KEY, access)) {
		throw redirect(303, '/servicii');
	}

	return {
		catalog: await buildPublicCatalog(tenantId),
		company: await loadPublicCompany(tenantId)
	};
};
