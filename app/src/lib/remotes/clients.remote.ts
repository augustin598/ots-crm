import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, ne, sql, getTableColumns } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function isPrivateHost(hostname: string): boolean {
	if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
	const parts = hostname.split('.').map(Number);
	if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
		if (parts[0] === 10) return true;
		if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
		if (parts[0] === 192 && parts[1] === 168) return true;
		if (parts[0] === 169 && parts[1] === 254) return true;
		if (parts[0] === 0) return true;
	}
	if (/\.(local|internal|corp|home|lan)$/i.test(hostname)) return true;
	return false;
}

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
	name: v.pipe(v.string(), v.minLength(1, 'Name is required'), v.maxLength(255)),
	businessName: v.optional(v.pipe(v.string(), v.maxLength(255))),
	email: v.optional(v.pipe(v.string(), v.email('Invalid email'), v.maxLength(255))),
	phone: v.optional(v.pipe(v.string(), v.maxLength(50))),
	website: v.optional(v.pipe(v.string(), v.maxLength(500))),
	status: v.optional(v.picklist(['prospect', 'active', 'inactive'])),
	companyType: v.optional(v.pipe(v.string(), v.maxLength(100))),
	cui: v.optional(v.pipe(v.string(), v.maxLength(20))),
	registrationNumber: v.optional(v.pipe(v.string(), v.maxLength(50))),
	tradeRegister: v.optional(v.pipe(v.string(), v.maxLength(50))),
	vatNumber: v.optional(v.pipe(v.string(), v.maxLength(30))),
	legalRepresentative: v.optional(v.pipe(v.string(), v.maxLength(255))),
	iban: v.optional(v.pipe(v.string(), v.maxLength(34))),
	bankName: v.optional(v.pipe(v.string(), v.maxLength(255))),
	address: v.optional(v.pipe(v.string(), v.maxLength(500))),
	city: v.optional(v.pipe(v.string(), v.maxLength(100))),
	county: v.optional(v.pipe(v.string(), v.maxLength(100))),
	postalCode: v.optional(v.pipe(v.string(), v.maxLength(20))),
	country: v.optional(v.pipe(v.string(), v.maxLength(100))),
	notes: v.optional(v.pipe(v.string(), v.maxLength(5000)))
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
				const fd = r.firstDate as unknown;
				const iso = typeof fd === 'string' ? fd : fd instanceof Date ? fd.toISOString() : null;
				return iso ? { clientId: r.clientId!, firstDate: iso } : null;
			})
			.filter((x): x is { clientId: string; firstDate: string } => x != null);
	} catch (e) {
		console.error('[getClientFirstInvoiceDates]', e);
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
	} catch (e) {
		console.error('[getClientsStats]', e);
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
	try {
		const parsed = new URL(url);
		if (isPrivateHost(parsed.hostname)) return null;
	} catch {
		return null;
	}
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
	const tenantId = event.locals.tenant.id;

	// Email/phone may be shared across clients (same person manages multiple
	// companies). Uniqueness is enforced on CUI alone.
	if (data.cui) {
		const cuiNormalized = data.cui.trim().toLowerCase().replace(/^ro/, '');
		if (cuiNormalized.length > 0) {
			const [cuiTaken] = await db
				.select({ id: table.client.id, name: table.client.name })
				.from(table.client)
				.where(
					and(
						eq(table.client.tenantId, tenantId),
						eq(sql`lower(replace(${table.client.cui}, 'RO', ''))`, cuiNormalized)
					)
				)
				.limit(1);
			if (cuiTaken) {
				throw new Error(`CUI deja folosit pe clientul "${cuiTaken.name}".`);
			}
		}
	}

	await db.insert(table.client).values({
		id: clientId,
		tenantId,
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

/** Nullify FK references and delete a clientUser record */
async function deleteClientUserWithFKs(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], clientUserId: string) {
	await tx
		.update(table.marketingMaterial)
		.set({ uploadedByClientUserId: null })
		.where(eq(table.marketingMaterial.uploadedByClientUserId, clientUserId));
	await tx
		.update(table.clientAccessData)
		.set({ createdByClientUserId: null })
		.where(eq(table.clientAccessData.createdByClientUserId, clientUserId));
	await tx.delete(table.clientUser).where(eq(table.clientUser.id, clientUserId));
}

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

		const { clientId, ...rest } = data;
		const tenantId = event.locals.tenant.id;

		// Verify client belongs to tenant
		const [existing] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);

		if (!existing) {
			throw new Error('Client not found');
		}

		const oldEmail = (existing.email || '').toLowerCase().trim();
		const newEmail = (rest.email || '').toLowerCase().trim();
		const emailChanged = oldEmail !== newEmail && oldEmail !== '';

		// Email/phone may be shared across clients (same person manages multiple
		// companies). Uniqueness is enforced on CUI alone.
		const newCui = (rest.cui || '').toString();
		if (newCui) {
			const cuiNormalized = newCui.trim().toLowerCase().replace(/^ro/, '');
			if (cuiNormalized.length > 0) {
				const [cuiTaken] = await db
					.select({ id: table.client.id, name: table.client.name })
					.from(table.client)
					.where(
						and(
							eq(table.client.tenantId, tenantId),
							eq(sql`lower(replace(${table.client.cui}, 'RO', ''))`, cuiNormalized),
							ne(table.client.id, clientId)
						)
					)
					.limit(1);
				if (cuiTaken) {
					throw new Error(`CUI deja folosit pe clientul "${cuiTaken.name}".`);
				}
			}
		}

		await db.transaction(async (tx) => {
			// 1. Update the client record
			await tx
				.update(table.client)
				.set({
					...rest,
					updatedAt: new Date()
				})
				.where(eq(table.client.id, clientId));

			// 2. If primary email changed, sync clientUser association
			if (emailChanged) {
				const [oldUser] = await tx
					.select()
					.from(table.user)
					.where(eq(table.user.email, oldEmail))
					.limit(1);

				if (oldUser) {
					const [oldClientUser] = await tx
						.select()
						.from(table.clientUser)
						.where(
							and(
								eq(table.clientUser.userId, oldUser.id),
								eq(table.clientUser.clientId, clientId),
								eq(table.clientUser.tenantId, tenantId),
								eq(table.clientUser.isPrimary, true)
							)
						)
						.limit(1);

					if (oldClientUser) {
						if (newEmail) {
							const [newUser] = await tx
								.select()
								.from(table.user)
								.where(eq(table.user.email, newEmail))
								.limit(1);

							if (newUser) {
								// Check if newUser already has a clientUser for this client
								const [existingNewCU] = await tx
									.select()
									.from(table.clientUser)
									.where(
										and(
											eq(table.clientUser.userId, newUser.id),
											eq(table.clientUser.clientId, clientId),
											eq(table.clientUser.tenantId, tenantId)
										)
									)
									.limit(1);

								if (existingNewCU) {
									// Promote existing to primary, delete old
									await tx
										.update(table.clientUser)
										.set({ isPrimary: true, updatedAt: new Date() })
										.where(eq(table.clientUser.id, existingNewCU.id));
									await deleteClientUserWithFKs(tx, oldClientUser.id);
								} else {
									// Re-link old clientUser to new user
									await tx
										.update(table.clientUser)
										.set({ userId: newUser.id, updatedAt: new Date() })
										.where(eq(table.clientUser.id, oldClientUser.id));
								}
							} else {
								// No user for new email yet — remove old clientUser
								await deleteClientUserWithFKs(tx, oldClientUser.id);
							}
						} else {
							// Email cleared — remove old primary clientUser
							await deleteClientUserWithFKs(tx, oldClientUser.id);
						}
					}
				}
			}
		});

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
			const tenants = await db
				.select()
				.from(table.tenant)
				.where(
					and(
						sql`${table.tenant.vatNumber} IS NOT NULL`,
						sql`${table.tenant.id} != ${event.locals.tenant.id}`
					)
				);

			for (const t of tenants) {
				if (normalizeVatId(t.vatNumber!) === normalizedVat) {
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
		const tenants = await db
			.select()
			.from(table.tenant)
			.where(
				and(
					sql`${table.tenant.vatNumber} IS NOT NULL`,
					sql`${table.tenant.id} != ${event.locals.tenant.id}`
				)
			);

		const partnerTenant = tenants.find((t) => {
			return normalizeVatId(t.vatNumber!) === normalizedVat;
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

// --- Client-facing: update own company data ---
const clientCompanyUpdateSchema = v.object({
	businessName: v.optional(v.pipe(v.string(), v.maxLength(255))),
	name: v.optional(v.pipe(v.string(), v.maxLength(255))),
	email: v.optional(v.pipe(v.string(), v.maxLength(255))),
	phone: v.optional(v.pipe(v.string(), v.maxLength(50))),
	companyType: v.optional(v.pipe(v.string(), v.maxLength(100))),
	cui: v.optional(v.pipe(v.string(), v.maxLength(20))),
	registrationNumber: v.optional(v.pipe(v.string(), v.maxLength(50))),
	tradeRegister: v.optional(v.pipe(v.string(), v.maxLength(50))),
	vatNumber: v.optional(v.pipe(v.string(), v.maxLength(30))),
	legalRepresentative: v.optional(v.pipe(v.string(), v.maxLength(255))),
	iban: v.optional(v.pipe(v.string(), v.maxLength(34))),
	bankName: v.optional(v.pipe(v.string(), v.maxLength(255))),
	address: v.optional(v.pipe(v.string(), v.maxLength(500))),
	city: v.optional(v.pipe(v.string(), v.maxLength(100))),
	county: v.optional(v.pipe(v.string(), v.maxLength(100))),
	postalCode: v.optional(v.pipe(v.string(), v.maxLength(20))),
	country: v.optional(v.pipe(v.string(), v.maxLength(100)))
});

export const updateClientCompanyData = command(clientCompanyUpdateSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.isClientUser || !event?.locals.clientUser || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const clientId = (event.locals as any).client?.id;
	if (!clientId) throw new Error('Unauthorized');
	const tenantId = event.locals.tenant.id;

	// Email/phone may be shared across clients. Uniqueness is enforced on CUI alone.
	const newCui = (data.cui || '').toString();
	if (newCui) {
		const cuiNormalized = newCui.trim().toLowerCase().replace(/^ro/, '');
		if (cuiNormalized.length > 0) {
			const [cuiTaken] = await db
				.select({ id: table.client.id, name: table.client.name })
				.from(table.client)
				.where(
					and(
						eq(table.client.tenantId, tenantId),
						eq(sql`lower(replace(${table.client.cui}, 'RO', ''))`, cuiNormalized),
						ne(table.client.id, clientId)
					)
				)
				.limit(1);
			if (cuiTaken) {
				throw new Error(`CUI deja folosit pe clientul "${cuiTaken.name}".`);
			}
		}
	}

	// Convert empty strings to null
	const cleanData: Record<string, any> = {};
	for (const [k, val] of Object.entries(data)) {
		cleanData[k] = val === '' ? null : val;
	}

	await db
		.update(table.client)
		.set({ ...cleanData, updatedAt: new Date() })
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)));

	return { success: true };
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

	// Check for related records before deleting
	const [invoiceCount] = await db
		.select({ count: sql<number>`count(*)` })
		.from(table.invoice)
		.where(eq(table.invoice.clientId, clientId));

	const [contractCount] = await db
		.select({ count: sql<number>`count(*)` })
		.from(table.contract)
		.where(eq(table.contract.clientId, clientId));

	const [projectCount] = await db
		.select({ count: sql<number>`count(*)` })
		.from(table.project)
		.where(eq(table.project.clientId, clientId));

	const refs: string[] = [];
	if (invoiceCount?.count > 0) refs.push(`${invoiceCount.count} facturi`);
	if (contractCount?.count > 0) refs.push(`${contractCount.count} contracte`);
	if (projectCount?.count > 0) refs.push(`${projectCount.count} proiecte`);

	if (refs.length > 0) {
		throw new Error(`Nu se poate șterge clientul — are ${refs.join(', ')} asociate`);
	}

	await db
		.delete(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)));

	return { success: true };
});

/** Get monthly budget for a client (in RON, converted from cents) */
export const getClientBudget = query(
	v.object({ clientId: v.string() }),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

		const [result] = await db
			.select({ monthlyBudget: table.client.monthlyBudget })
			.from(table.client)
			.where(and(eq(table.client.id, params.clientId), eq(table.client.tenantId, event.locals.tenant.id)))
			.limit(1);

		return { monthlyBudget: result?.monthlyBudget ? result.monthlyBudget / 100 : null };
	}
);

/** Update monthly budget for a client (input in RON, stored in cents) */
export const updateClientBudget = command(
	v.object({
		clientId: v.string(),
		monthlyBudget: v.nullable(v.pipe(v.number(), v.minValue(0)))
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

		await db
			.update(table.client)
			.set({
				monthlyBudget: params.monthlyBudget !== null ? Math.round(params.monthlyBudget * 100) : null,
				updatedAt: new Date()
			})
			.where(and(eq(table.client.id, params.clientId), eq(table.client.tenantId, event.locals.tenant.id)));

		return { success: true };
	}
);
