/**
 * „Adaugă ore unui client" — fluxul din admin.
 *
 * Ordinea cerută de business: **adminul adaugă creditul, apoi se emite factura,
 * apoi factura pleacă pe email cu link de plată.** Clientul are orele imediat;
 * factura urmează. E diferit de comanda publică de pe /servicii, unde orele
 * intră abia după ce Stripe confirmă plata.
 *
 * Consecința care contează: factura emisă aici NU mai poate credita la plată.
 * O marcăm cu `externalSource = HOUR_CREDIT_INVOICE_SOURCE`, iar
 * `invoiceCreditEligibility` o respinge explicit. Fără marcaj, `invoice.paid`
 * ar adăuga a doua oară aceleași ore.
 *
 * Prețul vine din `effectiveRateEur` (aceeași funcție ca /servicii și ca modalul
 * public) — formula NU se duplică aici.
 *
 * Valuta: ca la `emit-keez-hours-invoice`, antetul e în RON cu cursul BNR blocat
 * pe rând (Keez refuză facturi EUR pentru clienți din România), iar linia rămâne
 * în EUR. Fără curs BNR nu emitem factura — dar creditul rămâne acordat.
 */
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';
import { getNextInvoiceNumberFromPlugin } from '$lib/server/invoice-utils';
import { getLatestBnrRateWithDate } from '$lib/server/bnr/client';
import { pushInvoiceToKeez } from '$lib/server/plugins/keez/auto-push';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import { resolveVatPercent } from '$lib/server/vat/rate';
import { classifyClientVat, getZeroVatLegalNote } from '$lib/server/vat/classify-client';
import { appendZeroVatNote } from '$lib/server/whmcs/zero-vat-detection';
import { computeVatBreakdown, vatPercentToBps } from '$lib/utils/vat';
import { KEEZ_UNIT } from '$lib/constants/keez-measure-units';
import { applyLedgerEntry } from '$lib/server/hour-credits';
import { sendInvoiceEmail } from '$lib/server/email';
import {
	effectiveRateEur,
	eurCentsToRonCents,
	formatExchangeRate,
	hoursLineDescription,
	hoursNetCents,
	isValidHours
} from '$lib/logic/hours-pricing';
import {
	MAX_HOURS_MAX,
	activeModes,
	activeRates,
	resolveReferenceRate
} from '$lib/logic/hourly-catalog';
import { HOUR_CREDIT_INVOICE_SOURCE, eurCentsToReferenceMinutes } from '$lib/logic/hour-credits';
import { computeExpiryDate } from '$lib/logic/hour-credit-expiry';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export interface CreateHourCreditOrderInput {
	tenantId: string;
	clientId: string;
	userId: string;
	rateSlug: string;
	modeSlug: string;
	hours: number;
	/** Wall-clock, text liber: când are nevoie clientul de lucrare. */
	requestedWindow?: string | null;
	/** Fără bifă nu pleacă niciun email spre client. */
	sendEmail: boolean;
	/**
	 * Cheia de idempotență a cererii, generată la deschiderea modalului. Două
	 * trimiteri cu aceeași cheie (dublu click, al doilea tab, retry) creditează și
	 * facturează o singură dată. Lipsă = cerere nouă de fiecare dată.
	 */
	requestId?: string | null;
}

export interface CreateHourCreditOrderResult {
	creditMinutes: number;
	ledgerEntryId: string;
	invoiceId: string | null;
	invoiceNumber: string | null;
	keezPushed: boolean;
	emailSent: boolean;
	/** Ce nu a mers, fără să fi blocat creditarea (factură sau email). */
	warnings: string[];
	/** Cererea fusese deja procesată: nimic nou nu s-a creditat, emis sau trimis. */
	duplicate?: boolean;
}

/** Id-ul facturii derivat din cheia cererii — același format ca `generateId`. */
async function invoiceIdForRequest(tenantId: string, requestId: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(`hour-credit-order:${tenantId}:${requestId}`)
	);
	return encodeBase32LowerCase(new Uint8Array(digest).slice(0, 15));
}

