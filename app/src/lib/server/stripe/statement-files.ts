/**
 * Materializarea extraselor Stripe în fișiere (CSV individual + ZIP),
 * folosită atât de ruta de download cât și de trimiterea pe email.
 */

import JSZip from 'jszip';
import type Stripe from 'stripe';
import {
	getStripeReportingClient,
	getStripeReportingSecret
} from '$lib/server/plugins/stripe/factory';
import {
	STATEMENT_SPECS,
	STATEMENT_TIMEZONE,
	buildMonthView,
	csvFileName,
	fetchReportCsv,
	listRecentRuns,
	monthKey,
	resolveReportTypes,
	type StatementKind
} from './reports';

export interface StatementCsv {
	kind: StatementKind;
	year: number;
	month: number;
	fileName: string;
	content: Buffer;
}

/** Câte fișiere descărcăm în paralel de la Stripe (un an = până la 36). */
const DOWNLOAD_CONCURRENCY = 4;

async function mapLimited<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]);
		}
	});
	await Promise.all(workers);
	return out;
}

/** Anul/luna (în fusul extraselor) în care începe intervalul unei rulări. */
export function monthFromIntervalStart(intervalStart: number): { year: number; month: number } {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone: STATEMENT_TIMEZONE,
		year: 'numeric',
		month: '2-digit'
	});
	const parts: Record<string, string> = {};
	for (const p of dtf.formatToParts(new Date(intervalStart * 1000))) {
		if (p.type !== 'literal') parts[p.type] = p.value;
	}
	return { year: Number(parts.year), month: Number(parts.month) };
}

function kindForReportType(reportType: string): StatementKind | null {
	return STATEMENT_SPECS.find((s) => s.candidates.includes(reportType))?.kind ?? null;
}

/**
 * Descarcă CSV-ul unei rulări individuale.
 * Rularea e citită cu cheia tenantului → un `runId` din alt cont Stripe dă 404.
 */
export async function fetchCsvForRun(tenantId: string, runId: string): Promise<StatementCsv> {
	const stripe = await getStripeReportingClient(tenantId);
	const run = await stripe.reporting.reportRuns.retrieve(runId);

	if (run.status !== 'succeeded' || !run.result?.url) {
		throw new Error(
			run.status === 'failed'
				? `Raportul a eșuat la Stripe: ${run.error ?? 'motiv necunoscut'}`
				: 'Raportul încă se generează la Stripe.'
		);
	}

	const kind = kindForReportType(run.report_type);
	if (!kind) throw new Error(`Raport necunoscut: ${run.report_type}`);

	const intervalStart = run.parameters?.interval_start;
	if (typeof intervalStart !== 'number') throw new Error('Rularea nu are interval valid.');
	const { year, month } = monthFromIntervalStart(intervalStart);

	const secret = await getStripeReportingSecret(tenantId);
	const content = await fetchReportCsv(secret, run.result.url);

	return { kind, year, month, fileName: csvFileName(kind, year, month), content };
}

/**
 * Toate CSV-urile reușite pentru lunile cerute. Lunile fără rulări gata
 * sunt sărite tăcut — apelantul decide ce face cu lista goală.
 */
export async function collectMonthCsvs(
	tenantId: string,
	year: number,
	months: number[]
): Promise<StatementCsv[]> {
	const stripe = await getStripeReportingClient(tenantId);
	const [types, runs, secret] = await Promise.all([
		resolveReportTypes(stripe),
		listRecentRuns(stripe),
		getStripeReportingSecret(tenantId)
	]);
	const nowSeconds = Math.floor(Date.now() / 1000);

	type Pending = { kind: StatementKind; year: number; month: number; url: string };
	const pending: Pending[] = [];

	for (const month of months) {
		const view = buildMonthView(year, month, runs, types, nowSeconds);
		for (const report of view.reports) {
			if (report.status !== 'succeeded' || !report.runId) continue;
			const run = runs.find((r: Stripe.Reporting.ReportRun) => r.id === report.runId);
			if (!run?.result?.url) continue;
			pending.push({ kind: report.kind, year, month, url: run.result.url });
		}
	}

	return mapLimited(pending, DOWNLOAD_CONCURRENCY, async (item) => ({
		kind: item.kind,
		year: item.year,
		month: item.month,
		fileName: csvFileName(item.kind, item.year, item.month),
		content: await fetchReportCsv(secret, item.url)
	}));
}

/**
 * Arhivă cu CSV-urile date. Pentru mai multe luni, fiecare lună primește un
 * folder `2026-07/` — așa contabila încarcă în Keez lună cu lună, fără să
 * confunde fișierele între ele.
 */
export async function buildStatementsZip(files: StatementCsv[]): Promise<Buffer> {
	const zip = new JSZip();
	const multiMonth = new Set(files.map((f) => monthKey(f.year, f.month))).size > 1;

	for (const file of files) {
		const path = multiMonth ? `${monthKey(file.year, file.month)}/${file.fileName}` : file.fileName;
		zip.file(path, file.content);
	}

	return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
