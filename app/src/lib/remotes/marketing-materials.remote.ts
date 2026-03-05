import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, or, sql, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import * as storage from '$lib/server/storage';

function generateMaterialId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function validateTags(value: string): boolean {
	const parts = value.split(',').map((t) => t.trim()).filter(Boolean);
	return parts.length <= 10 && parts.every((t) => t.length <= 50);
}

function isValidHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

export const getMarketingMaterials = query(
	v.object({
		clientId: v.optional(v.string()),
		clientIds: v.optional(v.array(v.string())),
		category: v.optional(v.string()),
		type: v.optional(v.string()),
		status: v.optional(v.string()),
		search: v.optional(v.string()),
		campaignType: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions = eq(table.marketingMaterial.tenantId, event.locals.tenant.id);

		// Client portal: force filter by client + only active materials
		if (event.locals.isClientUser && event.locals.client) {
			conditions = and(
				conditions,
				eq(table.marketingMaterial.clientId, event.locals.client.id),
				eq(table.marketingMaterial.status, 'active')
			) as typeof conditions;
		} else if (filters.clientId) {
			conditions = and(conditions, eq(table.marketingMaterial.clientId, filters.clientId)) as typeof conditions;
		} else if (filters.clientIds && filters.clientIds.length > 0) {
			conditions = and(conditions, inArray(table.marketingMaterial.clientId, filters.clientIds)) as typeof conditions;
		}

		if (filters.category) {
			conditions = and(conditions, eq(table.marketingMaterial.category, filters.category)) as typeof conditions;
		}
		if (filters.type) {
			conditions = and(conditions, eq(table.marketingMaterial.type, filters.type)) as typeof conditions;
		}
		if (filters.status) {
			conditions = and(conditions, eq(table.marketingMaterial.status, filters.status)) as typeof conditions;
		}
		if (filters.campaignType) {
			conditions = and(conditions, eq(table.marketingMaterial.campaignType, filters.campaignType)) as typeof conditions;
		}
		if (filters.search?.trim()) {
			const escaped = filters.search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_');
			const s = `%${escaped}%`;
			conditions = and(
				conditions,
				or(
					sql`${table.marketingMaterial.title} LIKE ${s} ESCAPE '\\'`,
					sql`${table.marketingMaterial.description} LIKE ${s} ESCAPE '\\'`,
					sql`${table.marketingMaterial.fileName} LIKE ${s} ESCAPE '\\'`
				)!
			) as typeof conditions;
		}

		const results = await db
			.select({
				id: table.marketingMaterial.id,
				tenantId: table.marketingMaterial.tenantId,
				clientId: table.marketingMaterial.clientId,
				category: table.marketingMaterial.category,
				type: table.marketingMaterial.type,
				title: table.marketingMaterial.title,
				description: table.marketingMaterial.description,
				filePath: table.marketingMaterial.filePath,
				fileSize: table.marketingMaterial.fileSize,
				mimeType: table.marketingMaterial.mimeType,
				fileName: table.marketingMaterial.fileName,
				textContent: table.marketingMaterial.textContent,
				dimensions: table.marketingMaterial.dimensions,
				externalUrl: table.marketingMaterial.externalUrl,
				seoLinkId: table.marketingMaterial.seoLinkId,
				status: table.marketingMaterial.status,
				uploadedByUserId: table.marketingMaterial.uploadedByUserId,
				uploadedByClientUserId: table.marketingMaterial.uploadedByClientUserId,
				campaignType: table.marketingMaterial.campaignType,
				tags: table.marketingMaterial.tags,
				attachedImages: table.marketingMaterial.attachedImages,
				createdAt: table.marketingMaterial.createdAt,
				updatedAt: table.marketingMaterial.updatedAt,
				// SEO link fields
				seoLinkKeyword: table.seoLink.keyword,
				seoLinkArticleUrl: table.seoLink.articleUrl,
				seoLinkTargetUrl: table.seoLink.targetUrl,
				seoLinkStatus: table.seoLink.status
			})
			.from(table.marketingMaterial)
			.leftJoin(table.seoLink, eq(table.marketingMaterial.seoLinkId, table.seoLink.id))
			.where(conditions)
			.orderBy(desc(table.marketingMaterial.createdAt))
			.limit(500);

		return results;
	}
);

const createSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1)),
	category: v.picklist(['google-ads', 'facebook-ads', 'tiktok-ads', 'press-article', 'seo-article']),
	type: v.picklist(['image', 'video', 'document', 'text', 'url']),
	title: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
	description: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(1000)))),
	textContent: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(50000)))),
	externalUrl: v.optional(v.nullable(v.pipe(v.string(), v.check(isValidHttpUrl, 'URL invalid. Trebuie să înceapă cu https:// sau http://')))),
	seoLinkId: v.optional(v.nullable(v.string())),
	status: v.optional(v.picklist(['draft', 'active', 'archived'])),
	campaignType: v.optional(v.nullable(v.picklist(['display', 'pmax', 'search', 'demand-gen']))),
	tags: v.optional(v.nullable(v.pipe(v.string(), v.check(validateTags, 'Maximum 10 taguri, fiecare maxim 50 caractere'))))
});

