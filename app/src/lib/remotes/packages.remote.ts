import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { notifyAdminsOfPackageRequestInBackground } from '$lib/server/package-requests';
import { logError } from '$lib/server/logger';
import { getCategory, TIERS, type Tier } from '$lib/constants/ots-catalog';
import { requireStaff } from '$lib/server/get-actor';

function generateRequestId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const tierSchema = v.picklist(TIERS);

const createRequestSchema = v.object({
	categorySlug: v.pipe(v.string(), v.minLength(1)),
	tier: tierSchema,
	note: v.optional(v.string()),
	bundleId: v.optional(v.string()),
	services: v.optional(v.array(v.string()))
});

const updateStatusSchema = v.object({
	requestId: v.pipe(v.string(), v.minLength(1)),
	status: v.picklist(['pending', 'contacted', 'accepted', 'rejected'])
});

/** Forma unui element din coloana `items` (ofertă multi-serviciu de pe /servicii). */
export type QuoteRequestItem = {
	categorySlug: string;
	tier: Tier;
	monthlyEur: number | null;
	setupEur: number | null;
};

/** Un rând cu JSON stricat nu trebuie să dărâme toată lista din admin. */
function parseJsonArray<T>(raw: string | null): T[] | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as T[]) : null;
	} catch {
		return null;
	}
}

export const getPackageRequests = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	await requireStaff(event);

	try {
		const rows = await db
			.select({
				id: table.servicePackageRequest.id,
				categorySlug: table.servicePackageRequest.categorySlug,
				bundleId: table.servicePackageRequest.bundleId,
				services: table.servicePackageRequest.services,
				tier: table.servicePackageRequest.tier,
				note: table.servicePackageRequest.note,
				status: table.servicePackageRequest.status,
				contactedAt: table.servicePackageRequest.contactedAt,
				createdAt: table.servicePackageRequest.createdAt,
				clientId: table.servicePackageRequest.clientId,
				clientName: table.client.name,
				clientEmail: table.client.email,
				// Cererile de pe pagina publică /servicii n-au client în CRM — contactul
				// vine din formular. UI-ul afișează clientul dacă există, altfel contactul.
				source: table.servicePackageRequest.source,
				contactName: table.servicePackageRequest.contactName,
				contactEmail: table.servicePackageRequest.contactEmail,
				contactPhone: table.servicePackageRequest.contactPhone,
				companyName: table.servicePackageRequest.companyName,
				// Oferta multi-serviciu: tier + preț per serviciu și discountul aplicat.
				items: table.servicePackageRequest.items,
				discountPct: table.servicePackageRequest.discountPct
			})
			.from(table.servicePackageRequest)
			.leftJoin(table.client, eq(table.servicePackageRequest.clientId, table.client.id))
			.where(eq(table.servicePackageRequest.tenantId, event.locals.tenant.id))
			.orderBy(desc(table.servicePackageRequest.createdAt));

		return rows.map((r) => ({
			...r,
			services: parseJsonArray<string>(r.services),
			items: parseJsonArray<QuoteRequestItem>(r.items)
		}));
	} catch (err) {
		const raw = err instanceof Error ? err : new Error(String(err));
		// Expose the underlying SQL error so we can see "no such table / no such column"
		// in the server log instead of just Drizzle's generic "Failed query".
		logError('packages', 'getPackageRequests SQL failed', {
			stackTrace: raw.stack,
			metadata: {
				message: raw.message,
				cause: (raw as Error & { cause?: unknown }).cause
					? String((raw as Error & { cause?: unknown }).cause)
					: undefined
			}
		});
		console.error('[packages.getPackageRequests] SQL error →', raw.message, raw);
		throw raw;
	}
});

