import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import type Stripe from 'stripe';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { env } from '$env/dynamic/private';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { normalizeCui, validateCuiOrReason } from '$lib/server/cui-validator';
import {
	isStripeConfiguredForTenant,
	getStripeForTenant,
	getPublishableKeyForTenant,
	getOrCreateStripeTaxRate
} from '$lib/server/plugins/stripe/factory';
import { DEFAULT_VAT_PERCENT } from '$lib/server/vat/rate';
import { computeVatBreakdown } from '$lib/utils/vat';
import { getOrCreateStripeCustomer } from '$lib/server/stripe/customer';
import { getOrCreateStripePrice } from '$lib/server/stripe/price';
import { createHostingCheckoutSession } from '$lib/server/stripe/checkout';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { decrypt } from '$lib/server/plugins/smartbill/crypto';
import { rateLimit } from '$lib/server/redis';
import { insertHostingOrder } from '$lib/server/hosting/insert-order';

/**
 * Public hosting pages — accessible without authentication.
 *
 * These remotes serve the marketing site at `/pachete-hosting`. They're hardcoded
 * to a single "owner" tenant (env `PUBLIC_HOSTING_TENANT_SLUG`, default 'ots')
 * because the public site doesn't have a tenant URL prefix.
 *
 * Security notes:
 *  - NO auth required (intentional — marketing page).
 *  - Inquiry submission rate-limited per IP (in-memory, naive).
 *  - Only `isPublic = true AND isActive = true` packages exposed.
 *  - NEVER expose internal fields (daUsername, daServerId, credentials).
 */

const PUBLIC_TENANT_SLUG = env.PUBLIC_HOSTING_TENANT_SLUG ?? 'ots';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Resolve the owner tenant for the public site. Cached for 5 minutes — a slug
 * rename or tenant deletion can't take the public site offline for the full
 * pod lifetime (Audit MED-8 — previously cached for process lifetime, which
 * meant any tenant table change required a restart).
 */
const TENANT_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedTenantId: string | null = null;
let cachedTenantAt = 0;
function invalidateTenantCache(): void {
	cachedTenantId = null;
	cachedTenantAt = 0;
}
async function resolvePublicTenantId(): Promise<string> {
	if (cachedTenantId && Date.now() - cachedTenantAt < TENANT_CACHE_TTL_MS) {
		return cachedTenantId;
	}
	const [t] = await db
		.select({ id: table.tenant.id })
		.from(table.tenant)
		.where(eq(table.tenant.slug, PUBLIC_TENANT_SLUG))
		.limit(1);
	if (!t) {
		// Don't poison the cache when the tenant is missing — let the next call
		// re-attempt (e.g. tenant being created via admin while public site is up).
		cachedTenantId = null;
		cachedTenantAt = 0;
		throw new Error(
			`PUBLIC_HOSTING_TENANT_SLUG="${PUBLIC_TENANT_SLUG}" not found in tenant table`
		);
	}
	cachedTenantId = t.id;
	cachedTenantAt = Date.now();
	return t.id;
}

/**
 * List packages for the public marketing page.
 * Joined with daPackage to expose resource limits; returns tenant VAT rate
 * so the UI can display "fără TVA · cu TVA X%: Y RON".
 */
export const getPublicHostingPackages = query(async () => {
	const tenantId = await resolvePublicTenantId();

	const [settings] = await db
		.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	const vatRate = settings?.defaultTaxRate ?? 19;

	// Public-safe tenant info for the footer ("Sediu / Telefon / Email / CUI / RegCom").
	// These fields are publicly listed on invoices and the business registry — exposing
	// them on the marketing page is intentional, not a leak.
	const [tenantInfo] = await db
		.select({
			name: table.tenant.name,
			website: table.tenant.website,
			cui: table.tenant.cui,
			vatNumber: table.tenant.vatNumber,
			registrationNumber: table.tenant.registrationNumber,
			address: table.tenant.address,
			city: table.tenant.city,
			county: table.tenant.county,
			postalCode: table.tenant.postalCode,
			country: table.tenant.country,
			phone: table.tenant.phone,
			email: table.tenant.email,
			// Bank details exposed for the "Ordin de plată" checkout step. These
			// are already on invoices and the business registry — publicly listing
			// them on /pachete-hosting just spares the customer one extra request.
			bankName: table.tenant.bankName,
			iban: table.tenant.iban,
			ibanEuro: table.tenant.ibanEuro
		})
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);

	const packages = await db
		.select({
			id: table.hostingProduct.id,
			name: table.hostingProduct.name,
			description: table.hostingProduct.description,
			features: table.hostingProduct.features,
			highlightBadge: table.hostingProduct.highlightBadge,
			price: table.hostingProduct.price,
			currency: table.hostingProduct.currency,
			billingCycle: table.hostingProduct.billingCycle,
			setupFee: table.hostingProduct.setupFee,
			bandwidth: table.daPackage.bandwidth,
			quota: table.daPackage.quota,
			maxEmailAccounts: table.daPackage.maxEmailAccounts,
			maxDatabases: table.daPackage.maxDatabases,
			maxDomains: table.daPackage.maxDomains,
			maxSubdomains: table.daPackage.maxSubdomains,
			ssl: table.daPackage.ssl,
			ssh: table.daPackage.ssh,
			wordpress: table.daPackage.wordpress,
			redis: table.daPackage.redis,
			git: table.daPackage.git,
			cron: table.daPackage.cron
		})
		.from(table.hostingProduct)
		.leftJoin(table.daPackage, eq(table.hostingProduct.daPackageId, table.daPackage.id))
		.where(
			and(
				eq(table.hostingProduct.tenantId, tenantId),
				eq(table.hostingProduct.isActive, true),
				eq(table.hostingProduct.isPublic, true)
			)
		)
		.orderBy(table.hostingProduct.publicSortOrder, table.hostingProduct.price);

	// Surface the public-tenant Stripe publishable key alongside the packages so
	// the marketing page can preload Stripe.js as soon as the checkout modal
	// opens — long before submitHostingOrder is called. Pulling the bundle
	// (~200KB) in parallel with the user typing through step 1+2 trims ~500ms
	// off the perceived "step 3 loading" time on first visits.
	const publishableKey = await getPublishableKeyForTenant(tenantId);

	return { packages, vatRate, tenantInfo: tenantInfo ?? null, publishableKey };
});

