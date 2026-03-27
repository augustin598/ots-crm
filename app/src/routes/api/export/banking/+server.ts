import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { generateCSV, generateExcel, type ExportColumn } from '$lib/server/export';

type TransactionRow = {
	date: Date | null;
	description: string | null;
	counterpartName: string | null;
	amount: number | null;
	currency: string | null;
	reference: string | null;
	accountName: string | null;
	status: string | null;
};

const transactionColumns: ExportColumn<TransactionRow>[] = [
	{
		key: 'date',
		header: 'Data',
		width: 14,
		format: (v) => (v ? new Date(v as string).toLocaleDateString('ro-RO') : '')
	},
	{ key: 'description', header: 'Descriere', width: 40 },
	{ key: 'counterpartName', header: 'Contraparte', width: 30 },
	{
		key: 'amount',
		header: 'Sumă',
		width: 14,
		format: (v) => (v != null ? (Number(v) / 100).toFixed(2) : '0.00')
	},
	{ key: 'currency', header: 'Monedă', width: 10 },
	{ key: 'reference', header: 'Referință', width: 20 },
	{ key: 'accountName', header: 'Cont', width: 20 },
	{ key: 'status', header: 'Status', width: 14 }
];

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const format = url.searchParams.get('format') ?? 'csv';
	const fromDate = url.searchParams.get('from');
	const toDate = url.searchParams.get('to');
	const tenantId = locals.tenant.id;

	let conditions = eq(table.bankTransaction.tenantId, tenantId);

	if (fromDate) {
		conditions = and(
			conditions,
			gte(table.bankTransaction.date, new Date(fromDate))
		) as typeof conditions;
	}
	if (toDate) {
		conditions = and(
			conditions,
			lte(table.bankTransaction.date, new Date(toDate))
		) as typeof conditions;
	}

	const transactions = await db
		.select({
			date: table.bankTransaction.date,
			description: table.bankTransaction.description,
			counterpartName: table.bankTransaction.counterpartName,
			amount: table.bankTransaction.amount,
			currency: table.bankTransaction.currency,
			reference: table.bankTransaction.reference,
			accountName: table.bankAccount.accountName,
			status: table.bankTransaction.matchingMethod
		})
		.from(table.bankTransaction)
		.leftJoin(table.bankAccount, eq(table.bankTransaction.bankAccountId, table.bankAccount.id))
		.where(conditions)
		.orderBy(desc(table.bankTransaction.date));

	const fileName = `tranzactii-${new Date().toISOString().split('T')[0]}`;

	if (format === 'excel') {
		const buffer = generateExcel([
			{ name: 'Tranzacții', columns: transactionColumns, data: transactions }
		]);
		return new Response(buffer, {
			headers: {
				'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				'Content-Disposition': `attachment; filename="${fileName}.xlsx"`
			}
		});
	}

	const csv = generateCSV(transactions, transactionColumns);
	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${fileName}.csv"`
		}
	});
};
