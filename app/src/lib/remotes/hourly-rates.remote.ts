/**
 * Settings → Tarife orare.
 *
 * - `getHourlyCatalogView`: forma publică (doar active) pentru dialogul de
 *   comparare pachete — accesibil staff-ului ȘI utilizatorilor de portal ai
 *   aceluiași tenant (tarifele nu sunt secrete pentru un client autentificat;
 *   pagina publică /servicii le arată după parolă).
 * - `getHourlyRatesAdmin`: tot catalogul, inclusiv inactive + reguli (staff).
 * - mutațiile: doar owner/admin.
 *
 * Regulile de blocare (ultima specializare activă, referința, regimul standard)
 * sunt în $lib/logic/hourly-catalog.ts, testate fără DB.
 */
import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/get-actor';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { RATE_MODE_SLUGS } from '$lib/logic/hours-pricing';
import {
	MAX_HOURS_MAX,
	MAX_HOURS_MIN,
	MULTIPLIER_PCT_MAX,
	MULTIPLIER_PCT_MIN,
	RATE_EUR_MAX,
	RATE_EUR_MIN,
	STEP_MINUTES_OPTIONS,
	modeUpdateBlockReason,
	rateDeactivationBlockReason,
	referenceRateBlockReason,
	resolveReferenceRate,
	slugifyRateLabel,
	toPublicHourlyRates,
	toPublicRateModes,
	uniqueRateSlug
} from '$lib/logic/hourly-catalog';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** Staff (orice rol) SAU utilizator de portal — întoarce tenant-ul de scoping. */
async function resolveTenantForRead(): Promise<string> {
	const event = getRequestEvent();
	if (!event?.locals.user) throw error(401, 'Unauthorized');
	if (event.locals.isClientUser) {
		if (!event.locals.client) throw error(401, 'Unauthorized');
		return event.locals.client.tenantId;
	}
	if (!event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);
	return event.locals.tenant.id;
}

async function requireStaffTenant(): Promise<{ tenantId: string; role: string | undefined }> {
	const event = getRequestEvent();
	if (!event?.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);
	return { tenantId: event.locals.tenant.id, role: event.locals.tenantUser?.role };
}

async function requireOwnerOrAdmin(): Promise<{ tenantId: string; userId: string }> {
	const event = getRequestEvent();
	if (!event?.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Doar owner-ul sau un admin pot modifica tarifele.');
	}
	return { tenantId: event.locals.tenant.id, userId: event.locals.user.id };
}

const labelSchema = v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(60));
const rateEurSchema = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(RATE_EUR_MIN),
	v.maxValue(RATE_EUR_MAX)
);
const sortOrderSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(999));

// ── Citire ───────────────────────────────────────────────────────────────────

export const getHourlyCatalogView = query(async () => {
	const tenantId = await resolveTenantForRead();
	const catalog = await getHourlyCatalog(tenantId);
	return {
		hourlyRates: toPublicHourlyRates(catalog.rates),
		rateModes: toPublicRateModes(catalog.modes)
	};
});

export const getHourlyRatesAdmin = query(async () => {
	const { tenantId, role } = await requireStaffTenant();
	const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
	return {
		rates: catalog.rates,
		modes: catalog.modes,
		rules: catalog.rules,
		referenceRateSlug: resolveReferenceRate(catalog.rates, catalog.rules)?.slug ?? null,
		canEdit: role === 'owner' || role === 'admin'
	};
});

// ── Specializări ─────────────────────────────────────────────────────────────

export const createHourlyRate = command(
	v.object({ label: labelSchema, rateEur: rateEurSchema }),
	async (data) => {
		const { tenantId } = await requireOwnerOrAdmin();
		const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
		const base = slugifyRateLabel(data.label);
		if (!base) throw error(400, 'Denumirea trebuie să conțină litere sau cifre.');
		const slug = uniqueRateSlug(
			base,
			catalog.rates.map((r) => r.slug)
		);
		const sortOrder = catalog.rates.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1;
		const id = generateId();
		const now = new Date();
		await withTursoBusyRetry(
			() =>
				db.insert(table.hourlyRate).values({
					id,
					tenantId,
					slug,
					label: data.label,
					rateEur: data.rateEur,
					sortOrder,
					isActive: true,
					createdAt: now,
					updatedAt: now
				}),
			{ tenantId, label: 'hourly-rates.create' }
		);
		return { id, slug };
	}
);

