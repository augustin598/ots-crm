#!/usr/bin/env bun

import XLSX from 'xlsx';
import { db } from '../src/lib/server/db';
import * as table from '../src/lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { join } from 'path';

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

async function getTenantAndUser(tenantSlug: string) {
	// Get tenant by slug
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);

	if (!tenant) {
		throw new Error(`Tenant with slug "${tenantSlug}" not found`);
	}

	// Get first user for this tenant (owner)
	const [tenantUser] = await db
		.select()
		.from(table.tenantUser)
		.where(eq(table.tenantUser.tenantId, tenant.id))
		.limit(1);

	if (!tenantUser) {
		throw new Error(`No user found for tenant "${tenantSlug}"`);
	}

	const [user] = await db
		.select()
		.from(table.user)
		.where(eq(table.user.id, tenantUser.userId))
		.limit(1);

	if (!user) {
		throw new Error(`User not found`);
	}

	return { tenant, user };
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

async function importClients(tenantId: string, filePath: string): Promise<Map<string, string>> {
	console.log('Reading clients Excel file...');
	const workbook = XLSX.readFile(filePath, { cellDates: true });
	const sheetName = workbook.SheetNames[0];
	const worksheet = workbook.Sheets[sheetName];
	const rows: ClientRow[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

	console.log(`Found ${rows.length} client rows to import`);

	const clientMap = new Map<string, string>(); // CIF -> clientId

	let imported = 0;
	let skipped = 0;

	for (const row of rows) {
		const name = String(row['Denumire client'] || '').trim();
		const cif = String(row.CIF || '').trim();

		if (!name || name === 'Denumire client' || name.toLowerCase() === 'client') {
			// Skip header row or empty rows
			continue;
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
				clientId = existing.id;
				clientMap.set(cif, clientId);
				console.log(`Client already exists: ${name} (CIF: ${cif})`);
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
				console.log(`Client already exists: ${name}`);
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

		// Determine company type from registration number prefix or name
		let companyType: string | null = null;
		if (registrationNumber) {
			if (registrationNumber.startsWith('F') || registrationNumber.toLowerCase().includes('f12')) {
				companyType = 'PFA';
			} else if (registrationNumber.startsWith('J') || registrationNumber.toLowerCase().includes('j')) {
				companyType = 'SRL';
			}
		}

		// Also check name for PFA indication
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
		console.log(`Imported client: ${name}${cif ? ` (CIF: ${cif})` : ''}`);
	}

	console.log(`\nClients import complete: ${imported} imported, ${skipped} skipped`);
	return clientMap;
}

interface InvoiceRow {
	'Nr. crt.': string;
	Client: string;
	CIF: string;
	Adresa: string;
	Factura: string; // e.g., "NTS00143" - contains series and number
	'Data emiterii': string; // Date as string
	'Data scadentei': string; // Date as string
	Status: string; // 'emisa', 'depasita', etc.
	Moneda: string;
	'Valoare fara TVA': string | number;
	'Valoare TVA': string | number;
	'Valoare Totala': string | number;
	'Valoare Totala(RON)': string | number;
	'Aviz insotire': string;
	Observatii: string;
	'Index SPV': string;
}

async function importInvoices(
	tenantId: string,
	userId: string,
	filePath: string,
	clientMap: Map<string, string>
): Promise<void> {
	console.log('\nReading invoices Excel file...');
	const workbook = XLSX.readFile(filePath, { cellDates: true });
	const sheetName = workbook.SheetNames[0];
	const worksheet = workbook.Sheets[sheetName];
	
	// Skip first 3 rows (header/metadata) - start from row 4 (index 3)
	const rows: InvoiceRow[] = XLSX.utils.sheet_to_json(worksheet, {
		defval: '',
		raw: false,
		range: 3 // Start from row 4 (0-indexed, so 3 means row 4)
	});

	console.log(`Found ${rows.length} invoice rows to import`);

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
			console.warn(`Skipping invoice with invalid format: ${invoiceNumberFull}`);
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
			// Try to find by name
			const [client] = await db
				.select()
				.from(table.client)
				.where(and(eq(table.client.tenantId, tenantId), eq(table.client.name, clientName)))
				.limit(1);
			clientId = client?.id;
		}

		if (!clientId) {
			console.warn(
				`Skipping invoice ${invoiceNumber}: Client not found (CIF: ${clientCif}, Name: ${clientName})`
			);
			skipped++;
			continue;
		}

		// Check if invoice already exists by SmartBill series and number
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
			console.log(`Invoice already exists: ${invoiceNumber} (SmartBill: ${series}-${number})`);
			skipped++;
			continue;
		}

		// Parse dates (format: DD/MM/YYYY)
		let issueDate: Date | null = null;
		let dueDate: Date | null = null;
		
		const parseDate = (dateStr: string): Date | null => {
			if (!dateStr) return null;
			const parts = dateStr.split('/');
			if (parts.length === 3) {
				const day = parseInt(parts[0], 10);
				const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
				const year = parseInt(parts[2], 10);
				const date = new Date(year, month, day);
				if (!isNaN(date.getTime())) {
					return date;
				}
			}
			return null;
		};

		if (row['Data emiterii']) {
			issueDate = parseDate(String(row['Data emiterii']));
		}
		
		if (row['Data scadentei']) {
			dueDate = parseDate(String(row['Data scadentei']));
		}

		// Parse amounts
		let amount = 0;
		let taxAmount = 0;
		let totalAmount = 0;

		const parseAmount = (value: string | number): number => {
			if (typeof value === 'number') {
				return Math.round(value * 100); // Convert to cents
			}
			if (typeof value === 'string') {
				const cleaned = value.replace(/,/g, '').replace(/\s/g, '');
				return Math.round(parseFloat(cleaned) * 100) || 0;
			}
			return 0;
		};

		amount = parseAmount(row['Valoare fara TVA'] || 0);
		taxAmount = parseAmount(row['Valoare TVA'] || 0);
		totalAmount = parseAmount(row['Valoare Totala(RON)'] || row['Valoare Totala'] || 0);

		// Calculate tax rate if we have both amount and tax
		let taxRate: number = 1900; // Default 19%
		if (amount > 0 && taxAmount > 0) {
			taxRate = Math.round((taxAmount / amount) * 10000); // Store as basis points (e.g., 1900 = 19%)
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
			issueDate,
			dueDate,
			smartbillSeries: series || null,
			smartbillNumber: number || null,
			notes: String(row.Observatii || '').trim() || null,
			createdByUserId: userId
		});

		// Create a single line item with the invoice total
		// (SmartBill Excel export doesn't have line item details, just totals)
		if (amount > 0) {
			const lineItemId = generateLineItemId();
			await db.insert(table.invoiceLineItem).values({
				id: lineItemId,
				invoiceId,
				description: 'Servicii/Servicii prestate', // Default description
				quantity: 1,
				rate: amount,
				amount: amount
			});
		}

		imported++;
		console.log(`Imported invoice: ${invoiceNumber} for client ${clientName} (Status: ${status})`);
	}

	console.log(`\nInvoices import complete: ${imported} imported, ${skipped} skipped`);
}

