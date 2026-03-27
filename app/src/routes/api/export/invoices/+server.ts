import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { generateCSV, generateExcel, type ExportColumn } from '$lib/server/export';

type InvoiceRow = {
	invoiceNumber: string | null;
	clientName: string | null;
	status: string | null;
	totalAmount: number | null;
	currency: string | null;
	issueDate: Date | null;
	dueDate: Date | null;
	paidDate: Date | null;
};

const invoiceColumns: ExportColumn<InvoiceRow>[] = [
	{ key: 'invoiceNumber', header: 'Nr. Factură', width: 16 },
	{ key: 'clientName', header: 'Client', width: 30 },
	{ key: 'status', header: 'Status', width: 12 },
	{
		key: 'totalAmount',
		header: 'Total',
		width: 14,
		format: (v) => (v != null ? (Number(v) / 100).toFixed(2) : '0.00')
	},
	{ key: 'currency', header: 'Monedă', width: 10 },
	{
		key: 'issueDate',
		header: 'Data Emiterii',
		width: 16,
		format: (v) => (v ? new Date(v as string).toLocaleDateString('ro-RO') : '')
	},
	{
		key: 'dueDate',
		header: 'Scadența',
		width: 16,
		format: (v) => (v ? new Date(v as string).toLocaleDateString('ro-RO') : '')
	},
	{
		key: 'paidDate',
		header: 'Data Plății',
		width: 16,
		format: (v) => (v ? new Date(v as string).toLocaleDateString('ro-RO') : '')
	}
];

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const format = url.searchParams.get('format') ?? 'csv';
	const statusFilter = url.searchParams.get('status'); // e.g. 'paid,sent'
	const tenantId = locals.tenant.id;

	let conditions = eq(table.invoice.tenantId, tenantId);

	if (statusFilter) {
		const statuses = statusFilter.split(',').filter(Boolean);
		if (statuses.length > 0) {
			conditions = and(
				conditions,
				inArray(table.invoice.status, statuses)
			) as typeof conditions;
		}
	}

	const invoices = await db
		.select({
			invoiceNumber: table.invoice.invoiceNumber,
			clientName: table.client.name,
			status: table.invoice.status,
			totalAmount: table.invoice.totalAmount,
			currency: table.invoice.currency,
			issueDate: table.invoice.issueDate,
			dueDate: table.invoice.dueDate,
			paidDate: table.invoice.paidDate
		})
		.from(table.invoice)
		.leftJoin(table.client, eq(table.invoice.clientId, table.client.id))
		.where(conditions)
		.orderBy(desc(table.invoice.createdAt));

	const fileName = `facturi-${new Date().toISOString().split('T')[0]}`;

	if (format === 'excel') {
		const buffer = generateExcel([{ name: 'Facturi', columns: invoiceColumns, data: invoices }]);
		return new Response(buffer, {
			headers: {
				'Content-Type':
					'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				'Content-Disposition': `attachment; filename="${fileName}.xlsx"`
			}
		});
	}

	const csv = generateCSV(invoices, invoiceColumns);
	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${fileName}.csv"`
		}
	});
};
