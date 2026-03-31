/**
 * Test Recurring Invoices Flow - run with: bun scripts/test-recurring-invoices.ts
 *
 * This script analyzes recurring invoice templates and checks for potential issues:
 * - Shows all templates with status (due, active, ended)
 * - Checks invoice number consistency (duplicates, gaps)
 * - Verifies Keez sync status
 * - Pre-validates what would be generated
 *
 * Usage:
 *   bun scripts/test-recurring-invoices.ts                    # Full analysis
 *   bun scripts/test-recurring-invoices.ts --tenant=ots       # Filter by tenant
 */

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/lib/server/db/schema';
import { eq, and, desc, lte } from 'drizzle-orm';

// ─── DB Connection ─────────────────────────────────────────────────
const SQLITE_PATH = process.env.SQLITE_PATH || Bun.env.SQLITE_PATH;
const SQLITE_URI = process.env.SQLITE_URI || Bun.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN || Bun.env.SQLITE_AUTH_TOKEN;

let client;
if (SQLITE_PATH) {
	client = createClient({ url: `file:${SQLITE_PATH}` });
} else if (SQLITE_URI) {
	client = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });
} else {
	console.error('Missing SQLITE_PATH or SQLITE_URI');
	process.exit(1);
}

const db = drizzle(client, { schema });
const table = schema;

// ─── Config ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const TENANT_FILTER = args.find((a) => a.startsWith('--tenant='))?.split('=')[1];

const C = {
	reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
	blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m',
};

function log(color: string, prefix: string, msg: string, data?: any) {
	const ts = new Date().toISOString().split('T')[1].slice(0, 12);
	console.log(`${C.gray}${ts}${C.reset} ${color}[${prefix}]${C.reset} ${msg}`);
	if (data) console.log(`${C.gray}  └─ ${JSON.stringify(data, null, 2).replace(/\n/g, '\n     ')}${C.reset}`);
}

function header(title: string) {
	console.log(`\n${C.bold}${C.cyan}${'═'.repeat(70)}\n  ${title}\n${'═'.repeat(70)}${C.reset}`);
}

function section(title: string) {
	console.log(`\n${C.bold}${C.blue}── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}${C.reset}`);
}