// ====================== Rate limit (Redis-backed, multi-replica safe) ======
// Each kind of endpoint has its own per-IP-per-hour cap. The implementation
// lives in `$lib/server/redis.ts#rateLimit` (fixed-window via INCR + EXPIRE).
// Redis is the same instance BullMQ already uses; if Redis is down we fail
// OPEN — blocking all submissions on a transient infra blip is worse for
// revenue than letting a small attacker through during the outage.
const RATE_LIMIT_PER_IP_HOUR = 20;
const DOMAIN_CHECKS_PER_IP_HOUR = 30;
const EMAIL_CHECKS_PER_IP_HOUR = 10;
const ANAF_LOOKUPS_PER_IP_HOUR = 5;
const WINDOW_SEC = 60 * 60;

const InquirySchema = v.object({
	hostingProductId: v.optional(v.pipe(v.string(), v.minLength(1))),
	contactName: v.pipe(v.string(), v.minLength(2, 'Numele e prea scurt'), v.maxLength(120)),
	contactEmail: v.pipe(v.string(), v.email('Email invalid'), v.maxLength(255)),
	contactPhone: v.optional(v.pipe(v.string(), v.maxLength(40))),
	companyName: v.optional(v.pipe(v.string(), v.maxLength(255))),
	vatNumber: v.optional(v.pipe(v.string(), v.maxLength(64))),
	message: v.optional(v.pipe(v.string(), v.maxLength(2000)))
});

/**
 * Public form submission — creates a `hosting_inquiry` row.
 * Tenant scoped to owner-tenant (resolved by slug). Validated + rate-limited.
 */
export const submitHostingInquiry = command(InquirySchema, async (data) => {
	const event = getRequestEvent();
	const ip =
		event?.getClientAddress?.() ??
		event?.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown';
	const userAgent = event?.request?.headers.get('user-agent') ?? null;

	{
		const rl = await rateLimit({ kind: 'inquiry', ip, limit: RATE_LIMIT_PER_IP_HOUR, windowSec: WINDOW_SEC });
		if (!rl.allowed) {
			logInfo('directadmin', 'inquiry rate-limited', { metadata: { ip, count: rl.count } });
			throw error(429, 'Prea multe cereri din această locație. Te rugăm să încerci din nou peste o oră.');
		}
	}

	const tenantId = await resolvePublicTenantId();

	// If hostingProductId is provided, validate it belongs to this tenant and is public.
	if (data.hostingProductId) {
		const [pkg] = await db
			.select({ id: table.hostingProduct.id })
			.from(table.hostingProduct)
			.where(
				and(
					eq(table.hostingProduct.id, data.hostingProductId),
					eq(table.hostingProduct.tenantId, tenantId),
					eq(table.hostingProduct.isPublic, true),
					eq(table.hostingProduct.isActive, true)
				)
			)
			.limit(1);
		if (!pkg) {
			throw new Error('Pachetul selectat nu mai e disponibil. Te rugăm să alegi altul.');
		}
	}

	const id = generateId();
	try {
		await insertHostingOrder(tenantId, {
			id,
			hostingProductId: data.hostingProductId ?? null,
			contactName: data.contactName.trim(),
			contactEmail: data.contactEmail.trim().toLowerCase(),
			contactPhone: data.contactPhone?.trim() || null,
			companyName: data.companyName?.trim() || null,
			vatNumber: data.vatNumber?.trim() || null,
			message: data.message?.trim() || null,
			source: 'pachete-hosting',
			ipAddress: ip,
			userAgent,
			// `submitHostingInquiry` is the lightweight "Cere ofertă" form — no
			// product/domain breakdown, so we deliberately skip the items
			// insert by passing product=null (helper handles that).
			product: null
		});
		logInfo('directadmin', 'new inquiry created', {
			tenantId,
			metadata: { inquiryId: id, hasProduct: !!data.hostingProductId, email: data.contactEmail }
		});
	} catch (e) {
		const { message } = serializeError(e);
		logError('directadmin', `failed to save inquiry: ${message}`, {
			tenantId,
			metadata: { ip }
		});
		throw new Error('A apărut o eroare la salvarea cererii. Te rugăm să încerci din nou.');
	}

	return { success: true, inquiryId: id };
});

// ====================== Domain availability (DirectAdmin) ======================
// Public-safe check: does this domain already exist on any of our DA servers,
// either as a primary domain or as an addon/parked domain under another user?
// If yes — we cannot create a new account with the same hostname.
//
// Privacy: we expose only `available: true|false` plus a coarse reason. We do
// NOT reveal which user owns the conflicting domain.

// Rate-limit constants moved to top-of-file Redis section; concrete checks happen
// inline at the call sites via `rateLimit(...)`.

// Cached snapshot of all domains hosted across the tenant's DA servers.
// 60s TTL — DA accounts don't appear/disappear faster than that, and refresh
// is cheap (one searchUsers + N getUserConfig per server). Keyed by tenantId
// so multi-tenant operators stay isolated.
const DA_DOMAIN_CACHE_TTL_MS = 60 * 1000;
type DomainSnapshot = { ts: number; domains: Set<string> };
const daDomainCache = new Map<string, DomainSnapshot>();
const inflight: Map<string, Promise<DomainSnapshot>> = new Map();

/**
 * Direct DA call: list every domain owned by `username` on this server.
 * Hits the legacy endpoint because the modern `/api/users/{u}/config` only
 * returns the primary domain on this DA version (no `domains[]` array).
 *
 * Response shape: `domain1.ro=<stats>&domain2.com=<stats>` (form-encoded;
 * keys are domain names, value is bandwidth/usage tuple we ignore).
 */
