/**
 * WHMCS → DirectAdmin plugin import wizard.
 *
 * Scope: imports ONLY products, hosting services and domains. Clients/invoices/tickets
 * are handled by the CRM's existing WHMCS integration (`$lib/server/whmcs/`).
 *
 * Mapping rule: WHMCS `userid` → CRM `client.whmcsClientId` (existing column).
 */

import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';
import {
	mapWHMCSStatus,
	mapWHMCSDomainStatus,
	mapWHMCSBillingCycle,
	priceToCents,
	normalizeWHMCSDate,
	nullIfEmpty
} from '$lib/server/plugins/directadmin/mapper';
import { matchOrCreateClient } from '$lib/server/whmcs/client-matching';
import type { WhmcsClientPayload } from '$lib/server/whmcs/types';
import { encrypt, decrypt } from '$lib/server/plugins/smartbill/crypto';
import { logInfo, logError, serializeError } from '$lib/server/logger';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Map our internal `billingCycle` to `recurringInvoice.recurringType` + `recurringInterval`.
 * The recurringInvoice schema only knows about 'daily'|'weekly'|'monthly'|'yearly', so we
 * collapse our wider set into (type, interval) pairs.
 */
function cycleToRecurring(
	cycle: string
): { type: 'monthly' | 'yearly'; interval: number } | null {
	switch (cycle) {
		case 'monthly':
			return { type: 'monthly', interval: 1 };
		case 'quarterly':
			return { type: 'monthly', interval: 3 };
		case 'semiannually':
			return { type: 'monthly', interval: 6 };
		case 'annually':
			return { type: 'yearly', interval: 1 };
		case 'biennially':
			return { type: 'yearly', interval: 2 };
		case 'triennially':
			return { type: 'yearly', interval: 3 };
		case 'one_time':
		default:
			return null;
	}
}

/**
 * UPSERT a recurring_invoice row for a hosting account. Wires the hosting service into
 * the CRM's existing recurring billing engine (which already pushes to Keez via the
 * scheduler at `scheduler/tasks/recurring-invoices.ts`).
 *
 * Idempotent: matched by `hostingAccountId`. INSERT first time, UPDATE on re-import
 * (refresh amount, cycle, nextRunDate, isActive).
 *
 * Skips entirely when:
 *  - no clientId (unassigned account — recurring requires a client)
 *  - amount <= 0 (no positive recurring price)
 *  - cycle is `one_time` (not recurring by definition)
 *  - account status is `terminated`/`cancelled` (don't bill dead services)
 */