async function main() {
	const args = process.argv.slice(2);
	const tenantSlug = args[0];

	if (!tenantSlug) {
		console.error('Usage: bun scripts/import-smartbill-excel.ts <tenant-slug>');
		console.error('Example: bun scripts/import-smartbill-excel.ts my-company');
		process.exit(1);
	}

	const clientsFile = join(process.cwd(), '..', 'Clienti_10_01_2026.xls');
	const invoicesFile = join(process.cwd(), '..', 'Facturi_10_01_2026.xls');

	try {
		console.log('Starting SmartBill Excel import...');
		console.log(`Tenant: ${tenantSlug}`);
		console.log(`Clients file: ${clientsFile}`);
		console.log(`Invoices file: ${invoicesFile}\n`);

		// Get tenant and user
		const { tenant, user } = await getTenantAndUser(tenantSlug);
		console.log(`Found tenant: ${tenant.name} (ID: ${tenant.id})`);
		console.log(`Using user: ${user.username} (ID: ${user.id})\n`);

		// Import clients first
		const clientMap = await importClients(tenant.id, clientsFile);

		// Import invoices
		await importInvoices(tenant.id, user.id, invoicesFile, clientMap);

		console.log('\n✅ Import completed successfully!');
	} catch (error) {
		console.error('\n❌ Import failed:', error);
		process.exit(1);
	}
}

main();
