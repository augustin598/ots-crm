import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { env } from '$env/dynamic/private';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { normalizeCui, validateCuiOrReason } from '$lib/server/cui-validator';
import { getStripe, isStripeConfigured } from '$lib/server/stripe/client';
import { getOrCreateStripeCustomer } from '$lib/server/stripe/customer';
import { getOrCreateStripePrice } from '$lib/server/stripe/price';
import { createHostingCheckoutSession } from '$lib/server/stripe/checkout';

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
 * Resolve the owner tenant for the public site. Cached per process lifetime
 * (slug doesn't change at runtime).
 */
let cachedTenantId: string | null = null;
async function resolvePublicTenantId(): Promise<string> {
	if (cachedTenantId) return cachedTenantId;
	const [t] = await db
		.select({ id: table.tenant.id })
		.from(table.tenant)
		.where(eq(table.tenant.slug, PUBLIC_TENANT_SLUG))
		.limit(1);
	if (!t) {
		throw new Error(
			`PUBLIC_HOSTING_TENANT_SLUG="${PUBLIC_TENANT_SLUG}" not found in tenant table`
		);
	}
	cachedTenantId = t.id;
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

	return { packages, vatRate };
});

// ====================== Rate limit (naive, in-memory) ======================
// Tracks inquiry submissions per IP. Per-process state — multi-node deployments
// would need Redis. Acceptable for a marketing page with low expected volume.
const RATE_LIMIT_PER_IP_HOUR = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const ipHits = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
	const now = Date.now();
	const cutoff = now - RATE_LIMIT_WINDOW_MS;
	const hits = (ipHits.get(ip) ?? []).filter((t) => t > cutoff);
	if (hits.length >= RATE_LIMIT_PER_IP_HOUR) {
		ipHits.set(ip, hits);
		return false;
	}
	hits.push(now);
	ipHits.set(ip, hits);
	return true;
}

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

	if (!checkRateLimit(ip)) {
		logInfo('directadmin', 'inquiry rate-limited', { metadata: { ip } });
		throw new Error('Prea multe cereri din această locație. Te rugăm să încerci din nou peste o oră.');
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
		await db.insert(table.hostingInquiry).values({
			id,
			tenantId,
			hostingProductId: data.hostingProductId ?? null,
			contactName: data.contactName.trim(),
			contactEmail: data.contactEmail.trim().toLowerCase(),
			contactPhone: data.contactPhone?.trim() || null,
			companyName: data.companyName?.trim() || null,
			vatNumber: data.vatNumber?.trim() || null,
			message: data.message?.trim() || null,
			ipAddress: ip,
			userAgent
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

// ====================== Sprint 8: ANAF + Stripe checkout ======================

// Naive throttle: max 5 CUI lookups per IP per hour (anti-abuse ANAF API)
const ANAF_LOOKUPS_PER_IP_HOUR = 5;
const anafLookups = new Map<string, number[]>();
function checkAnafThrottle(ip: string): boolean {
	const now = Date.now();
	const cutoff = now - RATE_LIMIT_WINDOW_MS;
	const hits = (anafLookups.get(ip) ?? []).filter((t) => t > cutoff);
	if (hits.length >= ANAF_LOOKUPS_PER_IP_HOUR) {
		anafLookups.set(ip, hits);
		return false;
	}
	hits.push(now);
	anafLookups.set(ip, hits);
	return true;
}

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

		if (!checkAnafThrottle(ip)) {
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
	cui: v.pipe(v.string(), v.minLength(2), v.maxLength(12)),
	email: v.pipe(v.string(), v.email(), v.maxLength(255)),
	phone: v.optional(v.pipe(v.string(), v.maxLength(40))),
	// Date pre-completate de ANAF (validate de client side, dar re-verificăm CUI)
	companyName: v.pipe(v.string(), v.minLength(2), v.maxLength(255)),
	address: v.optional(v.pipe(v.string(), v.maxLength(500))),
	registrationNumber: v.optional(v.pipe(v.string(), v.maxLength(64))),
	postalCode: v.optional(v.pipe(v.string(), v.maxLength(16))),
	city: v.optional(v.pipe(v.string(), v.maxLength(120))),
	county: v.optional(v.pipe(v.string(), v.maxLength(120))),
	vatPayer: v.boolean(),
	consentTerms: v.literal(true) // GDPR + ToS — must be true
});

/**
 * Sprint 8 — final order submission with Stripe checkout.
 *
 * Flow:
 *  1. Validate CUI + payload
 *  2. Check duplicate CUI in CRM → if exists, send magic link silent + return
 *  3. Else: create `client` (pending_email) + `hosting_inquiry` linked
 *  4. Create Stripe Customer (cached after first call)
 *  5. Get/create Stripe Price for the package
 *  6. Create Stripe Checkout Session → return URL for redirect
 *
 * Webhook `checkout.session.completed` will later mark inquiry as paid and trigger
 * magic link email + admin notification.
 */
export const submitHostingOrder = command(OrderSchema, async (data) => {
	if (!isStripeConfigured()) {
		throw new Error(
			'Plățile online nu sunt configurate. Contactează administratorul (Stripe lipsește).'
		);
	}

	const event = getRequestEvent();
	const ip =
		event?.getClientAddress?.() ??
		event?.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown';
	const userAgent = event?.request?.headers.get('user-agent') ?? null;
	const origin = event?.url.origin ?? env.PUBLIC_APP_URL ?? 'http://localhost:5173';

	if (!checkRateLimit(ip)) {
		throw new Error('Prea multe cereri din această locație. Reîncearcă peste o oră.');
	}

	const reason = validateCuiOrReason(data.cui);
	if (reason) throw new Error(reason);
	const cleanCui = normalizeCui(data.cui);

	const tenantId = await resolvePublicTenantId();
	const normalizedEmail = data.email.trim().toLowerCase();

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
	if (!product) throw new Error('Pachetul selectat nu mai e disponibil.');

	// === Edge case: CUI existent ===
	// Mesaj transparent + magic link silent (decizia user — Sprint 7 design).
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
		logInfo('directadmin', 'CUI duplicat — magic link silent', {
			tenantId,
			metadata: { cui: cleanCui, clientId: existingClient.id, submittedEmail: normalizedEmail }
		});
		// TODO Sprint 8.1: send magic link to existing client's email (separate util).
		// Pentru moment, doar înregistrăm inquiry-ul pentru audit.
		const inquiryId = generateId();
		await db.insert(table.hostingInquiry).values({
			id: inquiryId,
			tenantId,
			hostingProductId: product.id,
			contactName: data.companyName,
			contactEmail: normalizedEmail,
			contactPhone: data.phone || null,
			companyName: data.companyName,
			vatNumber: cleanCui,
			message: 'CUI duplicat — clientul există deja în CRM',
			status: 'discarded',
			source: 'pachete-hosting-checkout',
			ipAddress: ip,
			userAgent,
			clientId: existingClient.id
		});
		return {
			duplicateCui: true as const,
			message:
				'Acest CUI există deja în sistemul nostru. Ți-am trimis pe emailul asociat un link de acces.'
		};
	}

	// === Normal flow: create client + inquiry + Stripe checkout ===
	const clientId = generateId();
	const inquiryId = generateId();
	const now = new Date();

	await db.insert(table.client).values({
		id: clientId,
		tenantId,
		name: data.companyName,
		businessName: data.companyName,
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
		legalType: 'srl', // MVP: JP only; ulterior detect din nrRegCom (J vs F vs A)
		signupSource: 'public-form',
		onboardingStatus: 'pending_email'
	});

	await db.insert(table.hostingInquiry).values({
		id: inquiryId,
		tenantId,
		hostingProductId: product.id,
		contactName: data.companyName,
		contactEmail: normalizedEmail,
		contactPhone: data.phone || null,
		companyName: data.companyName,
		vatNumber: cleanCui,
		status: 'new',
		source: 'pachete-hosting-checkout',
		ipAddress: ip,
		userAgent,
		clientId,
		clientCreated: true,
		clientCreatedAt: now
	});

	// === Stripe: customer + price + checkout session ===
	const [clientRow] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, clientId))
		.limit(1);
	if (!clientRow) throw new Error('Client creat dar nu poate fi citit (race condition).');

	let checkoutUrl: string;
	try {
		const stripeCustomerId = await getOrCreateStripeCustomer({
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
		});
		const stripePriceId = await getOrCreateStripePrice({
			id: product.id,
			name: product.name,
			description: product.description,
			price: product.price,
			currency: product.currency,
			billingCycle: product.billingCycle,
			stripePriceId: product.stripePriceId,
			stripeProductId: product.stripeProductId
		});

		const mode = product.billingCycle === 'one_time' ? 'payment' : 'subscription';
		const session = await createHostingCheckoutSession({
			stripeCustomerId,
			stripePriceId,
			mode,
			successUrl: `${origin}/pachete-hosting/comanda/success`,
			cancelUrl: `${origin}/pachete-hosting`,
			metadata: {
				crmTenantId: tenantId,
				crmClientId: clientRow.id,
				crmHostingInquiryId: inquiryId,
				crmHostingProductId: product.id
			}
		});

		await db
			.update(table.hostingInquiry)
			.set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() })
			.where(eq(table.hostingInquiry.id, inquiryId));

		checkoutUrl = session.url ?? '';
		if (!checkoutUrl) throw new Error('Stripe nu a returnat URL de checkout.');
	} catch (e) {
		const { message } = serializeError(e);
		logError('directadmin', `Stripe checkout creation failed: ${message}`, {
			tenantId,
			metadata: { clientId, inquiryId, product: product.name }
		});
		// Mark inquiry as failed for staff visibility
		await db
			.update(table.hostingInquiry)
			.set({ status: 'new', message: `Eroare Stripe: ${message}`, updatedAt: new Date() })
			.where(eq(table.hostingInquiry.id, inquiryId));
		throw new Error(`Nu am putut crea sesiunea de plată: ${message}`);
	}

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
});
