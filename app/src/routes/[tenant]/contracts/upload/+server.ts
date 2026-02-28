import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import * as storage from '$lib/server/storage';

function generateContractId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const formData = await event.request.formData();
	const file = formData.get('file') as File | null;
	const clientId = formData.get('clientId') as string | null;
	const contractTitle = formData.get('contractTitle') as string | null;
	const contractDate = formData.get('contractDate') as string | null;
	const contractNumber = formData.get('contractNumber') as string | null;

	if (!file || !(file instanceof File)) {
		throw error(400, 'Fișierul este obligatoriu');
	}

	if (file.type !== 'application/pdf') {
		throw error(400, 'Doar fișiere PDF sunt acceptate');
	}

	// Max 10MB file size
	if (file.size > 10 * 1024 * 1024) {
		throw error(400, 'Fișierul depășește dimensiunea maximă de 10MB');
	}

	// Validate PDF magic bytes (%PDF)
	const headerBytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
	const header = String.fromCharCode(...headerBytes);
	if (!header.startsWith('%PDF')) {
		throw error(400, 'Fișierul nu este un PDF valid');
	}

	if (!clientId) {
		throw error(400, 'Clientul este obligatoriu');
	}

	// Validate clientId belongs to current tenant
	const [clientCheck] = await db
		.select({ id: table.client.id })
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!clientCheck) {
		throw error(400, 'Client invalid sau nu aparține acestui tenant');
	}

	const uploadResult = await storage.uploadFile(event.locals.tenant.id, file, {
		type: 'contract',
		clientId,
		uploadedBy: event.locals.user.id
	});

	const tenantId = event.locals.tenant.id;
	const userId = event.locals.user.id;
	const contractId = generateContractId();

	// Use transaction for atomic contract number generation + insert
	await db.transaction(async (tx) => {
		let finalContractNumber = contractNumber;
		if (!finalContractNumber) {
			const prefix = event.locals.tenant?.contractPrefix || 'CTR';
			const [maxResult] = await tx
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
			finalContractNumber = `${prefix}-${String(nextNumber).padStart(4, '0')}`;
		}

		await tx.insert(table.contract).values({
			id: contractId,
			tenantId,
			clientId,
			contractNumber: finalContractNumber,
			contractDate: contractDate ? new Date(contractDate) : new Date(),
			contractTitle: contractTitle || file.name.replace(/\.pdf$/i, ''),
			status: 'signed',
			currency: 'EUR',
			paymentTermsDays: 5,
			penaltyRate: 50,
			billingFrequency: 'monthly',
			contractDurationMonths: 6,
			hourlyRate: 6000,
			hourlyRateCurrency: 'EUR',
			uploadedFilePath: uploadResult.path,
			uploadedFileSize: uploadResult.size,
			uploadedFileMimeType: uploadResult.mimeType,
			createdByUserId: userId
		});
	});

	return json({ success: true, contractId });
};