/**
 * Cota de TVA a unei facturi de ore. NU e hardcodată: vine din setările de facturare
 * ale tenantului; un client intracomunitar sau din afara UE se facturează cu 0% și
 * mențiunea legală — aceeași regulă ca la facturile create din /invoices.
 */
async function resolveHourOrderVat(
	tenantId: string,
	clientId: string | null | undefined
): Promise<{ vatPercent: number; zeroVatNote: string | null }> {
	const [settings] = await db
		.select({
			defaultTaxRate: table.invoiceSettings.defaultTaxRate,
			zeroVatAutoDetect: table.invoiceSettings.whmcsZeroVatAutoDetect
		})
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	let vatPercent = resolveVatPercent(settings?.defaultTaxRate);
	let zeroVatNote: string | null = null;
	if (clientId && (settings?.zeroVatAutoDetect ?? true)) {
		const [vatClient] = await db
			.select({ country: table.client.country, cui: table.client.cui })
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (vatClient) {
			const scenario = classifyClientVat({ country: vatClient.country, cui: vatClient.cui });
			if (scenario === 'intracom' || scenario === 'export') {
				vatPercent = 0;
				zeroVatNote = getZeroVatLegalNote(scenario);
			}
		}
	}
	return { vatPercent, zeroVatNote };
}

/**
 * Validare + preț, fără efecte. Aceleași reguli ca pe /servicii, ca previewul
 * din modal să nu poată diverge de ce se întâmplă la submit.
 */
export async function quoteHourCreditOrder(params: {
	tenantId: string;
	rateSlug: string;
	modeSlug: string;
	hours: number;
	/** Când e dat, cota de TVA ține cont de clasificarea fiscală a clientului. */
	clientId?: string | null;
}): Promise<
	| { ok: false; reason: string }
	| {
			ok: true;
			rateLabel: string;
			modeLabel: string;
			modeSuffix: string;
			modeSla: string;
			baseRateEur: number;
			multiplierPct: number;
			effectiveRateEur: number;
			maxHours: number;
			netCents: number;
			vatCents: number;
			grossCents: number;
			vatPercent: number;
			creditMinutes: number;
			/** Mențiunea legală de pus pe factură când TVA-ul e 0. */
			zeroVatNote: string | null;
	  }
> {
	const { tenantId, rateSlug, modeSlug, hours } = params;
	// Limita publică (100 h) nu se aplică aici; plafonul real e al regimului, mai jos.
	if (!isValidHours(hours, MAX_HOURS_MAX)) return { ok: false, reason: 'Număr de ore invalid.' };

	const catalog = await getHourlyCatalog(tenantId);
	const rate = activeRates(catalog.rates).find((r) => r.slug === rateSlug);
	if (!rate) return { ok: false, reason: 'Specializarea nu există sau e dezactivată.' };
	const mode = activeModes(catalog.modes).find((m) => m.slug === modeSlug);
	if (!mode) return { ok: false, reason: 'Regimul de lucru nu există sau e dezactivat.' };
	if (hours > mode.maxHours) {
		return {
			ok: false,
			reason: `Pentru regimul „${mode.label}" se vând maximum ${mode.maxHours} ore odată.`
		};
	}

	const reference = resolveReferenceRate(catalog.rates, catalog.rules);
	if (!reference)
		return { ok: false, reason: 'Nicio specializare activă (tarif de referință lipsă).' };

	const rateEur = effectiveRateEur(rate.rateEur, mode.multiplierPct);
	const netCents = hoursNetCents(rateEur, hours, mode.maxHours);
	const { vatPercent, zeroVatNote } = await resolveHourOrderVat(tenantId, params.clientId);
	const { vatCents, grossCents } = computeVatBreakdown(netCents, vatPercent);

	// Creditul se măsoară în minute la tariful de REFERINȚĂ: orele scumpe aduc
	// proporțional mai mult credit. Folosim ACEEAȘI funcție ca la creditarea
	// facturilor plătite, ca să se aplice și rotunjirea la pasul configurat —
	// altfel fluxul ăsta ar produce solduri care nu sunt multiplu de pas, spre
	// deosebire de toate celelalte alimentări.
	const creditMinutes = eurCentsToReferenceMinutes(
		netCents,
		reference.rateEur,
		catalog.rules.stepMinutes
	);

	return {
		ok: true,
		rateLabel: rate.label,
		modeLabel: mode.label,
		modeSuffix: mode.suffix,
		modeSla: mode.sla,
		baseRateEur: rate.rateEur,
		multiplierPct: mode.multiplierPct,
		effectiveRateEur: rateEur,
		maxHours: mode.maxHours,
		netCents,
		vatCents,
		grossCents,
		vatPercent,
		creditMinutes,
		zeroVatNote
	};
}