export const createMarketingMaterial = command(createSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const tenantId = event.locals.tenant.id;
	const isClientUser = event.locals.isClientUser;

	// Validate clientId
	if (isClientUser && event.locals.client) {
		if (data.clientId !== event.locals.client.id) {
			throw new Error('Nu puteți crea materiale pentru alt client');
		}
	} else {
		const [clientCheck] = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!clientCheck) {
			throw new Error('Client invalid');
		}
	}

	// Validate seoLinkId FK
	if (data.seoLinkId) {
		const [seoCheck] = await db
			.select({ id: table.seoLink.id })
			.from(table.seoLink)
			.where(and(eq(table.seoLink.id, data.seoLinkId), eq(table.seoLink.tenantId, tenantId)))
			.limit(1);
		if (!seoCheck) {
			throw new Error('SEO Link invalid');
		}
	}

	const materialId = generateMaterialId();

	await db.insert(table.marketingMaterial).values({
		id: materialId,
		tenantId,
		clientId: data.clientId,
		category: data.category,
		type: data.type,
		title: data.title,
		description: data.description || null,
		textContent: data.textContent || null,
		externalUrl: data.externalUrl || null,
		seoLinkId: data.seoLinkId || null,
		status: data.status || 'active',
		campaignType: data.campaignType || null,
		tags: data.tags || null,
		uploadedByUserId: isClientUser ? null : event.locals.user.id,
		uploadedByClientUserId: isClientUser ? (event.locals as any).clientUser?.id || null : null
	});

	return { success: true, materialId };
});

const updateSchema = v.object({
	id: v.pipe(v.string(), v.minLength(1)),
	title: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
	description: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(1000)))),
	textContent: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(50000)))),
	externalUrl: v.optional(v.nullable(v.pipe(v.string(), v.check(isValidHttpUrl, 'URL invalid. Trebuie să înceapă cu https:// sau http://')))),
	seoLinkId: v.optional(v.nullable(v.string())),
	status: v.optional(v.picklist(['draft', 'active', 'archived'])),
	campaignType: v.optional(v.nullable(v.picklist(['display', 'pmax', 'search', 'demand-gen']))),
	tags: v.optional(v.nullable(v.pipe(v.string(), v.check(validateTags, 'Maximum 10 taguri, fiecare maxim 50 caractere'))))
});