async function upsertRecurringForHostingAccount(args: {
	tenantId: string;
	userId: string;
	hostingAccountId: string;
	clientId: string | null;
	domain: string;
	daPackageName?: string | null;
	recurringAmount: number; // cents (for the cycle, not monthly)
	currency: string;
	billingCycle: string;
	startDate: string | null;
	nextDueDate: string | null;
	status: string;
}): Promise<'created' | 'updated' | 'skipped'> {
	if (!args.clientId) return 'skipped';
	if (args.recurringAmount <= 0) return 'skipped';
	if (args.status === 'terminated' || args.status === 'cancelled') return 'skipped';
	const cycleMap = cycleToRecurring(args.billingCycle);
	if (!cycleMap) return 'skipped'; // one_time or unknown

	// Pick start/next-run dates with sensible fallbacks. Both columns are NOT NULL on
	// recurring_invoice, so we always need *something*. If WHMCS gave us nothing useful,
	// default to today (start) and today+1cycle (nextRunDate).
	const today = new Date();
	const start = args.startDate ? new Date(args.startDate) : today;
	const nextRun = args.nextDueDate ? new Date(args.nextDueDate) : today;
	if (Number.isNaN(start.getTime())) return 'skipped';
	if (Number.isNaN(nextRun.getTime())) return 'skipped';

	// Resolve current package name: prefer caller-supplied, else read latest from hostingAccount
	// (the DA sync may have populated it after the WHMCS row was first imported).
	let resolvedPackageName: string | null = args.daPackageName ?? null;
	if (!resolvedPackageName) {
		const [ha] = await db
			.select({ daPackageName: table.hostingAccount.daPackageName })
			.from(table.hostingAccount)
			.where(eq(table.hostingAccount.id, args.hostingAccountId))
			.limit(1);
		resolvedPackageName = ha?.daPackageName ?? null;
	}

	// Resolve VAT rate from tenant's invoice settings. NEVER hardcode — Romania's VAT
	// changed (e.g. 19% → 21% in 2025/2026) and the tenant is the source of truth.
	// Fallback to 21 only if no settings row exists; do not bake a stale default in.
	const [vatSettings] = await db
		.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, args.tenantId))
		.limit(1);
	const taxRatePercent = vatSettings?.defaultTaxRate ?? 21;
	const taxRateBps = taxRatePercent * 100; // recurringInvoice.taxRate is in basis points (19% = 1900)

	const name = resolvedPackageName
		? `Hosting ${args.domain} (${resolvedPackageName})`
		: `Hosting ${args.domain}`;

	// Build template-level line item. Period (start-end) is appended per-generation in
	// generateInvoiceFromRecurringTemplate — this template description is the static seed.
	// rate is in CURRENCY UNITS (not cents); invoice-utils multiplies by 100 at generation time.
	// taxRate is in PERCENTAGE units; invoice-utils also multiplies by 100 (item.taxRate * 100 → bps).
	const baseDescription = resolvedPackageName
		? `${resolvedPackageName} - ${args.domain}`
		: `Hosting - ${args.domain}`;
	const lineItem = {
		description: baseDescription,
		quantity: 1,
		rate: args.recurringAmount / 100,
		taxRate: taxRatePercent,
		currency: args.currency,
		unitOfMeasure: 'Buc'
	};
	const lineItemsJson = JSON.stringify([lineItem]);

	const [existing] = await db
		.select({ id: table.recurringInvoice.id })
		.from(table.recurringInvoice)
		.where(eq(table.recurringInvoice.hostingAccountId, args.hostingAccountId))
		.limit(1);

	if (existing) {
		await db
			.update(table.recurringInvoice)
			.set({
				name,
				amount: args.recurringAmount,
				taxRate: taxRateBps,
				currency: args.currency,
				recurringType: cycleMap.type,
				recurringInterval: cycleMap.interval,
				nextRunDate: nextRun,
				isActive: args.status === 'active',
				lineItemsJson,
				updatedAt: new Date()
			})
			.where(eq(table.recurringInvoice.id, existing.id));
		return 'updated';
	}

	await db.insert(table.recurringInvoice).values({
		id: generateId(),
		tenantId: args.tenantId,
		clientId: args.clientId,
		hostingAccountId: args.hostingAccountId,
		name,
		amount: args.recurringAmount,
		taxRate: taxRateBps,
		currency: args.currency,
		recurringType: cycleMap.type,
		recurringInterval: cycleMap.interval,
		startDate: start,
		nextRunDate: nextRun,
		issueDateOffset: 0,
		dueDateOffset: 14,
		lineItemsJson,
		isActive: args.status === 'active',
		createdByUserId: args.userId
	});
	return 'created';
}

const ConnectionSchema = v.object({
	host: v.pipe(v.string(), v.minLength(1)),
	port: v.optional(v.pipe(v.number(), v.integer())),
	user: v.pipe(v.string(), v.minLength(1)),
	password: v.pipe(v.string(), v.minLength(1)),
	database: v.pipe(v.string(), v.minLength(1))
});

const ImportSchema = v.object({
	host: v.pipe(v.string(), v.minLength(1)),
	port: v.optional(v.pipe(v.number(), v.integer())),
	user: v.pipe(v.string(), v.minLength(1)),
	password: v.pipe(v.string(), v.minLength(1)),
	database: v.pipe(v.string(), v.minLength(1)),
	entities: v.array(v.picklist(['product', 'service', 'domain'])),
	/** WHMCS server id → CRM daServer id */
	serverMappings: v.optional(v.record(v.string(), v.string())),
	/** WHMCS tblcurrencies.id of the currency to read prices in. Default = 1 (WHMCS install default). */
	currencyId: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
	/**
	 * When true, services pointing at a WHMCS user that has no CRM client trigger an
	 * auto-create from tblclients data. Default = false because the usual workflow is:
	 * clients already exist in CRM (synced via Keez/ANAF/manual), match them by CUI/email,
	 * just link the hosting account. Enable only for fresh CRM installs without prior
	 * client data.
	 */
	autoCreateMissingClients: v.optional(v.boolean(), false)
});

