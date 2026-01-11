import { command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import XLSX from 'xlsx';

function generateClientId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateInvoiceId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateLineItemId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

interface ClientRow {
	'Denumire client': string;
	CIF: string;
	'Reg com': string;
	'Cod client': string;
	Adresa: string;
	Localitate: string;
	Judet: string;
	Banca: string;
	Iban: string;
	Tara: string;
	Email: string;
	'Pers contact': string;
	Telefon: string;
}

interface InvoiceRow {
	'Nr. crt.': string;
	Client: string;
	CIF: string;
	Adresa: string;
	Factura: string;
	'Data emiterii': string;
	'Data scadentei': string;
	Status: string;
	Moneda: string;
	'Valoare fara TVA': string | number;
	'Valoare TVA': string | number;
	'Valoare Totala': string | number;
	'Valoare Totala(RON)': string | number;
	'Aviz insotire': string;
	Observatii: string;
	'Index SPV': string;
}

export const importClientsFromExcel = command(
	v.object({
		fileData: v.string(), // base64-encoded Excel file
		fileName: v.string()
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can import
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Decode base64 data
		const base64Data = data.fileData.replace(/^data:.*;base64,/, '');
		const buffer = Buffer.from(base64Data, 'base64');

		// Read Excel file - XLSX.read works with buffers directly
		const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
		const sheetName = workbook.SheetNames[0];
		const worksheet = workbook.Sheets[sheetName];
		const rows: ClientRow[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

		const clientMap = new Map<string, string>(); // CIF -> clientId
		const tenantId = event.locals.tenant.id;
		let imported = 0;
		let skipped = 0;

		for (const row of rows) {
			const name = String(row['Denumire client'] || '').trim();
			const cif = String(row.CIF || '').trim();

			if (!name || name === 'Denumire client' || name.toLowerCase() === 'client') {
				continue; // Skip header row or empty rows
			}

			// Check if client already exists by CIF
			let clientId: string | undefined;
			if (cif) {
				const [existing] = await db
					.select()
					.from(table.client)
					.where(and(eq(table.client.tenantId, tenantId), eq(table.client.cui, cif)))
					.limit(1);

				if (existing) {
					clientMap.set(cif, existing.id);
					skipped++;
					continue;
				}
			}

			// Check by name if no CIF
			if (!clientId) {
				const [existingByName] = await db
					.select()
					.from(table.client)
					.where(and(eq(table.client.tenantId, tenantId), eq(table.client.name, name)))
					.limit(1);

				if (existingByName) {
					clientId = existingByName.id;
					if (cif) clientMap.set(cif, clientId);
					skipped++;
					continue;
				}
			}

			// Create new client
			clientId = generateClientId();
			const registrationNumber = String(row['Reg com'] || '').trim();
			const address = String(row.Adresa || '').trim();
			const city = String(row.Localitate || '').trim();
			const county = String(row.Judet || '').trim();
			const bankName = String(row.Banca || '').trim();
			const iban = String(row.Iban || '').trim();
			const country = String(row.Tara || 'România').trim() || 'România';
			const email = String(row.Email || '').trim() || null;
			const phone = String(row.Telefon || '').trim() || null;
			const contactPerson = String(row['Pers contact'] || '').trim();

			// Determine company type
			let companyType: string | null = null;
			if (registrationNumber) {
				if (registrationNumber.startsWith('F') || registrationNumber.toLowerCase().includes('f12')) {
					companyType = 'PFA';
				} else if (registrationNumber.startsWith('J') || registrationNumber.toLowerCase().includes('j')) {
					companyType = 'SRL';
				}
			}

			if (!companyType && name.toLowerCase().includes('persoana fizica autorizata')) {
				companyType = 'PFA';
			} else if (!companyType && (name.toLowerCase().includes('s.r.l.') || name.toLowerCase().includes('srl'))) {
				companyType = 'SRL';
			} else if (!companyType && name.toLowerCase().includes('s.a.')) {
				companyType = 'SA';
			}

			await db.insert(table.client).values({
				id: clientId,
				tenantId,
				name,
				email,
				phone,
				cui: cif || null,
				registrationNumber: registrationNumber || null,
				tradeRegister: county ? `J${county}` : null,
				iban: iban || null,
				bankName: bankName || null,
				address: address || null,
				city: city || null,
				county: county || null,
				country,
				companyType,
				status: 'active',
				notes: contactPerson ? `Contact: ${contactPerson}` : null
			});

			if (cif) clientMap.set(cif, clientId);
			imported++;
		}

		return { success: true, imported, skipped };
	}
);

export const importInvoicesFromExcel = command(
	v.object({
		fileData: v.string(), // base64-encoded Excel file
		fileName: v.string()
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can import
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		const tenantId = event.locals.tenant.id;
		const userId = event.locals.user.id;

		// Decode base64 data
		const base64Data = data.fileData.replace(/^data:.*;base64,/, '');
		const buffer = Buffer.from(base64Data, 'base64');

		// Read Excel file - XLSX.read works with buffers directly
		const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
		const sheetName = workbook.SheetNames[0];
		const worksheet = workbook.Sheets[sheetName];

		// Skip first 3 rows (header/metadata) - start from row 4 (index 3)
		const rows: InvoiceRow[] = XLSX.utils.sheet_to_json(worksheet, {
			defval: '',
			raw: false,
			range: 3
		});

		// Build client map from existing clients
		const existingClients = await db
			.select()
			.from(table.client)
			.where(eq(table.client.tenantId, tenantId));

		const clientMap = new Map<string, string>(); // CIF -> clientId
		for (const client of existingClients) {
			if (client.cui) {
				clientMap.set(client.cui, client.id);
			}
		}

		// Also map by name
		const clientByNameMap = new Map<string, string>(); // name -> clientId
		for (const client of existingClients) {
			clientByNameMap.set(client.name.toLowerCase(), client.id);
		}

		let imported = 0;
		let skipped = 0;

		for (const row of rows) {
			const invoiceNumberFull = String(row.Factura || '').trim();
			const clientName = String(row.Client || '').trim();

			// Skip empty rows or header-like rows
			if (!invoiceNumberFull || !clientName || invoiceNumberFull === 'Factura' || clientName === 'Client') {
				continue;
			}

			// Parse invoice number (e.g., "NTS00143" -> series: "NTS", number: "00143")
			const invoiceMatch = invoiceNumberFull.match(/^([A-Z]+)(\d+)$/);
			if (!invoiceMatch) {
				skipped++;
				continue;
			}

			const series = invoiceMatch[1];
			const number = invoiceMatch[2];
			const invoiceNumber = `${series}-${number}`;

			const clientCif = String(row.CIF || '').trim();

			// Find client
			let clientId: string | undefined;
			if (clientCif) {
				clientId = clientMap.get(clientCif);
			}

			if (!clientId && clientName) {
				clientId = clientByNameMap.get(clientName.toLowerCase());
			}

			if (!clientId) {
				skipped++;
				continue;
			}

			// Check if invoice already exists
			const [existing] = await db
				.select()
				.from(table.invoice)
				.where(
					and(
						eq(table.invoice.tenantId, tenantId),
						eq(table.invoice.smartbillSeries, series),
						eq(table.invoice.smartbillNumber, number)
					)
				)
				.limit(1);

			if (existing) {
				skipped++;
				continue;
			}

			// Parse dates (format: DD/MM/YYYY)
			const parseDate = (dateStr: string): Date | null => {
				if (!dateStr) return null;
				const parts = String(dateStr).split('/');
				if (parts.length === 3) {
					const day = parseInt(parts[0], 10);
					const month = parseInt(parts[1], 10) - 1;
					const year = parseInt(parts[2], 10);
					const date = new Date(year, month, day);
					if (!isNaN(date.getTime())) {
						return date;
					}
				}
				return null;
			};

			let issueDate: Date | null = null;
			let dueDate: Date | null = null;

			if (row['Data emiterii']) {
				issueDate = parseDate(String(row['Data emiterii']));
			}

			if (row['Data scadentei']) {
				dueDate = parseDate(String(row['Data scadentei']));
			}

			// Parse amounts
			const parseAmount = (value: string | number): number => {
				if (typeof value === 'number') {
					return Math.round(value * 100);
				}
				if (typeof value === 'string') {
					const cleaned = value.replace(/,/g, '').replace(/\s/g, '');
					return Math.round(parseFloat(cleaned) * 100) || 0;
				}
				return 0;
			};

			const amount = parseAmount(row['Valoare fara TVA'] || 0);
			const taxAmount = parseAmount(row['Valoare TVA'] || 0);
			const totalAmount = parseAmount(row['Valoare Totala(RON)'] || row['Valoare Totala'] || 0);

			// Calculate tax rate
			let taxRate: number = 1900; // Default 19%
			if (amount > 0 && taxAmount > 0) {
				taxRate = Math.round((taxAmount / amount) * 10000);
			}

			// Map status
			let status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' = 'sent';
			const statusStr = String(row.Status || '').toLowerCase().trim();
			if (statusStr === 'emisa') {
				status = 'sent';
			} else if (statusStr === 'depasita') {
				status = 'overdue';
			} else if (statusStr.includes('plata') || statusStr.includes('platit')) {
				status = 'paid';
			} else if (statusStr.includes('anulat')) {
				status = 'cancelled';
			}

			// Get currency from Excel (default to RON if not specified)
			const currency = String(row.Moneda || 'RON').trim().toUpperCase() || 'RON';

			// Create invoice
			const invoiceId = generateInvoiceId();
			await db.insert(table.invoice).values({
				id: invoiceId,
				tenantId,
				clientId,
				invoiceNumber,
				status,
				amount,
				taxRate,
				taxAmount,
				totalAmount,
				currency,
				issueDate,
				dueDate,
				smartbillSeries: series || null,
				smartbillNumber: number || null,
				notes: String(row.Observatii || '').trim() || null,
				createdByUserId: userId
			});

			// Create a single line item with the invoice total
			if (amount > 0) {
				const lineItemId = generateLineItemId();
				await db.insert(table.invoiceLineItem).values({
					id: lineItemId,
					invoiceId,
					description: 'Servicii/Servicii prestate',
					quantity: 1,
					rate: amount,
					amount: amount
				});
			}

			imported++;
		}

		return { success: true, imported, skipped };
	}
);
