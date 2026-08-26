/**
 * Cumpărarea orelor de extra work de pe pagina publică `/servicii` (tab
 * „Tarife orare"). Fluxul oglindește comanda de hosting (`submitHostingOrder`),
 * dar vinde un număr de ore dintr-o specializare, nu un produs:
 *
 *  - aceeași gardă ca celelalte formulare /servicii (poartă + rate-limit comun);
 *  - clientul se creează/leagă cu aceeași politică anti-enumeration ca la
 *    hosting (CUI la firme, email la PF; UNIQUE race recovery) — răspunsul e
 *    identic indiferent dacă clientul exista deja;
 *  - suma = ore × tarif din CATALOG (nu din payload) + TVA-ul tenantului →
 *    PaymentIntent EUR pe BRUT, cu `metadata.crmPurpose='hours_purchase'`:
 *    contractul cu webhook-ul care emite factura Keez și trimite emailurile
 *    DOAR pentru acest flux (fără provisioning DA, fără reemitere).
 */
import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { and, eq, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { getHourlyRate } from '$lib/constants/ots-catalog';
import { HOURS_MIN, HOURS_MAX, hoursNetCents } from '$lib/logic/hours-pricing';
import { computeVatBreakdown } from '$lib/utils/vat';
import { resolveVatPercent } from '$lib/server/vat/rate';
import { guardPublicServicesSubmission } from '$lib/server/public-services-guard';
import { normalizeCui, validateCuiOrReason } from '$lib/server/cui-validator';
import {
	getPublishableKeyForTenant,
	getStripeForTenant,
	isStripeConfiguredForTenant,
	isStripeDevTestMode
} from '$lib/server/plugins/stripe/factory';
import { getOrCreateStripeCustomer } from '$lib/server/stripe/customer';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { logError, logInfo, serializeError } from '$lib/server/logger';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

const hoursOrderSchema = v.object({
	rateSlug: v.pipe(v.string(), v.minLength(1), v.maxLength(40)),
	hours: v.pipe(v.number(), v.integer(), v.minValue(HOURS_MIN), v.maxValue(HOURS_MAX)),
	billingType: v.optional(v.picklist(['company', 'person']), 'company'),
	contactName: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(120)),
	contactEmail: v.pipe(v.string(), v.trim(), v.maxLength(255), v.regex(EMAIL_REGEX)),
	contactPhone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
	companyName: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(160))),
	cui: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(12))),
	/** Din ANAF (autocomplete în modal); decide prefixul `RO` pe vatNumber, ca la hosting. */
	vatPayer: v.optional(v.boolean(), false),
	// Adresa de facturare: Keez o cere obligatoriu la persoane fizice
	// (ERROR_PF_AT_LEAST_ADDRESS) și o tipărește pe orice factură. La firme vine
	// din ANAF (modal) sau, când ANAF e indisponibil, din CRM dacă firma e deja
	// client — de aceea e opțională în schemă și verificată mai jos, după ce
	// știm dacă clientul există.
	address: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500))),
	city: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120))),
	county: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(120))),
	postalCode: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(16))),
	note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000))),
	/** Acordul cu Termenii + GDPR — obligatoriu, ca la comanda de hosting. */
	consentTerms: v.literal(true)
});

type ClientRow = typeof table.client.$inferSelect;

