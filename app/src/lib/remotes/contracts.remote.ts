import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, inArray, like, sql, asc, desc } from 'drizzle-orm';
import { encodeBase32LowerCase, encodeBase64url, encodeHexLowerCase } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';
import { sendContractSigningEmail } from '$lib/server/email';
import * as storage from '$lib/server/storage';
import { env as publicEnv } from '$env/dynamic/public';
import { extractTextFromPDF, extractClientInfoFromText, type ClientExtractedInfo, type TenantInfo } from '$lib/server/pdf-client-extractor';
import { env } from '$env/dynamic/private';
import { recordContractActivity } from '$lib/server/contract-activity';

const DEBUG_EXTRACTION = () => env.DEBUG_CONTRACT_EXTRACTION === 'true';

const CONTRACT_STATUSES = ['draft', 'sent', 'signed', 'active', 'expired', 'cancelled'] as const;
type ContractStatus = (typeof CONTRACT_STATUSES)[number];

const VALID_STATUS_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
	draft: ['sent', 'cancelled'],
	sent: ['signed', 'draft', 'cancelled'],
	signed: ['active', 'cancelled'],
	active: ['expired', 'cancelled'],
	expired: [],
	cancelled: []
};

function validateStatusTransition(currentStatus: string, newStatus: string): void {
	if (!CONTRACT_STATUSES.includes(newStatus as ContractStatus)) {
		throw new Error(`Status invalid: "${newStatus}". Statusuri valide: ${CONTRACT_STATUSES.join(', ')}`);
	}
	const allowed = VALID_STATUS_TRANSITIONS[currentStatus as ContractStatus];
	if (allowed && !allowed.includes(newStatus as ContractStatus)) {
		throw new Error(
			`Tranziție de status nepermisă: "${currentStatus}" → "${newStatus}". Tranzitii permise din "${currentStatus}": ${allowed.length > 0 ? allowed.join(', ') : 'niciuna'}`
		);
	}
}