async function checkAlreadyImported(
	tenantId: string,
	entityType: string,
	sourceId: number
): Promise<string | null> {
	const [existing] = await db
		.select({ id: table.whmcsHostingImportLog.id, targetId: table.whmcsHostingImportLog.targetId })
		.from(table.whmcsHostingImportLog)
		.where(
			and(
				eq(table.whmcsHostingImportLog.tenantId, tenantId),
				eq(table.whmcsHostingImportLog.entityType, entityType),
				eq(table.whmcsHostingImportLog.sourceId, sourceId),
				eq(table.whmcsHostingImportLog.status, 'success')
			)
		)
		.limit(1);
	return existing?.targetId ?? null;
}

async function writeImportLog(
	tenantId: string,
	userId: string,
	entityType: 'product' | 'service' | 'domain',
	sourceId: number,
	targetId: string,
	status: 'success' | 'skipped' | 'error',
	errorMessage?: string
) {
	await db.insert(table.whmcsHostingImportLog).values({
		id: generateId(),
		tenantId,
		importedAt: new Date().toISOString(),
		importedByUserId: userId,
		entityType,
		sourceId,
		targetId,
		status,
		errorMessage
	});
}

import type { RowDataPacket } from 'mysql2';

interface WhmcsProductRow extends RowDataPacket {
	id: number;
	name: string;
	description: string | null;
	type: string;
	paytype: string;
	hidden: number;
	// Joined from tblpricing (LEFT JOIN — may be null if product has no pricing row in selected currency)
	monthly: string | null;
	quarterly: string | null;
	semiannually: string | null;
	annually: string | null;
	biennially: string | null;
	triennially: string | null;
	msetupfee: string | null;
	qsetupfee: string | null;
	ssetupfee: string | null;
	asetupfee: string | null;
	bsetupfee: string | null;
	tsetupfee: string | null;
}

interface WhmcsServiceRow extends RowDataPacket {
	id: number;
	userid: number;
	packageid: number;
	server: number;
	regdate: string;
	domain: string;
	domainstatus: string;
	username: string;
	password: string;
	notes: string | null;
	billingcycle: string;
	amount: string;
	nextduedate: string | null;
}

interface WhmcsDomainRow extends RowDataPacket {
	id: number;
	userid: number;
	registrationdate: string | null;
	domain: string;
	registrar: string | null;
	expirydate: string | null;
	nextduedate: string | null;
	status: string;
	donotrenew: number;
	recurringamount: string | null;
}

interface WhmcsClientRow extends RowDataPacket {
	id: number;
	firstname: string;
	lastname: string;
	companyname: string;
	email: string;
	address1: string;
	city: string;
	state: string;
	postcode: string;
	country: string;
	phonenumber: string;
	tax_id: string;
	status: string; // 'Active' | 'Inactive' | 'Closed'
}

export const testWHMCSConnection = command(ConnectionSchema, async (config) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.import');

	const mysql = await import('mysql2/promise');
	const conn = await mysql.createConnection({
		host: config.host,
		port: config.port ?? 3306,
		user: config.user,
		password: config.password,
		database: config.database,
		connectTimeout: 10000
	});
	try {
		await conn.query('SELECT 1');
		return { success: true };
	} finally {
		await conn.end();
	}
});