export const createHoursOrder = command(hoursOrderSchema, async (data) => {
	const event = getRequestEvent();
	const { tenantId, ip } = await guardPublicServicesSubmission(event);
	const userAgent = event?.request?.headers.get('user-agent') ?? null;

	if (!(await isStripeConfiguredForTenant(tenantId))) {
		throw error(503, 'Plățile online nu sunt disponibile momentan. Scrie-ne și rezolvăm direct.');
	}

	// Tariful vine din catalog, NU din payload — clientul nu-și alege prețul.
	const rate = getHourlyRate(data.rateSlug);
	if (!rate) throw error(400, 'Specializarea selectată nu există.');

	const normalizedEmail = data.contactEmail.toLowerCase();
	const billingType = data.billingType ?? 'company';
	const contactName = data.contactName.trim();

	// TVA-ul tenantului — aceeași sursă ca factura Keez și catalogul public
	// (audit C1: Stripe încasează BRUT, exact totalul afișat și facturat).
	const [settings] = await db
		.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	const vatPercent = resolveVatPercent(settings?.defaultTaxRate);
	const netCents = hoursNetCents(rate.rate, data.hours);
	const { vatCents, grossCents } = computeVatBreakdown(netCents, vatPercent);

	// ── Validare identitate + căutare client existent ────────────────────────
	let cleanCui: string | null = null;
	let companyName: string | null = null;

	if (billingType === 'company') {
		const reason = validateCuiOrReason(data.cui ?? '');
		if (reason) throw error(400, reason);
		cleanCui = normalizeCui(data.cui!);
		companyName = data.companyName?.trim() || null;
		if (!companyName) {
			throw error(400, 'Denumirea firmei este obligatorie pentru facturare pe firmă.');
		}
	} else if (contactName.split(/\s+/).length < 2) {
		// PF: nume + prenume vin într-un singur câmp; cerem minim două cuvinte
		// ca factura să nu iasă pe „Ion".
		throw error(400, 'Te rugăm să completezi numele și prenumele.');
	}

	const clientMatch = () =>
		and(
			eq(table.client.tenantId, tenantId),
			cleanCui
				? or(
						eq(table.client.cui, cleanCui),
						eq(table.client.vatNumber, `RO${cleanCui}`),
						eq(table.client.vatNumber, cleanCui)
					)
				: eq(table.client.email, normalizedEmail)
		);

	let clientRow: ClientRow | undefined;
	{
		const [existing] = await db.select().from(table.client).where(clientMatch()).limit(1);
		clientRow = existing;
	}

	const formAddress = data.address?.trim() ?? '';
	const formCity = data.city?.trim() ?? '';
	const formHasAddress = formAddress.length >= 5 && formCity.length >= 2;
	const ADDRESS_REQUIRED_MSG =
		billingType === 'company'
			? 'Nu am găsit sediul firmei (ANAF indisponibil). Completează adresa și localitatea.'
			: 'Completează adresa de facturare și localitatea.';

	if (!clientRow) {
		// Client nou: adresa e obligatorie (Keez o tipărește; la PF o refuză fără ea).
		if (!formHasAddress) throw error(400, ADDRESS_REQUIRED_MSG);
		try {
			const inserted = await withTursoBusyRetry(
				() =>
					db
						.insert(table.client)
						.values({
							id: generateId(),
							tenantId,
							name: companyName ?? contactName,
							businessName: companyName,
							email: normalizedEmail,
							phone: data.contactPhone || null,
							status: 'prospect',
							cui: cleanCui,
							vatNumber: cleanCui ? (data.vatPayer ? `RO${cleanCui}` : cleanCui) : null,
							address: formAddress,
							city: formCity,
							county: data.county || null,
							postalCode: data.postalCode || null,
							country: 'RO',
							legalType: cleanCui ? 'srl' : 'pf',
							signupSource: 'public-form',
							onboardingStatus: 'pending_email'
						})
						.returning(),
				{ tenantId, label: 'public-hours/insertClient' }
			);
			clientRow = inserted[0];
		} catch (err) {
			const { message } = serializeError(err);
			if (!message.toLowerCase().includes('unique')) throw err;
			// Race pe (tenant, email) sau (tenant, cui): re-căutăm pe AMBELE chei
			// și ne atașăm — răspuns identic cu clientul nou (anti-enumeration).
			const [race] = await db
				.select()
				.from(table.client)
				.where(
					and(
						eq(table.client.tenantId, tenantId),
						cleanCui
							? or(
									eq(table.client.cui, cleanCui),
									eq(table.client.vatNumber, `RO${cleanCui}`),
									eq(table.client.vatNumber, cleanCui),
									eq(table.client.email, normalizedEmail)
								)
							: eq(table.client.email, normalizedEmail)
					)
				)
				.limit(1);
			if (!race) throw err;
			clientRow = race;
		}
	}

	// Client existent: CRM-ul e sursa de adevăr pentru adresă (nu suprascriem).
	// Dacă în CRM lipsește (ex. client creat dintr-o cerere de ofertă), o luăm din
	// formular; fără niciuna, Keez ar respinge factura — cerem completarea.
	if (!clientRow.address?.trim()) {
		if (!formHasAddress) throw error(400, ADDRESS_REQUIRED_MSG);
		try {
			await withTursoBusyRetry(
				() =>
					db
						.update(table.client)
						.set({
							address: formAddress,
							city: clientRow!.city?.trim() ? clientRow!.city : formCity,
							county: clientRow!.county?.trim() ? clientRow!.county : data.county || null,
							postalCode: clientRow!.postalCode?.trim() ? clientRow!.postalCode : data.postalCode || null,
							updatedAt: new Date()
						})
						.where(and(eq(table.client.id, clientRow!.id), eq(table.client.tenantId, tenantId))),
				{ tenantId, label: 'public-hours/backfillClientAddress' }
			);
			clientRow = { ...clientRow, address: formAddress, city: clientRow.city || formCity };
		} catch (err) {
			logError('packages', `comandă ore: completarea adresei clientului a eșuat — ${serializeError(err).message}`, {
				tenantId,
				metadata: { clientId: clientRow.id }
			});
		}
	}

	// ── Comanda de ore (pending_payment) ─────────────────────────────────────
	const orderId = generateId();
	try {
		await withTursoBusyRetry(
			() =>
				db.insert(table.serviceHoursOrder).values({
					id: orderId,
					tenantId,
					clientId: clientRow.id,
					rateSlug: rate.slug,
					rateLabel: rate.label,
					rateEur: rate.rate,
					hours: data.hours,
					netCents,
					vatCents,
					grossCents,
					vatPercent,
					currency: 'EUR',
					billingType,
					contactName,
					contactEmail: normalizedEmail,
					contactPhone: data.contactPhone || null,
					companyName,
					cui: cleanCui,
					note: data.note || null,
					status: 'pending_payment',
					ipAddress: ip,
					userAgent
				}),
			{ tenantId, label: 'public-hours/insertOrder' }
		);
	} catch (err) {
		const { message, stack } = serializeError(err);
		logError('packages', `comandă ore: INSERT eșuat — ${message}`, {
			tenantId,
			stackTrace: stack,
			metadata: { rateSlug: rate.slug, hours: data.hours, clientId: clientRow.id }
		});
		throw error(500, 'Nu am putut înregistra comanda. Te rugăm să încerci din nou.');
	}

	// ── Stripe PaymentIntent pe BRUT ─────────────────────────────────────────
	try {
		const stripe = await getStripeForTenant(tenantId);
		const publishableKey = await getPublishableKeyForTenant(tenantId);
		if (!publishableKey) throw new Error('Publishable key Stripe lipsă pentru acest tenant.');

		// Dev-test (localhost cu chei de test): fără Customer — `client.stripe_customer_id`
		// e din contul LIVE, iar un Customer de test i-ar suprascrie cache-ul în DB-ul
		// partajat cu producția.
		let customerId: string | undefined;
		if (!isStripeDevTestMode()) {
			try {
				customerId = await getOrCreateStripeCustomer({
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
			} catch (err) {
				// Plata nu depinde de existența unui Customer — continuăm fără el.
				logError('packages', `comandă ore: Stripe Customer eșuat, continuăm fără — ${serializeError(err).message}`, {
					tenantId,
					metadata: { orderId, clientId: clientRow.id }
				});
			}
		}

		const intent = await stripe.paymentIntents.create({
			amount: grossCents,
			currency: 'eur',
			...(customerId ? { customer: customerId } : {}),
			automatic_payment_methods: { enabled: true },
			metadata: {
				crmPurpose: 'hours_purchase',
				crmTenantId: tenantId,
				crmClientId: clientRow.id,
				crmHoursOrderId: orderId,
				crmNetCents: String(netCents),
				crmVatCents: String(vatCents),
				crmVatPercent: String(vatPercent)
			},
			description: `Extra work — ${rate.label} × ${data.hours} h`
		});
		if (!intent.client_secret) throw new Error('Stripe nu a returnat clientSecret.');

		await withTursoBusyRetry(
			() =>
				db
					.update(table.serviceHoursOrder)
					.set({ stripePaymentIntentId: intent.id, updatedAt: new Date() })
					.where(
						and(
							eq(table.serviceHoursOrder.id, orderId),
							eq(table.serviceHoursOrder.tenantId, tenantId)
						)
					),
			{ tenantId, label: 'public-hours/updateOrderPI' }
		);

		logInfo('packages', 'comandă ore: PaymentIntent creat', {
			tenantId,
			metadata: {
				orderId,
				clientId: clientRow.id,
				rateSlug: rate.slug,
				hours: data.hours,
				grossCents,
				paymentIntentId: intent.id
			}
		});

		return {
			success: true as const,
			orderId,
			clientSecret: intent.client_secret,
			publishableKey,
			breakdown: { netCents, vatCents, grossCents, vatPercent }
		};
	} catch (err) {
		const { message, stack } = serializeError(err);
		logError('packages', `comandă ore: Stripe eșuat — ${message}`, {
			tenantId,
			stackTrace: stack,
			metadata: { orderId, clientId: clientRow.id }
		});
		throw error(502, 'Plata nu poate fi inițializată acum. Te rugăm să încerci peste câteva minute.');
	}
});
