import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { resolveVatPercent } from '$lib/server/vat/rate';
import { classifyClientVat, getZeroVatLegalNote } from '$lib/server/vat/classify-client';

/**
 * Cota de TVA a unei facturi de ore. NU e hardcodată: vine din setările de facturare
 * ale tenantului; un client intracomunitar sau din afara UE se facturează cu 0% și
 * mențiunea legală — aceeași regulă ca la facturile create din /invoices.
 */
export async function resolveHourOrderVat(
	tenantId: string,
	clientId: string | null | undefined
): Promise<{ vatPercent: number; zeroVatNote: string | null }> {
	const [settings] = await db
		.select({
			defaultTaxRate: table.invoiceSettings.defaultTaxRate,
			zeroVatAutoDetect: table.invoiceSettings.whmcsZeroVatAutoDetect
		})
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	let vatPercent = resolveVatPercent(settings?.defaultTaxRate);
	let zeroVatNote: string | null = null;
	if (clientId && (settings?.zeroVatAutoDetect ?? true)) {
		const [vatClient] = await db
			.select({ country: table.client.country, cui: table.client.cui })
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (vatClient) {
			const scenario = classifyClientVat({ country: vatClient.country, cui: vatClient.cui });
			if (scenario === 'intracom' || scenario === 'export') {
				vatPercent = 0;
				zeroVatNote = getZeroVatLegalNote(scenario);
			}
		}
	}
	return { vatPercent, zeroVatNote };
}