export const updateHourlyRate = command(
	v.object({
		id: v.pipe(v.string(), v.minLength(1)),
		label: labelSchema,
		rateEur: rateEurSchema,
		sortOrder: sortOrderSchema,
		isActive: v.boolean()
	}),
	async (data) => {
		const { tenantId } = await requireOwnerOrAdmin();
		const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
		const current = catalog.rates.find((r) => r.id === data.id);
		if (!current) throw error(404, 'Specializarea nu există.');
		if (current.isActive && !data.isActive) {
			const reason = rateDeactivationBlockReason(catalog.rates, current.slug, catalog.rules);
			if (reason) throw error(400, reason);
		}
		await withTursoBusyRetry(
			() =>
				db
					.update(table.hourlyRate)
					.set({
						label: data.label,
						rateEur: data.rateEur,
						sortOrder: data.sortOrder,
						isActive: data.isActive,
						updatedAt: new Date()
					})
					.where(and(eq(table.hourlyRate.id, data.id), eq(table.hourlyRate.tenantId, tenantId))),
			{ tenantId, label: 'hourly-rates.update' }
		);
		return { ok: true as const };
	}
);

// ── Regimuri ─────────────────────────────────────────────────────────────────

export const updateRateMode = command(
	v.object({
		slug: v.picklist(RATE_MODE_SLUGS),
		label: labelSchema,
		suffix: v.pipe(v.string(), v.trim(), v.maxLength(40)),
		description: v.pipe(v.string(), v.trim(), v.maxLength(300)),
		sla: v.pipe(v.string(), v.trim(), v.maxLength(300)),
		multiplierPct: v.pipe(
			v.number(),
			v.integer(),
			v.minValue(MULTIPLIER_PCT_MIN),
			v.maxValue(MULTIPLIER_PCT_MAX)
		),
		maxHours: v.pipe(v.number(), v.integer(), v.minValue(MAX_HOURS_MIN), v.maxValue(MAX_HOURS_MAX)),
		isActive: v.boolean()
	}),
	async (data) => {
		const { tenantId } = await requireOwnerOrAdmin();
		const reason = modeUpdateBlockReason(data.slug, data);
		if (reason) throw error(400, reason);
		// Asigură seed-ul înainte de update (tenant nou = rândurile pot lipsi).
		await getHourlyCatalog(tenantId, { includeInactive: true });
		await withTursoBusyRetry(
			() =>
				db
					.update(table.hourlyRateMode)
					.set({
						label: data.label,
						suffix: data.suffix,
						description: data.description,
						sla: data.sla,
						multiplierPct: data.multiplierPct,
						maxHours: data.maxHours,
						isActive: data.isActive,
						updatedAt: new Date()
					})
					.where(
						and(
							eq(table.hourlyRateMode.tenantId, tenantId),
							eq(table.hourlyRateMode.slug, data.slug)
						)
					),
			{ tenantId, label: 'hourly-rates.updateMode' }
		);
		return { ok: true as const };
	}
);

// ── Reguli credit ────────────────────────────────────────────────────────────

export const updateHourCreditRules = command(
	v.object({
		referenceRateSlug: v.nullable(v.pipe(v.string(), v.maxLength(40))),
		lowCreditThresholdMinutes: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000)),
		stepMinutes: v.picklist(STEP_MINUTES_OPTIONS),
		notifyEmail: v.boolean(),
		notifyWhatsapp: v.boolean()
	}),
	async (data) => {
		const { tenantId, userId } = await requireOwnerOrAdmin();
		const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
		// '' din UI = „automat" — se persistă null, ca resolveReferenceRate să-l trateze la fel.
		const referenceRateSlug = data.referenceRateSlug || null;
		const reason = referenceRateBlockReason(catalog.rates, referenceRateSlug);
		if (reason) throw error(400, reason);

		// Upsert pe indexul unic (tenant_id): două salvări simultane la prima
		// configurare nu pot produce nici rând dublu, nici 500 pe conflict.
		const now = new Date();
		const values = {
			referenceRateSlug,
			lowCreditThresholdMinutes: data.lowCreditThresholdMinutes,
			stepMinutes: data.stepMinutes,
			notifyEmail: data.notifyEmail,
			notifyWhatsapp: data.notifyWhatsapp,
			updatedByUserId: userId,
			updatedAt: now
		};
		await withTursoBusyRetry(
			() =>
				db
					.insert(table.hourCreditSettings)
					.values({ id: generateId(), tenantId, createdAt: now, ...values })
					.onConflictDoUpdate({ target: table.hourCreditSettings.tenantId, set: values }),
			{ tenantId, label: 'hourly-rates.updateRules' }
		);
		return { ok: true as const };
	}
);
