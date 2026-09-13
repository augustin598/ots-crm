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
import { and, desc, eq, isNotNull } from 'drizzle-orm';
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
import { activeModes, activeRates, resolveReferenceRate } from '$lib/logic/hourly-catalog';
import {
	HOUR_CREDIT_INVOICE_SOURCE,
	eurCentsToReferenceMinutes
} from '$lib/logic/hour-credits';
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
	if (!isValidHours(hours)) return { ok: false, reason: 'Număr de ore invalid.' };

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
	if (!reference) return { ok: false, reason: 'Nicio specializare activă (tarif de referință lipsă).' };

	const rateEur = effectiveRateEur(rate.rateEur, mode.multiplierPct);
	const netCents = hoursNetCents(rateEur, hours);
	const [settings] = await db
		.select({
			defaultTaxRate: table.invoiceSettings.defaultTaxRate,
			zeroVatAutoDetect: table.invoiceSettings.whmcsZeroVatAutoDetect
		})
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);

	// Cota NU e hardcodată: vine din setările de facturare ale tenantului. În plus,
	// un client intracomunitar sau din afara UE se facturează cu 0% și mențiunea
	// legală — aceeași regulă ca la facturile create din /invoices.
	let vatPercent = resolveVatPercent(settings?.defaultTaxRate);
	let zeroVatNote: string | null = null;
	if (params.clientId && (settings?.zeroVatAutoDetect ?? true)) {
		const [vatClient] = await db
			.select({ country: table.client.country, cui: table.client.cui })
			.from(table.client)
			.where(and(eq(table.client.id, params.clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (vatClient) {
			const scenario = classifyClientVat({ country: vatClient.country, cui: vatClient.cui });
			if (scenario === 'intracom' || scenario === 'export') {
				vatPercent = 0;
				zeroVatNote = getZeroVatLegalNote(scenario);
			}
		}
	}
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

	// ── 1. Creditul, întâi ────────────────────────────────────────────────────
	const ledgerEntryId = generateId();
	const modeNote =
		input.modeSlug === 'standard'
			? ''
			: ` · regim ${quote.modeLabel}${input.requestedWindow ? `, interval cerut: ${input.requestedWindow}` : ''}`;
	await applyLedgerEntry(
		{
			tenantId,
			clientId,
			deltaMinutes: quote.creditMinutes,
			kind: 'manual',
			sourceType: 'manual',
			sourceId: ledgerEntryId,
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

	// ── 2. Factura ────────────────────────────────────────────────────────────
	const bnr = await getLatestBnrRateWithDate('EUR');
	if (!bnr || !(bnr.rate > 0)) {
		warnings.push(
			'Creditul a fost adăugat, dar factura NU s-a emis: lipsește cursul BNR EUR. Reia emiterea după sync-ul BNR.'
		);
		logWarning('server', 'hour-credit-order: lipsește cursul BNR — factura nu s-a emis', {
			tenantId,
			metadata: { clientId, ledgerEntryId }
		});
		return {
			creditMinutes: quote.creditMinutes,
			ledgerEntryId,
			invoiceId: null,
			invoiceNumber: null,
			keezPushed: false,
			emailSent: false,
			warnings
		};
	}

	const exchangeRate = bnr.rate;
	const netRon = eurCentsToRonCents(quote.netCents, exchangeRate);
	const taxRon = eurCentsToRonCents(quote.vatCents, exchangeRate);
	const lineTaxRate = vatPercentToBps(quote.vatPercent);

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
	const lineDescription = hoursLineDescription(quote.rateLabel);
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

	const invoiceId = generateId();
	const now = new Date();
	const dueDate = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
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
						taxApplicationType: quote.vatPercent === 0 ? 'none' : 'apply',
						issueDate: now,
						dueDate,
						notes: appendZeroVatNote(
							`Ore extra work ${quote.rateLabel} × ${input.hours} h, adăugate în creditul clientului la ${now.toISOString().slice(0, 10)}.${
							input.modeSlug === 'standard'
								? ''
								: ` Regim ${quote.modeLabel} (+${quote.multiplierPct - 100}% față de tariful standard de ${quote.baseRateEur} €/h)${
										input.requestedWindow ? `, interval cerut: ${input.requestedWindow}` : ''
									}.${quote.modeSla ? ` ${quote.modeSla}` : ''}`
						} Curs BNR ${formatExchangeRate(exchangeRate)} din ${bnr.rateDate.toISOString().slice(0, 10)}.`,
						quote.zeroVatNote
					)
					});
					await tx.insert(table.invoiceLineItem).values({
						id: generateId(),
						invoiceId,
						description: lineDescription,
						note: `${input.hours} h × ${quote.effectiveRateEur} €`,
						quantity: input.hours,
						rate: quote.effectiveRateEur * 100,
						amount: quote.netCents,
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
			metadata: { clientId, invoiceId, ledgerEntryId }
		});
		warnings.push('Creditul a fost adăugat, dar factura nu s-a putut crea.');
		return {
			creditMinutes: quote.creditMinutes,
			ledgerEntryId,
			invoiceId: null,
			invoiceNumber: null,
			keezPushed: false,
			emailSent: false,
			warnings
		};
	}

	// ── 3. Keez (nefatal) ─────────────────────────────────────────────────────
	//
	// ATENȚIE: `pushInvoiceToKeez` NU aruncă la eșec, întoarce
	// `{ success: false, error }`. Fără verificarea rezultatului am raporta
	// „trimis în Keez" pentru o factură care n-a plecat — exact ce s-a întâmplat
	// la proba din 12 sep 2026 (Keez respinge factura când clientul are același
	// CUI ca firma emitentă).
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

	// ── 4. Emailul cu linkul de plată (nefatal) ───────────────────────────────
	let emailSent = false;
	if (input.sendEmail) {
		if (!client.email) {
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

	logInfo(
		'server',
		`hour-credit-order: +${quote.creditMinutes} min pentru ${client.name}, factura ${invoiceNumber}`,
		{ tenantId, metadata: { clientId, invoiceId, ledgerEntryId, emailSent, keezPushed } }
	);

	return {
		creditMinutes: quote.creditMinutes,
		ledgerEntryId,
		invoiceId,
		invoiceNumber,
		keezPushed,
		emailSent,
		warnings
	};
}
