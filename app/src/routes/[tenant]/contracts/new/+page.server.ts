import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async (event) => {
	const clients = await db
		.select()
		.from(table.client)
		.where(eq(table.client.tenantId, event.locals.tenant!.id));

	const templates = await db
		.select()
		.from(table.contractTemplate)
		.where(eq(table.contractTemplate.tenantId, event.locals.tenant!.id));

	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, event.locals.tenant!.id))
		.limit(1);

	return {
		clients,
		templates,
		defaultTaxRate: invoiceSettings?.defaultTaxRate ?? 19
	};
};