export const importFromWHMCS = command(ImportSchema, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.import');

	const tenantId = event.locals.tenant.id;
	const userId = event.locals.user.id;

	const mysql = await import('mysql2/promise');
	const conn = await mysql.createConnection({
		host: params.host,
		port: params.port ?? 3306,
		user: params.user,
		password: params.password,
		database: params.database,
		connectTimeout: 15000,
		// CRITICAL: mysql2 by default decodes DATE/DATETIME/TIMESTAMP columns to JS Date objects.
		// Our normalizers expect strings (and WHMCS stores `0000-00-00` sentinels which Date can't
		// represent without weird epoch values). Forcing string output keeps everything predictable.
		dateStrings: true
	});

	const stats = {
		imported: 0,
		skipped: 0,
		errors: 0,
		errorDetails: [] as string[],
		byType: {
			product: { imported: 0, skipped: 0, errors: 0 },
			/**
			 * `unassigned` counts services that imported successfully but with `client_id=null`
			 * because no CRM match was found AND auto-create was disabled. User can fix these
			 * via the "Match client" dropdown on /hosting/accounts.
			 */
			service: { imported: 0, unassigned: 0, skipped: 0, errors: 0 },
			domain: { imported: 0, skipped: 0, errors: 0 },
			/**
			 * Client match-or-create breakdown by `matchType` returned from the shared
			 * `matchOrCreateClient` helper (the same one the existing WHMCS invoice
			 * integration uses). matchedByCui is the most common branch (~80% per the
			 * matching cascade's docs); matchedByEmail is the natural-person tiebreak;
			 * created means a brand-new CRM client row was inserted.
			 */
			client: { matchedByWhmcsId: 0, matchedByCui: 0, matchedByEmail: 0, created: 0 },
			/** Recurring invoices created/updated/skipped for hosting accounts. */
			recurring: { created: 0, updated: 0, skipped: 0 }
		}
	};

	const productIdMap: Record<number, string> = {};
	/** Per-import cache: WHMCS userid → CRM clientId. Populated on first lookup, reused thereafter. */
	const clientIdCache: Record<number, string | null> = {};

	/**
	 * Resolve a WHMCS userid to a CRM clientId by reusing the SAME `matchOrCreateClient`
	 * cascade the CRM already uses for WHMCS invoice webhooks. That helper handles:
	 *   - whmcs_client_id match (fast path after first sync)
	 *   - CUI match (normalized: strips `RO` prefix, lowercases, digits-only) — covers
	 *     the common case where Keez/ANAF already synced the client with the same CUI
	 *   - Email match (tiebreak / natural-person)
	 *   - Insert with backfill of whmcsClientId on match (so future lookups skip cascade)
	 * We just have to build the right `WhmcsClientPayload` from the tblclients row.
	 * Returns null only when the WHMCS row itself doesn't exist or autoCreate is off
	 * AND no existing match is found.
	 */
	async function resolveClientId(whmcsUserId: number): Promise<string | null> {
		if (whmcsUserId in clientIdCache) return clientIdCache[whmcsUserId];

		// Fetch the WHMCS user record
		const [whmcsRows] = await conn.query<WhmcsClientRow[]>(
			'SELECT id, firstname, lastname, companyname, email, address1, city, state, postcode, country, phonenumber, tax_id, status FROM tblclients WHERE id = ? LIMIT 1',
			[whmcsUserId]
		);
		const whmcs = whmcsRows[0];
		if (!whmcs) {
			clientIdCache[whmcsUserId] = null;
			return null;
		}

		const companyName = nullIfEmpty(whmcs.companyname);
		const payload: WhmcsClientPayload = {
			event: 'added',
			whmcsClientId: whmcsUserId,
			taxId: nullIfEmpty(whmcs.tax_id),
			companyName,
			firstName: nullIfEmpty(whmcs.firstname),
			lastName: nullIfEmpty(whmcs.lastname),
			isLegalPerson: companyName !== null,
			email: nullIfEmpty(whmcs.email),
			phone: nullIfEmpty(whmcs.phonenumber),
			address: nullIfEmpty(whmcs.address1),
			city: nullIfEmpty(whmcs.city),
			countyName: nullIfEmpty(whmcs.state),
			countyCode: null,
			postalCode: nullIfEmpty(whmcs.postcode),
			countryCode: nullIfEmpty(whmcs.country),
			countryName: null,
			status: nullIfEmpty(whmcs.status)
		};

		// If autoCreate is OFF, we still want to MATCH but skip CREATE. The simplest way
		// is to short-circuit when matchOrCreateClient would otherwise insert: try the
		// match-only path first (whmcsClientId → CUI → email queries) without delegating.
		if (!params.autoCreateMissingClients) {
			const matchType = await tryMatchOnly(payload);
			if (matchType) {
				return clientIdCache[whmcsUserId]!;
			}
			clientIdCache[whmcsUserId] = null;
			return null;
		}

		const result = await matchOrCreateClient(tenantId, payload);
		switch (result.matchType) {
			case 'WHMCS_ID':
				stats.byType.client.matchedByWhmcsId++;
				break;
			case 'CUI':
				stats.byType.client.matchedByCui++;
				break;
			case 'EMAIL':
				stats.byType.client.matchedByEmail++;
				break;
			case 'NEW':
				stats.byType.client.created++;
				break;
		}
		clientIdCache[whmcsUserId] = result.clientId;
		return result.clientId;
	}

	/**
	 * Match-only variant (no insert) for when autoCreate is disabled. Mirrors the cascade
	 * in `matchOrCreateClient` but returns null instead of creating.
	 */
	async function tryMatchOnly(payload: WhmcsClientPayload): Promise<'WHMCS_ID' | 'CUI' | 'EMAIL' | null> {
		const { normalizeCui } = await import('$lib/server/whmcs/client-matching');
		const cui = normalizeCui(payload.taxId);
		const email = (payload.email ?? '').trim().toLowerCase();

		const byId = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(eq(table.client.tenantId, tenantId), eq(table.client.whmcsClientId, payload.whmcsClientId)))
			.limit(1);
		if (byId[0]) {
			stats.byType.client.matchedByWhmcsId++;
			clientIdCache[payload.whmcsClientId] = byId[0].id;
			return 'WHMCS_ID';
		}
		if (cui) {
			const byCui = await db
				.select({ id: table.client.id })
				.from(table.client)
				.where(and(eq(table.client.tenantId, tenantId), eq(table.client.cui, cui)))
				.limit(1);
			if (byCui[0]) {
				await db
					.update(table.client)
					.set({ whmcsClientId: payload.whmcsClientId, updatedAt: new Date() })
					.where(eq(table.client.id, byCui[0].id));
				stats.byType.client.matchedByCui++;
				clientIdCache[payload.whmcsClientId] = byCui[0].id;
				return 'CUI';
			}
		}
		if (email) {
			const byEmail = await db
				.select({ id: table.client.id })
				.from(table.client)
				.where(and(eq(table.client.tenantId, tenantId), eq(table.client.email, email)))
				.limit(1);
			if (byEmail[0]) {
				await db
					.update(table.client)
					.set({ whmcsClientId: payload.whmcsClientId, updatedAt: new Date() })
					.where(eq(table.client.id, byEmail[0].id));
				stats.byType.client.matchedByEmail++;
				clientIdCache[payload.whmcsClientId] = byEmail[0].id;
				return 'EMAIL';
			}
		}
		return null;
	}

	try {
		// 1. Products
		// WHMCS stores recurring prices and setup fees in `tblpricing`, NOT on tblproducts.
		// Join: tblpricing.relid = tblproducts.id AND tblpricing.type = 'product' AND tblpricing.currency = ?
		// Setup fee columns are prefixed by cycle: m=monthly, q=quarterly, s=semiannually, a=annually, b=biennially, t=triennially.
		if (params.entities.includes('product')) {
			const [rows] = await conn.query<WhmcsProductRow[]>(
				`SELECT p.id, p.name, p.description, p.type, p.paytype, p.hidden,
				        pr.monthly, pr.quarterly, pr.semiannually, pr.annually, pr.biennially, pr.triennially,
				        pr.msetupfee, pr.qsetupfee, pr.ssetupfee, pr.asetupfee, pr.bsetupfee, pr.tsetupfee
				FROM tblproducts p
				LEFT JOIN tblpricing pr ON pr.type = 'product' AND pr.relid = p.id AND pr.currency = ?
				WHERE p.type = 'hostingaccount'`,
				[params.currencyId ?? 1]
			);
			for (const p of rows) {
				try {
					const existingTargetId = await checkAlreadyImported(tenantId, 'product', p.id);
					if (existingTargetId) {
						productIdMap[p.id] = existingTargetId;
						stats.skipped++;
						stats.byType.product.skipped++;
						continue;
					}

					// Pick cheapest non-zero recurring price as default. Each entry tracks its
					// matching setup fee column (m/q/s/a/b/t prefix). FIX: previously `biannually`
					// was reused for both semiannually (6 months) and biennially (24 months) — wrong.
					// Now each WHMCS cycle column maps to its distinct internal cycle.
					const cycles = [
						{ cycle: 'monthly' as const, raw: p.monthly, setupRaw: p.msetupfee },
						{ cycle: 'quarterly' as const, raw: p.quarterly, setupRaw: p.qsetupfee },
						{ cycle: 'semiannually' as const, raw: p.semiannually, setupRaw: p.ssetupfee },
						{ cycle: 'annually' as const, raw: p.annually, setupRaw: p.asetupfee },
						{ cycle: 'biennially' as const, raw: p.biennially, setupRaw: p.bsetupfee },
						{ cycle: 'triennially' as const, raw: p.triennially, setupRaw: p.tsetupfee }
					]
						.map((c) => ({
							cycle: c.cycle,
							cents: priceToCents(c.raw),
							setupCents: priceToCents(c.setupRaw)
						}))
						.filter((c) => c.cents > 0);

					const chosen = cycles[0] ?? {
						cycle: 'monthly' as const,
						cents: 0,
						setupCents: 0
					};

					const newId = generateId();
					await db.insert(table.hostingProduct).values({
						id: newId,
						tenantId,
						name: p.name,
						description: nullIfEmpty(p.description),
						price: chosen.cents,
						currency: 'RON',
						billingCycle: chosen.cycle,
						setupFee: chosen.setupCents,
						isActive: p.hidden === 0,
						whmcsProductId: p.id
					});
					productIdMap[p.id] = newId;
					await writeImportLog(tenantId, userId, 'product', p.id, newId, 'success');
					stats.imported++;
					stats.byType.product.imported++;
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					await writeImportLog(tenantId, userId, 'product', p.id, '', 'error', msg);
					stats.errors++;
					stats.byType.product.errors++;
					stats.errorDetails.push(`product ${p.id}: ${msg}`);
				}
			}
		}

		// 2. Services (hosting accounts) — UPSERT: re-running updates existing rows with fresh
		// data from WHMCS (cycle, amount, status, next due date). Idempotent log entries track each run.
		if (params.entities.includes('service')) {
			const [rows] = await conn.query<WhmcsServiceRow[]>(
				`SELECT id, userid, packageid, server, regdate, domain, domainstatus, username, notes, billingcycle, amount, nextduedate
				FROM tblhosting`
			);
			for (const s of rows) {
				try {
					const crmClientId = await resolveClientId(s.userid);
					const isUnassigned = !crmClientId;

					const daServerId = params.serverMappings?.[String(s.server)] ?? null;
					if (!daServerId) {
						const msg = `No DA server mapping for WHMCS server id ${s.server}`;
						await writeImportLog(tenantId, userId, 'service', s.id, '', 'error', msg);
						stats.errors++;
						stats.byType.service.errors++;
						stats.errorDetails.push(`service ${s.id}: ${msg}`);
						continue;
					}

					// Common fields we (re-)set on every import. Notes prefix tags unassigned services.
					const baseNotes = nullIfEmpty(s.notes);
					const unassignedTag = isUnassigned
						? `[Neasignat — WHMCS user #${s.userid}, alocă manual clientul]`
						: null;
					const finalNotes = [unassignedTag, baseNotes].filter(Boolean).join('\n') || null;
					const commonFields = {
						clientId: crmClientId,
						daServerId,
						hostingProductId: productIdMap[s.packageid] ?? null,
						daUsername: s.username,
						domain: s.domain,
						status: mapWHMCSStatus(s.domainstatus),
						recurringAmount: priceToCents(s.amount),
						currency: 'RON',
						billingCycle: mapWHMCSBillingCycle(s.billingcycle),
						startDate: normalizeWHMCSDate(s.regdate),
						nextDueDate: normalizeWHMCSDate(s.nextduedate),
						notes: finalNotes,
						whmcsServiceId: s.id,
						updatedAt: new Date()
					};

					// Check existing first — by whmcsServiceId scoped to tenant.
					const [existing] = await db
						.select({ id: table.hostingAccount.id })
						.from(table.hostingAccount)
						.where(
							and(
								eq(table.hostingAccount.tenantId, tenantId),
								eq(table.hostingAccount.whmcsServiceId, s.id)
							)
						)
						.limit(1);

					let targetAccountId: string;
					if (existing) {
						await db
							.update(table.hostingAccount)
							.set(commonFields)
							.where(eq(table.hostingAccount.id, existing.id));
						targetAccountId = existing.id;
						await writeImportLog(
							tenantId,
							userId,
							'service',
							s.id,
							existing.id,
							'success',
							`Re-imported (updated existing)${isUnassigned ? ' — unassigned' : ''}`
						);
						stats.imported++;
						if (isUnassigned) stats.byType.service.unassigned++;
						else stats.byType.service.imported++;
					} else {
						const newId = generateId();
						await db.insert(table.hostingAccount).values({
							id: newId,
							tenantId,
							...commonFields
						});
						targetAccountId = newId;
						await writeImportLog(
							tenantId,
							userId,
							'service',
							s.id,
							newId,
							'success',
							isUnassigned ? `Imported as unassigned (WHMCS user #${s.userid})` : undefined
						);
						stats.imported++;
						if (isUnassigned) stats.byType.service.unassigned++;
						else stats.byType.service.imported++;
					}

					// Auto-create/update recurringInvoice so the existing CRM scheduler bills via Keez.
					// Skips silently when account is unassigned, terminated, one-time, or zero-priced.
					try {
						const result = await upsertRecurringForHostingAccount({
							tenantId,
							userId,
							hostingAccountId: targetAccountId,
							clientId: crmClientId,
							domain: s.domain,
							daPackageName: null, // populated separately via DA sync
							recurringAmount: priceToCents(s.amount),
							currency: 'RON',
							billingCycle: mapWHMCSBillingCycle(s.billingcycle),
							startDate: normalizeWHMCSDate(s.regdate),
							nextDueDate: normalizeWHMCSDate(s.nextduedate),
							status: mapWHMCSStatus(s.domainstatus)
						});
						stats.byType.recurring[result]++;
					} catch (recErr) {
						const msg = recErr instanceof Error ? recErr.message : String(recErr);
						logError('directadmin', `recurring upsert failed for service ${s.id}: ${msg}`, {
							tenantId,
							metadata: { whmcsServiceId: s.id, hostingAccountId: targetAccountId }
						});
						// Don't fail the whole service import — recurring is a downstream concern.
					}
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					await writeImportLog(tenantId, userId, 'service', s.id, '', 'error', msg);
					stats.errors++;
					stats.byType.service.errors++;
					stats.errorDetails.push(`service ${s.id}: ${msg}`);
				}
			}
		}

		// 3. Domains
		if (params.entities.includes('domain')) {
			const [rows] = await conn.query<WhmcsDomainRow[]>(
				`SELECT id, userid, registrationdate, domain, registrar, expirydate, nextduedate, status, donotrenew, recurringamount
				FROM tbldomains`
			);
			for (const d of rows) {
				try {
					const existingTargetId = await checkAlreadyImported(tenantId, 'domain', d.id);
					if (existingTargetId) {
						stats.skipped++;
						stats.byType.domain.skipped++;
						continue;
					}

					// CRM doesn't track domains as first-class entities (no registered_domain table).
					// We still want to resolve the client (which may auto-create) and log a clean skip
					// so the user gets a record but doesn't see "missing CRM client" noise.
					const crmClientId = await resolveClientId(d.userid);
					if (!('registeredDomain' in table)) {
						const msg = crmClientId
							? `Domain "${d.domain}" — CRM nu are modul Domenii. Sărit (clientul ${crmClientId} a fost resolved/created).`
							: `Domain "${d.domain}" — CRM nu are modul Domenii; clientul WHMCS ${d.userid} nu a fost nici el găsit.`;
						await writeImportLog(tenantId, userId, 'domain', d.id, '', 'skipped', msg);
						stats.skipped++;
						stats.byType.domain.skipped++;
						continue;
					}

					if (!crmClientId) {
						const msg = `WHMCS user ${d.userid} not found in tblclients (or auto-create disabled)`;
						await writeImportLog(tenantId, userId, 'domain', d.id, '', 'error', msg);
						stats.errors++;
						stats.byType.domain.errors++;
						stats.errorDetails.push(`domain ${d.id}: ${msg}`);
						continue;
					}

					const newId = generateId();
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const rdTable = (table as any).registeredDomain;
					await db.insert(rdTable).values({
						id: newId,
						tenantId,
						clientId: crmClientId,
						domain: d.domain,
						registrar: nullIfEmpty(d.registrar),
						registrationDate: normalizeWHMCSDate(d.registrationdate),
						expiryDate: normalizeWHMCSDate(d.expirydate),
						nextDueDate: normalizeWHMCSDate(d.nextduedate),
						status: mapWHMCSDomainStatus(d.status),
						autoRenew: d.donotrenew === 0,
						price: priceToCents(d.recurringamount),
						currency: 'RON',
						whmcsDomainId: d.id
					});
					await writeImportLog(tenantId, userId, 'domain', d.id, newId, 'success');
					stats.imported++;
					stats.byType.domain.imported++;
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					await writeImportLog(tenantId, userId, 'domain', d.id, '', 'error', msg);
					stats.errors++;
					stats.byType.domain.errors++;
					stats.errorDetails.push(`domain ${d.id}: ${msg}`);
				}
			}
		}

		logInfo('directadmin', 'WHMCS import complete', { tenantId, metadata: stats });
		return stats;
	} catch (e) {
		const { message, stack } = serializeError(e);
		logError('directadmin', `WHMCS import failed: ${message}`, { tenantId, stackTrace: stack });
		throw e;
	} finally {
		await conn.end();
	}
});