export const updateMarketingMaterial = command(updateSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const tenantId = event.locals.tenant.id;
	let conditions = and(
		eq(table.marketingMaterial.id, data.id),
		eq(table.marketingMaterial.tenantId, tenantId)
	);

	// Client users can only update their own uploads
	if (event.locals.isClientUser && event.locals.client) {
		const clientUserId = (event.locals as any).clientUser?.id;
		if (!clientUserId) {
			throw new Error('Sesiune client invalidă');
		}
		conditions = and(
			conditions,
			eq(table.marketingMaterial.clientId, event.locals.client.id),
			eq(table.marketingMaterial.uploadedByClientUserId, clientUserId)
		) as typeof conditions;
	}

	const [existing] = await db
		.select({ id: table.marketingMaterial.id })
		.from(table.marketingMaterial)
		.where(conditions!)
		.limit(1);

	if (!existing) {
		throw new Error('Material negăsit sau fără permisiune');
	}

	const isClientUser = event.locals.isClientUser;
	const updateData: Record<string, any> = { updatedAt: new Date() };
	if (data.title !== undefined) updateData.title = data.title;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.textContent !== undefined) updateData.textContent = data.textContent;
	if (data.externalUrl !== undefined) updateData.externalUrl = data.externalUrl;
	if (data.seoLinkId !== undefined) updateData.seoLinkId = data.seoLinkId;
	// Client users cannot change status (only admin can draft/archive)
	if (data.status !== undefined && !isClientUser) updateData.status = data.status;
	if (data.campaignType !== undefined) updateData.campaignType = data.campaignType;
	if (data.tags !== undefined) updateData.tags = data.tags;

	await db
		.update(table.marketingMaterial)
		.set(updateData)
		.where(conditions!);

	return { success: true };
});

export const deleteMarketingMaterial = command(
	v.pipe(v.string(), v.minLength(1)),
	async (materialId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const tenantId = event.locals.tenant.id;
		let conditions = and(
			eq(table.marketingMaterial.id, materialId),
			eq(table.marketingMaterial.tenantId, tenantId)
		);

		// Client users can only delete their own uploads
		if (event.locals.isClientUser && event.locals.client) {
			const clientUserId = (event.locals as any).clientUser?.id;
			if (!clientUserId) {
				throw new Error('Sesiune client invalidă');
			}
			conditions = and(
				conditions,
				eq(table.marketingMaterial.clientId, event.locals.client.id),
				eq(table.marketingMaterial.uploadedByClientUserId, clientUserId)
			) as typeof conditions;
		}

		const [material] = await db
			.select({
				id: table.marketingMaterial.id,
				filePath: table.marketingMaterial.filePath,
				attachedImages: table.marketingMaterial.attachedImages
			})
			.from(table.marketingMaterial)
			.where(conditions!)
			.limit(1);

		if (!material) {
			throw new Error('Material negăsit sau fără permisiune');
		}

		// Delete DB record first, then storage (orphan file is less harmful than orphan record)
		await db
			.delete(table.marketingMaterial)
			.where(conditions!);

		// Delete file from MinIO if exists
		if (material.filePath) {
			try {
				await storage.deleteFile(material.filePath);
			} catch (e) {
				console.error('Error deleting marketing material file:', e);
			}
		}

		// Delete attached images from MinIO if exist
		if (material.attachedImages) {
			try {
				const images = JSON.parse(material.attachedImages) as { filePath: string }[];
				for (const img of images) {
					try {
						await storage.deleteFile(img.filePath);
					} catch (e) {
						console.error('Error deleting attached image:', e);
					}
				}
			} catch {
				// Invalid JSON, skip
			}
		}

		return { success: true };
	}
);

export const getMaterialDownloadUrl = query(
	v.pipe(v.string(), v.minLength(1)),
	async (materialId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const tenantId = event.locals.tenant.id;
		let conditions = and(
			eq(table.marketingMaterial.id, materialId),
			eq(table.marketingMaterial.tenantId, tenantId)
		);

		if (event.locals.isClientUser && event.locals.client) {
			conditions = and(
				conditions,
				eq(table.marketingMaterial.clientId, event.locals.client.id)
			) as typeof conditions;
		}

		const [material] = await db
			.select({
				filePath: table.marketingMaterial.filePath,
				fileName: table.marketingMaterial.fileName,
				mimeType: table.marketingMaterial.mimeType
			})
			.from(table.marketingMaterial)
			.where(conditions!)
			.limit(1);

		if (!material || !material.filePath) {
			throw new Error('Material negăsit sau fără fișier');
		}

		const url = await storage.getDownloadUrl(material.filePath, 300);
		return { url, fileName: material.fileName, mimeType: material.mimeType };
	}
);