/**
 * Creditează, apoi emite factura, apoi o trimite. Creditul e pasul care nu are
 * voie să eșueze silențios; factura și emailul degradează grațios (adminul le
 * reia din /invoices), pentru că orele sunt deja la client.
 */
export async function createHourCreditOrder(
	input: CreateHourCreditOrderInput
): Promise<CreateHourCreditOrderResult> {
	const { tenantId, clientId, userId } = input;
	const warnings: string[] = [];

	const quote = await quoteHourCreditOrder({
		tenantId,
		clientId,
		rateSlug: input.rateSlug,
		modeSlug: input.modeSlug,
		hours: input.hours
	});
	if (!quote.ok) throw new Error(quote.reason);

	const [client] = await db
		.select({ id: table.client.id, name: table.client.name, email: table.client.email })
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (!client) throw new Error('Clientul nu există.');

	const catalog = await getHourlyCatalog(tenantId);
	const reference = resolveReferenceRate(catalog.rates, catalog.rules);

	// Id-ul facturii se fixează ÎNAINTE de credit: rândul din ledger o referă, iar
	// indexul unic pe (purchase, invoice, id) oprește a doua trimitere a aceleiași cereri.
	const invoiceId = input.requestId
		? await invoiceIdForRequest(tenantId, input.requestId)
		: generateId();

	// ── 1. Creditul, întâi ────────────────────────────────────────────────────
	const ledgerEntryId = generateId();
	const modeNote =
		input.modeSlug === 'standard'
			? ''
			: ` · regim ${quote.modeLabel}${input.requestedWindow ? `, interval cerut: ${input.requestedWindow}` : ''}`;
	const credit = await applyLedgerEntry(
		{
			tenantId,
			clientId,
			deltaMinutes: quote.creditMinutes,
			// Ore cumpărate, legate de factura lor: intră în raportul lunar, iar
			// anularea facturii se poate detecta (și storna) după sursă.
			kind: 'purchase',
			sourceType: 'invoice',
			sourceId: invoiceId,
			note: `${input.hours} h ${quote.rateLabel} adăugate din admin${modeNote}`,
			createdByUserId: userId,
			referenceRateEurSnapshot: reference?.rateEur ?? null,
			netCentsSnapshot: quote.netCents,
			currencySnapshot: 'EUR',
			rateSlug: input.rateSlug,
			modeSlug: input.modeSlug,
			rateEurSnapshot: quote.effectiveRateEur,
			multiplierPctSnapshot: quote.multiplierPct,
			realMinutes: input.hours * 60,
			expiresAt: computeExpiryDate(new Date(), catalog.rules.creditExpiryDays)
		},
		{ id: ledgerEntryId }
	);
	if (!credit.applied) {
		const [existing] = await db
			.select({ invoiceNumber: table.invoice.invoiceNumber })
			.from(table.invoice)
			.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, tenantId)))
			.limit(1);
		logInfo('server', `hour-credit-order: cererea ${input.requestId} fusese deja procesată`, {
			tenantId,
			metadata: { clientId, invoiceId }
		});
		return {
			creditMinutes: quote.creditMinutes,
			ledgerEntryId,
			invoiceId: existing ? invoiceId : null,
			invoiceNumber: existing?.invoiceNumber ?? null,
			keezPushed: false,
			emailSent: false,
			warnings: [
				'Cererea fusese deja trimisă — orele și factura există deja, nu s-a dublat nimic.'
			],
			duplicate: true
		};
	}

	// ── 2–4. Factura, Keez, email ─────────────────────────────────────────────
	const issued = await issueHourCreditInvoice({
		tenantId,
		clientId,
		userId,
		invoiceId,
		hours: input.hours,
		sendEmail: input.sendEmail,
		requestedWindow: input.requestedWindow ?? null,
		pricing: quote
	});
	warnings.push(...issued.warnings);
	const { invoiceNumber, keezPushed, emailSent } = issued;

	logInfo(
		'server',
		`hour-credit-order: +${quote.creditMinutes} min pentru ${client.name}, factura ${invoiceNumber ?? 'neemisă'}`,
		{ tenantId, metadata: { clientId, invoiceId, ledgerEntryId, emailSent, keezPushed } }
	);

	return {
		creditMinutes: quote.creditMinutes,
		ledgerEntryId,
		invoiceId: issued.invoiceId,
		invoiceNumber,
		keezPushed,
		emailSent,
		warnings
	};
}

