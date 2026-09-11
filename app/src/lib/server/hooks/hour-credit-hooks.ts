/**
 * Creditul de ore ascultă `invoice.paid` (spec §5.1).
 *
 * Handler-ul nu aruncă niciodată: `hooks.emit()` rulează ascultătorii în paralel
 * și o excepție aici ar anula restul (Keez, notificări). Ledger-ul e singurul
 * adevăr; dacă pică, factura apare în lista „Necreditate" din Bugete ore.
 */
import { getHooksManager } from '../plugins/hooks';
import type { InvoicePaidEvent } from '../plugins/types';
import { creditPaidInvoice } from '../hour-credits';
import { logError, logInfo, serializeError } from '$lib/server/logger';

const HOUR_CREDIT_HOOKS_REGISTERED = Symbol.for('ots_crm_hour_credit_hooks_registered');
const gt = globalThis as unknown as Record<symbol, boolean>;

export function registerHourCreditHooks(): void {
	if (gt[HOUR_CREDIT_HOOKS_REGISTERED]) return;
	gt[HOUR_CREDIT_HOOKS_REGISTERED] = true;

	const hooks = getHooksManager();
	hooks.on('invoice.paid', async (event: InvoicePaidEvent) => {
		try {
			const result = await creditPaidInvoice({
				tenantId: event.tenantId,
				invoiceId: event.invoice.id,
				trigger: 'hook',
				userId: event.userId || null
			});
			if (result.status === 'skipped' || result.status === 'failed') {
				logInfo(
					'server',
					`hour-credits: factura ${event.invoice.id} ${result.status}: ${result.reason}`,
					{
						tenantId: event.tenantId,
						metadata: { invoiceId: event.invoice.id, status: result.status }
					}
				);
			}
		} catch (err) {
			logError(
				'server',
				`hour-credits: invoice.paid handler a picat — ${serializeError(err).message}`,
				{
					tenantId: event.tenantId,
					metadata: { invoiceId: event.invoice.id }
				}
			);
		}
	});
}
