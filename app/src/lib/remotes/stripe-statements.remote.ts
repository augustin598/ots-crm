/**
 * Extrase Stripe pentru contabilitate (Keez).
 *
 * Pagina `/[tenant]/invoices/stripe-statements` cere cele 3 rapoarte lunare
 * pe care le vrea contabila și le livrează ca CSV / ZIP / email.
 *
 * Starea NU se ține în DB: sursa de adevăr sunt chiar rulările din Stripe
 * (`reporting.report_runs`), pe care le listăm și le potrivim pe (report_type,
 * interval). Fără tabel nou → fără migrare, fără divergență între CRM și Stripe.
 */

import { query, command, getRequestEvent } from '$app/server';
import { error as svelteError } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';
import {
	getStripeReportingClient,
	getStripeReportingKeyInfo,
	StripeNotConfiguredError
} from '$lib/server/plugins/stripe/factory';
import { logError, logInfo, serializeError } from '$lib/server/logger';
import {
	STATEMENT_SPECS,
	STATEMENT_TIMEZONE,
	buildMonthView,
	createRun,
	effectiveInterval,
	listRecentRuns,
	monthInterval,
	monthsForYear,
	resolveReportTypes,
	specFor,
	STATEMENTS_MIN_YEAR,
	type MonthStatementsView,
	type StatementKind,
	type ResolvedReportType
} from '$lib/server/stripe/reports';
import { buildStatementsZip, collectMonthCsvs } from '$lib/server/stripe/statement-files';
import { sendStripeStatementsEmail } from '$lib/server/email';

const KIND_VALUES = STATEMENT_SPECS.map((s) => s.kind) as [StatementKind, ...StatementKind[]];

const YearSchema = v.object({
	year: v.pipe(v.number(), v.integer(), v.minValue(STATEMENTS_MIN_YEAR), v.maxValue(2100))
});

const MonthSchema = v.object({
	year: v.pipe(v.number(), v.integer(), v.minValue(STATEMENTS_MIN_YEAR), v.maxValue(2100)),
	month: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(12)),
	kinds: v.optional(v.array(v.picklist(KIND_VALUES)))
});

const EmailSchema = v.object({
	year: v.pipe(v.number(), v.integer(), v.minValue(STATEMENTS_MIN_YEAR), v.maxValue(2100)),
	/** null → tot anul într-o singură arhivă. */
	month: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(12))),
	to: v.pipe(v.string(), v.trim(), v.email('Adresă de email invalidă.'), v.maxLength(255)),
	message: v.optional(v.pipe(v.string(), v.maxLength(2000)))
});

/**
 * Gate comun: staff + `admin.stripe.view` (owner/admin). Extrasele conțin toate
 * tranzacțiile și datele clienților plătitori — nu e conținut pentru orice rol.
 */
async function statementsScope() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw svelteError(401, 'Neautentificat.');
	const actor = await getActor(event);
	assertCan(actor, 'admin.stripe.view');
	return { event, tenantId: event.locals.tenant.id };
}

function toFriendlyError(e: unknown): never {
	if (e instanceof StripeNotConfiguredError) {
		throw svelteError(400, e.message);
	}
	const raw = e as { type?: string; message?: string; statusCode?: number };
	if (raw?.type === 'StripeAuthenticationError') {
		throw svelteError(400, 'Cheia Stripe e respinsă de Stripe. Verifică STRIPE_REPORTING_KEY.');
	}
	if (raw?.type === 'StripePermissionError') {
		throw svelteError(
			403,
			'Cheia restricționată nu are drepturile necesare. Îi trebuie: Report runs (write), ' +
				'Report types (read) și Files (read).'
		);
	}
	if (raw?.statusCode === 429) {
		throw svelteError(
			429,
			'Stripe limitează numărul de rapoarte rulate simultan. Așteaptă să se termine cele în curs și reia.'
		);
	}
	const msg = raw?.message || 'Eroare necunoscută la Stripe.';
	// Mesajul „live-mode API key is required” e cel mai frecvent motiv de eșec.
	if (/live-mode API key/i.test(msg)) {
		throw svelteError(
			400,
			'Rapoartele Stripe se pot rula doar cu o cheie LIVE. Setează STRIPE_REPORTING_KEY ' +
				'(rk_live_… restricționată pe rapoarte) — cheia de plăți poate rămâne pe test.'
		);
	}
	throw svelteError(502, msg);
}