async function fetchUserDomains(
	tenantId: string,
	srv: typeof table.daServer.$inferSelect,
	username: string
): Promise<string[]> {
	const user = decrypt(tenantId, srv.usernameEncrypted);
	const pass = decrypt(tenantId, srv.passwordEncrypted);
	const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
	const proto = srv.useHttps !== false ? 'https' : 'http';
	const port = srv.port ?? 2222;
	const url = `${proto}://${srv.hostname}:${port}/CMD_API_SHOW_USER_DOMAINS?user=${encodeURIComponent(username)}`;
	const r = await fetch(url, {
		method: 'GET',
		headers: { Authorization: auth, Accept: 'text/plain' },
		signal: AbortSignal.timeout(8000),
		// Bun extends RequestInit with `tls` — typed natively in current Bun versions.
		tls: { rejectUnauthorized: false } as never
	});
	if (!r.ok) return [];
	const body = await r.text();
	const domains: string[] = [];
	for (const pair of body.split('&')) {
		const eq = pair.indexOf('=');
		if (eq <= 0) continue;
		const key = decodeURIComponent(pair.slice(0, eq));
		// DA leaks "error" / "text" rows when something went wrong — skip those.
		if (!key || key === 'error' || key === 'text' || key === 'details' || key.startsWith('list[')) continue;
		// Domain keys always contain at least one dot
		if (key.includes('.')) domains.push(key.toLowerCase().trim());
	}
	return domains;
}

/**
 * Read the list of usernames on this DA server. `/api/search/users` returns
 * a plain string array on the OTS DA version (not the `{username, domain}`
 * object shape some docs suggest), so we just take it as-is.
 */
async function fetchUsernames(
	tenantId: string,
	srv: typeof table.daServer.$inferSelect
): Promise<string[]> {
	const user = decrypt(tenantId, srv.usernameEncrypted);
	const pass = decrypt(tenantId, srv.passwordEncrypted);
	const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
	const proto = srv.useHttps !== false ? 'https' : 'http';
	const port = srv.port ?? 2222;
	const url = `${proto}://${srv.hostname}:${port}/api/search/users`;
	const r = await fetch(url, {
		method: 'GET',
		headers: { Authorization: auth, Accept: 'application/json' },
		signal: AbortSignal.timeout(8000),
		// Bun extends RequestInit with `tls` — typed natively in current Bun versions.
		tls: { rejectUnauthorized: false } as never
	});
	if (!r.ok) return [];
	const text = await r.text();
	try {
		const parsed = JSON.parse(text);
		if (Array.isArray(parsed)) {
			if (parsed.length === 0) return [];
			// Modern shape: ["user1","user2",...]
			if (typeof parsed[0] === 'string') return parsed as string[];
			// Object shape: [{username:"user1",...}, ...]
			if (typeof parsed[0] === 'object' && parsed[0]?.username) {
				return (parsed as Array<{ username: string }>).map((u) => u.username);
			}
		}
		if (parsed && Array.isArray(parsed.list)) return parsed.list as string[];
	} catch {
		// fall through
	}
	return [];
}

async function loadDomainSnapshot(tenantId: string): Promise<DomainSnapshot> {
	const cached = daDomainCache.get(tenantId);
	if (cached && Date.now() - cached.ts < DA_DOMAIN_CACHE_TTL_MS) return cached;

	const pending = inflight.get(tenantId);
	if (pending) return pending;

	const work = (async () => {
		const servers = await db
			.select()
			.from(table.daServer)
			.where(and(eq(table.daServer.tenantId, tenantId), eq(table.daServer.isActive, true)));

		const all = new Set<string>();
		for (const srv of servers) {
			try {
				const usernames = await fetchUsernames(tenantId, srv);
				// Parallel-but-bounded per server — DA can handle a handful of concurrent
				// connections, and we want to keep snapshot wall-time under ~2s for 40-150 users.
				const CONCURRENCY = 8;
				let i = 0;
				async function worker() {
					while (i < usernames.length) {
						const idx = i++;
						const u = usernames[idx];
						try {
							const domains = await fetchUserDomains(tenantId, srv, u);
							for (const d of domains) all.add(d);
						} catch (err) {
							logInfo('directadmin', `domain snapshot: SHOW_USER_DOMAINS(${u}) failed`, {
								tenantId,
								metadata: { server: srv.hostname, error: serializeError(err).message }
							});
						}
					}
				}
				await Promise.all(Array.from({ length: CONCURRENCY }, worker));
			} catch (err) {
				logError(
					'directadmin',
					`domain snapshot: server ${srv.hostname} unreachable: ${serializeError(err).message}`,
					{ tenantId, metadata: { serverId: srv.id } }
				);
			}
		}

		const snap = { ts: Date.now(), domains: all };
		daDomainCache.set(tenantId, snap);
		logInfo('directadmin', `domain snapshot refreshed: ${all.size} domains`, {
			tenantId,
			metadata: { serverCount: servers.length }
		});
		return snap;
	})();

	inflight.set(tenantId, work);
	try {
		return await work;
	} finally {
		inflight.delete(tenantId);
	}
}

const DomainCheckSchema = v.pipe(v.string(), v.minLength(3), v.maxLength(253));

/**
 * Returns whether `domain` is free to use as the primary domain of a new DA
 * account on the tenant's servers. Hits a 60s in-memory cache; refreshes via
 * DA's `/api/search/users` + per-user `/api/users/{u}/config`.
 *
 * Public — no auth. Rate-limited per IP.
 */
export const checkDomainAvailability = query(DomainCheckSchema, async (raw) => {
	const event = getRequestEvent();
	const ip =
		event?.getClientAddress?.() ??
		event?.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown';
	const domainRl = await rateLimit({ kind: 'domain', ip, limit: DOMAIN_CHECKS_PER_IP_HOUR, windowSec: WINDOW_SEC });
	if (!domainRl.allowed) {
		return {
			ok: false as const,
			error: 'Prea multe verificări de domeniu din această locație. Reîncearcă peste o oră.'
		};
	}

	const candidate = raw.trim().toLowerCase();
	if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(candidate) || candidate.startsWith('-') || candidate.endsWith('-')) {
		return { ok: false as const, error: 'Format invalid.' };
	}

	const tenantId = await resolvePublicTenantId();
	try {
		const snap = await loadDomainSnapshot(tenantId);
		const taken = snap.domains.has(candidate);
		return {
			ok: true as const,
			available: !taken as boolean,
			domain: candidate,
			source: 'directadmin' as const,
			snapshotAgeMs: Date.now() - snap.ts
		};
	} catch (err) {
		logError('directadmin', `domain availability check failed: ${serializeError(err).message}`, {
			tenantId,
			metadata: { domain: candidate, ip }
		});
		// When DA is unreachable we return `available: null` (the explicit
		// "we don't know" state). The UI shows an amber banner instead of green
		// "available" — a fail-open green misleads users into paying for a
		// domain that turns out to be taken (Audit MED-6). The hard guard at
		// submit time still re-checks before account creation.
		return {
			ok: true as const,
			available: null,
			domain: candidate,
			source: 'da-unreachable' as const,
			snapshotAgeMs: 0
		};
	}
});