/** Prețul facturii de ore — din cotația de acum sau din snapshot-ul ledgerului. */
export interface HourInvoicePricing {
	rateLabel: string;
	modeLabel: string;
	modeSla: string;
	baseRateEur: number;
	multiplierPct: number;
	effectiveRateEur: number;
	netCents: number;
	vatCents: number;
	vatPercent: number;
	zeroVatNote: string | null;
}

/**
 * Factura unui credit de ore deja acordat: INSERT (id-ul fixat de rândul din ledger),
 * push Keez și email — ultimele două nefatale. `invoiceId: null` = factura nu s-a
 * creat (curs BNR lipsă sau INSERT eșuat); creditul rămâne și apare în „De rezolvat".
 */
async function issueHourCreditInvoice(params: {
	tenantId: string;
	clientId: string;
	userId: string;
	invoiceId: string;
	hours: number;
	sendEmail: boolean;
	requestedWindow: string | null;
	pricing: HourInvoicePricing;
	/** Ziua în care orele au intrat în credit (implicit azi). */
	creditedOn?: Date;
}): Promise<{
	invoiceId: string | null;
	invoiceNumber: string | null;
	keezPushed: boolean;
	emailSent: boolean;
	warnings: string[];
}> {
	const { tenantId, clientId, userId, invoiceId, pricing } = params;
	const warnings: string[] = [];
	const notIssued = { invoiceId: null, invoiceNumber: null, keezPushed: false, emailSent: false };

	const bnr = await getLatestBnrRateWithDate('EUR');
	if (!bnr || !(bnr.rate > 0)) {
		warnings.push(
			'Creditul a fost adăugat, dar factura NU s-a emis: lipsește cursul BNR EUR. Emite-o din Bugete ore → De rezolvat după sync-ul BNR.'
		);
		logWarning('server', 'hour-credit-order: lipsește cursul BNR — factura nu s-a emis', {
			tenantId,
			metadata: { clientId, invoiceId }
		});
		return { ...notIssued, warnings };
	}

	const [client] = await db
		.select({ email: table.client.email })
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);

	const exchangeRate = bnr.rate;
	const netRon = eurCentsToRonCents(pricing.netCents, exchangeRate);
	const taxRon = eurCentsToRonCents(pricing.vatCents, exchangeRate);
	const lineTaxRate = vatPercentToBps(pricing.vatPercent);

	let invoiceNumber: string;
	let invoiceSeries: string | null = null;
	try {
		const fromPlugin = await getNextInvoiceNumberFromPlugin(tenantId);
		if (fromPlugin) {
			invoiceNumber = fromPlugin;
			const m = invoiceNumber.match(/^(\D+)\s*(\d+)$/);
			if (m) invoiceSeries = m[1].trim();
		} else {
			invoiceNumber = `INV-${Date.now()}`;
		}
	} catch (err) {
		logError('server', `hour-credit-order: numerotare eșuată: ${serializeError(err).message}`, {
			tenantId,
			metadata: { clientId }
		});
		invoiceNumber = `INV-${Date.now()}`;
	}

	// Refolosim articolul Keez al liniilor identice, ca să nu umplem nomenclatorul.
	const lineDescription = hoursLineDescription(pricing.rateLabel);
	let cachedArticleId: string | null = null;
	try {
		const [cached] = await db
			.select({ keezItemExternalId: table.invoiceLineItem.keezItemExternalId })
			.from(table.invoiceLineItem)
			.innerJoin(table.invoice, eq(table.invoiceLineItem.invoiceId, table.invoice.id))
			.where(
				and(
					eq(table.invoice.tenantId, tenantId),
					eq(table.invoiceLineItem.description, lineDescription),
					isNotNull(table.invoiceLineItem.keezItemExternalId)
				)
			)
			.orderBy(desc(table.invoice.issueDate))
			.limit(1);
		const id = cached?.keezItemExternalId;
		if (id && /^[a-f0-9]{32}$/i.test(id)) cachedArticleId = id;
	} catch {
		// Doar optimizare.
	}

	const now = new Date();
	const creditedOn = params.creditedOn ?? now;
	const dueDate = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
	const premium = pricing.multiplierPct > 100;
	try {
		await withTursoBusyRetry(
			() =>
				db.transaction(async (tx) => {
					await tx.insert(table.invoice).values({
						id: invoiceId,
						tenantId,
						clientId,
						createdByUserId: userId,
						invoiceNumber,
						invoiceSeries,
						// Neplătită: clientul primește linkul de plată. Fiscalizarea în Keez
						// urmează politica tenantului la `invoice.paid`.
						status: 'sent',
						// Marcajul care oprește a doua creditare la plată.
						externalSource: HOUR_CREDIT_INVOICE_SOURCE,
						amount: netRon,
						taxRate: lineTaxRate,
						taxAmount: taxRon,
						totalAmount: netRon + taxRon,
						currency: 'RON',
						invoiceCurrency: null,
						exchangeRate: formatExchangeRate(exchangeRate),
						// 'none' la 0%: Keez nu trebuie să aplice cotă peste o operațiune
						// scutită (intracomunitar / export).
						taxApplicationType: pricing.vatPercent === 0 ? 'none' : 'apply',
						issueDate: now,
						dueDate,
						notes: appendZeroVatNote(
							`Ore extra work ${pricing.rateLabel} × ${params.hours} h, adăugate în creditul clientului la ${creditedOn.toISOString().slice(0, 10)}.${
								premium
									? ` Regim ${pricing.modeLabel} (+${pricing.multiplierPct - 100}% față de tariful standard de ${pricing.baseRateEur} €/h)${
											params.requestedWindow ? `, interval cerut: ${params.requestedWindow}` : ''
										}.${pricing.modeSla ? ` ${pricing.modeSla}` : ''}`
									: ''
							} Curs BNR ${formatExchangeRate(exchangeRate)} din ${bnr.rateDate.toISOString().slice(0, 10)}.`,
							pricing.zeroVatNote
						)
					});
					await tx.insert(table.invoiceLineItem).values({
						id: generateId(),
						invoiceId,
						description: lineDescription,
						note: `${params.hours} h × ${pricing.effectiveRateEur} €`,
						quantity: params.hours,
						rate: pricing.effectiveRateEur * 100,
						amount: pricing.netCents,
						taxRate: lineTaxRate,
						currency: 'EUR',
						unitOfMeasure: KEEZ_UNIT.HOUR,
						keezItemExternalId: cachedArticleId
					});
				}),
			{ tenantId, label: 'hour-credit-order/insertInvoice' }
		);
	} catch (err) {
		logError('server', `hour-credit-order: INSERT factură eșuat: ${serializeError(err).message}`, {
			tenantId,
			metadata: { clientId, invoiceId }
		});
		warnings.push(
			'Creditul a fost adăugat, dar factura nu s-a putut crea. Emite-o din Bugete ore → De rezolvat.'
		);
		return { ...notIssued, warnings };
	}

	// ATENȚIE: `pushInvoiceToKeez` NU aruncă la eșec, întoarce `{ success: false, error }`.
	// Fără verificarea rezultatului am raporta „trimis în Keez" pentru o factură care n-a
	// plecat — exact ce s-a întâmplat la proba din 12 sep 2026 (Keez respinge factura
	// când clientul are același CUI ca firma emitentă).
	let keezPushed = false;
	try {
		const push = await pushInvoiceToKeez(tenantId, invoiceId);
		keezPushed = push.success;
		if (!push.success) {
			logError('keez', `hour-credit-order: push Keez respins: ${push.error}`, {
				tenantId,
				metadata: { invoiceId, invoiceNumber }
			});
			warnings.push(
				`Factura ${invoiceNumber} e în CRM, dar Keez a respins-o: ${push.error}. Retrimite din pagina facturii după ce rezolvi cauza.`
			);
		}
	} catch (err) {
		logError('keez', `hour-credit-order: push Keez eșuat: ${serializeError(err).message}`, {
			tenantId,
			metadata: { invoiceId, invoiceNumber }
		});
		warnings.push(
			`Factura ${invoiceNumber} e în CRM, dar nu a ajuns în Keez. Retrimite din pagina facturii.`
		);
	}

	let emailSent = false;
	if (params.sendEmail) {
		if (!client?.email) {
			warnings.push('Clientul nu are email — factura nu s-a trimis.');
		} else {
			try {
				await sendInvoiceEmail(invoiceId, client.email);
				emailSent = true;
			} catch (err) {
				logError('email', `hour-credit-order: email eșuat: ${serializeError(err).message}`, {
					tenantId,
					metadata: { invoiceId, clientId }
				});
				warnings.push('Factura nu a putut fi trimisă pe email. Retrimite din pagina facturii.');
			}
		}
	}

	return { invoiceId, invoiceNumber, keezPushed, emailSent, warnings };
}

