import { error } from '@sveltejs/kit';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';
import { logError, logInfo, serializeError } from '$lib/server/logger';
import { StripeNotConfiguredError } from '$lib/server/plugins/stripe/factory';
import {
	buildStatementsZip,
	collectMonthCsvs,
	fetchCsvForRun
} from '$lib/server/stripe/statement-files';
import { monthsForYear, STATEMENTS_MIN_YEAR } from '$lib/server/stripe/reports';
import type { RequestHandler } from './$types';

/**
 * Descărcarea extraselor Stripe (CSV pentru Keez).
 *
 *   GET /2026-01_payouts.csv?runId=frr_xxx     — un singur CSV
 *   GET /extrase-stripe-2026-01.zip?year=2026&month=1  — ZIP pe lună
 *   GET /extrase-stripe-2026.zip?year=2026     — ZIP pe tot anul
 *
 * Numele fișierului e ȘI în cale, nu doar în `Content-Disposition`: extensiile
 * de browser și managerele de descărcări ignoră destul de des antetul, iar
 * atunci Chrome salvează un UUID fără extensie. Numele din cale e doar pentru
 * browser — conținutul se decide exclusiv din query, iar antetul rămâne
 * autoritar (îl calculează serverul, nu clientul).
 *
 * Fișierele NU pot fi servite direct din Stripe: `result.url` cere
 * `Authorization: Bearer <secret>`, deci descărcarea trece obligatoriu prin
 * server. Același gate ca pagina: staff + `admin.stripe.view`.
 */

function sanitizeFileName(name: string): string {
	return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

function attachment(name: string): string {
	const safe = sanitizeFileName(name);
	return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Neautentificat.');
	const actor = await getActor(event);
	assertCan(actor, 'admin.stripe.view');
	const tenantId = event.locals.tenant.id;

	const params = event.url.searchParams;
	const runId = params.get('runId');
	const yearRaw = params.get('year');
	const monthRaw = params.get('month');

	try {
		if (runId) {
			if (!/^frr_[A-Za-z0-9]{8,64}$/.test(runId)) throw error(400, 'ID de raport invalid.');
			const file = await fetchCsvForRun(tenantId, runId);
			// Extrasele conțin toate tranzacțiile + datele plătitorilor: cine le-a
			// scos și când trebuie să rămână în urmă (cerință de audit).
			logInfo('stripe', `Extras Stripe descărcat: ${file.fileName}`, {
				tenantId,
				userId: event.locals.user.id,
				metadata: { runId, fileName: file.fileName }
			});
			return new Response(new Uint8Array(file.content), {
				headers: {
					'Content-Type': 'text/csv; charset=utf-8',
					'Content-Disposition': attachment(file.fileName),
					'Cache-Control': 'private, no-store'
				}
			});
		}

		const year = Number(yearRaw);
		if (!Number.isInteger(year) || year < STATEMENTS_MIN_YEAR || year > 2100) {
			throw error(400, 'An invalid.');
		}

		let months: number[];
		if (monthRaw !== null) {
			const month = Number(monthRaw);
			if (!Number.isInteger(month) || month < 1 || month > 12) throw error(400, 'Lună invalidă.');
			months = [month];
		} else {
			months = monthsForYear(year, new Date());
		}

		const csvs = await collectMonthCsvs(tenantId, year, months);
		if (csvs.length === 0) {
			throw error(404, 'Nu există extrase generate pentru perioada aleasă.');
		}

		const suffix =
			months.length === 1 ? `${year}-${String(months[0]).padStart(2, '0')}` : String(year);
		const zip = await buildStatementsZip(csvs);
		logInfo('stripe', `Arhivă extrase Stripe descărcată: ${suffix}`, {
			tenantId,
			userId: event.locals.user.id,
			metadata: { suffix, files: csvs.length }
		});

		return new Response(new Uint8Array(zip), {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': attachment(`extrase-stripe-${suffix}.zip`),
				'Cache-Control': 'private, no-store'
			}
		});
	} catch (e) {
		if ((e as { status?: number })?.status) throw e;
		if (e instanceof StripeNotConfiguredError) throw error(400, e.message);
		logError('stripe', 'Descărcare extrase Stripe eșuată', {
			tenantId,
			metadata: { runId, year: yearRaw, month: monthRaw, error: serializeError(e) }
		});
		throw error(502, e instanceof Error ? e.message : 'Descărcarea a eșuat.');
	}
};