async function generateContractNumber(txOrDb: { select: typeof db.select }, tenantId: string, prefix: string): Promise<string> {
	const [maxResult] = await txOrDb
		.select({
			maxNumber: sql<string>`max(${table.contract.contractNumber})`
		})
		.from(table.contract)
		.where(eq(table.contract.tenantId, tenantId));

	let nextNumber = 1;
	if (maxResult?.maxNumber) {
		const match = maxResult.maxNumber.match(/(\d+)$/);
		if (match) {
			nextNumber = parseInt(match[1], 10) + 1;
		}
	}
	return `${prefix}-${String(nextNumber).padStart(4, '0')}`;
}

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
		search: v.optional(v.string()),
		page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
		pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)))
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const page = filters.page || 1;
		const pageSize = filters.pageSize || 25;
		const offset = (page - 1) * pageSize;

		const whereConditions = [eq(table.contract.tenantId, event.locals.tenant.id)];

		// If user is a client user, filter by their client ID
		if (event.locals.isClientUser && event.locals.client) {
			// Secondary email users cannot see contracts
			if (!event.locals.isClientUserPrimary) return { contracts: [], totalCount: 0, page, pageSize, totalPages: 0 };
			whereConditions.push(eq(table.contract.clientId, event.locals.client.id));
		} else if (filters.clientId) {
			const clientIds = Array.isArray(filters.clientId) ? filters.clientId : [filters.clientId];
			whereConditions.push(inArray(table.contract.clientId, clientIds));
		}

		// Status filter
		if (filters.status) {
			const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
			whereConditions.push(inArray(table.contract.status, statuses));
		}

		// Search filter (contract number)
		if (filters.search) {
			const searchPattern = `%${filters.search}%`;
			whereConditions.push(like(table.contract.contractNumber, searchPattern));
		}

		const whereClause = and(...whereConditions);

		// Count query
		const [countResult] = await db
			.select({ count: sql<number>`count(*)` })
			.from(table.contract)
			.where(whereClause);

		const totalCount = countResult?.count || 0;
		const totalPages = Math.ceil(totalCount / pageSize);

		// Data query with pagination — select only columns needed for list view
		const contracts = await db
			.select({
				id: table.contract.id,
				tenantId: table.contract.tenantId,
				clientId: table.contract.clientId,
				contractNumber: table.contract.contractNumber,
				contractDate: table.contract.contractDate,
				contractTitle: table.contract.contractTitle,
				status: table.contract.status,
				currency: table.contract.currency,
				contractDurationMonths: table.contract.contractDurationMonths,
				billingFrequency: table.contract.billingFrequency,
				uploadedFilePath: table.contract.uploadedFilePath
			})
			.from(table.contract)
			.where(whereClause)
			.orderBy(desc(table.contract.contractDate))
			.limit(pageSize)
			.offset(offset);

		// Fetch line item totals for listed contracts
		// Fetch tenant tax rate
		const [settings] = await db
			.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
			.limit(1);
		const taxRate = settings?.defaultTaxRate ?? 19;

		const contractIds = contracts.map(c => c.id);
		const priceMap = new Map<string, number>();
		if (contractIds.length > 0) {
			const totals = await db
				.select({
					contractId: table.contractLineItem.contractId,
					total: sql<number>`sum(${table.contractLineItem.price})`
				})
				.from(table.contractLineItem)
				.where(inArray(table.contractLineItem.contractId, contractIds))
				.groupBy(table.contractLineItem.contractId);
			for (const t of totals) {
				priceMap.set(t.contractId, Number(t.total) || 0);
			}
		}
		const contractsWithPrice = contracts.map(c => {
			const price = priceMap.get(c.id) || 0;
			const tvaAmount = Math.round(price * taxRate / 100);
			return {
				...c,
				totalPrice: price,
				tvaAmount,
				totalWithTVA: price + tvaAmount,
				taxRate
			};
		});

		// For client users, attach signing URLs for draft/sent contracts
		if (event.locals.isClientUser) {
			const signingIds = contractsWithPrice
				.filter(c => c.status === 'draft' || c.status === 'sent')
				.map(c => c.id);

			if (signingIds.length > 0) {
				const tokens = await db
					.select()
					.from(table.contractSignToken)
					.where(
						and(
							inArray(table.contractSignToken.contractId, signingIds),
							eq(table.contractSignToken.tenantId, event.locals.tenant.id),
							eq(table.contractSignToken.used, false)
						)
					);

				const now = new Date();
				const tokenMap = new Map<string, string>();
				for (const token of tokens) {
					if (token.signingUrl && token.expiresAt > now) {
						tokenMap.set(token.contractId, token.signingUrl);
					}
				}

				return {
					contracts: contractsWithPrice.map(c => ({
						...c,
						signingUrl: tokenMap.get(c.id) ?? null
					})),
					totalCount,
					page,
					pageSize,
					totalPages
				};
			}
		}

		return { contracts: contractsWithPrice, totalCount, page, pageSize, totalPages };
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
		contractNumber: v.optional(v.string()),
		templateId: v.optional(v.string()),
		contractDate: v.optional(v.string()),
		contractTitle: v.optional(v.string()),
		status: v.optional(v.picklist(CONTRACT_STATUSES)),
		serviceDescription: v.optional(v.string()),
		offerLink: v.optional(v.string()),
		currency: v.optional(v.string()),
		paymentTermsDays: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(365))),
		penaltyRate: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(10000))),
		billingFrequency: v.optional(v.string()),
		contractDurationMonths: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(600))),
		discountPercent: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(100))),
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

		// Validate clientId belongs to current tenant
		const [clientCheck] = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(
				and(
					eq(table.client.id, data.clientId),
					eq(table.client.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!clientCheck) {
			throw new Error('Client invalid sau nu aparține acestui tenant');
		}

		const tenantId = event.locals.tenant.id;
		const userId = event.locals.user.id;
		const prefix = event.locals.tenant.contractPrefix || 'CTR';
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
						eq(table.contractTemplate.tenantId, tenantId)
					)
				)
				.limit(1);

			if (template?.clausesJson) {
				clausesJson = template.clausesJson;
			}
		}

		// Use transaction for atomic contract number generation + insert
		await db.transaction(async (tx) => {
			const contractNumber = data.contractNumber?.trim() || await generateContractNumber(tx, tenantId, prefix);

			await tx.insert(table.contract).values({
				id: contractId,
				tenantId,
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
				createdByUserId: userId
			});

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

		// Audit trail
		await recordContractActivity({
			contractId,
			userId: event.locals.user.id,
			tenantId: event.locals.tenant.id,
			action: 'created'
		});

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
		version: v.pipe(v.number(), v.integer(), v.minValue(1)),
		clientId: v.optional(v.string()),
		templateId: v.optional(v.string()),
		contractDate: v.optional(v.string()),
		contractTitle: v.optional(v.string()),
		status: v.optional(v.picklist(CONTRACT_STATUSES)),
		serviceDescription: v.optional(v.string()),
		offerLink: v.optional(v.string()),
		currency: v.optional(v.string()),
		paymentTermsDays: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(365))),
		penaltyRate: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(10000))),
		billingFrequency: v.optional(v.string()),
		contractDurationMonths: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(600))),
		discountPercent: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(100))),
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

		const { contractId, version, lineItems, ...updateData } = data;

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

		// Only allow editing draft or sent contracts
		if (existing.status !== 'draft' && existing.status !== 'sent') {
			throw new Error(`Nu se poate edita un contract cu statusul "${existing.status}". Doar contractele în starea "draft" sau "sent" pot fi editate.`);
		}

		// Optimistic locking check
		if (version !== existing.version) {
			throw new Error('Contractul a fost modificat de altcineva. Reîncărcați pagina și încercați din nou.');
		}

		// Validate status transition if status is being changed
		if (updateData.status && updateData.status !== existing.status) {
			validateStatusTransition(existing.status, updateData.status);
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
					version: existing.version + 1,
					updatedAt: new Date()
				})
				.where(and(eq(table.contract.id, contractId), eq(table.contract.version, version)));

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

		// Audit trail: record field-level changes
		const trackableFields = [
			'clientId', 'templateId', 'contractDate', 'contractTitle', 'status',
			'serviceDescription', 'offerLink', 'currency', 'paymentTermsDays',
			'penaltyRate', 'billingFrequency', 'contractDurationMonths', 'discountPercent',
			'prestatorEmail', 'beneficiarEmail', 'hourlyRate', 'hourlyRateCurrency',
			'notes'
		] as const;

		for (const field of trackableFields) {
			if (updateData[field] !== undefined && String(updateData[field] ?? '') !== String((existing as any)[field] ?? '')) {
				const action = field === 'status' ? 'status_changed' : 'updated';
				await recordContractActivity({
					contractId,
					userId: event.locals.user.id,
					tenantId: event.locals.tenant.id,
					action,
					field,
					oldValue: String((existing as any)[field] ?? ''),
					newValue: String(updateData[field] ?? '')
				});
			}
		}

		if (lineItems !== undefined) {
			await recordContractActivity({
				contractId,
				userId: event.locals.user.id,
				tenantId: event.locals.tenant.id,
				action: 'updated',
				field: 'lineItems'
			});
		}

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

		// Prevent deletion of signed/active contracts
		if (existing.status === 'signed' || existing.status === 'active') {
			throw new Error(`Nu se poate șterge un contract cu statusul "${existing.status}". Doar contractele în starea "draft", "sent", "expired" sau "cancelled" pot fi șterse.`);
		}

		// Delete uploaded file from storage if exists
		if (existing.uploadedFilePath) {
			try {
				await storage.deleteFile(existing.uploadedFilePath);
			} catch (err) {
				console.error('Failed to delete uploaded contract file (non-fatal):', err);
			}
		}

		try {
			await db.transaction(async (tx) => {
				// Delete sign tokens first (no cascade on FK)
				await tx
					.delete(table.contractSignToken)
					.where(eq(table.contractSignToken.contractId, contractId));

				// Delete line items explicitly (in case cascade doesn't work)
				await tx
					.delete(table.contractLineItem)
					.where(eq(table.contractLineItem.contractId, contractId));

				// Delete activity records explicitly (SQLite cascade may not be enabled)
				await tx
					.delete(table.contractActivity)
					.where(eq(table.contractActivity.contractId, contractId));

				await tx.delete(table.contract).where(eq(table.contract.id, contractId));
			});
		} catch (err) {
			console.error('Failed to delete contract from DB:', err);
			throw new Error('Eroare la stergerea contractului din baza de date');
		}

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

		const tenantId = event.locals.tenant.id;
		const userId = event.locals.user.id;
		const prefix = event.locals.tenant.contractPrefix || 'CTR';
		const newContractId = generateContractId();

		// Use transaction for atomic contract number generation + insert
		await db.transaction(async (tx) => {
			const contractNumber = await generateContractNumber(tx, tenantId, prefix);

			await tx.insert(table.contract).values({
				id: newContractId,
				tenantId,
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
				createdByUserId: userId
			});

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

		// Audit trail
		await recordContractActivity({
			contractId: newContractId,
			userId: event.locals.user.id,
			tenantId: event.locals.tenant.id,
			action: 'duplicated',
			field: 'sourceContractId',
			newValue: contractId
		});

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

		// Only allow sending from draft or sent status
		if (contract.status !== 'draft' && contract.status !== 'sent') {
			throw new Error(`Nu se poate trimite pentru semnare un contract cu statusul "${contract.status}". Doar contractele în starea "draft" sau "sent" pot fi trimise.`);
		}

		const [client] = await db
			.select()
			.from(table.client)
			.where(eq(table.client.id, contract.clientId))
			.limit(1);

		// Revoke all existing unused tokens for this contract
		await db
			.update(table.contractSignToken)
			.set({ used: true, usedAt: new Date() })
			.where(
				and(
					eq(table.contractSignToken.contractId, contractId),
					eq(table.contractSignToken.used, false)
				)
			);

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
			.set({ status: 'sent', version: contract.version + 1, updatedAt: new Date() })
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

		// Audit trail
		await recordContractActivity({
			contractId,
			userId: event.locals.user.id,
			tenantId,
			action: 'sent_for_signing',
			field: 'email',
			newValue: email
		});
		if (contract.status !== 'sent') {
			await recordContractActivity({
				contractId,
				userId: event.locals.user.id,
				tenantId,
				action: 'status_changed',
				field: 'status',
				oldValue: contract.status,
				newValue: 'sent'
			});
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

		// Only allow prestator signing on draft or sent contracts
		if (contract.status !== 'draft' && contract.status !== 'sent') {
			throw new Error(`Nu se poate semna un contract cu statusul "${contract.status}". Doar contractele în starea "draft" sau "sent" pot fi semnate.`);
		}

		if (signatureImage && signatureImage.length > 700000) {
			throw new Error('Imaginea semnăturii este prea mare (max 700KB)');
		}

		const imageToSave =
			signatureImage?.startsWith('data:image/png;base64,') ? signatureImage : null;

		const now = new Date();

		// Auto-transition to 'signed' if both parties have now signed
		const newStatus = contract.beneficiarSignedAt ? 'signed' : undefined;

		await db
			.update(table.contract)
			.set({
				prestatorSignatureName: signatureName,
				prestatorSignatureImage: imageToSave,
				prestatorSignedAt: now,
				...(newStatus ? { status: newStatus } : {}),
				version: contract.version + 1,
				updatedAt: now
			})
			.where(eq(table.contract.id, contractId));

		// Audit trail
		await recordContractActivity({
			contractId,
			userId: event.locals.user.id,
			tenantId,
			action: 'signed_prestator'
		});
		if (contract.beneficiarSignedAt) {
			await recordContractActivity({
				contractId,
				userId: event.locals.user.id,
				tenantId,
				action: 'status_changed',
				field: 'status',
				oldValue: contract.status,
				newValue: 'signed'
			});
		}

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

export const extractClientFromContract = command(
	v.object({ contractId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ contractId }) => {
		const debug: Record<string, unknown> = { contractId, steps: [] as string[] };
		const step = (msg: string, data?: Record<string, unknown>) => {
			(debug.steps as string[]).push(msg);
			if (data) Object.assign(debug, data);
		};
		const emptyResult = (reason: string) => {
			step(`EARLY_EXIT: ${reason}`);
			if (DEBUG_EXTRACTION()) {
				console.log('\n========== extractClientFromContract DEBUG ==========');
				console.log(JSON.stringify(debug, null, 2));
				console.log('=====================================================\n');
			}
			return { clientUpdated: false, extracted: {} as Record<string, string>, updated: {} as Record<string, string>, skipped: {} as Record<string, string> };
		};

		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		step('auth_ok', { userEmail: event.locals.user.email, tenantName: event.locals.tenant.name });

		const [contract] = await db
			.select()
			.from(table.contract)
			.where(and(eq(table.contract.id, contractId), eq(table.contract.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!contract || !contract.uploadedFilePath || !contract.clientId) {
			return emptyResult(`Contract lookup failed: found=${!!contract}, hasFile=${!!contract?.uploadedFilePath}, hasClient=${!!contract?.clientId}`);
		}
		step('contract_found', { uploadedFilePath: contract.uploadedFilePath, clientId: contract.clientId });

		const fileBuffer = await storage.getFileBuffer(contract.uploadedFilePath);
		step('file_loaded', { bufferSize: fileBuffer.length });

		const pdfText = await extractTextFromPDF(fileBuffer);
		if (!pdfText || pdfText.trim().length === 0) {
			return emptyResult('PDF text extraction returned empty');
		}
		step('pdf_text_extracted', { textLength: pdfText.length, first200chars: pdfText.substring(0, 200) });

		const tenantEmails = [event.locals.tenant.email, event.locals.user.email].filter(Boolean);
		const tenantData: TenantInfo = {
			cui: event.locals.tenant.cui, registrationNumber: event.locals.tenant.registrationNumber,
			email: event.locals.tenant.email, phone: event.locals.tenant.phone,
			address: event.locals.tenant.address, city: event.locals.tenant.city,
			county: event.locals.tenant.county, postalCode: event.locals.tenant.postalCode,
			iban: event.locals.tenant.iban, ibanEuro: event.locals.tenant.ibanEuro,
			bankName: event.locals.tenant.bankName, legalRepresentative: event.locals.tenant.legalRepresentative
		};

		const extractedInfo = extractClientInfoFromText(pdfText, tenantData);
		if (Object.keys(extractedInfo).length === 0) {
			return emptyResult('extractClientInfoFromText returned empty');
		}
		step('extraction_done', { extractedInfo, tenantEmails });

		const [currentClient] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.id, contract.clientId), eq(table.client.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!currentClient) {
			return emptyResult('Client not found in DB');
		}
		step('client_found', { clientName: currentClient.name });

		const fieldsToUpdate: Record<string, string> = {};
		const fieldMapping: Array<[keyof ClientExtractedInfo, keyof typeof currentClient]> = [
			['cui', 'cui'], ['registrationNumber', 'registrationNumber'], ['email', 'email'],
			['phone', 'phone'], ['address', 'address'], ['city', 'city'], ['county', 'county'],
			['postalCode', 'postalCode'], ['iban', 'iban'], ['bankName', 'bankName'],
			['legalRepresentative', 'legalRepresentative']
		];

		function matchesByWords(current: string, tenantVal: string): boolean {
			const getWords = (s: string) => s.toLowerCase().replace(/[^\p{L}\d]/gu, ' ').split(/\s+/).filter(w => w.length >= 3);
			const tenantWords = getWords(tenantVal);
			if (tenantWords.length === 0) return false;
			const currentWords = getWords(current);
			return tenantWords.every(tw => currentWords.some(cw => cw === tw || cw.includes(tw) || tw.includes(cw)));
		}

		const fieldAnalysis: Record<string, unknown>[] = [];
		for (const [extractedKey, dbKey] of fieldMapping) {
			const extractedValue = extractedInfo[extractedKey];
			const currentValue = currentClient[dbKey];
			const isEmpty = !currentValue || (typeof currentValue === 'string' && currentValue.trim() === '');
			const tenantVal = tenantData[dbKey as keyof TenantInfo];

			let isTenantData = false;
			if (!isEmpty && typeof currentValue === 'string') {
				if (dbKey === 'email') {
					isTenantData = tenantEmails.some(te => typeof te === 'string' && te.toLowerCase() === currentValue.toLowerCase());
				} else if (dbKey === 'legalRepresentative') {
					isTenantData = typeof tenantVal === 'string' && matchesByWords(currentValue, tenantVal);
				} else if (typeof tenantVal === 'string') {
					const norm = (s: string) => s.replace(/[\s.\-\/(),;:]/g, '').toLowerCase();
					isTenantData = norm(currentValue).includes(norm(tenantVal)) || norm(tenantVal).includes(norm(currentValue));
				}
			}

			const willUpdate = !!(extractedValue && (isEmpty || isTenantData));
			fieldAnalysis.push({ field: dbKey, extracted: extractedValue || null, current: currentValue || null, tenant: tenantVal || null, isEmpty, isTenantData, willUpdate });
			if (willUpdate) fieldsToUpdate[dbKey] = extractedValue!;
		}
		debug.fieldAnalysis = fieldAnalysis;

		const extracted = Object.fromEntries(Object.entries(extractedInfo).filter(([, v]) => v)) as Record<string, string>;

		if (Object.keys(fieldsToUpdate).length === 0) {
			step('RESULT: no fields to update');
			if (DEBUG_EXTRACTION()) {
				console.log('\n========== extractClientFromContract DEBUG ==========');
				console.log(JSON.stringify(debug, null, 2));
				console.log('=====================================================\n');
			}
			return { clientUpdated: false, extracted, updated: {} as Record<string, string>, skipped: extracted };
		}

		await db.update(table.client).set({ ...fieldsToUpdate, updatedAt: new Date() }).where(eq(table.client.id, contract.clientId));

		const skipped = Object.fromEntries(Object.entries(extracted).filter(([k]) => !(k in fieldsToUpdate))) as Record<string, string>;

		step('RESULT: client updated', { updated: fieldsToUpdate, skipped });
		if (DEBUG_EXTRACTION()) {
			console.log('\n========== extractClientFromContract DEBUG ==========');
			console.log(JSON.stringify(debug, null, 2));
			console.log('=====================================================\n');
		}
		return { clientUpdated: true, extracted, updated: fieldsToUpdate, skipped };
	}
);

export const getContractInvoices = query(
	v.pipe(v.string(), v.minLength(1)),
	async (contractId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const invoices = await db
			.select({
				id: table.invoice.id,
				invoiceNumber: table.invoice.invoiceNumber,
				status: table.invoice.status,
				totalAmount: table.invoice.totalAmount,
				currency: table.invoice.currency,
				issueDate: table.invoice.issueDate
			})
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.contractId, contractId),
					eq(table.invoice.tenantId, event.locals.tenant.id)
				)
			)
			.orderBy(desc(table.invoice.issueDate));

		return invoices;
	}
);
