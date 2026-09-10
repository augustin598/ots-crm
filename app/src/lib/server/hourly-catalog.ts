/**
 * Singurul cititor al catalogului de tarife orare.
 *
 * Îl folosesc /servicii (catalog.server.ts), comanda de ore (public-hours.remote),
 * emitentul Keez pentru ore, pagina Settings → Tarife orare și (din faza 2)
 * creditul de ore. Nimeni nu mai citește HOURLY_RATES / RATE_MODES direct.
 *
 * Seed lazy: un tenant fără rânduri primește constantele din ots-catalog la
 * prima citire. Inserția e idempotentă (index unic pe tenant+slug +
 * onConflictDoNothing), deci două cereri simultane nu pot dubla nimic.
 *
 * Seed-ul NU repară seturi parțiale: rulează doar când tabelul e complet gol
 * pentru tenant (zero rânduri), nu când lipsește doar un rând/slug.
 */
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { HOURLY_RATES, RATE_MODES } from '$lib/constants/ots-catalog';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { logInfo, logWarning } from '$lib/server/logger';
import { isRateModeSlug } from '$lib/logic/hours-pricing';
import {
	DEFAULT_HOUR_CREDIT_RULES,
	sortModes,
	sortRates,
	type CatalogMode,
	type CatalogRate,
	type HourCreditRules,
	type HourlyCatalog
} from '$lib/logic/hourly-catalog';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

type RateRow = typeof table.hourlyRate.$inferSelect;
type ModeRow = typeof table.hourlyRateMode.$inferSelect;
type RulesRow = typeof table.hourCreditSettings.$inferSelect;

function rowToRate(r: RateRow): CatalogRate {
	return {
		id: r.id,
		slug: r.slug,
		label: r.label,
		rateEur: r.rateEur,
		sortOrder: r.sortOrder,
		isActive: !!r.isActive
	};
}

function rowToMode(r: ModeRow, tenantId: string): CatalogMode | null {
	if (!isRateModeSlug(r.slug)) {
		logWarning('server', `regim necunoscut în DB: ${r.slug} (tenant ${tenantId}) — ignorat`, {
			tenantId
		});
		return null;
	}
	return {
		id: r.id,
		slug: r.slug,
		label: r.label,
		suffix: r.suffix,
		description: r.description,
		sla: r.sla,
		multiplierPct: r.multiplierPct,
		maxHours: r.maxHours,
		sortOrder: r.sortOrder,
		isActive: !!r.isActive
	};
}

function rowToRules(r: RulesRow | undefined): HourCreditRules {
	if (!r) return { ...DEFAULT_HOUR_CREDIT_RULES };
	return {
		referenceRateSlug: r.referenceRateSlug ?? null,
		lowCreditThresholdMinutes: r.lowCreditThresholdMinutes,
		stepMinutes: r.stepMinutes,
		notifyEmail: !!r.notifyEmail,
		notifyWhatsapp: !!r.notifyWhatsapp
	};
}

async function loadRates(tenantId: string): Promise<RateRow[]> {
	return db.select().from(table.hourlyRate).where(eq(table.hourlyRate.tenantId, tenantId));
}

async function loadModes(tenantId: string): Promise<ModeRow[]> {
	return db.select().from(table.hourlyRateMode).where(eq(table.hourlyRateMode.tenantId, tenantId));
}

async function loadRules(tenantId: string): Promise<RulesRow | undefined> {
	const rows = await db
		.select()
		.from(table.hourCreditSettings)
		.where(eq(table.hourCreditSettings.tenantId, tenantId));
	return rows[0];
}

/** Rândurile de seed pentru un tenant nou — din constantele care erau până acum singura sursă. */
export function seedRateRows(tenantId: string): (typeof table.hourlyRate.$inferInsert)[] {
	// Timestamp-urile se dau explicit (convenția fișierului schema.ts): default-ul SQL
	// `current_timestamp` ar stoca alt format decât rândurile scrise din aplicație.
	const now = new Date();
	return HOURLY_RATES.map((r, i) => ({
		id: generateId(),
		tenantId,
		slug: r.slug,
		label: r.label,
		rateEur: r.rate,
		sortOrder: i,
		isActive: true,
		createdAt: now,
		updatedAt: now
	}));
}

export function seedModeRows(tenantId: string): (typeof table.hourlyRateMode.$inferInsert)[] {
	const now = new Date();
	return RATE_MODES.map((m, i) => ({
		id: generateId(),
		tenantId,
		slug: m.slug,
		label: m.label,
		suffix: m.suffix,
		description: m.description,
		sla: m.sla,
		multiplierPct: m.multiplierPct,
		maxHours: m.maxHours,
		sortOrder: i,
		isActive: true,
		createdAt: now,
		updatedAt: now
	}));
}

async function seedRates(tenantId: string): Promise<void> {
	const result = await withTursoBusyRetry(
		() => db.insert(table.hourlyRate).values(seedRateRows(tenantId)).onConflictDoNothing(),
		{ tenantId, label: 'hourly-catalog.seedRates' }
	);
	if (result.rowsAffected > 0) {
		logInfo(
			'server',
			`seed tarife orare pentru tenant ${tenantId}: ${result.rowsAffected} rânduri`,
			{ tenantId }
		);
	}
}

async function seedModes(tenantId: string): Promise<void> {
	const result = await withTursoBusyRetry(
		() => db.insert(table.hourlyRateMode).values(seedModeRows(tenantId)).onConflictDoNothing(),
		{ tenantId, label: 'hourly-catalog.seedModes' }
	);
	if (result.rowsAffected > 0) {
		logInfo(
			'server',
			`seed regimuri de lucru pentru tenant ${tenantId}: ${result.rowsAffected} rânduri`,
			{ tenantId }
		);
	}
}

export async function getHourlyCatalog(
	tenantId: string,
	opts: { includeInactive?: boolean } = {}
): Promise<HourlyCatalog> {
	const loaded = await Promise.all([loadRates(tenantId), loadModes(tenantId), loadRules(tenantId)]);
	let [rateRows, modeRows] = loaded;
	const rules = rowToRules(loaded[2]);
	if (rateRows.length === 0) {
		await seedRates(tenantId);
		rateRows = await loadRates(tenantId);
	}
	if (modeRows.length === 0) {
		await seedModes(tenantId);
		modeRows = await loadModes(tenantId);
	}

	const rates = rateRows.map(rowToRate);
	const modes = modeRows
		.map((r) => rowToMode(r, tenantId))
		.filter((m): m is CatalogMode => m !== null);
	const keep = <T extends { isActive: boolean }>(x: T) => opts.includeInactive || x.isActive;

	return {
		rates: sortRates(rates.filter(keep)),
		modes: sortModes(modes.filter(keep)),
		rules
	};
}
