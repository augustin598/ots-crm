import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';
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

	if (!clientId) {
		throw error(400, 'Clientul este obligatoriu');
	}

	const uploadResult = await storage.uploadFile(event.locals.tenant.id, file, {
		type: 'contract',
		clientId,
		uploadedBy: event.locals.user.id
	});

	let finalContractNumber = contractNumber;
	if (!finalContractNumber) {
		const prefix = event.locals.tenant.contractPrefix || 'CTR';
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
		finalContractNumber = `${prefix}-${String(nextNumber).padStart(4, '0')}`;
	}

	const contractId = generateContractId();

	await db.insert(table.contract).values({
		id: contractId,
		tenantId: event.locals.tenant.id,
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
		createdByUserId: event.locals.user.id
	});

	return json({ success: true, contractId });
};
