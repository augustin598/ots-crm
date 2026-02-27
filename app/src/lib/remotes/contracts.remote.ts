import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, inArray, like, sql, asc, desc } from 'drizzle-orm';
import { encodeBase32LowerCase, encodeBase64url, encodeHexLowerCase } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';
import { sendContractSigningEmail } from '$lib/server/email';
import { env as publicEnv } from '$env/dynamic/public';

function generateContractId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateContractLineItemId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const getContract = query(v.pipe(v.string(), v.minLength(1)), async (contractId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [contract] = await db
		.select()
		.from(table.contract)
		.where(
			and(eq(table.contract.id, contractId), eq(table.contract.tenantId, event.locals.tenant.id))
		)
		.limit(1);

	if (!contract) {
		throw new Error('Contract not found');
	}

	const lineItems = await db
		.select()
		.from(table.contractLineItem)
		.where(eq(table.contractLineItem.contractId, contractId))
		.orderBy(asc(table.contractLineItem.sortOrder));

	return {
		...contract,
		lineItems
	};
});

export const getContracts = query(
	v.object({
		clientId: v.optional(v.union([v.string(), v.array(v.string())])),
		status: v.optional(v.union([v.string(), v.array(v.string())])),
		search: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions: any = eq(table.contract.tenantId, event.locals.tenant.id);

		// If user is a client user, filter by their client ID
		if (event.locals.isClientUser && event.locals.client) {
			conditions = and(conditions, eq(table.contract.clientId, event.locals.client.id)) as any;
		} else if (filters.clientId) {
			const clientIds = Array.isArray(filters.clientId) ? filters.clientId : [filters.clientId];
			conditions = and(conditions, inArray(table.contract.clientId, clientIds)) as any;
		}

		// Status filter
		if (filters.status) {
			const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
			conditions = and(conditions, inArray(table.contract.status, statuses)) as any;
		}

		// Search filter (contract number)
		if (filters.search) {
			const searchPattern = `%${filters.search}%`;
			conditions = and(
				conditions,
				like(table.contract.contractNumber, searchPattern)
			) as any;
		}

		return await db
			.select()
			.from(table.contract)
			.where(conditions)
			.orderBy(desc(table.contract.contractDate));
	}
);

const contractLineItemSchema = v.object({
	description: v.pipe(v.string(), v.minLength(1)),
	price: v.number(), // in cents
	unitOfMeasure: v.optional(v.string()),
	sortOrder: v.optional(v.number())
});

export const createContract = command(
	v.object({
		clientId: v.pipe(v.string(), v.minLength(1)),
		templateId: v.optional(v.string()),
		contractDate: v.optional(v.string()),
		contractTitle: v.optional(v.string()),
		status: v.optional(v.string()),
		serviceDescription: v.optional(v.string()),
		offerLink: v.optional(v.string()),
		currency: v.optional(v.string()),
		paymentTermsDays: v.optional(v.number()),
		penaltyRate: v.optional(v.number()),
		billingFrequency: v.optional(v.string()),
		contractDurationMonths: v.optional(v.number()),
		discountPercent: v.optional(v.number()),
		prestatorEmail: v.optional(v.string()),
		beneficiarEmail: v.optional(v.string()),
		hourlyRate: v.optional(v.number()),
		hourlyRateCurrency: v.optional(v.string()),
		prestatorSignatureName: v.optional(v.string()),
		beneficiarSignatureName: v.optional(v.string()),
		clausesJson: v.optional(v.string()),
		notes: v.optional(v.string()),
		lineItems: v.optional(v.array(contractLineItemSchema))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Auto-generate contract number: query max contract_number for tenant, increment
		const [maxResult] = await db
			.select({
				maxNumber: sql<string>`max(${table.contract.contractNumber})`
			})
			.from(table.contract)
			.where(eq(table.contract.tenantId, event.locals.tenant.id));

		let nextNumber = 1;
		if (maxResult?.maxNumber) {
			// Try to extract numeric part from the contract number
			const match = maxResult.maxNumber.match(/(\d+)$/);
			if (match) {
				nextNumber = parseInt(match[1], 10) + 1;
			}
		}
		const contractNumber = `CTR-${String(nextNumber).padStart(4, '0')}`;

		const contractId = generateContractId();

		// If templateId provided, copy clausesJson from template
		let clausesJson = data.clausesJson || null;
		if (data.templateId && !clausesJson) {
			const [template] = await db
				.select()
				.from(table.contractTemplate)
				.where(
					and(
						eq(table.contractTemplate.id, data.templateId),
						eq(table.contractTemplate.tenantId, event.locals.tenant.id)
					)
				)
				.limit(1);

			if (template?.clausesJson) {
				clausesJson = template.clausesJson;
			}
		}

		const newContract = {
			id: contractId,
			tenantId: event.locals.tenant.id,
			clientId: data.clientId,
			templateId: data.templateId || null,
			contractNumber,
			contractDate: data.contractDate ? new Date(data.contractDate) : new Date(),
			contractTitle: data.contractTitle || 'PRESTARI SERVICII INFORMATICE',
			status: data.status || 'draft',
			serviceDescription: data.serviceDescription || null,
			offerLink: data.offerLink || null,
			currency: data.currency || 'EUR',
			paymentTermsDays: data.paymentTermsDays ?? 5,
			penaltyRate: data.penaltyRate ?? 50,
			billingFrequency: data.billingFrequency || 'monthly',
			contractDurationMonths: data.contractDurationMonths ?? 6,
			discountPercent: data.discountPercent ?? null,
			prestatorEmail: data.prestatorEmail || null,
			beneficiarEmail: data.beneficiarEmail || null,
			hourlyRate: data.hourlyRate ?? 6000,
			hourlyRateCurrency: data.hourlyRateCurrency || 'EUR',
			prestatorSignatureName: data.prestatorSignatureName || null,
			beneficiarSignatureName: data.beneficiarSignatureName || null,
			clausesJson,
			notes: data.notes || null,
			createdByUserId: event.locals.user.id
		};

		// Use transaction to create contract and line items
		await db.transaction(async (tx) => {
			await tx.insert(table.contract).values(newContract);

			// Insert line items if provided
			if (data.lineItems && data.lineItems.length > 0) {
				const lineItemsToInsert = data.lineItems.map((item, index) => ({
					id: generateContractLineItemId(),
					contractId,
					description: item.description,
					price: item.price,
					unitOfMeasure: item.unitOfMeasure || 'Luna',
					sortOrder: item.sortOrder ?? index
				}));

				await tx.insert(table.contractLineItem).values(lineItemsToInsert);
			}
		});

		// Fetch the created contract with line items
		const [createdContract] = await db
			.select()
			.from(table.contract)
			.where(eq(table.contract.id, contractId))
			.limit(1);

		const lineItems = await db
			.select()
			.from(table.contractLineItem)
			.where(eq(table.contractLineItem.contractId, contractId))
			.orderBy(asc(table.contractLineItem.sortOrder));

		return {
			success: true,
			contractId,
			contract: { ...createdContract, lineItems }
		};
	}
);

export const updateContract = command(
	v.object({
		contractId: v.pipe(v.string(), v.minLength(1)),
		clientId: v.optional(v.string()),
		templateId: v.optional(v.string()),
		contractDate: v.optional(v.string()),
		contractTitle: v.optional(v.string()),
		status: v.optional(v.string()),
		serviceDescription: v.optional(v.string()),
		offerLink: v.optional(v.string()),
		currency: v.optional(v.string()),
		paymentTermsDays: v.optional(v.number()),
		penaltyRate: v.optional(v.number()),
		billingFrequency: v.optional(v.string()),
		contractDurationMonths: v.optional(v.number()),
		discountPercent: v.optional(v.number()),
		prestatorEmail: v.optional(v.string()),
		beneficiarEmail: v.optional(v.string()),
		hourlyRate: v.optional(v.number()),
		hourlyRateCurrency: v.optional(v.string()),
		prestatorSignatureName: v.optional(v.string()),
		beneficiarSignatureName: v.optional(v.string()),
		clausesJson: v.optional(v.string()),
		notes: v.optional(v.string()),
		lineItems: v.optional(v.array(contractLineItemSchema))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { contractId, lineItems, ...updateData } = data;

		// Verify contract belongs to tenant
		const [existing] = await db
			.select()
			.from(table.contract)
			.where(
				and(
					eq(table.contract.id, contractId),
					eq(table.contract.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Contract not found');
		}

		await db.transaction(async (tx) => {
			await tx
				.update(table.contract)
				.set({
					clientId: updateData.clientId || undefined,
					templateId:
						updateData.templateId !== undefined ? updateData.templateId || null : undefined,
					contractDate: updateData.contractDate
						? new Date(updateData.contractDate)
						: undefined,
					contractTitle: updateData.contractTitle || undefined,
					status: updateData.status || undefined,
					serviceDescription:
						updateData.serviceDescription !== undefined
							? updateData.serviceDescription || null
							: undefined,
					offerLink:
						updateData.offerLink !== undefined ? updateData.offerLink || null : undefined,
					currency: updateData.currency || undefined,
					paymentTermsDays: updateData.paymentTermsDays ?? undefined,
					penaltyRate: updateData.penaltyRate ?? undefined,
					billingFrequency: updateData.billingFrequency || undefined,
					contractDurationMonths: updateData.contractDurationMonths ?? undefined,
					discountPercent:
						updateData.discountPercent !== undefined ? updateData.discountPercent : undefined,
					prestatorEmail:
						updateData.prestatorEmail !== undefined
							? updateData.prestatorEmail || null
							: undefined,
					beneficiarEmail:
						updateData.beneficiarEmail !== undefined
							? updateData.beneficiarEmail || null
							: undefined,
					hourlyRate: updateData.hourlyRate ?? undefined,
					hourlyRateCurrency: updateData.hourlyRateCurrency || undefined,
					prestatorSignatureName:
						updateData.prestatorSignatureName !== undefined
							? updateData.prestatorSignatureName || null
							: undefined,
					beneficiarSignatureName:
						updateData.beneficiarSignatureName !== undefined
							? updateData.beneficiarSignatureName || null
							: undefined,
					clausesJson:
						updateData.clausesJson !== undefined ? updateData.clausesJson || null : undefined,
					notes: updateData.notes !== undefined ? updateData.notes || null : undefined,
					updatedAt: new Date()
				})
				.where(eq(table.contract.id, contractId));

			// Replace line items if provided
			if (lineItems !== undefined) {
				// Delete old line items
				await tx
					.delete(table.contractLineItem)
					.where(eq(table.contractLineItem.contractId, contractId));

				// Insert new line items
				if (lineItems && lineItems.length > 0) {
					const lineItemsToInsert = lineItems.map((item, index) => ({
						id: generateContractLineItemId(),
						contractId,
						description: item.description,
						price: item.price,
						unitOfMeasure: item.unitOfMeasure || 'Luna',
						sortOrder: item.sortOrder ?? index
					}));

					await tx.insert(table.contractLineItem).values(lineItemsToInsert);
				}
			}
		});

		return { success: true };
	}
);

export const deleteContract = command(
	v.pipe(v.string(), v.minLength(1)),
	async (contractId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify contract belongs to tenant
		const [existing] = await db
			.select()
			.from(table.contract)
			.where(
				and(
					eq(table.contract.id, contractId),
					eq(table.contract.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Contract not found');
		}

		// Delete sign tokens first (no cascade on FK)
		await db
			.delete(table.contractSignToken)
			.where(eq(table.contractSignToken.contractId, contractId));

		await db.delete(table.contract).where(eq(table.contract.id, contractId));

		return { success: true };
	}
);

export const duplicateContract = command(
	v.pipe(v.string(), v.minLength(1)),
	async (contractId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Fetch existing contract
		const [existing] = await db
			.select()
			.from(table.contract)
			.where(
				and(
					eq(table.contract.id, contractId),
					eq(table.contract.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Contract not found');
		}

		// Fetch existing line items
		const existingLineItems = await db
			.select()
			.from(table.contractLineItem)
			.where(eq(table.contractLineItem.contractId, contractId))
			.orderBy(asc(table.contractLineItem.sortOrder));

		// Generate new contract number
		const [maxResult] = await db
			.select({
				maxNumber: sql<string>`max(${table.contract.contractNumber})`
			})
			.from(table.contract)
			.where(eq(table.contract.tenantId, event.locals.tenant.id));

		let nextNumber = 1;
		if (maxResult?.maxNumber) {
			const match = maxResult.maxNumber.match(/(\d+)$/);
			if (match) {
				nextNumber = parseInt(match[1], 10) + 1;
			}
		}
		const contractNumber = `CTR-${String(nextNumber).padStart(4, '0')}`;

		const newContractId = generateContractId();

		const newContract = {
			id: newContractId,
			tenantId: event.locals.tenant.id,
			clientId: existing.clientId,
			templateId: existing.templateId,
			contractNumber,
			contractDate: new Date(),
			contractTitle: existing.contractTitle,
			status: 'draft',
			serviceDescription: existing.serviceDescription,
			offerLink: existing.offerLink,
			currency: existing.currency,
			paymentTermsDays: existing.paymentTermsDays,
			penaltyRate: existing.penaltyRate,
			billingFrequency: existing.billingFrequency,
			contractDurationMonths: existing.contractDurationMonths,
			discountPercent: existing.discountPercent,
			prestatorEmail: existing.prestatorEmail,
			beneficiarEmail: existing.beneficiarEmail,
			hourlyRate: existing.hourlyRate,
			hourlyRateCurrency: existing.hourlyRateCurrency,
			prestatorSignatureName: existing.prestatorSignatureName,
			beneficiarSignatureName: existing.beneficiarSignatureName,
			clausesJson: existing.clausesJson,
			notes: existing.notes,
			createdByUserId: event.locals.user.id
		};

		await db.transaction(async (tx) => {
			await tx.insert(table.contract).values(newContract);

			if (existingLineItems.length > 0) {
				const lineItemsToInsert = existingLineItems.map((item) => ({
					id: generateContractLineItemId(),
					contractId: newContractId,
					description: item.description,
					price: item.price,
					unitOfMeasure: item.unitOfMeasure,
					sortOrder: item.sortOrder
				}));

				await tx.insert(table.contractLineItem).values(lineItemsToInsert);
			}
		});

		// Fetch the duplicated contract with line items
		const [duplicatedContract] = await db
			.select()
			.from(table.contract)
			.where(eq(table.contract.id, newContractId))
			.limit(1);

		const lineItems = await db
			.select()
			.from(table.contractLineItem)
			.where(eq(table.contractLineItem.contractId, newContractId))
			.orderBy(asc(table.contractLineItem.sortOrder));

		return {
			success: true,
			contractId: newContractId,
			contract: { ...duplicatedContract, lineItems }
		};
	}
);

export const sendContractForSigning = command(
	v.object({
		contractId: v.pipe(v.string(), v.minLength(1)),
		email: v.pipe(v.string(), v.email())
	}),
	async ({ contractId, email }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		const tenantId = event.locals.tenant.id;
		const tenantSlug = event.locals.tenant.slug;

		const [contract] = await db
			.select()
			.from(table.contract)
			.where(and(eq(table.contract.id, contractId), eq(table.contract.tenantId, tenantId)))
			.limit(1);

		if (!contract) throw new Error('Contract not found');

		const [client] = await db
			.select()
			.from(table.client)
			.where(eq(table.client.id, contract.clientId))
			.limit(1);

		// Generate signing token
		const rawBytes = crypto.getRandomValues(new Uint8Array(32));
		const rawToken = encodeBase64url(rawBytes);
		const hashedToken = encodeHexLowerCase(sha256(new TextEncoder().encode(rawToken)));
		const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));

		const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

		const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';
		const signingUrl = `${baseUrl}/sign/${tenantSlug}/${encodeURIComponent(rawToken)}`;

		await db.insert(table.contractSignToken).values({
			id: tokenId,
			token: hashedToken,
			contractId,
			tenantId,
			email,
			signingUrl,
			expiresAt,
			used: false
		});

		// Update contract status to 'sent'
		await db
			.update(table.contract)
			.set({ status: 'sent', updatedAt: new Date() })
			.where(eq(table.contract.id, contractId));

		// Try to send email — best-effort with 5s timeout, don't fail if SMTP not configured
		let emailSent = false;
		try {
			const clientName = client?.businessName || client?.name || 'Client';
			const emailPromise = sendContractSigningEmail(
				email,
				rawToken,
				tenantSlug,
				contract.contractNumber,
				clientName
			);
			const timeoutPromise = new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Email timeout after 5s')), 5000)
			);
			await Promise.race([emailPromise, timeoutPromise]);
			emailSent = true;
		} catch (err) {
			console.error('Email sending failed (non-fatal):', err);
		}

		return { success: true, signingUrl, emailSent };
	}
);

export const signContractAsPrestator = command(
	v.object({
		contractId: v.pipe(v.string(), v.minLength(1)),
		signatureName: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
		signatureImage: v.optional(v.string())
	}),
	async ({ contractId, signatureName, signatureImage }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		const tenantId = event.locals.tenant.id;

		const [contract] = await db
			.select()
			.from(table.contract)
			.where(and(eq(table.contract.id, contractId), eq(table.contract.tenantId, tenantId)))
			.limit(1);

		if (!contract) throw new Error('Contract not found');

		const imageToSave =
			signatureImage?.startsWith('data:image/png;base64,') ? signatureImage : null;

		await db
			.update(table.contract)
			.set({
				prestatorSignatureName: signatureName,
				prestatorSignatureImage: imageToSave,
				prestatorSignedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(table.contract.id, contractId));

		return { success: true };
	}
);

export const getActiveSigningToken = query(
	v.pipe(v.string(), v.minLength(1)),
	async (contractId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		const tenantId = event.locals.tenant.id;

		const [token] = await db
			.select()
			.from(table.contractSignToken)
			.where(
				and(
					eq(table.contractSignToken.contractId, contractId),
					eq(table.contractSignToken.tenantId, tenantId),
					eq(table.contractSignToken.used, false)
				)
			)
			.orderBy(desc(table.contractSignToken.expiresAt))
			.limit(1);

		if (!token || token.expiresAt < new Date()) {
			return { hasActiveToken: false, expiresAt: null, email: null };
		}

		return {
			hasActiveToken: true,
			expiresAt: token.expiresAt.toISOString(),
			email: token.email,
			signingUrl: token.signingUrl ?? null
		};
	}
);
