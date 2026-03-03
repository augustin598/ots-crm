import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql, getTableColumns } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

async function getNormalizeVatId() {
	const { normalizeVatId } = await import('$lib/server/plugins/anaf-spv/mapper');
	return normalizeVatId;
}

function generateClientId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generatePartnerId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const clientSchema = v.object({
	name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
	businessName: v.optional(v.string()),
	email: v.optional(v.pipe(v.string(), v.email('Invalid email'))),
	phone: v.optional(v.string()),
	website: v.optional(v.string()),
	status: v.optional(v.string()),
	companyType: v.optional(v.string()),
	cui: v.optional(v.string()),
	registrationNumber: v.optional(v.string()),
	tradeRegister: v.optional(v.string()),
	vatNumber: v.optional(v.string()),
	legalRepresentative: v.optional(v.string()),
	iban: v.optional(v.string()),
	bankName: v.optional(v.string()),
	address: v.optional(v.string()),
	city: v.optional(v.string()),
	county: v.optional(v.string()),
	postalCode: v.optional(v.string()),
	country: v.optional(v.string()),
	notes: v.optional(v.string())
});

export const getClients = query(async () => {
	try {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const clients = await db
			.select({
				...getTableColumns(table.client),
				defaultWebsiteUrl: table.clientWebsite.url
			})
			.from(table.client)
			.leftJoin(
				table.clientWebsite,
				and(
					eq(table.clientWebsite.clientId, table.client.id),
					eq(table.clientWebsite.isDefault, true)
				)
			)
			.where(eq(table.client.tenantId, event.locals.tenant.id));

		return clients;
	} catch (e) {
		console.error('[getClients]', e);
		throw e instanceof Error ? e : new Error(String(e));
	}
});

/** Returns array of { clientId, firstDate } for first invoice per client. Used for "Joined" display. */
export const getClientFirstInvoiceDates = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	try {
		const rows = await db
			.select({
				clientId: table.invoice.clientId,
				firstDate: sql<string>`MIN(${table.invoice.issueDate})`.as('first_date')
			})
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.tenantId, event.locals.tenant.id),
					sql`${table.invoice.issueDate} IS NOT NULL`
				)
			)
			.groupBy(table.invoice.clientId);

		return rows
			.filter((r) => r.clientId && r.firstDate != null)
			.map((r) => {
				const fd = r.firstDate;
				const iso = typeof fd === 'string' ? fd : fd instanceof Date ? fd.toISOString() : null;
				return iso ? { clientId: r.clientId!, firstDate: iso } : null;
			})
			.filter((x): x is { clientId: string; firstDate: string } => x != null);
	} catch {
		return [];
	}
});