export interface UninvoicedHourCredit {
	ledgerEntryId: string;
	clientId: string;
	clientName: string;
	hours: number;
	rateSlug: string | null;
	creditMinutes: number;
	netCents: number;
	createdAt: Date;
}

/**
 * Ore adăugate din admin a căror factură nu există (curs BNR lipsă, INSERT eșuat).
 * Sursa e rândul din ledger (`purchase` pe `invoice`) fără factură cu acel id și
 * fără stornare.
 */
export async function listUninvoicedHourCredits(tenantId: string): Promise<UninvoicedHourCredit[]> {
	const rows = await db
		.select({
			ledgerEntryId: table.clientHourLedger.id,
			sourceId: table.clientHourLedger.sourceId,
			clientId: table.clientHourLedger.clientId,
			clientName: table.client.name,
			realMinutes: table.clientHourLedger.realMinutes,
			rateSlug: table.clientHourLedger.rateSlug,
			deltaMinutes: table.clientHourLedger.deltaMinutes,
			netCents: table.clientHourLedger.netCentsSnapshot,
			createdAt: table.clientHourLedger.createdAt,
			invoiceId: table.invoice.id
		})
		.from(table.clientHourLedger)
		.innerJoin(table.client, eq(table.client.id, table.clientHourLedger.clientId))
		.leftJoin(
			table.invoice,
			and(
				eq(table.invoice.id, table.clientHourLedger.sourceId),
				eq(table.invoice.tenantId, table.clientHourLedger.tenantId)
			)
		)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				eq(table.clientHourLedger.kind, 'purchase'),
				eq(table.clientHourLedger.sourceType, 'invoice'),
				isNull(table.invoice.id)
			)
		)
		.orderBy(desc(table.clientHourLedger.createdAt));
	if (rows.length === 0) return [];

	const reversed = await db
		.select({ sourceId: table.clientHourLedger.sourceId })
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.tenantId, tenantId),
				eq(table.clientHourLedger.kind, 'purchase_reversal'),
				eq(table.clientHourLedger.sourceType, 'invoice')
			)
		);
	const reversedIds = new Set(reversed.map((r) => r.sourceId));

	return rows
		.filter((r) => !reversedIds.has(r.sourceId) && r.realMinutes && r.netCents)
		.map((r) => ({
			ledgerEntryId: r.ledgerEntryId,
			clientId: r.clientId,
			clientName: r.clientName,
			hours: r.realMinutes! / 60,
			rateSlug: r.rateSlug,
			creditMinutes: r.deltaMinutes,
			netCents: r.netCents!,
			createdAt: r.createdAt
		}));
}