// ====================== Email-known-to-CRM (anti-enumeration) =================
// Public lookup. Modal-ul îl apela pentru a marca pre-submit dacă emailul e
// cunoscut și a afișa un hint UI "ai deja cont, autentifică-te". Acel hint
// CONSTITUIE un oracle de enumeration pentru atacatori anonimi (request URL +
// răspuns => o listă de emailuri client). Eliminăm scurgerea:
//   - Răspunsul e mereu identic, indiferent dacă match-uiește sau nu.
//   - Logging-ul server-side rămâne (pentru telemetrie internă), dar valorile
//     diferențiale (`known: true/false`, `action: 'login-required'/'none'`)
//     NU mai trec wire-ul.
//   - Modalul nu mai are flag-uri de UI bazate pe match — vezi commit-ul
//     anti-enumeration din hosting-checkout-modal.svelte.

const EmailCheckSchema = v.pipe(
	v.string(),
	v.trim(),
	v.email('Email invalid'),
	v.maxLength(255)
);

/**
 * ANTI-ENUMERATION: returnează un payload identic indiferent de match. NU
 * expune `known`, `action` sau alte flag-uri diferențiale. Server-side
 * facem lookup-ul (pentru audit + viitor magic-link async), dar răspunsul
 * spre client e sealed. Rate-limited per IP.
 */
export const checkEmailKnownToCrm = query(EmailCheckSchema, async (rawEmail) => {
	const event = getRequestEvent();
	const ip =
		event?.getClientAddress?.() ??
		event?.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown';
	const emailRl = await rateLimit({ kind: 'email-known', ip, limit: EMAIL_CHECKS_PER_IP_HOUR, windowSec: WINDOW_SEC });
	if (!emailRl.allowed) {
		return { ok: false as const, error: 'Prea multe verificări. Reîncearcă peste o oră.' };
	}

	const tenantId = await resolvePublicTenantId();
	const normalized = rawEmail.trim().toLowerCase();

	// Three tables to check, in order of likelihood for a returning customer:
	//   1. client.email                 — CRM contact created via prior order
	//   2. user.email via clientUser   — customer portal login
	//   3. user.email via tenantUser   — staff member of this tenant (rare,
	//                                    but if they typo their own email
	//                                    into the public form we should still
	//                                    recognize them)
	// Each lookup is constant-time on its own and we run them in parallel so
	// the response time is uniform regardless of which (if any) match hits.
	const [clientHit, portalHit, staffHit] = await Promise.all([
		db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(eq(table.client.tenantId, tenantId), eq(table.client.email, normalized)))
			.limit(1),
		db
			.select({ userId: table.user.id, clientId: table.clientUser.clientId })
			.from(table.user)
			.innerJoin(table.clientUser, eq(table.clientUser.userId, table.user.id))
			.where(
				and(eq(table.clientUser.tenantId, tenantId), eq(table.user.email, normalized))
			)
			.limit(1),
		db
			.select({ userId: table.user.id })
			.from(table.user)
			.innerJoin(table.tenantUser, eq(table.tenantUser.userId, table.user.id))
			.where(and(eq(table.tenantUser.tenantId, tenantId), eq(table.user.email, normalized)))
			.limit(1)
	]);

	const matched =
		clientHit[0] ? { kind: 'client' as const, id: clientHit[0].id } :
		portalHit[0] ? { kind: 'portal' as const, userId: portalHit[0].userId, clientId: portalHit[0].clientId } :
		staffHit[0] ? { kind: 'staff' as const, userId: staffHit[0].userId } :
		null;

	if (matched) {
		// LOG server-side pentru telemetrie internă + future async magic-link.
		// NU returnăm nicio diferență către client — atacatorul anonim NU mai
		// poate enumera emailuri prin acest endpoint.
		logInfo('directadmin', 'checkout: known-email lookup hit (no enumeration leak)', {
			tenantId,
			metadata: { kind: matched.kind, email: normalized, ip }
		});
	}

	// ANTI-ENUMERATION: răspuns sealed, identic indiferent de match. Nu mai
	// expunem `known: true/false` sau `action: '...'` distinguibile. Modalul nu
	// mai are nimic util să facă cu acest endpoint — îl chemăm doar pentru
	// rate-limiting + audit (e nice-to-have, NU comportament UI critic).
	return { ok: true as const };
});

// ====================== Sprint 8: ANAF + Stripe checkout ======================

// ANAF throttle moved to Redis (rateLimit kind='anaf') — see constant
// `ANAF_LOOKUPS_PER_IP_HOUR` at top-of-file. Per-process Maps reset on each
// deploy and don't scale across replicas.

/**
 * Validate CUI (check digit) + fetch ANAF company data.
 *
 * Folosit pe pasul 1 al form-ului `/pachete-hosting/comanda` ca să auto-completeze
 * datele firmei (denumire, adresă, status TVA) după ce userul introduce CUI-ul.
 *
 * Rate-limit per IP pentru a evita abuze ale API-ului ANAF gratuit.
 */