export const getMaterialAttachedImageUrl = query(
	v.object({
		materialId: v.pipe(v.string(), v.minLength(1)),
		imageIndex: v.pipe(v.number(), v.minValue(0), v.maxValue(2))
	}),
	async ({ materialId, imageIndex }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const tenantId = event.locals.tenant.id;
		let conditions = and(
			eq(table.marketingMaterial.id, materialId),
			eq(table.marketingMaterial.tenantId, tenantId)
		);

		if (event.locals.isClientUser && event.locals.client) {
			conditions = and(
				conditions,
				eq(table.marketingMaterial.clientId, event.locals.client.id)
			) as typeof conditions;
		}

		const [material] = await db
			.select({ attachedImages: table.marketingMaterial.attachedImages })
			.from(table.marketingMaterial)
			.where(conditions!)
			.limit(1);

		if (!material?.attachedImages) {
			throw new Error('Material negăsit sau fără imagini atașate');
		}

		let images: { filePath: string; fileName: string; mimeType: string }[];
		try {
			images = JSON.parse(material.attachedImages);
			if (!Array.isArray(images)) throw new Error('Format invalid');
		} catch {
			throw new Error('Date imagini atașate corupte');
		}

		if (imageIndex >= images.length) {
			throw new Error('Index imagine invalid');
		}

		const img = images[imageIndex];
		const url = await storage.getDownloadUrl(img.filePath, 300);
		return { url, fileName: img.fileName, mimeType: img.mimeType };
	}
);

// --- Social URL Sets (TikTok / Facebook) ---

const socialUrlSetsSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1)),
	category: v.picklist(['facebook-ads', 'tiktok-ads']),
	sets: v.pipe(
		v.array(
			v.object({
				title: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
				urls: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1))
			})
		),
		v.minLength(1)
	),
	tags: v.nullable(v.pipe(v.string(), v.maxLength(500))),
	taskId: v.nullable(v.string())
});

export const createSocialUrlSets = command(socialUrlSetsSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const tenantId = event.locals.tenant.id;
	const isClientUser = event.locals.isClientUser;

	// Validate client belongs to tenant
	if (isClientUser && event.locals.client) {
		if (data.clientId !== event.locals.client.id) {
			throw new Error('Nu puteți crea materiale pentru alt client');
		}
	} else {
		const [clientCheck] = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!clientCheck) throw new Error('Client invalid');
	}

	// Validate taskId if provided
	if (data.taskId) {
		const [taskCheck] = await db
			.select({ id: table.task.id })
			.from(table.task)
			.where(and(eq(table.task.id, data.taskId), eq(table.task.tenantId, tenantId)))
			.limit(1);
		if (!taskCheck) throw new Error('Task invalid');
	}

	// Validate all URLs
	for (const set of data.sets) {
		for (const url of set.urls) {
			if (!isValidHttpUrl(url)) {
				throw new Error(`URL invalid în setul "${set.title}": ${url}`);
			}
		}
	}

	const categoryLabel = data.category === 'tiktok-ads' ? 'TikTok Ads' : 'Facebook Ads';
	const dateStr = new Date().toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' });
	const materialId = generateMaterialId();

	await db.transaction(async (tx) => {
		await tx.insert(table.marketingMaterial).values({
			id: materialId,
			tenantId,
			clientId: data.clientId,
			category: data.category,
			type: 'url',
			title: `${categoryLabel} — ${dateStr}`,
			textContent: JSON.stringify(data.sets.map(s => ({ title: s.title, urls: s.urls }))),
			externalUrl: data.sets[0].urls[0],
			tags: data.tags || null,
			status: 'active',
			uploadedByUserId: isClientUser ? null : event.locals.user!.id,
			uploadedByClientUserId: isClientUser
				? (event.locals as any).clientUser?.id || null
				: null
		});

		if (data.taskId) {
			await tx.insert(table.taskMarketingMaterial).values({
				id: generateMaterialId(),
				tenantId,
				taskId: data.taskId,
				marketingMaterialId: materialId,
				addedByUserId: event.locals.user!.id
			});
		}
	});

	return { success: true, materialIds: [materialId] };
});
