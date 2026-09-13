/**
 * Expirarea creditului de ore — job zilnic.
 *
 * Pentru fiecare tenant cu `credit_expiry_days > 0`, recalculează loturile de
 * credit ale clienților și scrie un rând `expire` (minus) pentru fiecare lot al
 * cărui termen a trecut și care a rămas neconsumat.
 *
 * Idempotență în două straturi:
 *  1. `client_hour_ledger_expire_uidx` — un lot nu poate expira de două ori cu
 *     aceeași cheie, nici dacă jobul rulează concurent (conflict → no-op).
 *  2. Rândul de expirare e el însuși consum în ledger, deci la rularea
 *     următoare lotul nu mai apare ca neconsumat. Nu ținem stare separată.
 *
 * Concurență cu decontările: citirea ledgerului și scrierea expirării stau în
 * ACEEAȘI tranzacție per client. Altfel un Done strecurat între ele consuma din
 * lot, iar expirarea scădea apoi lotul întreg: la sold insuficient, soldul ajungea
 * negativ și depășirea Done-ului nu se mai factura.
 *
 * Alocarea consumului pe loturi e FIFO pe expirare (`$lib/logic/hour-credit-expiry`):
 * clientul pierde cât mai puțin. Termenele trecute cât expirarea a fost oprită nu
 * expiră după repornire (`credit_expiry_enabled_at`).
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { isUniqueViolation } from '$lib/server/hour-credits';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import {
	expiredBatches,
	type ExpiredBatch,
	type ExpiryLedgerRow
} from '$lib/logic/hour-credit-expiry';
import { logError, logInfo, serializeError } from '$lib/server/logger';

export interface HourCreditExpiryResult {
	tenantsChecked: number;
	clientsChecked: number;
	batchesExpired: number;
	minutesExpired: number;
	dryRun: boolean;
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Expiră loturile unui client, atomic față de mișcările concurente ale ledgerului.
 * `beforeWrite` există doar pentru testul de concurență (rulează între citire și scriere).
 */
async function expireClient(params: {
	tenantId: string;
	clientId: string;
	now: Date;
	notBefore: Date | null;
	dryRun: boolean;
	beforeWrite?: () => Promise<unknown>;
}): Promise<ExpiredBatch[]> {
	const { tenantId, clientId, now } = params;
	try {
		return await withTursoBusyRetry(
			() =>
				db.transaction(async (tx) => {
					const rows: ExpiryLedgerRow[] = await tx
						.select({
							id: table.clientHourLedger.id,
							createdAt: table.clientHourLedger.createdAt,
							deltaMinutes: table.clientHourLedger.deltaMinutes,
							expiresAt: table.clientHourLedger.expiresAt,
							kind: table.clientHourLedger.kind,
							sourceId: table.clientHourLedger.sourceId
						})
						.from(table.clientHourLedger)
						.where(
							and(
								eq(table.clientHourLedger.tenantId, tenantId),
								eq(table.clientHourLedger.clientId, clientId)
							)
						);
					const expired = expiredBatches(rows, now, { notBefore: params.notBefore });
					if (params.dryRun || expired.length === 0) return expired;

					if (params.beforeWrite) await params.beforeWrite();
					const at = new Date();
					for (const batch of expired) {
						await tx.insert(table.clientHourLedger).values({
							id: generateId(),
							tenantId,
							clientId,
							deltaMinutes: -batch.minutes,
							kind: 'expire',
							sourceType: 'ledger',
							// Lotul care a expirat (+ al câtelea termen) — cheia de idempotență.
							sourceId: batch.expireKey,
							note: `Expirare credit neconsumat (termen ${batch.expiresAt.toISOString().slice(0, 10)})`,
							createdAt: at
						});
					}
					const total = expired.reduce((s, b) => s + b.minutes, 0);
					await tx
						.update(table.client)
						.set({
							hourCreditMinutes: sql`${table.client.hourCreditMinutes} - ${total}`,
							updatedAt: at
						})
						.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)));
					return expired;
				}),
			{ tenantId, label: 'hour-credit-expiry.client' }
		);
	} catch (err) {
		// O rulare paralelă a scris deja aceleași expirări: tranzacția noastră s-a anulat întreagă.
		if (isUniqueViolation(err)) return [];
		throw err;
	}
}

/**
 * `dryRun` implicit FALSE aici: spre deosebire de suspendarea de hosting,
 * expirarea e reversibilă printr-o ajustare manuală și nu atinge clientul
 * direct. Rămâne totuși parametrizabilă pentru endpointul de debug.
 */
export async function processHourCreditExpiry(
	params: {
		dryRun?: boolean;
		tenantId?: string;
		/** Doar pentru teste: rulează între citirea ledgerului și scrierea expirării. */
		beforeWrite?: () => Promise<unknown>;
	} = {}
): Promise<HourCreditExpiryResult> {
	const dryRun = params.dryRun ?? false;
	const now = new Date();
	const result: HourCreditExpiryResult = {
		tenantsChecked: 0,
		clientsChecked: 0,
		batchesExpired: 0,
		minutesExpired: 0,
		dryRun
	};

	// Doar tenanții care au pornit expirarea. `credit_expiry_days = 0` = fără termen.
	const settingsRows = await db
		.select({
			tenantId: table.hourCreditSettings.tenantId,
			enabledAt: table.hourCreditSettings.creditExpiryEnabledAt
		})
		.from(table.hourCreditSettings)
		.where(gt(table.hourCreditSettings.creditExpiryDays, 0));

	const tenants = params.tenantId
		? settingsRows.filter((r) => r.tenantId === params.tenantId)
		: settingsRows;

	for (const { tenantId, enabledAt } of tenants) {
		result.tenantsChecked++;
		try {
			// Clienții cu mișcări în ledger — restul n-au ce expira.
			const clientRows = await db
				.selectDistinct({ clientId: table.clientHourLedger.clientId })
				.from(table.clientHourLedger)
				.where(eq(table.clientHourLedger.tenantId, tenantId));

			for (const { clientId } of clientRows) {
				result.clientsChecked++;
				const expired = await expireClient({
					tenantId,
					clientId,
					now,
					notBefore: enabledAt ?? null,
					dryRun,
					beforeWrite: params.beforeWrite
				});
				result.batchesExpired += expired.length;
				result.minutesExpired += expired.reduce((s, b) => s + b.minutes, 0);
			}
		} catch (err) {
			logError('scheduler', `hour-credit-expiry: tenant ${tenantId} a eșuat`, {
				tenantId,
				metadata: { error: serializeError(err) }
			});
		}
	}

	logInfo(
		'scheduler',
		`hour-credit-expiry: ${result.batchesExpired} loturi, ${result.minutesExpired} min, ${result.tenantsChecked} tenanți${dryRun ? ' (dry-run)' : ''}`
	);
	return result;
}