export const validateCuiAndFetch = query(
	v.pipe(v.string(), v.minLength(2), v.maxLength(12)),
	async (cuiInput) => {
		const event = getRequestEvent();
		const ip =
			event?.getClientAddress?.() ??
			event?.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
			'unknown';

		// Validare check digit locală — fail rapid, fără să apelăm ANAF
		const reason = validateCuiOrReason(cuiInput);
		if (reason) return { valid: false as const, error: reason };

		const anafRl = await rateLimit({ kind: 'anaf', ip, limit: ANAF_LOOKUPS_PER_IP_HOUR, windowSec: WINDOW_SEC });
		if (!anafRl.allowed) {
			return {
				valid: false as const,
				error: 'Prea multe verificări CUI din această locație. Reîncearcă peste o oră.'
			};
		}

		const cleanCui = normalizeCui(cuiInput);
		try {
			const apiUrl =
				env.ANAF_API_URL || 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva';
			const res = await fetch(apiUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([{ cui: parseInt(cleanCui), data: new Date().toISOString().slice(0, 10) }]),
				signal: AbortSignal.timeout(8000)
			});
			if (!res.ok) {
				return { valid: false as const, error: `ANAF a răspuns ${res.status}. Încearcă din nou.` };
			}
			const data = (await res.json()) as {
				found?: Array<{
					date_generale?: {
						cui: number;
						denumire: string;
						adresa: string;
						nrRegCom?: string;
						telefon?: string;
						codPostal?: string;
						statusRO_e_Factura?: boolean;
					};
					inregistrare_scop_Tva?: { scpTVA: boolean };
				}>;
				notFound?: string[];
			};

			if (!data.found || data.found.length === 0) {
				return {
					valid: false as const,
					error: 'CUI valid algoritmic, dar nu a fost găsit la ANAF. Verifică din nou.'
				};
			}

			const company = data.found[0];
			return {
				valid: true as const,
				data: {
					cui: cleanCui,
					vatNumber: company.inregistrare_scop_Tva?.scpTVA ? `RO${cleanCui}` : cleanCui,
					denumire: company.date_generale?.denumire ?? '',
					adresa: company.date_generale?.adresa ?? '',
					nrRegCom: company.date_generale?.nrRegCom ?? '',
					telefon: company.date_generale?.telefon ?? '',
					codPostal: company.date_generale?.codPostal ?? '',
					platitorTva: !!company.inregistrare_scop_Tva?.scpTVA,
					eFacturaActiv: !!company.date_generale?.statusRO_e_Factura
				}
			};
		} catch (e) {
			logError('directadmin', `ANAF lookup failed: ${serializeError(e).message}`, {
				metadata: { cui: cleanCui, ip }
			});
			return {
				valid: false as const,
				error: 'Eroare la verificare ANAF. Încearcă din nou peste câteva minute.'
			};
		}
	}
);

const OrderSchema = v.object({
	hostingProductId: v.pipe(v.string(), v.minLength(1)),
	// Person vs. company billing. Defaults to company for backwards compat with
	// any caller that pre-dates this field.
	billingType: v.optional(v.picklist(['person', 'company']), 'company'),
	email: v.pipe(v.string(), v.email(), v.maxLength(255)),
	phone: v.optional(v.pipe(v.string(), v.maxLength(40))),
	// Company fields — required when billingType=company, runtime-validated below.
	cui: v.optional(v.pipe(v.string(), v.maxLength(12))),
	companyName: v.optional(v.pipe(v.string(), v.maxLength(255))),
	registrationNumber: v.optional(v.pipe(v.string(), v.maxLength(64))),
	vatPayer: v.optional(v.boolean(), false),
	// Person fields — required when billingType=person.
	firstName: v.optional(v.pipe(v.string(), v.maxLength(120))),
	lastName: v.optional(v.pipe(v.string(), v.maxLength(120))),
	// Shared address fields.
	address: v.optional(v.pipe(v.string(), v.maxLength(500))),
	postalCode: v.optional(v.pipe(v.string(), v.maxLength(16))),
	city: v.optional(v.pipe(v.string(), v.maxLength(120))),
	county: v.optional(v.pipe(v.string(), v.maxLength(120))),
	consentTerms: v.literal(true), // GDPR + ToS — must be true
	// Optional context collected by the inline checkout modal (domain selection,
	// payment-method preference, additional notes). Stored on `hosting_inquiry.message`
	// for staff visibility — Stripe itself only handles the payment.
	notes: v.optional(v.pipe(v.string(), v.maxLength(2000))),
	// Payment surface:
	//   'checkout_redirect' (default) → Stripe Checkout hosted page (returns checkoutUrl)
	//   'payment_intent' → embedded Stripe Elements (returns clientSecret + publishableKey)
	paymentMode: v.optional(v.picklist(['checkout_redirect', 'payment_intent']), 'checkout_redirect'),
	// What the customer actually selected on the modal. Distinct from `paymentMode`
	// (which is the Stripe surface). When customer picks "ordin de plată" we still
	// route through Stripe Checkout as a fallback, but staff sees the OP intent in
	// the Comenzi hosting admin page and accepts the bank transfer manually.
	paymentMethod: v.optional(v.picklist(['card', 'op', 'paypal', 'revolut']), 'card'),
	// The domain the customer chose on the public form (new registration, existing
	// domain via DNS update, or transfer). Stored as-is so the Comenzi hosting
	// admin page can pre-populate the DA provisioning form's "Domeniu primar".
	// Lightly validated — strict format check happens server-side on provisioning.
	requestedDomain: v.optional(v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(253))),
	// Domain breakdown — captured from the checkout modal so the admin
	// drawer + future invoice can show a real line for the domain. `buy` =
	// new registration (cost paid now). `have`/`transfer` = no cost (the
	// row exists for audit but unit_price_cents stays 0).
	domainName: v.optional(v.pipe(v.string(), v.maxLength(253))),
	domainMode: v.optional(v.picklist(['buy', 'have', 'transfer'])),
	domainCostCents: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)))
});

/**
 * Sprint 8 — final order submission with Stripe checkout.
 *
 * Flow:
 *  1. Validate CUI + payload
 *  2. Check duplicate CUI in CRM → if exists, return login-required message (no email sent)
 *  3. Else: create `client` (pending_email) + `hosting_inquiry` linked
 *  4. Create Stripe Customer (cached after first call)
 *  5. Get/create Stripe Price for the package
 *  6. Create Stripe Checkout Session → return URL for redirect
 *
 * Webhook `checkout.session.completed` will later mark inquiry as paid and trigger
 * admin notification (no automated email to the buyer — that would be a spam relay).
 */
