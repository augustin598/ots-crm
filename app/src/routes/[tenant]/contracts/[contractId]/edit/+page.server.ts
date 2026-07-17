import type { PageServerLoad } from './$types';
import { getContract } from '$lib/remotes/contracts.remote';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { resolveVatPercent } from '$lib/server/vat/rate';

export const load: PageServerLoad = async (event) => {
	try {
		const contract = await getContract(event.params.contractId);
		const clients = await db.select().from(table.client)
			.where(eq(table.client.tenantId, event.locals.tenant!.id));
		const templates = await db.select().from(table.contractTemplate)
			.where(eq(table.contractTemplate.tenantId, event.locals.tenant!.id));
		const [invoiceSettings] = await db
			.select()
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, event.locals.tenant!.id))
			.limit(1);
		return {
			contract,
			clients,
			templates,
			defaultTaxRate: resolveVatPercent(invoiceSettings?.defaultTaxRate)
		};
	} catch {
		throw error(404, 'Contract not found');
	}
};
