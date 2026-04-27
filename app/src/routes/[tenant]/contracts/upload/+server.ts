import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import * as storage from '$lib/server/storage';
import { recordContractActivity } from '$lib/server/contract-activity';

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

	const manualNumber = contractNumber?.trim() || undefined;
	const prefix = event.locals.tenant?.contractPrefix || 'CTR';

	const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const numberRegex = new RegExp(`^${escapedPrefix}-(\\d+)$`);

	const isUniqueConstraintError = (err: unknown): boolean => {
		const e = err as { code?: string; message?: string } | null;
		const msg = e?.message || String(err);
		return (
			e?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
			e?.code === 'SQLITE_CONSTRAINT' ||
			msg.includes('UNIQUE constraint failed') ||
			msg.includes('UNIQUE constraint')
		);
	};

	const MAX_RETRIES = 5;
	let lastErr: unknown = null;
	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			await db.transaction(async (tx) => {
				let finalContractNumber: string;
				if (manualNumber) {
					finalContractNumber = manualNumber;
					const [dup] = await tx
						.select({ id: table.contract.id })
						.from(table.contract)
						.where(
							and(
								eq(table.contract.tenantId, tenantId),
								eq(table.contract.contractNumber, finalContractNumber)
							)
						)
						.limit(1);
					if (dup) {
						throw new Error(`Numărul de contract "${finalContractNumber}" există deja pentru acest tenant`);
					}
				} else {
					const rows = await tx
						.select({ contractNumber: table.contract.contractNumber })
						.from(table.contract)
						.where(eq(table.contract.tenantId, tenantId));
					let maxNum = 0;
					for (const row of rows) {
						const m = row.contractNumber.match(numberRegex);
						if (m) {
							const n = parseInt(m[1], 10);
							if (n > maxNum) maxNum = n;
						}
					}
					finalContractNumber = `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
				}

				await tx.insert(table.contract).values({
					id: contractId,
					tenantId,
					clientId,
					contractNumber: finalContractNumber,
					contractDate: contractDate ? new Date(contractDate) : new Date(),
					contractTitle: contractTitle || file.name.replace(/\.pdf$/i, ''),
					status: 'draft',
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
			lastErr = null;
			break;
		} catch (err) {
			lastErr = err;
			if (manualNumber) throw err;
			if (!isUniqueConstraintError(err)) throw err;
		}
	}
	if (lastErr) {
		throw error(500, 'Nu s-a putut genera un număr unic de contract după mai multe încercări. Încercați din nou.');
	}

	// Audit trail
	await recordContractActivity({
		contractId,
		userId,
		tenantId,
		action: 'created',
		field: 'uploadedFilePath',
		newValue: uploadResult.path
	});

	return json({ success: true, contractId });
};