export const createPackageRequest = command(createRequestSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.isClientUser || !event?.locals.client || !event?.locals.clientUser) {
		throw new Error('Unauthorized');
	}

	const category = getCategory(data.categorySlug);
	if (!category) {
		throw new Error('Categorie invalidă');
	}

	const tenantId = event.locals.client.tenantId;
	const requestId = generateRequestId();

	try {
		await db.insert(table.servicePackageRequest).values({
			id: requestId,
			tenantId,
			clientId: event.locals.client.id,
			clientUserId: event.locals.clientUser.id,
			categorySlug: data.categorySlug,
			bundleId: data.bundleId || null,
			services: data.services && data.services.length > 0 ? JSON.stringify(data.services) : null,
			tier: data.tier,
			note: data.note?.trim() || null,
			source: 'portal',
			status: 'pending'
		});
	} catch (err) {
		const raw = err instanceof Error ? err : new Error(String(err));
		logError('packages', 'createPackageRequest INSERT failed', {
			stackTrace: raw.stack,
			metadata: {
				message: raw.message,
				cause: (raw as Error & { cause?: unknown }).cause
					? String((raw as Error & { cause?: unknown }).cause)
					: undefined,
				categorySlug: data.categorySlug,
				tier: data.tier
			}
		});
		console.error('[packages.createPackageRequest] SQL error →', raw.message, raw);
		throw raw;
	}

	// Notificare fire-and-forget către owner/admin — nu blocăm răspunsul clientului.
	// Aceeași funcție e folosită și de cererile publice (/servicii).
	notifyAdminsOfPackageRequestInBackground(tenantId, requestId);

	return { success: true, requestId };
});

export const updatePackageRequestStatus = command(updateStatusSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	await requireStaff(event);

	const [existing] = await db
		.select()
		.from(table.servicePackageRequest)
		.where(
			and(
				eq(table.servicePackageRequest.id, data.requestId),
				eq(table.servicePackageRequest.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);

	if (!existing) {
		throw new Error('Cerere negăsită');
	}

	const updates: Partial<typeof table.servicePackageRequest.$inferInsert> = {
		status: data.status,
		updatedAt: new Date()
	};
	if (data.status === 'contacted' && !existing.contactedAt) {
		updates.contactedAt = new Date();
	}

	await db
		.update(table.servicePackageRequest)
		.set(updates)
		.where(eq(table.servicePackageRequest.id, data.requestId));

	return { success: true };
});

// ─── Comenzi de ore extra work (cumpărate cu cardul de pe /servicii) ─────────

export const getHoursOrders = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	await requireStaff(event);

	return db
		.select({
			id: table.serviceHoursOrder.id,
			clientId: table.serviceHoursOrder.clientId,
			rateSlug: table.serviceHoursOrder.rateSlug,
			rateLabel: table.serviceHoursOrder.rateLabel,
			rateEur: table.serviceHoursOrder.rateEur,
			hours: table.serviceHoursOrder.hours,
			netCents: table.serviceHoursOrder.netCents,
			grossCents: table.serviceHoursOrder.grossCents,
			currency: table.serviceHoursOrder.currency,
			status: table.serviceHoursOrder.status,
			billingType: table.serviceHoursOrder.billingType,
			contactName: table.serviceHoursOrder.contactName,
			contactEmail: table.serviceHoursOrder.contactEmail,
			contactPhone: table.serviceHoursOrder.contactPhone,
			companyName: table.serviceHoursOrder.companyName,
			cui: table.serviceHoursOrder.cui,
			note: table.serviceHoursOrder.note,
			invoiceId: table.serviceHoursOrder.invoiceId,
			stripePaymentIntentId: table.serviceHoursOrder.stripePaymentIntentId,
			paidAt: table.serviceHoursOrder.paidAt,
			createdAt: table.serviceHoursOrder.createdAt
		})
		.from(table.serviceHoursOrder)
		.where(eq(table.serviceHoursOrder.tenantId, event.locals.tenant.id))
		.orderBy(desc(table.serviceHoursOrder.createdAt))
		.limit(200);
});