/** Returns per-client invoice aggregates (totals, counts, overdue) in a single batch query. */
export const getClientsStats = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	try {
		const rows = await db
			.select({
				clientId: table.invoice.clientId,
				currency: table.invoice.currency,
				totalInvoiced: sql<number>`COALESCE(SUM(${table.invoice.totalAmount}), 0)`.as('total_invoiced'),
				totalPaid: sql<number>`COALESCE(SUM(CASE WHEN ${table.invoice.status} = 'paid' THEN ${table.invoice.totalAmount} ELSE 0 END), 0)`.as('total_paid'),
				unpaidAmount: sql<number>`COALESCE(SUM(CASE WHEN ${table.invoice.status} IN ('sent', 'overdue') THEN ${table.invoice.totalAmount} ELSE 0 END), 0)`.as('unpaid_amount'),
				invoiceCount: sql<number>`COUNT(*)`.as('invoice_count'),
				paidCount: sql<number>`SUM(CASE WHEN ${table.invoice.status} = 'paid' THEN 1 ELSE 0 END)`.as('paid_count'),
				unpaidCount: sql<number>`SUM(CASE WHEN ${table.invoice.status} IN ('sent', 'overdue') THEN 1 ELSE 0 END)`.as('unpaid_count'),
				overdueCount: sql<number>`SUM(CASE WHEN ${table.invoice.status} = 'overdue' THEN 1 ELSE 0 END)`.as('overdue_count')
			})
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.tenantId, event.locals.tenant.id),
					sql`${table.invoice.status} NOT IN ('draft', 'cancelled')`
				)
			)
			.groupBy(table.invoice.clientId, table.invoice.currency);

		// Aggregate per-currency rows into a single object per client
		const aggregated = new Map<string, {
			clientId: string;
			totalInvoicedByCurrency: Record<string, number>;
			totalPaidByCurrency: Record<string, number>;
			unpaidAmountByCurrency: Record<string, number>;
			invoiceCount: number;
			paidCount: number;
			unpaidCount: number;
			overdueCount: number;
		}>();

		for (const row of rows) {
			if (!row.clientId) continue;
			const curr = row.currency || 'RON';
			if (!aggregated.has(row.clientId)) {
				aggregated.set(row.clientId, {
					clientId: row.clientId,
					totalInvoicedByCurrency: {},
					totalPaidByCurrency: {},
					unpaidAmountByCurrency: {},
					invoiceCount: 0,
					paidCount: 0,
					unpaidCount: 0,
					overdueCount: 0
				});
			}
			const agg = aggregated.get(row.clientId)!;
			agg.totalInvoicedByCurrency[curr] = (agg.totalInvoicedByCurrency[curr] || 0) + row.totalInvoiced;
			agg.totalPaidByCurrency[curr] = (agg.totalPaidByCurrency[curr] || 0) + row.totalPaid;
			agg.unpaidAmountByCurrency[curr] = (agg.unpaidAmountByCurrency[curr] || 0) + row.unpaidAmount;
			agg.invoiceCount += row.invoiceCount;
			agg.paidCount += row.paidCount;
			agg.unpaidCount += row.unpaidCount;
			agg.overdueCount += row.overdueCount;
		}

		return Array.from(aggregated.values());
	} catch {
		return [];
	}
});

export const getClient = query(v.pipe(v.string(), v.minLength(1)), async (clientId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [client] = await db
		.select({
			...getTableColumns(table.client),
			defaultWebsiteUrl: table.clientWebsite.url
		})
		.from(table.client)
		.leftJoin(
			table.clientWebsite,
			and(
				eq(table.clientWebsite.clientId, table.client.id),
				eq(table.clientWebsite.isDefault, true)
			)
		)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!client) {
		throw new Error('Client not found');
	}

	return client;
});

/** Fetches website HTML and extracts logo URL from common selectors (site-logo-img, custom-logo, etc.) */
export const getLogoFromWebsite = query(v.pipe(v.string(), v.minLength(1)), async (websiteUrl) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
	let html: string;
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CRM-Bot/1.0)' },
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) return null;
		html = await res.text();
	} catch {
		return null;
	}

	const { parse } = await import('node-html-parser');
	const root = parse(html);
	const baseUrl = new URL(url);

	const selectors = [
		'.site-logo-img img',
		'.custom-logo-link img',
		'.custom-logo',
		'#logo img',
		'.logo img',
		'.header-logo img',
		'[class*="site-logo"] img',
		'[class*="custom-logo"]',
		'[id*="logo"] img',
		'[class*="logo"] img'
	];

	for (const sel of selectors) {
		const el = root.querySelector(sel);
		if (!el) continue;
		const src = el.getAttribute('src') || el.getAttribute('data-src');
		if (!src) continue;
		try {
			const absolute = new URL(src, baseUrl).href;
			if (absolute.startsWith('http') && /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(absolute)) {
				return absolute;
			}
		} catch {
			// skip invalid URLs
		}
	}
	return null;
});

export const createClient = command(clientSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const clientId = generateClientId();

	await db.insert(table.client).values({
		id: clientId,
		tenantId: event.locals.tenant.id,
		name: data.name,
		businessName: data.businessName || null,
		email: data.email || null,
		phone: data.phone || null,
		website: data.website || null,
		status: data.status || 'prospect',
		companyType: data.companyType || null,
		cui: data.cui || null,
		registrationNumber: data.registrationNumber || null,
		tradeRegister: data.tradeRegister || null,
		vatNumber: data.vatNumber || null,
		legalRepresentative: data.legalRepresentative || null,
		iban: data.iban || null,
		bankName: data.bankName || null,
		address: data.address || null,
		city: data.city || null,
		county: data.county || null,
		postalCode: data.postalCode || null,
		country: data.country || 'România',
		notes: data.notes || null
	});

	return { success: true, clientId };
});

