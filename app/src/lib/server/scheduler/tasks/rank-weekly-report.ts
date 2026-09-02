// Job orar: pentru fiecare tenant a cărui zi+oră de raport se potrivesc cu ora
// Bucureștiului, construiește raportul săptămânal de poziții și îl trimite. Idempotent
// prin unique (tenant_id, week_key) pe rank_report. Nu re-verifică pozițiile — folosește
// snapshot-urile deja colectate de verificarea zilnică.
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import { rankSettings, rankReport } from '$lib/server/db/schema';
import { logError, logInfo, serializeError } from '$lib/server/logger';
import { isoWeekKey } from '$lib/logic/rank-tracker';
import { buildRankReportData, type RankReportData } from '$lib/server/rank-tracker/report';

const BUCHAREST_TZ = 'Europe/Bucharest';

function bucharestNow(d: Date): { dayOfWeek: number; hour: number } {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: BUCHAREST_TZ,
		weekday: 'short',
		hour: 'numeric',
		hourCycle: 'h23'
	}).formatToParts(d);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
	return { dayOfWeek: map[get('weekday')] ?? 1, hour: Number(get('hour')) };
}

function generateId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export interface RankWeeklyDeps {
	loadEnabledSettings?: () => Promise<
		{ tenantId: string; reportDay: number; reportHour: string; recipients: string[] }[]
	>;
	reportExists?: (tenantId: string, weekKey: string) => Promise<boolean>;
	buildData?: (tenantId: string, weekKey: string) => Promise<RankReportData>;
	sendEmail?: (tenantId: string, recipient: string, data: RankReportData) => Promise<void>;
	insertReport?: (row: typeof rankReport.$inferInsert) => Promise<void>;
}

export interface RankWeeklyResult {
	checked: number;
	processed: number;
	emailsSent: number;
	errors: number;
}

async function defaultLoadEnabledSettings() {
	const rows = await db
		.select({
			tenantId: rankSettings.tenantId,
			reportDay: rankSettings.reportDay,
			reportHour: rankSettings.reportHour,
			recipients: rankSettings.recipients
		})
		.from(rankSettings)
		.where(eq(rankSettings.isEnabled, true));
	return rows.map((r) => ({ ...r, recipients: (r.recipients as string[]) ?? [] }));
}

async function defaultReportExists(tenantId: string, weekKey: string): Promise<boolean> {
	const [row] = await db
		.select({ id: rankReport.id })
		.from(rankReport)
		.where(and(eq(rankReport.tenantId, tenantId), eq(rankReport.weekKey, weekKey)))
		.limit(1);
	return !!row;
}

async function defaultSendEmail(tenantId: string, recipient: string, data: RankReportData) {
	const { sendRankReportEmail } = await import('$lib/server/email');
	await sendRankReportEmail(tenantId, recipient, data);
}

async function defaultInsertReport(row: typeof rankReport.$inferInsert) {
	await db.insert(rankReport).values(row);
}

/** Rulează raportul săptămânal per tenant la potrivirea zi/oră. */
export async function processRankWeeklyReport(
	now: Date = new Date(),
	deps: RankWeeklyDeps = {}
): Promise<RankWeeklyResult> {
	const loadEnabledSettings = deps.loadEnabledSettings ?? defaultLoadEnabledSettings;
	const reportExists = deps.reportExists ?? defaultReportExists;
	const buildData = deps.buildData ?? buildRankReportData;
	const sendEmail = deps.sendEmail ?? defaultSendEmail;
	const insertReport = deps.insertReport ?? defaultInsertReport;

	const cal = bucharestNow(now);
	const weekKey = isoWeekKey(now);
	const settings = await loadEnabledSettings();

	const result: RankWeeklyResult = { checked: 0, processed: 0, emailsSent: 0, errors: 0 };

	for (const s of settings) {
		const settingHour = Number(String(s.reportHour).split(':')[0]);
		if (s.reportDay !== cal.dayOfWeek || settingHour !== cal.hour) continue;
		result.checked++;

		try {
			if (await reportExists(s.tenantId, weekKey)) continue; // idempotent

			const data = await buildData(s.tenantId, weekKey);
			let status: 'sent' | 'partial' = 'sent';
			let note: string | null = null;
			let emailsSent = 0;

			if (s.recipients.length === 0) {
				status = 'sent';
				note = 'fără destinatari';
			} else {
				for (const recipient of s.recipients) {
					try {
						await sendEmail(s.tenantId, recipient, data);
						emailsSent++;
					} catch (e) {
						status = 'partial';
						note = `email eșuat către ${recipient}: ${serializeError(e).message.slice(0, 120)}`;
						result.errors++;
					}
				}
			}

			await insertReport({
				id: generateId(),
				tenantId: s.tenantId,
				weekKey,
				sentAt: emailsSent > 0 ? now : null,
				projectCount: data.projectCount,
				keywordCount: data.keywordCount,
				avgPosition: data.avgPosition,
				visibility: data.visibility,
				deltaVisibility: data.deltaVisibility,
				topUp: data.topUp,
				topDown: data.topDown,
				distribution: data.distribution,
				alertCount: data.alertCount,
				status,
				note,
				recipients: s.recipients,
				createdAt: now
			});

			result.processed++;
			result.emailsSent += emailsSent;
		} catch (e) {
			result.errors++;
			logError('scheduler', `[rank] raport săptămânal eșuat pentru ${s.tenantId}: ${serializeError(e).message}`);
		}
	}

	if (result.processed > 0) {
		logInfo('scheduler', `[rank] raport săptămânal: ${result.processed} tenanți, ${result.emailsSent} emailuri`);
	}
	return result;
}
