/**
 * Creditul de ore ascultă `invoice.paid` (spec §5.1) și `invoice.paid.synced`
 * (încasarea înregistrată în Keez și adusă de sincronizare — vezi
 * `plugins/keez/paid-transition.ts`).
 *
 * Handler-ele nu aruncă niciodată: `hooks.emit()` rulează ascultătorii în paralel
 * și o excepție aici ar anula restul (Keez, notificări). Ledger-ul e singurul
 * adevăr; dacă pică, factura apare în lista „Necreditate" din Bugete ore.
 */
import { getHooksManager } from '../plugins/hooks';
import type { InvoicePaidEvent, InvoicePaidSyncedEvent } from '../plugins/types';
import { creditPaidInvoice } from '../hour-credits';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';

const HOUR_CREDIT_HOOKS_REGISTERED = Symbol.for('ots_crm_hour_credit_hooks_registered');
const gt = globalThis as unknown as Record<symbol, boolean>;

async function creditWithoutThrowing(params: {
	tenantId: string;
	invoiceId: string;
	trigger: 'hook' | 'keez-sync';
	userId: string | null;
}): Promise<void> {
	try {
		const result = await creditPaidInvoice(params);
		if (result.status === 'skipped' || result.status === 'failed') {
			// `failed` (ex. curs BNR indisponibil) consumă tranziția: singura recuperare
			// e creditarea manuală din „Facturi necreditate", deci trebuie să se vadă.
			const log = result.status === 'failed' ? logWarning : logInfo;
			log(
				'server',
				`hour-credits: factura ${params.invoiceId} ${result.status}: ${result.reason}`,
				{
					tenantId: params.tenantId,
					metadata: { invoiceId: params.invoiceId, status: result.status, trigger: params.trigger }
				}
			);
		}
	} catch (err) {
		logError(
			'server',
			`hour-credits: handler-ul ${params.trigger} a picat — ${serializeError(err).message}`,
			{
				tenantId: params.tenantId,
				metadata: { invoiceId: params.invoiceId }
			}
		);
	}
}

export function registerHourCreditHooks(): void {
	if (gt[HOUR_CREDIT_HOOKS_REGISTERED]) return;
	gt[HOUR_CREDIT_HOOKS_REGISTERED] = true;

	const hooks = getHooksManager();
	hooks.on('invoice.paid', async (event: InvoicePaidEvent) => {
		await creditWithoutThrowing({
			tenantId: event.tenantId,
			invoiceId: event.invoice.id,
			trigger: 'hook',
			userId: event.userId || null
		});
	});
	hooks.on('invoice.paid.synced', async (event: InvoicePaidSyncedEvent) => {
		await creditWithoutThrowing({
			tenantId: event.tenantId,
			invoiceId: event.invoiceId,
			trigger: 'keez-sync',
			userId: null
		});
	});
}