export const updateClient = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1)),
		...clientSchema.entries
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { clientId, ...updateData } = data;

		// Verify client belongs to tenant
		const [existing] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!existing) {
			throw new Error('Client not found');
		}

		const { clientId: _cid, ...rest } = updateData;
		await db
			.update(table.client)
			.set({
				...rest,
				updatedAt: new Date()
			})
			.where(eq(table.client.id, clientId));

		return { success: true };
	}
);

export const getClientPartnerInfo = query(
	v.pipe(v.string(), v.minLength(1)),
	async (clientId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [client] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!client) {
			throw new Error('Client not found');
		}

		const [existingPartner] = await db
			.select()
			.from(table.partner)
			.where(
				and(
					eq(table.partner.tenantId, event.locals.tenant.id),
					eq(table.partner.clientId, clientId)
				)
			)
			.limit(1);

		let matchedTenant: (typeof table.tenant.$inferSelect) | null = null;

		if (client.vatNumber) {
			const normalizeVatId = await getNormalizeVatId();
			const normalizedVat = normalizeVatId(client.vatNumber);
			const tenants = await db.select().from(table.tenant);

			for (const t of tenants) {
				if (!t.vatNumber) continue;
				if (t.id === event.locals.tenant.id) continue;
				if (normalizeVatId(t.vatNumber) === normalizedVat) {
					matchedTenant = t;
					break;
				}
			}
		}

		if (!matchedTenant && existingPartner) {
			const [partnerTenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.id, existingPartner.partnerTenantId))
				.limit(1);
			if (partnerTenant) {
				matchedTenant = partnerTenant;
			}
		}

		return {
			canBePartner: !!matchedTenant || !!existingPartner,
			isPartner: !!existingPartner,
			partnerTenantId: existingPartner?.partnerTenantId ?? matchedTenant?.id ?? null,
			partnerTenantName: matchedTenant?.name ?? null
		};
	}
);

export const setClientPartnerStatus = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1)),
		isPartner: v.boolean()
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { clientId, isPartner } = data;

		const [client] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!client) {
			throw new Error('Client not found');
		}

		const [existingPartner] = await db
			.select()
			.from(table.partner)
			.where(
				and(
					eq(table.partner.tenantId, event.locals.tenant.id),
					eq(table.partner.clientId, clientId)
				)
			)
			.limit(1);

		if (!isPartner) {
			if (existingPartner) {
				await db
					.delete(table.partner)
					.where(
						and(
							eq(table.partner.id, existingPartner.id),
							eq(table.partner.tenantId, event.locals.tenant.id)
						)
					);
			}

			return { success: true };
		}

		if (existingPartner) {
			return { success: true };
		}

		if (!client.vatNumber) {
			throw new Error('Client has no VAT number set');
		}

		const normalizeVatId = await getNormalizeVatId();
		const normalizedVat = normalizeVatId(client.vatNumber);
		const tenants = await db.select().from(table.tenant);

		const partnerTenant = tenants.find((t) => {
			if (!t.vatNumber) return false;
			if (t.id === event.locals.tenant.id) return false;
			return normalizeVatId(t.vatNumber) === normalizedVat;
		});

		if (!partnerTenant) {
			throw new Error('No matching tenant found for client VAT number');
		}

		await db.insert(table.partner).values({
			id: generatePartnerId(),
			tenantId: event.locals.tenant.id,
			clientId,
			partnerTenantId: partnerTenant.id
		});

		return { success: true };
	}
);

export const getTenantPartners = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const partners = await db
		.select({
			id: table.partner.id,
			clientId: table.partner.clientId,
			partnerTenantId: table.partner.partnerTenantId,
			clientName: table.client.name,
			partnerTenantName: table.tenant.name
		})
		.from(table.partner)
		.innerJoin(table.client, eq(table.partner.clientId, table.client.id))
		.innerJoin(table.tenant, eq(table.partner.partnerTenantId, table.tenant.id))
		.where(eq(table.partner.tenantId, event.locals.tenant.id));

	return partners;
});

export const deleteClient = command(v.pipe(v.string(), v.minLength(1)), async (clientId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Verify client belongs to tenant
	const [existing] = await db
		.select()
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!existing) {
		throw new Error('Client not found');
	}

	await db.delete(table.client).where(eq(table.client.id, clientId));

	return { success: true };
});
