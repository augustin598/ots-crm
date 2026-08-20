/**
 * Administrarea paginilor publice protejate cu parolă (deocamdată `/servicii`).
 * Staff-only — vezi tab-ul „Pagina publică" din /[tenant]/services.
 *
 * Parola în clar nu se întoarce niciodată către UI: o ține doar hash-ul argon2
 * din DB. UI-ul află doar dacă există parolă și când a fost schimbată ultima dată.
 */

import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/get-actor';
import { getAppBaseUrl } from '$lib/server/app-url';
import {
	PUBLIC_SERVICES_PAGE_KEY,
	clearPublicPagePassword,
	getPublicPageAccess,
	resolvePublicTenantId,
	setPublicPageEnabled,
	setPublicPagePassword
} from '$lib/server/public-page-access';
import { logInfo } from '$lib/server/logger';

const MIN_PASSWORD_LENGTH = 6;

async function requireStaffTenant() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	await requireStaff(event);
	return { event, tenantId: event.locals.tenant.id, userId: event.locals.user.id };
}

export const getPublicServicesAccess = query(async () => {
	const { tenantId } = await requireStaffTenant();

	const row = await getPublicPageAccess(tenantId, PUBLIC_SERVICES_PAGE_KEY);

	let updatedBy: string | null = null;
	if (row?.updatedByUserId) {
		const [u] = await db
			.select({ firstName: table.user.firstName, lastName: table.user.lastName })
			.from(table.user)
			.where(eq(table.user.id, row.updatedByUserId))
			.limit(1);
		updatedBy = u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || null : null;
	}

	// Pagina publică nu are tenant în URL: servește tenantul „proprietar" al
	// site-ului. Dacă adminul e pe alt tenant, îl anunțăm în loc să-l lăsăm să
	// creadă că a publicat ceva.
	let isPublicTenant = true;
	try {
		isPublicTenant = (await resolvePublicTenantId()) === tenantId;
	} catch {
		isPublicTenant = false;
	}

	return {
		enabled: row?.enabled ?? false,
		hasPassword: Boolean(row?.passwordHash),
		passwordUpdatedAt: row?.passwordUpdatedAt ?? null,
		updatedAt: row?.updatedAt ?? null,
		updatedBy,
		isPublicTenant,
		publicUrl: `${getAppBaseUrl()}/servicii`
	};
});

export const setPublicServicesPassword = command(
	v.object({
		password: v.pipe(v.string(), v.minLength(MIN_PASSWORD_LENGTH), v.maxLength(128)),
		enable: v.optional(v.boolean())
	}),
	async ({ password, enable }) => {
		const { tenantId, userId } = await requireStaffTenant();

		await setPublicPagePassword({
			tenantId,
			pageKey: PUBLIC_SERVICES_PAGE_KEY,
			password,
			userId,
			enable: enable ?? true
		});

		logInfo('packages', 'parolă pagină publică servicii setată', {
			tenantId,
			userId,
			action: 'public_page_password_set'
		});

		return { success: true as const };
	}
);

export const setPublicServicesEnabled = command(
	v.object({ enabled: v.boolean() }),
	async ({ enabled }) => {
		const { tenantId, userId } = await requireStaffTenant();

		const result = await setPublicPageEnabled({
			tenantId,
			pageKey: PUBLIC_SERVICES_PAGE_KEY,
			enabled,
			userId
		});

		if (!result.ok) {
			throw error(400, 'Setează întâi o parolă — altfel pagina ar rămâne deschisă oricui.');
		}

		logInfo('packages', `pagină publică servicii ${enabled ? 'activată' : 'dezactivată'}`, {
			tenantId,
			userId,
			action: 'public_page_toggle'
		});

		return { success: true as const };
	}
);

export const clearPublicServicesPassword = command(async () => {
	const { tenantId, userId } = await requireStaffTenant();

	await clearPublicPagePassword({
		tenantId,
		pageKey: PUBLIC_SERVICES_PAGE_KEY,
		userId
	});

	logInfo('packages', 'parolă pagină publică servicii ștearsă (pagina închisă)', {
		tenantId,
		userId,
		action: 'public_page_password_cleared'
	});

	return { success: true as const };
});
