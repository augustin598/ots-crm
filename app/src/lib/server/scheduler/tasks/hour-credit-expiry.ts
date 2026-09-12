/**
 * Expirarea creditului de ore — job zilnic.
 *
 * Pentru fiecare tenant cu `credit_expiry_days > 0`, recalculează loturile de
 * credit ale clienților și scrie un rând `expire` (minus) pentru fiecare lot al
 * cărui termen a trecut și care a rămas neconsumat.
 *
 * Idempotență în două straturi:
 *  1. `client_hour_ledger_expire_uidx` — un lot nu poate expira de două ori,
 *     nici dacă jobul rulează concurent (a doua inserare dă conflict → no-op).
 *  2. Rândul de expirare e el însuși consum în ledger, deci la rularea
 *     următoare lotul nu mai apare ca neconsumat. Nu ținem stare separată.
 *
 * Alocarea consumului pe loturi e FIFO pe expirare (`$lib/logic/hour-credit-expiry`):
 * clientul pierde cât mai puțin.
 */
import { and, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../../db';
import * as table from '../../db/schema';
import { applyLedgerEntry } from '$lib/server/hour-credits';
import { expiredBatches, type ExpiryLedgerRow } from '$lib/logic/hour-credit-expiry';
import { logError, logInfo, serializeError } from '$lib/server/logger';

export interface HourCreditExpiryResult {
	tenantsChecked: number;
	clientsChecked: number;
	batchesExpired: number;
	minutesExpired: number;
	dryRun: boolean;
}

/**
 * `dryRun` implicit FALSE aici: spre deosebire de suspendarea de hosting,
 * expirarea e reversibilă printr-o ajustare manuală și nu atinge clientul
 * direct. Rămâne totuși parametrizabilă pentru endpointul de debug.
 */
export async function processHourCreditExpiry(
	params: { dryRun?: boolean; tenantId?: string } = {}
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
			days: table.hourCreditSettings.creditExpiryDays
		})
		.from(table.hourCreditSettings)
		.where(gt(table.hourCreditSettings.creditExpiryDays, 0));

	const tenants = params.tenantId
		? settingsRows.filter((r) => r.tenantId === params.tenantId)
		: settingsRows;

	for (const { tenantId } of tenants) {
		result.tenantsChecked++;
		try {
			// Clienții cu mișcări în ledger — restul n-au ce expira.
			const clientRows = await db
				.selectDistinct({ clientId: table.clientHourLedger.clientId })
				.from(table.clientHourLedger)
				.where(eq(table.clientHourLedger.tenantId, tenantId));
			if (clientRows.length === 0) continue;

			const clientIds = clientRows.map((r) => r.clientId);
			// O singură interogare pentru toate mișcările tenantului, apoi grupăm în
			// memorie: altfel ar fi N+1 pe numărul de clienți.
			const entries = await db
				.select({
					id: table.clientHourLedger.id,
					clientId: table.clientHourLedger.clientId,
					createdAt: table.clientHourLedger.createdAt,
					deltaMinutes: table.clientHourLedger.deltaMinutes,
					expiresAt: table.clientHourLedger.expiresAt
				})
				.from(table.clientHourLedger)
				.where(
					and(
						eq(table.clientHourLedger.tenantId, tenantId),
						inArray(table.clientHourLedger.clientId, clientIds)
					)
				);

			const byClient = new Map<string, ExpiryLedgerRow[]>();
			for (const e of entries) {
				const list = byClient.get(e.clientId) ?? [];
				list.push({
					id: e.id,
					createdAt: e.createdAt,
					deltaMinutes: e.deltaMinutes,
					expiresAt: e.expiresAt
				});
				byClient.set(e.clientId, list);
			}

			for (const [clientId, rows] of byClient) {
				result.clientsChecked++;
				const expired = expiredBatches(rows, now);
				for (const batch of expired) {
					result.batchesExpired++;
					result.minutesExpired += batch.minutes;
					if (dryRun) continue;
					await applyLedgerEntry({
						tenantId,
						clientId,
						deltaMinutes: -batch.minutes,
						kind: 'expire',
						sourceType: 'ledger',
						// Lotul care a expirat — cheia de idempotență.
						sourceId: batch.batchId,
						note: `Expirare credit neconsumat (termen ${batch.expiresAt.toISOString().slice(0, 10)})`
					});
				}
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