async function getIntegrationInfo(tenantId: string) {
	const [row] = await db
		.select({
			accountId: table.stripeIntegration.accountId,
			accountName: table.stripeIntegration.accountName,
			isTestMode: table.stripeIntegration.isTestMode,
			isActive: table.stripeIntegration.isActive
		})
		.from(table.stripeIntegration)
		.where(eq(table.stripeIntegration.tenantId, tenantId))
		.limit(1);
	return row ?? null;
}

export interface StatementsOverview {
	year: number;
	timezone: string;
	account: {
		accountId: string | null;
		accountName: string | null;
		/** Modul integrării de PLĂȚI (poate diferi de cheia de rapoarte). */
		isTestMode: boolean;
	} | null;
	/** Ce cheie folosesc efectiv rapoartele — asta contează pentru extrase. */
	reportingKey: { mode: 'live' | 'test'; restricted: boolean; dedicated: boolean };
	reportTypes: ResolvedReportType[];
	months: MonthStatementsView[];
	/** Există cel puțin o rulare în curs → pagina poate face poll. */
	anyPending: boolean;
	/** Cea mai recentă zi pentru care Stripe are date (min pe cele 3 rapoarte). */
	dataAvailableEnd: number | null;
}

export const getStripeStatements = query(YearSchema, async ({ year }): Promise<StatementsOverview> => {
	const { tenantId } = await statementsScope();

	try {
		const stripe = await getStripeReportingClient(tenantId);
		const [types, runs, integration, reportingKey] = await Promise.all([
			resolveReportTypes(stripe),
			listRecentRuns(stripe),
			getIntegrationInfo(tenantId),
			getStripeReportingKeyInfo(tenantId)
		]);

		const now = new Date();
		const nowSeconds = Math.floor(now.getTime() / 1000);
		const months = monthsForYear(year, now).map((month) =>
			buildMonthView(year, month, runs, types, nowSeconds)
		);

		const availableEnds = Object.values(types)
			.map((t) => t.dataAvailableEnd)
			.filter((v): v is number => typeof v === 'number');

		return {
			year,
			timezone: STATEMENT_TIMEZONE,
			account: integration
				? {
						accountId: integration.accountId,
						accountName: integration.accountName,
						isTestMode: !!integration.isTestMode
					}
				: null,
			reportingKey,
			reportTypes: Object.values(types),
			months,
			anyPending: months.some((m) => m.reports.some((r) => r.status === 'pending')),
			dataAvailableEnd: availableEnds.length ? Math.min(...availableEnds) : null
		};
	} catch (e) {
		toFriendlyError(e);
	}
});

interface GenerateResult {
	created: number;
	skipped: number;
	/** Luni pentru care Stripe n-are încă date. */
	unavailable: string[];
	/**
	 * Stripe a început să limiteze rulările (429) și ne-am oprit aici. Ce s-a
	 * creat până atunci rămâne valid — restul se reia cu încă un click.
	 */
	throttled: boolean;
}

/**
 * Creează rulările lipsă pentru o listă de luni. Rulăm secvențial: Stripe
 * throttle-uiește rapoartele concurente (429) și n-are rost să ardem retry-uri.
 *
 * Un 429 la mijlocul unui an întreg (până la 36 de rulări) NU aruncă: raportăm
 * progresul parțial, altfel utilizatorul ar crede că n-a pornit nimic și ar
 * relua de la zero peste încă o limitare.
 */