export const getWHMCSHostingImportLogs = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.import');

	return db
		.select()
		.from(table.whmcsHostingImportLog)
		.where(eq(table.whmcsHostingImportLog.tenantId, event.locals.tenant.id))
		.orderBy(desc(table.whmcsHostingImportLog.createdAt))
		.limit(200);
});

/**
 * Saved WHMCS import config lives in `tenantPlugin.config.whmcsImport`:
 *   { host, port, user, database, passwordEncrypted }
 * Password is per-tenant encrypted (AES-256-GCM). Other fields are not secret.
 */

interface SavedWhmcsImportConfig {
	host?: string;
	port?: number;
	user?: string;
	database?: string;
	passwordEncrypted?: string;
}

async function loadTenantPluginRow(tenantId: string) {
	const pluginRow = await db
		.select({ id: table.plugin.id })
		.from(table.plugin)
		.where(eq(table.plugin.name, 'directadmin'))
		.limit(1);
	if (pluginRow.length === 0) return null;
	const tp = await db
		.select()
		.from(table.tenantPlugin)
		.where(
			and(
				eq(table.tenantPlugin.tenantId, tenantId),
				eq(table.tenantPlugin.pluginId, pluginRow[0].id)
			)
		)
		.limit(1);
	if (tp.length === 0) return null;
	return tp[0];
}