// ─── Main ──────────────────────────────────────────────────────────
async function main() {
	header('RECURRING INVOICES — DEBUG ANALYSIS');
	log(C.cyan, 'DB', `Connected: ${SQLITE_PATH ? `file:${SQLITE_PATH}` : SQLITE_URI?.substring(0, 40) + '...'}`);
	if (TENANT_FILTER) log(C.cyan, 'FILTER', `Tenant: ${TENANT_FILTER}`);

	// ── 1. All recurring templates ─────────────────────────────────
	section('1. Recurring Invoice Templates');

	const allRecurring = await db.select().from(table.recurringInvoice).orderBy(desc(table.recurringInvoice.createdAt));
	log(C.blue, 'COUNT', `Total templates: ${allRecurring.length}`);

	const now = new Date();
	let dueCount = 0;

	for (const ri of allRecurring) {
		const [tenant] = await db.select({ slug: table.tenant.slug, name: table.tenant.name }).from(table.tenant).where(eq(table.tenant.id, ri.tenantId)).limit(1);
		if (TENANT_FILTER && tenant?.slug !== TENANT_FILTER) continue;

		const [clientRow] = await db.select({ name: table.client.name, cui: table.client.cui }).from(table.client).where(eq(table.client.id, ri.clientId)).limit(1);

		const isDue = ri.isActive && ri.nextRunDate && new Date(ri.nextRunDate) <= now && (!ri.endDate || new Date(ri.endDate) > now);
		const isEnded = ri.endDate && new Date(ri.endDate) <= now;
		const status = !ri.isActive ? '⏸️  INACTIV' : isEnded ? '🏁 TERMINAT' : isDue ? '🔔 SCADENT' : '⏳ PROGRAMAT';
		if (isDue) dueCount++;

		// Parse line items
		let lineItemCount = 0, keezItemCount = 0, invoiceSeries = '';
		if (ri.lineItemsJson) {
			try {
				const items = JSON.parse(ri.lineItemsJson);
				lineItemCount = items.length;
				keezItemCount = items.filter((i: any) => i.keezItemExternalId).length;
			} catch {}
		}
		if (ri.notes) {
			const m = ri.notes.match(/RECURRING_INVOICE_FIELDS:(.*?)-->/s);
			if (m) try { invoiceSeries = JSON.parse(m[1]).invoiceSeries || ''; } catch {}
		}

		log(
			isDue ? C.yellow : C.gray,
			status,
			`${ri.name} | ${clientRow?.name || 'N/A'} (CUI: ${clientRow?.cui || 'N/A'}) | ${tenant?.slug}`,
			{
				id: ri.id.substring(0, 12) + '...',
				type: `${ri.recurringType} / interval ${ri.recurringInterval}`,
				series: invoiceSeries || '(none)',
				amount: `${(ri.amount / 100).toFixed(2)} ${ri.currency}`,
				items: `${lineItemCount} total, ${keezItemCount} keez`,
				nextRun: ri.nextRunDate ? new Date(ri.nextRunDate).toISOString().split('T')[0] : 'N/A',
				lastRun: ri.lastRunDate ? new Date(ri.lastRunDate).toISOString().split('T')[0] : 'never',
				startDate: ri.startDate ? new Date(ri.startDate).toISOString().split('T')[0] : 'N/A',
				endDate: ri.endDate ? new Date(ri.endDate).toISOString().split('T')[0] : 'none (indefinit)',
				issueDateOffset: ri.issueDateOffset,
				dueDateOffset: ri.dueDateOffset,
			}
		);
	}

	log(C.yellow, 'DUE', `${dueCount} template(s) due for generation NOW`);

	// ── 2. Keez Integration Status ─────────────────────────────────
	section('2. Keez Integration Status');

	const keezIntegrations = await db.select().from(table.keezIntegration).where(eq(table.keezIntegration.isActive, true));

	for (const ki of keezIntegrations) {
		const [tenant] = await db.select({ slug: table.tenant.slug }).from(table.tenant).where(eq(table.tenant.id, ki.tenantId)).limit(1);
		if (TENANT_FILTER && tenant?.slug !== TENANT_FILTER) continue;

		const [settings] = await db.select().from(table.invoiceSettings).where(eq(table.invoiceSettings.tenantId, ki.tenantId)).limit(1);

		log(C.green, 'KEEZ', `Tenant: ${tenant?.slug} | clientEid: ${ki.clientEid}`, {
			series: settings?.keezSeries || 'N/A',
			startNumber: settings?.keezStartNumber || 'N/A',
			lastSyncedNumber: settings?.keezLastSyncedNumber || 'N/A',
			defaultPaymentType: settings?.keezDefaultPaymentTypeId || 'N/A',
		});
	}

	// ── 3. Invoice Number Consistency ──────────────────────────────
	section('3. Invoice Number Consistency Check');

	const allSettings = await db.select().from(table.invoiceSettings);
	for (const settings of allSettings) {
		const [tenant] = await db.select({ slug: table.tenant.slug }).from(table.tenant).where(eq(table.tenant.id, settings.tenantId)).limit(1);
		if (TENANT_FILTER && tenant?.slug !== TENANT_FILTER) continue;

		const series = settings.keezSeries || settings.smartbillSeries;
		if (!series) continue;

		const invoices = await db
			.select({
				id: table.invoice.id,
				invoiceNumber: table.invoice.invoiceNumber,
				invoiceSeries: table.invoice.invoiceSeries,
				status: table.invoice.status,
				issueDate: table.invoice.issueDate,
				createdAt: table.invoice.createdAt,
			})
			.from(table.invoice)
			.where(and(eq(table.invoice.tenantId, settings.tenantId), eq(table.invoice.invoiceSeries, series)))
			.orderBy(desc(table.invoice.createdAt));

		// Extract numbers
		const entries = invoices.map((inv) => {
			const m = inv.invoiceNumber?.match(/(\d+)$/);
			return { id: inv.id, num: m ? parseInt(m[1]) : 0, full: inv.invoiceNumber, status: inv.status, date: inv.issueDate, created: inv.createdAt };
		}).filter((e) => e.num > 0).sort((a, b) => a.num - b.num);

		log(C.blue, 'SERIES', `Tenant: ${tenant?.slug} | Serie: "${series}" | Total facturi: ${entries.length}`);

		// Duplicates
		const seen = new Map<number, typeof entries>();
		for (const e of entries) {
			if (!seen.has(e.num)) seen.set(e.num, []);
			seen.get(e.num)!.push(e);
		}
		const duplicates = [...seen.entries()].filter(([_, arr]) => arr.length > 1);

		if (duplicates.length > 0) {
			log(C.red, '⚠️  DUPLICATES', `${duplicates.length} numere duplicate!`);
			for (const [num, dupes] of duplicates) {
				for (const d of dupes) {
					log(C.red, `  DUP #${num}`, `id=${d.id.substring(0, 12)}... | ${d.full} | status=${d.status} | date=${d.date ? new Date(d.date).toISOString().split('T')[0] : 'N/A'}`);
				}
			}
		} else {
			log(C.green, '✅ UNIQUE', 'Toate numerele sunt unice');
		}

		// Gaps
		if (entries.length > 1) {
			const sorted = entries.map((e) => e.num).sort((a, b) => a - b);
			const gaps: number[] = [];
			for (let i = 0; i < sorted.length - 1; i++) {
				for (let g = sorted[i] + 1; g < sorted[i + 1]; g++) {
					gaps.push(g);
				}
			}
			if (gaps.length > 0 && gaps.length <= 20) {
				log(C.yellow, 'GAPS', `Numere lipsă: ${gaps.join(', ')}`);
			} else if (gaps.length > 20) {
				log(C.yellow, 'GAPS', `${gaps.length} numere lipsă (primul: ${gaps[0]}, ultimul: ${gaps[gaps.length - 1]})`);
			} else {
				log(C.green, '✅ SEQUENTIAL', `Numerele sunt secvențiale (${sorted[0]} → ${sorted[sorted.length - 1]})`);
			}
		}

		// Latest 10
		const latest = entries.slice(-10).reverse();
		log(C.gray, 'LATEST', 'Ultimele 10 facturi:');
		for (const e of latest) {
			log(C.gray, `  #${e.num}`, `${e.full} | ${e.status} | ${e.date ? new Date(e.date).toISOString().split('T')[0] : 'N/A'} | created: ${new Date(e.created).toISOString().replace('T', ' ').substring(0, 19)}`);
		}
	}

	// ── 4. Keez Sync Status ────────────────────────────────────────
	section('4. Keez Sync Status (Last 20 invoices)');

	for (const ki of keezIntegrations) {
		const [tenant] = await db.select({ slug: table.tenant.slug }).from(table.tenant).where(eq(table.tenant.id, ki.tenantId)).limit(1);
		if (TENANT_FILTER && tenant?.slug !== TENANT_FILTER) continue;

		const recentInvoices = await db
			.select({ id: table.invoice.id, invoiceNumber: table.invoice.invoiceNumber, status: table.invoice.status })
			.from(table.invoice)
			.where(eq(table.invoice.tenantId, ki.tenantId))
			.orderBy(desc(table.invoice.createdAt))
			.limit(20);

		let synced = 0, errors = 0, missing = 0;

		for (const inv of recentInvoices) {
			const [sync] = await db
				.select({ syncStatus: table.keezInvoiceSync.syncStatus, errorMessage: table.keezInvoiceSync.errorMessage, keezExternalId: table.keezInvoiceSync.keezExternalId })
				.from(table.keezInvoiceSync)
				.where(eq(table.keezInvoiceSync.invoiceId, inv.id))
				.limit(1);

			if (!sync) {
				missing++;
				log(C.gray, '  —', `${inv.invoiceNumber} | ${inv.status} | no sync record`);
			} else if (sync.syncStatus === 'synced') {
				synced++;
				log(C.green, '  ✅', `${inv.invoiceNumber} | ${inv.status} | keez=${sync.keezExternalId?.substring(0, 16)}...`);
			} else {
				errors++;
				log(C.red, '  ❌', `${inv.invoiceNumber} | ${inv.status} | ${sync.syncStatus}: ${sync.errorMessage?.substring(0, 80)}`);
			}
		}

		log(C.blue, 'SYNC-SUMMARY', `${tenant?.slug}: ${synced} synced, ${errors} errors, ${missing} no-record`);
	}

	// ── 5. Race Condition Risk Assessment ──────────────────────────
	section('5. Race Condition Risk Assessment');

	// Find templates that share the same tenant AND same next run date
	const dueTemplates = allRecurring.filter((ri) =>
		ri.isActive && ri.nextRunDate && new Date(ri.nextRunDate) <= now && (!ri.endDate || new Date(ri.endDate) > now)
	);

	const byTenantDate = new Map<string, typeof dueTemplates>();
	for (const ri of dueTemplates) {
		const dateKey = ri.nextRunDate ? new Date(ri.nextRunDate).toISOString().split('T')[0] : 'unknown';
		const key = `${ri.tenantId}|${dateKey}`;
		if (!byTenantDate.has(key)) byTenantDate.set(key, []);
		byTenantDate.get(key)!.push(ri);
	}

	const conflicts = [...byTenantDate.entries()].filter(([_, templates]) => templates.length > 1);

	if (conflicts.length > 0) {
		log(C.red, '⚠️  RISC', `${conflicts.length} grup(uri) de facturi recurente cu aceeași dată pe același tenant!`);
		for (const [key, templates] of conflicts) {
			const [tenantId, date] = key.split('|');
			const [tenant] = await db.select({ slug: table.tenant.slug }).from(table.tenant).where(eq(table.tenant.id, tenantId)).limit(1);
			log(C.red, 'CONFLICT', `Tenant: ${tenant?.slug} | Data: ${date} | ${templates.length} facturi simultane:`);
			for (const t of templates) {
				const [c] = await db.select({ name: table.client.name }).from(table.client).where(eq(table.client.id, t.clientId)).limit(1);
				log(C.yellow, '  →', `${t.name} | ${c?.name} | amount=${(t.amount / 100).toFixed(2)} ${t.currency}`);
			}
			log(C.yellow, 'NOTE', `Aceste ${templates.length} facturi vor fi procesate SECVENȚIAL (for...of + await).`);
			log(C.yellow, 'NOTE', `Hook-ul Keez are retry cu increment pe număr duplicat (max 3 tentative).`);
		}
	} else if (dueTemplates.length > 0) {
		log(C.green, '✅ OK', 'Nu există facturi recurente care se generează simultan pe același tenant');
	} else {
		log(C.gray, 'N/A', 'Nu există facturi recurente scadente');
	}

	// ── 6. Debug: Recent Keez Logs ─────────────────────────────────
	section('6. Recent Keez Logs (last 20)');

	try {
		const recentLogs = await db
			.select({
				level: table.debugLog.level,
				source: table.debugLog.source,
				message: table.debugLog.message,
				action: table.debugLog.action,
				createdAt: table.debugLog.createdAt,
			})
			.from(table.debugLog)
			.where(eq(table.debugLog.source, 'keez'))
			.orderBy(desc(table.debugLog.createdAt))
			.limit(20);

		if (recentLogs.length === 0) {
			log(C.gray, 'LOGS', 'No Keez logs found');
		} else {
			for (const l of recentLogs) {
				const color = l.level === 'error' ? C.red : l.level === 'warning' ? C.yellow : C.green;
				const ts = new Date(l.createdAt).toISOString().replace('T', ' ').substring(0, 19);
				log(color, `${l.level?.toUpperCase()}`, `${ts} | ${l.action || ''} | ${l.message?.substring(0, 100)}`);
			}
		}
	} catch {
		log(C.gray, 'LOGS', 'Could not read debug logs (table may not exist)');
	}
}

// ─── Run ───────────────────────────────────────────────────────────
main()
	.then(() => {
		console.log(`\n${C.green}[DONE]${C.reset} Analysis complete\n`);
		process.exit(0);
	})
	.catch((err) => {
		console.error(`\n${C.red}[FATAL]${C.reset} ${err instanceof Error ? err.message : err}`);
		if (err instanceof Error) console.error(err.stack);
		process.exit(1);
	});