async function ensureRuns(
	tenantId: string,
	year: number,
	months: number[],
	kinds: StatementKind[]
): Promise<GenerateResult> {
	const stripe = await getStripeReportingClient(tenantId);
	const [types, runs] = await Promise.all([resolveReportTypes(stripe), listRecentRuns(stripe)]);
	const nowSeconds = Math.floor(Date.now() / 1000);

	const result: GenerateResult = { created: 0, skipped: 0, unavailable: [], throttled: false };

	for (const month of months) {
		if (result.throttled) break;
		const view = buildMonthView(year, month, runs, types, nowSeconds);
		for (const report of view.reports) {
			if (!kinds.includes(report.kind)) continue;
			// Rulările reușite sau în curs se refolosesc — nu regenerăm degeaba.
			if (report.status === 'succeeded' || report.status === 'pending') {
				result.skipped++;
				continue;
			}

			const type = types[report.kind];
			const interval = effectiveInterval(monthInterval(year, month), type);
			if (!interval) {
				result.unavailable.push(`${view.key} — ${report.label}`);
				continue;
			}

			try {
				const run = await createRun(stripe, specFor(report.kind), type, interval);
				result.created++;
				logInfo('stripe', `Report run creat: ${type.reportType} ${view.key}`, {
					tenantId,
					metadata: { runId: run.id, reportType: type.reportType, month: view.key }
				});
			} catch (e) {
				if ((e as { statusCode?: number })?.statusCode === 429 && result.created > 0) {
					result.throttled = true;
					logInfo('stripe', 'Stripe a limitat rulările de rapoarte — ne oprim cu progres parțial', {
						tenantId,
						metadata: { year, month, created: result.created }
					});
					break;
				}
				throw e;
			}
		}
	}

	return result;
}

/** Generează cele 3 extrase pentru o lună. */
export const generateStripeStatementsForMonth = command(
	MonthSchema,
	async ({ year, month, kinds }): Promise<GenerateResult> => {
		const { tenantId } = await statementsScope();
		try {
			return await ensureRuns(tenantId, year, [month], kinds ?? [...KIND_VALUES]);
		} catch (e) {
			logError('stripe', 'Generare extrase Stripe eșuată', {
				tenantId,
				metadata: { year, month, error: serializeError(e) }
			});
			toFriendlyError(e);
		}
	}
);

/** Generează extrasele pentru toate lunile anului (ian → luna curentă). */
export const generateStripeStatementsForYear = command(
	YearSchema,
	async ({ year }): Promise<GenerateResult> => {
		const { tenantId } = await statementsScope();
		const months = monthsForYear(year, new Date());
		if (months.length === 0) {
			throw svelteError(400, `Anul ${year} nu a început încă.`);
		}
		try {
			return await ensureRuns(tenantId, year, months, [...KIND_VALUES]);
		} catch (e) {
			logError('stripe', 'Generare extrase Stripe pe an eșuată', {
				tenantId,
				metadata: { year, error: serializeError(e) }
			});
			toFriendlyError(e);
		}
	}
);

/** Trimite CSV-urile (lună sau tot anul) pe emailul contabilei. */
export const emailStripeStatements = command(
	EmailSchema,
	async ({ year, month, to, message }): Promise<{ files: number; to: string }> => {
		const { tenantId, event } = await statementsScope();

		try {
			const months = month ? [month] : monthsForYear(year, new Date());
			const csvs = await collectMonthCsvs(tenantId, year, months);
			if (csvs.length === 0) {
				throw svelteError(
					400,
					'Nu există extrase generate pentru perioada aleasă. Generează-le întâi.'
				);
			}

			const zip = await buildStatementsZip(csvs);
			const period = month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`;

			await sendStripeStatementsEmail({
				tenantId,
				to,
				period,
				files: csvs.map((c) => ({ fileName: c.fileName, content: c.content })),
				zip,
				zipName: `extrase-stripe-${period}.zip`,
				note: message?.trim() || null,
				senderName:
					[event.locals.user?.firstName, event.locals.user?.lastName]
						.filter(Boolean)
						.join(' ') || null
			});

			return { files: csvs.length, to };
		} catch (e) {
			if ((e as { status?: number })?.status) throw e;
			logError('stripe', 'Trimitere extrase Stripe pe email eșuată', {
				tenantId,
				metadata: { year, month, to, error: serializeError(e) }
			});
			toFriendlyError(e);
		}
	}
);
