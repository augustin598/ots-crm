import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';

/**
 * Admin-side management of hosting inquiries submitted via the public
 * /pachete-hosting marketing page.
 */

function tenantScope() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	return { event, tenantId: event.locals.tenant.id };
}

const IdSchema = v.pipe(v.string(), v.minLength(1));

export const getHostingInquiries = query(async () => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');

	return db
		.select({
			id: table.hostingInquiry.id,
			hostingProductId: table.hostingInquiry.hostingProductId,
			contactName: table.hostingInquiry.contactName,
			contactEmail: table.hostingInquiry.contactEmail,
			contactPhone: table.hostingInquiry.contactPhone,
			companyName: table.hostingInquiry.companyName,
			vatNumber: table.hostingInquiry.vatNumber,
			message: table.hostingInquiry.message,
			status: table.hostingInquiry.status,
			source: table.hostingInquiry.source,
			ipAddress: table.hostingInquiry.ipAddress,
			createdAt: table.hostingInquiry.createdAt,
			contactedAt: table.hostingInquiry.contactedAt,
			productName: table.hostingProduct.name
		})
		.from(table.hostingInquiry)
		.leftJoin(
			table.hostingProduct,
			eq(table.hostingInquiry.hostingProductId, table.hostingProduct.id)
		)
		.where(eq(table.hostingInquiry.tenantId, tenantId))
		.orderBy(desc(table.hostingInquiry.createdAt));
});

const UpdateStatusSchema = v.object({
	id: IdSchema,
	status: v.picklist(['new', 'contacted', 'converted', 'discarded'])
});

export const updateHostingInquiryStatus = command(UpdateStatusSchema, async (params) => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	const updates: Record<string, unknown> = {
		status: params.status,
		updatedAt: new Date()
	};
	if (params.status === 'contacted') {
		updates.contactedAt = new Date();
	}

	await db
		.update(table.hostingInquiry)
		.set(updates)
		.where(
			and(
				eq(table.hostingInquiry.id, params.id),
				eq(table.hostingInquiry.tenantId, tenantId)
			)
		);

	return { success: true };
});

export const deleteHostingInquiry = command(IdSchema, async (id) => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.manage');

	await db
		.delete(table.hostingInquiry)
		.where(
			and(eq(table.hostingInquiry.id, id), eq(table.hostingInquiry.tenantId, tenantId))
		);

	return { success: true };
});