export const getWHMCSImportConfig = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.import');
	const tenantId = event.locals.tenant.id;

	const tp = await loadTenantPluginRow(tenantId);
	if (!tp) return null;
	const cfg = (tp.config ?? {}) as Record<string, unknown>;
	const saved = (cfg.whmcsImport ?? null) as SavedWhmcsImportConfig | null;
	if (!saved) return null;

	let password = '';
	if (saved.passwordEncrypted) {
		try {
			password = await decrypt(tenantId, saved.passwordEncrypted);
		} catch (e) {
			logError('directadmin', `failed to decrypt WHMCS password: ${serializeError(e).message}`, {
				tenantId
			});
		}
	}

	return {
		host: saved.host ?? '',
		port: saved.port ?? 3306,
		user: saved.user ?? '',
		password,
		database: saved.database ?? ''
	};
});

const SaveWhmcsConfigSchema = v.object({
	host: v.pipe(v.string(), v.minLength(1)),
	port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
	user: v.pipe(v.string(), v.minLength(1)),
	password: v.string(),
	database: v.pipe(v.string(), v.minLength(1))
});

export const saveWHMCSImportConfig = command(SaveWhmcsConfigSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.import');
	const tenantId = event.locals.tenant.id;

	const tp = await loadTenantPluginRow(tenantId);
	if (!tp) throw new Error('Plugin DirectAdmin nu este activat pentru acest tenant.');

	const passwordEncrypted = data.password ? await encrypt(tenantId, data.password) : '';

	const existing = (tp.config ?? {}) as Record<string, unknown>;
	const next: Record<string, unknown> = {
		...existing,
		whmcsImport: {
			host: data.host,
			port: data.port,
			user: data.user,
			database: data.database,
			passwordEncrypted
		} satisfies SavedWhmcsImportConfig
	};

	await db
		.update(table.tenantPlugin)
		.set({ config: next, updatedAt: new Date() })
		.where(eq(table.tenantPlugin.id, tp.id));

	logInfo('directadmin', 'WHMCS import config saved', { tenantId });
	return { success: true };
});