export const submitHostingOrder = command(OrderSchema, async (data) => {
	const tenantId = await resolvePublicTenantId();
	if (!(await isStripeConfiguredForTenant(tenantId))) {
		throw error(
			503,
			'Plățile online nu sunt configurate. Contactează administratorul (Stripe lipsește).'
		);
	}

	const event = getRequestEvent();
	const ip =
		event?.getClientAddress?.() ??
		event?.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown';
	const userAgent = event?.request?.headers.get('user-agent') ?? null;

	// Origin whitelist — Stripe redirect target trebuie să vină dintr-o listă fixă
	// ca să prevenim open redirect via Host/X-Forwarded-Host forjat la proxy.
	const ALLOWED_ORIGINS = [env.PUBLIC_APP_URL, 'http://localhost:5173'].filter(
		(o): o is string => Boolean(o)
	);
	const candidateOrigin = event?.url.origin;
	const origin =
		candidateOrigin && ALLOWED_ORIGINS.includes(candidateOrigin)
			? candidateOrigin
			: env.PUBLIC_APP_URL ?? 'http://localhost:5173';

	{
		// Same per-IP-per-hour cap as the inquiry endpoint; both count under
		// kind='inquiry' so a determined abuser can't double their quota by
		// mixing the two submit paths.
		const rl = await rateLimit({ kind: 'inquiry', ip, limit: RATE_LIMIT_PER_IP_HOUR, windowSec: WINDOW_SEC });
		if (!rl.allowed) {
			throw error(
				429,
				'Prea multe cereri din această locație. Te rugăm să încerci din nou peste o oră.'
			);
		}
	}

	const normalizedEmail = data.email.trim().toLowerCase();
	const billingType = data.billingType ?? 'company';

	// Validate product belongs to tenant + is public
	const [product] = await db
		.select()
		.from(table.hostingProduct)
		.where(
			and(
				eq(table.hostingProduct.id, data.hostingProductId),
				eq(table.hostingProduct.tenantId, tenantId),
				eq(table.hostingProduct.isPublic, true),
				eq(table.hostingProduct.isActive, true)
			)
		)
		.limit(1);
	if (!product) throw error(404, 'Pachetul selectat nu mai e disponibil.');

	// === C1 (audit 2026-05-31): Stripe MUST collect GROSS (net + TVA) ===
	// `product.price` is NET (bani). The UI shows the customer a total WITH TVA
	// and the Keez fiscal invoice is emitted on net+TVA. Previously Stripe charged
	// only the net → TVA was promised + invoiced but never collected (fiscal gap).
	// We read the tenant VAT rate (same source as the Keez emitter +
	// getPublicHostingPackages) and add it on top: as a Stripe Tax Rate for the
	// Price/subscription + hosted Checkout paths, or by bumping the one-time
	// PaymentIntent amount directly.
	const [taxSettings] = await db
		.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	const vatPercent = taxSettings?.defaultTaxRate ?? DEFAULT_VAT_PERCENT;
	const { netCents, vatCents, grossCents } = computeVatBreakdown(Number(product.price), vatPercent);

	// `clientId` se reasignează la id-ul existent dacă clientul deja există în CRM
	// (vezi anti-enumeration logic în branch-urile de mai jos). Inițial = UUID nou
	// folosit DOAR dacă insertăm un client nou. Tipul rămâne string în ambele cazuri.
	let clientId = generateId();
	const inquiryId = generateId();
	const now = new Date();

	// =====================================================================
	// Branch on billingType. The two flows diverge on:
	//   - identity check (CUI for company, email for person)
	//   - displayName / legalType on the client row
	//   - which fields the Stripe Customer carries
	// Everything from "Create inquiry" onwards is shared.
	// =====================================================================

	let clientRow: typeof table.client.$inferSelect;
	let displayName: string; // for inquiry.contactName + Stripe Customer name

	if (billingType === 'company') {
		const reason = validateCuiOrReason(data.cui ?? '');
		if (reason) throw error(400, reason);
		const cleanCui = normalizeCui(data.cui!);
		if (!data.companyName?.trim())
			throw error(400, 'Denumirea firmei este obligatorie pentru facturare pe firmă.');
		const companyName = data.companyName.trim();
		displayName = companyName;

		// Duplicate-CUI detection — log + transparent login message, no email sent.
		const [existingClient] = await db
			.select()
			.from(table.client)
			.where(
				and(
					eq(table.client.tenantId, tenantId),
					or(
						eq(table.client.cui, cleanCui),
						eq(table.client.vatNumber, `RO${cleanCui}`),
						eq(table.client.vatNumber, cleanCui)
					)
				)
			)
			.limit(1);

		if (existingClient) {
			// ANTI-ENUMERATION: NU returnăm un response distinguishable de cel pentru
			// client nou. Atașăm comanda la clientul existent și continuăm prin path-ul
			// comun (insert inquiry status='new' + Stripe). Atacatorul anonim NU mai
			// poate testa dacă un CUI/email există probând endpoint-ul.
			logInfo('directadmin', 'CUI hit — attaching new order to existing client (anti-enumeration unified path)', {
				tenantId,
				metadata: { cui: cleanCui, clientId: existingClient.id, submittedEmail: normalizedEmail }
			});
			clientRow = existingClient;
			clientId = existingClient.id;
		} else {
			try {
				const inserted = await withTursoBusyRetry(
					() =>
						db
							.insert(table.client)
							.values({
								id: clientId,
								tenantId,
								name: companyName,
								businessName: companyName,
								email: normalizedEmail,
								phone: data.phone || null,
								status: 'prospect',
								cui: cleanCui,
								vatNumber: data.vatPayer ? `RO${cleanCui}` : cleanCui,
								registrationNumber: data.registrationNumber || null,
								address: data.address || null,
								city: data.city || null,
								county: data.county || null,
								postalCode: data.postalCode || null,
								country: 'RO',
								legalType: 'srl',
								signupSource: 'public-form',
								onboardingStatus: 'pending_email'
							})
							.returning(),
					{ tenantId, label: 'public-hosting/insertClient' }
				);
				clientRow = inserted[0];
			} catch (err) {
				const { message } = serializeError(err);
				if (message.toLowerCase().includes('unique')) {
					logInfo('directadmin', 'CUI UNIQUE race — attaching to existing (anti-enumeration unified path)', {
						tenantId,
						metadata: { cui: cleanCui }
					});
					const [raceClient] = await db
						.select()
						.from(table.client)
						.where(and(eq(table.client.tenantId, tenantId), eq(table.client.cui, cleanCui)))
						.limit(1);
					if (!raceClient) {
						// Race lost dar nu găsim client-ul — re-throw, fluxul nu se poate completa.
						throw err;
					}
					clientRow = raceClient;
					clientId = raceClient.id;
				} else {
					throw err;
				}
			}
		}
	} else {
		// === Person flow ===
		// No CUI. Identity is just email; we still surface the same "silent magic
		// link" UX when the email is already attached to an existing client.
		const firstName = data.firstName?.trim() ?? '';
		const lastName = data.lastName?.trim() ?? '';
		if (!firstName || !lastName)
			throw error(400, 'Prenume și nume sunt obligatorii pentru persoană fizică.');
		displayName = `${firstName} ${lastName}`;

		const [existingByEmail] = await db
			.select()
			.from(table.client)
			.where(and(eq(table.client.tenantId, tenantId), eq(table.client.email, normalizedEmail)))
			.limit(1);

		if (existingByEmail) {
			// ANTI-ENUMERATION: vezi comentariul de la company branch. Atașăm
			// comanda la clientul existent — răspuns identic cu cel pentru client nou.
			logInfo('directadmin', 'Email hit (PF) — attaching new order to existing client (anti-enumeration unified path)', {
				tenantId,
				metadata: { clientId: existingByEmail.id, email: normalizedEmail }
			});
			clientRow = existingByEmail;
			clientId = existingByEmail.id;
		} else {
			try {
				const inserted = await withTursoBusyRetry(
					() =>
						db
							.insert(table.client)
							.values({
								id: clientId,
								tenantId,
								name: displayName,
								businessName: null,
								email: normalizedEmail,
								phone: data.phone || null,
								status: 'prospect',
								cui: null,
								vatNumber: null,
								registrationNumber: null,
								address: data.address || null,
								city: data.city || null,
								county: data.county || null,
								postalCode: data.postalCode || null,
								country: 'RO',
								legalType: 'pf',
								signupSource: 'public-form',
								onboardingStatus: 'pending_email'
							})
							.returning(),
					{ tenantId, label: 'public-hosting/insertClient-person' }
				);
				clientRow = inserted[0];
			} catch (err) {
				const { message } = serializeError(err);
				if (message.toLowerCase().includes('unique')) {
					logInfo('directadmin', 'PF email UNIQUE race — attaching to existing (anti-enumeration unified path)', {
						tenantId,
						metadata: { email: normalizedEmail }
					});
					const [raceClientPf] = await db
						.select()
						.from(table.client)
						.where(
							and(eq(table.client.tenantId, tenantId), eq(table.client.email, normalizedEmail))
						)
						.limit(1);
					if (!raceClientPf) {
						throw err;
					}
					clientRow = raceClientPf;
					clientId = raceClientPf.id;
				} else {
					throw err;
				}
			}
		}
	}

	const stripeMetadata = {
		crmTenantId: tenantId,
		crmClientId: clientRow.id,
		crmHostingInquiryId: inquiryId,
		crmHostingProductId: product.id
	};

	try {
		// Optimization: Parallelize DB write + Stripe Customer prep + Stripe Price prep
		// (~1.5s - 2s total saved depending on network jitter).
		const [stripeCustomerId, stripePriceId] = await Promise.all([
			getOrCreateStripeCustomer({
				id: clientRow.id,
				tenantId: clientRow.tenantId,
				name: clientRow.name,
				businessName: clientRow.businessName,
				email: clientRow.email,
				phone: clientRow.phone,
				vatNumber: clientRow.vatNumber,
				address: clientRow.address,
				city: clientRow.city,
				county: clientRow.county,
				postalCode: clientRow.postalCode,
				country: clientRow.country,
				stripeCustomerId: clientRow.stripeCustomerId
			}),
			getOrCreateStripePrice(tenantId, {
				id: product.id,
				name: product.name,
				description: product.description,
				price: product.price,
				currency: product.currency,
				billingCycle: product.billingCycle,
				stripePriceId: product.stripePriceId,
				stripeProductId: product.stripeProductId
			}),
			withTursoBusyRetry(
				() =>
					insertHostingOrder(tenantId, {
						id: inquiryId,
						product,
						hostingProductId: product.id,
						contactName: displayName,
						contactEmail: normalizedEmail,
						contactPhone: data.phone || null,
						companyName: billingType === 'company' ? data.companyName?.trim() ?? null : null,
						vatNumber: billingType === 'company' ? normalizeCui(data.cui ?? '') : null,
						message: data.notes?.trim() || null,
						status: 'new',
						source: 'pachete-hosting-checkout',
						ipAddress: ip,
						userAgent,
						clientId,
						clientCreated: true,
						clientCreatedAt: now,
						paymentMethod: data.paymentMethod ?? 'card',
						paymentStatus: 'pending',
						requestedDomain: data.requestedDomain || null,
						domainName: data.domainName ?? null,
						domainMode: data.domainMode ?? null,
						domainCostCents: data.domainCostCents ?? null
					}),
				{ tenantId, label: 'public-hosting/insertInquiry' }
			)
		]);

		const mode = product.billingCycle === 'one_time' ? 'payment' : 'subscription';

		logInfo('directadmin', '[CHECKOUT] Stripe prep', {
			tenantId,
			metadata: {
				inquiryId,
				clientId,
				productId: product.id,
				priceCents: product.price,
				currency: product.currency,
				billingCycle: product.billingCycle,
				mode,
				paymentMode: data.paymentMode,
				stripeCustomerId,
				stripePriceId
			}
		});

		// Branch on paymentMode: embedded Stripe Elements (PaymentIntent / Subscription
		// with default_incomplete) returns a clientSecret; legacy Checkout redirect
		// returns a Stripe-hosted URL. Both flows carry the same metadata so the
		// downstream webhook handlers resolve tenant/client/inquiry identically.
		if (data.paymentMode === 'payment_intent') {
			const stripe = await getStripeForTenant(tenantId);
			const publishableKey = await getPublishableKeyForTenant(tenantId);
			if (!publishableKey) {
				throw new Error('Publishable key Stripe lipsă pentru acest tenant.');
			}

			let clientSecret: string | null = null;
			let paymentIntentId: string | null = null;
			let subscriptionId: string | null = null;

			if (mode === 'subscription') {
				// C1: attach the tenant VAT Tax Rate so Stripe collects net+TVA. The
				// rate sits on the subscription item → it also applies to every renewal
				// invoice (keeping renewal charges == renewal Keez invoices).
				const taxRateId = await getOrCreateStripeTaxRate(tenantId, vatPercent);
				const subscription = await stripe.subscriptions.create({
					customer: stripeCustomerId,
					items: [{ price: stripePriceId, tax_rates: [taxRateId] }],
					payment_behavior: 'default_incomplete',
					payment_settings: { save_default_payment_method: 'on_subscription' },
					// Stripe API 2026-04-22 (dahlia) moved the PaymentIntent reference
					// off `latest_invoice.payment_intent` (now absent) onto the new
					// `latest_invoice.payments.data[].payment.payment_intent` shape.
					// We can only expand 4 levels deep; the PaymentIntent ID at that
					// path is a string, so we retrieve the full PI in a second call
					// to get the client_secret + update metadata. Older API versions
					// still populate `payment_intent` directly — handle both shapes.
					expand: ['latest_invoice.payments.data.payment', 'latest_invoice.payment_intent'],
					metadata: stripeMetadata
				});
				subscriptionId = subscription.id;
				const latestInvoice = subscription.latest_invoice;
				if (!latestInvoice || typeof latestInvoice === 'string') {
					throw new Error('Stripe nu a returnat invoice-ul pentru subscription.');
				}

				// Resolve PI id from either the legacy or new shape.
				type InvoicePayment = {
					payment?: { payment_intent?: string | null; type?: string } | null;
				};
				type ExtInvoice = Stripe.Invoice & {
					payment_intent?: Stripe.PaymentIntent | string | null;
					payments?: { data?: InvoicePayment[] } | null;
				};
				const inv = latestInvoice as ExtInvoice;
				let piRef: Stripe.PaymentIntent | string | null = inv.payment_intent ?? null;
				if (!piRef) {
					const inpay = inv.payments?.data?.[0];
					piRef = inpay?.payment?.payment_intent ?? null;
				}
				if (!piRef) {
					throw new Error('Stripe nu a returnat PaymentIntent pentru subscription.');
				}
				const piId = typeof piRef === 'string' ? piRef : piRef.id;
				// Retrieve full PI (we need client_secret which isn't on the deep-
				// expanded shape) and stamp CRM metadata + subscription id so the
				// webhook handler can resolve everything without a Subscription
				// roundtrip later.
				const pi = await stripe.paymentIntents.update(piId, {
					metadata: { ...stripeMetadata, crmSubscriptionId: subscription.id }
				});
				clientSecret = pi.client_secret;
				paymentIntentId = pi.id;
			} else {
				// `product.price` is ALREADY stored in the smallest currency unit
				// (bani for RON) per `hostingProduct.price` schema annotation. The
				// earlier `* 100` multiplier here charged 100× the real price
				// (1.399 RON → 139,900 RON PaymentIntent). Pass through directly.
				const intent = await stripe.paymentIntents.create({
					// C1: charge GROSS (net + TVA). One-time PaymentIntents can't carry
					// a Stripe Tax Rate, so add TVA into the amount → Stripe collects
					// exactly what the customer sees + what Keez invoices.
					amount: grossCents,
					currency: product.currency.toLowerCase(),
					customer: stripeCustomerId,
					automatic_payment_methods: { enabled: true },
					metadata: {
						...stripeMetadata,
						crmNetCents: String(netCents),
						crmVatCents: String(vatCents),
						crmVatPercent: String(vatPercent)
					},
					description: `Hosting one-time — ${product.name}`
				});
				clientSecret = intent.client_secret;
				paymentIntentId = intent.id;
			}

			if (!clientSecret || !paymentIntentId) {
				throw new Error('Stripe nu a returnat clientSecret.');
			}

			// Persist paymentIntent id on the inquiry for traceability (reuses the
			// existing `stripeCheckoutSessionId` column — webhook resolves via metadata,
			// not this column, so the name mismatch is acceptable for now).
			await withTursoBusyRetry(
				() =>
					db
						.update(table.hostingInquiry)
						.set({ stripeCheckoutSessionId: paymentIntentId, updatedAt: new Date() })
						.where(eq(table.hostingInquiry.id, inquiryId)),
				{ tenantId, label: 'public-hosting/updateInquiryPI' }
			);

			logInfo('directadmin', '[CHECKOUT] Stripe PaymentIntent created (embedded)', {
				tenantId,
				metadata: {
					clientId,
					inquiryId,
					product: product.name,
					priceCents: product.price,
					mode,
					paymentIntentId,
					subscriptionId,
					clientSecretPrefix: clientSecret?.slice(0, 18) + '…'
				}
			});

			return {
				duplicateCui: false as const,
				clientId,
				inquiryId,
				paymentIntent: {
					clientSecret,
					publishableKey,
					paymentIntentId,
					subscriptionId,
					mode
				}
			};
		}

		// Default: legacy hosted Stripe Checkout redirect.
		// C1: pass the tenant VAT Tax Rate so the hosted Checkout page collects
		// net+TVA (== the total shown in the wizard + the Keez invoice).
		const checkoutTaxRateId = await getOrCreateStripeTaxRate(tenantId, vatPercent);
		const session = await createHostingCheckoutSession({
			tenantId,
			stripeCustomerId,
			stripePriceId,
			mode,
			taxRateId: checkoutTaxRateId,
			successUrl: `${origin}/pachete-hosting/comanda/success`,
			cancelUrl: `${origin}/pachete-hosting`,
			metadata: stripeMetadata
		});

		await withTursoBusyRetry(
			() =>
				db
					.update(table.hostingInquiry)
					.set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() })
					.where(eq(table.hostingInquiry.id, inquiryId)),
			{ tenantId, label: 'public-hosting/updateInquirySession' }
		);

		const checkoutUrl = session.url ?? '';
		if (!checkoutUrl) throw new Error('Stripe nu a returnat URL de checkout.');

		logInfo('directadmin', 'Stripe checkout session created', {
			tenantId,
			metadata: { clientId, inquiryId, product: product.name }
		});

		return {
			duplicateCui: false as const,
			clientId,
			inquiryId,
			checkoutUrl
		};
	} catch (e) {
		const { message } = serializeError(e);
		logError('directadmin', `Stripe creation failed: ${message}`, {
			tenantId,
			metadata: { clientId, inquiryId, product: product.name, paymentMode: data.paymentMode }
		});
		// Mark inquiry as failed for staff visibility (best-effort, nu blocăm pe DB busy).
		await withTursoBusyRetry(
			() =>
				db
					.update(table.hostingInquiry)
					.set({ status: 'new', message: `Eroare Stripe: ${message}`, updatedAt: new Date() })
					.where(eq(table.hostingInquiry.id, inquiryId)),
			{ tenantId, label: 'public-hosting/markInquiryFailed' }
		).catch(() => {});
		throw error(
			502,
			'Plata nu poate fi inițializată acum. Te rugăm să încerci din nou peste câteva minute sau să folosești metoda „Ordin de plată".'
		);
	}
});
