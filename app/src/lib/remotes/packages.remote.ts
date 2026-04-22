import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { sendPackageRequestEmail } from '$lib/server/email';
import { logError, logInfo } from '$lib/server/logger';
import { getCategory, TIERS } from '$lib/constants/ots-catalog';

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

export const getPackageRequests = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

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
				clientEmail: table.client.email
			})
			.from(table.servicePackageRequest)
			.leftJoin(table.client, eq(table.servicePackageRequest.clientId, table.client.id))
			.where(eq(table.servicePackageRequest.tenantId, event.locals.tenant.id))
			.orderBy(desc(table.servicePackageRequest.createdAt));

		return rows.map((r) => ({
			...r,
			services: r.services ? (JSON.parse(r.services) as string[]) : null
		}));
	} catch (err) {
		const raw = err instanceof Error ? err : new Error(String(err));
		// Expose the underlying SQL error so we can see "no such table / no such column"
		// in the server log instead of just Drizzle's generic "Failed query".
		logError('packages', 'getPackageRequests SQL failed', {
			message: raw.message,
			cause: (raw as Error & { cause?: unknown }).cause
				? String((raw as Error & { cause?: unknown }).cause)
				: undefined,
			stack: raw.stack
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
			status: 'pending'
		});
	} catch (err) {
		const raw = err instanceof Error ? err : new Error(String(err));
		logError('packages', 'createPackageRequest INSERT failed', {
			message: raw.message,
			cause: (raw as Error & { cause?: unknown }).cause
				? String((raw as Error & { cause?: unknown }).cause)
				: undefined,
			categorySlug: data.categorySlug,
			tier: data.tier,
			stack: raw.stack
		});
		console.error('[packages.createPackageRequest] SQL error →', raw.message, raw);
		throw raw;
	}

	// Fire-and-forget notification to tenant admins/owners — do not block client response
	(async () => {
		try {
			const admins = await db
				.select({
					email: table.user.email,
					firstName: table.user.firstName,
					lastName: table.user.lastName
				})
				.from(table.tenantUser)
				.innerJoin(table.user, eq(table.tenantUser.userId, table.user.id))
				.where(
					and(
						eq(table.tenantUser.tenantId, tenantId),
						or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
					)
				);

			for (const admin of admins) {
				if (!admin.email) continue;
				const name = [admin.firstName, admin.lastName].filter(Boolean).join(' ');
				try {
					await sendPackageRequestEmail(requestId, admin.email, name || undefined);
				} catch (err) {
					logError('packages', 'sendPackageRequestEmail failed', {
						requestId,
						adminEmail: admin.email,
						error: err instanceof Error ? err.message : String(err)
					});
				}
			}
			logInfo('packages', 'package request admins notified', {
				requestId,
				adminCount: admins.length
			});
		} catch (err) {
			logError('packages', 'failed to enumerate admins for package request', {
				requestId,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	})().catch((err) => {
		// Extra safety net: ensures the fire-and-forget promise never triggers
		// an unhandled rejection that could abort the SvelteKit response.
		logError('packages', 'package request notification IIFE crashed', {
			requestId,
			error: err instanceof Error ? err.message : String(err)
		});
	});

	return { success: true, requestId };
});

export const updatePackageRequestStatus = command(updateStatusSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

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