/**
 * Emite factura unui credit de ore acordat fără factură. Prețul e cel înghețat în
 * ledger la acordare (NU catalogul de azi); cursul BNR și TVA-ul sunt cele de acum.
 * Creditul NU se acordă din nou. Id-ul facturii e cel referit de rândul din ledger,
 * deci o a doua emitere dă conflict pe cheia primară, nu o factură dublă.
 */
export async function reissueHourCreditInvoice(params: {
	tenantId: string;
	ledgerEntryId: string;
	userId: string;
	sendEmail: boolean;
}): Promise<CreateHourCreditOrderResult> {
	const { tenantId, userId } = params;
	const [entry] = await db
		.select()
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.id, params.ledgerEntryId),
				eq(table.clientHourLedger.tenantId, tenantId),
				eq(table.clientHourLedger.kind, 'purchase'),
				eq(table.clientHourLedger.sourceType, 'invoice')
			)
		)
		.limit(1);
	if (!entry) throw new Error('Creditul nu există sau nu provine din „Adaugă ore".');
	const [existing] = await db
		.select({ id: table.invoice.id })
		.from(table.invoice)
		.where(and(eq(table.invoice.id, entry.sourceId), eq(table.invoice.tenantId, tenantId)))
		.limit(1);
	if (existing) throw new Error('Factura acestui credit există deja.');
	if (!entry.realMinutes || !entry.netCentsSnapshot || !entry.rateEurSnapshot) {
		throw new Error('Rândul din ledger nu are prețul înghețat — emite factura manual.');
	}

	const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
	const multiplierPct = entry.multiplierPctSnapshot ?? 100;
	const mode = catalog.modes.find((m) => m.slug === (entry.modeSlug ?? 'standard'));
	const { vatPercent, zeroVatNote } = await resolveHourOrderVat(tenantId, entry.clientId);
	const { vatCents } = computeVatBreakdown(entry.netCentsSnapshot, vatPercent);
	const hours = entry.realMinutes / 60;

	const issued = await issueHourCreditInvoice({
		tenantId,
		clientId: entry.clientId,
		userId,
		invoiceId: entry.sourceId,
		hours,
		sendEmail: params.sendEmail,
		requestedWindow: null,
		creditedOn: entry.createdAt,
		pricing: {
			rateLabel:
				catalog.rates.find((r) => r.slug === entry.rateSlug)?.label ?? entry.rateSlug ?? 'Ore',
			modeLabel: mode?.label ?? entry.modeSlug ?? 'standard',
			modeSla: mode?.sla ?? '',
			// Tariful de bază derivat din cel efectiv înghețat — doar pentru nota facturii.
			baseRateEur: Math.round((entry.rateEurSnapshot * 100) / multiplierPct),
			multiplierPct,
			effectiveRateEur: entry.rateEurSnapshot,
			netCents: entry.netCentsSnapshot,
			vatCents,
			vatPercent,
			zeroVatNote
		}
	});
	logInfo('server', `hour-credit-order: factura creditului ${entry.id} emisă ulterior`, {
		tenantId,
		metadata: { invoiceId: issued.invoiceId, clientId: entry.clientId }
	});
	return {
		creditMinutes: entry.deltaMinutes,
		ledgerEntryId: entry.id,
		...issued
	};
}
