import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logError, logInfo, logWarning } from '$lib/server/logger';
import { fetchMetaPaymentStatus } from '$lib/server/meta-ads/status';
import { fetchGooglePaymentStatus } from '$lib/server/google-ads/status';
import { fetchTikTokPaymentStatus } from '$lib/server/tiktok-ads/status';
import { reconcileAndAlert } from '$lib/server/ads/payment-alerts';
import type { AdsProvider, PaymentStatusSnapshot } from '$lib/server/ads/payment-status-types';

interface BreakerState {
	consecutiveFailures: number;
	openedAt: number | null;
}

const breaker = new Map<string, BreakerState>();
const BREAK_AFTER_FAILURES = 5;
const COOLDOWN_MS = 15 * 60 * 1000;

function breakerKey(tenantId: string, provider: AdsProvider): string {
	return `${tenantId}:${provider}`;
}

function shouldSkip(tenantId: string, provider: AdsProvider): boolean {
	const state = breaker.get(breakerKey(tenantId, provider));
	if (!state?.openedAt) return false;
	if (Date.now() - state.openedAt < COOLDOWN_MS) return true;
	return false;
}

function markSuccess(tenantId: string, provider: AdsProvider): void {
	breaker.delete(breakerKey(tenantId, provider));
}

function markFailure(tenantId: string, provider: AdsProvider): void {
	const key = breakerKey(tenantId, provider);
	const current = breaker.get(key) ?? { consecutiveFailures: 0, openedAt: null };
	const next: BreakerState = {
		consecutiveFailures: current.consecutiveFailures + 1,
		openedAt: current.openedAt,
	};
	if (next.consecutiveFailures >= BREAK_AFTER_FAILURES && !next.openedAt) {
		next.openedAt = Date.now();
		logWarning('scheduler', `Circuit breaker opened for ${key} — pausing 15min`);
	}
	breaker.set(key, next);
}

async function pollMeta(tenantId: string): Promise<PaymentStatusSnapshot[]> {
	const integrations = await db
		.select()
		.from(table.metaAdsIntegration)
		.where(
			and(
				eq(table.metaAdsIntegration.tenantId, tenantId),
				eq(table.metaAdsIntegration.isActive, true),
			),
		);
	const all: PaymentStatusSnapshot[] = [];
	for (const integration of integrations) {
		try {
			const snaps = await fetchMetaPaymentStatus(integration);
			all.push(...snaps);
		} catch (err) {
			markFailure(tenantId, 'meta');
			logError('scheduler', `Meta status fetch failed tenant=${tenantId} integration=${integration.id}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	return all;
}

async function pollGoogle(tenantId: string): Promise<PaymentStatusSnapshot[]> {
	const integrations = await db
		.select()
		.from(table.googleAdsIntegration)
		.where(
			and(
				eq(table.googleAdsIntegration.tenantId, tenantId),
				eq(table.googleAdsIntegration.isActive, true),
			),
		);
	const all: PaymentStatusSnapshot[] = [];
	for (const integration of integrations) {
		try {
			const snaps = await fetchGooglePaymentStatus(integration);
			all.push(...snaps);
		} catch (err) {
			markFailure(tenantId, 'google');
			logError('scheduler', `Google status fetch failed tenant=${tenantId} integration=${integration.id}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	return all;
}

async function pollTikTok(tenantId: string): Promise<PaymentStatusSnapshot[]> {
	const integrations = await db
		.select()
		.from(table.tiktokAdsIntegration)
		.where(
			and(
				eq(table.tiktokAdsIntegration.tenantId, tenantId),
				eq(table.tiktokAdsIntegration.isActive, true),
			),
		);
	const all: PaymentStatusSnapshot[] = [];
	for (const integration of integrations) {
		try {
			const snaps = await fetchTikTokPaymentStatus(integration);
			all.push(...snaps);
		} catch (err) {
			markFailure(tenantId, 'tiktok');
			logError('scheduler', `TikTok status fetch failed tenant=${tenantId} integration=${integration.id}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	return all;
}

async function tenantsWithAnyAdsIntegration(): Promise<string[]> {
	const tables = [
		table.metaAdsIntegration,
		table.googleAdsIntegration,
		table.tiktokAdsIntegration,
	];

	const tenantIds = new Set<string>();
	for (const t of tables) {
		const rows = await db
			.select({ tenantId: t.tenantId })
			.from(t)
			.where(eq(t.isActive, true));
		for (const r of rows) tenantIds.add(r.tenantId);
	}
	return [...tenantIds];
}

export async function processAdsStatusMonitor(): Promise<{
	tenants: number;
	metaSnapshots: number;
	googleSnapshots: number;
	tiktokSnapshots: number;
	transitions: number;
	restored: number;
	errors: number;
}> {
	logInfo('scheduler', 'Starting ads status monitor', { metadata: { trigger: 'scheduled' } });

	const tenantIds = await tenantsWithAnyAdsIntegration();
	logInfo('scheduler', `Polling ${tenantIds.length} tenants with ads integrations`);

	let metaCount = 0;
	let googleCount = 0;
	let tiktokCount = 0;
	let transitions = 0;
	let restored = 0;
	let errors = 0;

	for (const tenantId of tenantIds) {
		try {
			const snaps: PaymentStatusSnapshot[] = [];

			if (!shouldSkip(tenantId, 'meta')) {
				const metaSnaps = await pollMeta(tenantId);
				if (metaSnaps.length > 0) markSuccess(tenantId, 'meta');
				snaps.push(...metaSnaps);
				metaCount += metaSnaps.length;
			}
			if (!shouldSkip(tenantId, 'google')) {
				const googleSnaps = await pollGoogle(tenantId);
				if (googleSnaps.length > 0) markSuccess(tenantId, 'google');
				snaps.push(...googleSnaps);
				googleCount += googleSnaps.length;
			}
			if (!shouldSkip(tenantId, 'tiktok')) {
				const tiktokSnaps = await pollTikTok(tenantId);
				if (tiktokSnaps.length > 0) markSuccess(tenantId, 'tiktok');
				snaps.push(...tiktokSnaps);
				tiktokCount += tiktokSnaps.length;
			}

			if (snaps.length === 0) continue;

			const result = await reconcileAndAlert(tenantId, snaps);
			transitions += result.transitions;
			restored += result.restored;
			errors += result.errors;
		} catch (err) {
			errors += 1;
			logError('scheduler', `Ads status monitor failed for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	const summary = {
		tenants: tenantIds.length,
		metaSnapshots: metaCount,
		googleSnapshots: googleCount,
		tiktokSnapshots: tiktokCount,
		transitions,
		restored,
		errors,
	};
	logInfo('scheduler', 'Ads status monitor done', { metadata: summary });
	return summary;
}
