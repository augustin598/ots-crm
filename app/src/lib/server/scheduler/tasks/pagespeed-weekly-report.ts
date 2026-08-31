// Jobul săptămânal PageSpeed: rulează ORAR (cron '0 * * * *' Europe/Bucharest) și
// compară ziua/ora configurate de fiecare tenant în pagespeed_settings cu calendarul
// Bucureștiului. Idempotent: indexul unic (tenant_id, week_key) pe pagespeed_report
// garantează o singură rulare pe săptămână, chiar dacă jobul se reia.
import { and, eq, isNotNull } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logError, logInfo, serializeError } from '$lib/server/logger';
import { isoWeekKey } from '$lib/logic/pagespeed';
import { runPagespeedScan, type ScanSummary } from '$lib/server/pagespeed/scan';
import {
	buildPagespeedReportData,
	type PagespeedReportData
} from '$lib/server/pagespeed/report';

const BUCHAREST_TZ = 'Europe/Bucharest';

function bucharestNow(d: Date): { dayOfWeek: number; hour: number } {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: BUCHAREST_TZ,
		weekday: 'short',
		hour: 'numeric',
		hourCycle: 'h23'
	}).formatToParts(d);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
	return { dayOfWeek: weekdayMap[get('weekday')] ?? 1, hour: Number(get('hour')) };
}

function generateId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export interface PagespeedWeeklyDeps {
	runScan: (opts: { tenantId: string }) => Promise<ScanSummary>;
	buildData: (
		tenantId: string,
		weekKey: string,
		opts: { includeOpportunities: boolean; attachPdf: boolean }
	) => Promise<PagespeedReportData>;
	sendEmail: (
		tenantId: string,
		recipient: string,
		data: PagespeedReportData,
		alertThreshold: number
	) => Promise<void>;
}

async function defaultSendEmail(
	tenantId: string,
	recipient: string,
	data: PagespeedReportData,
	alertThreshold: number
) {
	const { sendPagespeedReportEmail } = await import('$lib/server/email');
	await sendPagespeedReportEmail(tenantId, recipient, data, alertThreshold);
}

export interface PagespeedWeeklyResult {
	checked: number;
	processed: number;
	emailsSent: number;
	errors: number;
}

export async function processPagespeedWeeklyReport(
	now: Date = new Date(),
	deps: PagespeedWeeklyDeps = {
		runScan: (opts) => runPagespeedScan(opts),
		buildData: buildPagespeedReportData,
		sendEmail: defaultSendEmail
	}
): Promise<PagespeedWeeklyResult> {
	const cal = bucharestNow(now);
	const weekKey = isoWeekKey(now);
	const result: PagespeedWeeklyResult = { checked: 0, processed: 0, emailsSent: 0, errors: 0 };

	const allSettings = await db
		.select()
		.from(table.pagespeedSettings)
		.where(eq(table.pagespeedSettings.isEnabled, true));

	logInfo(
		'scheduler',
		`[pagespeed-weekly] start — ${allSettings.length} tenants configurați, ${weekKey}, zi ${cal.dayOfWeek}, ora ${cal.hour}`
	);

	for (const settings of allSettings) {
		result.checked++;
		const scheduledHour = Number(String(settings.hour).split(':')[0]);
		if (settings.dayOfWeek !== cal.dayOfWeek || scheduledHour !== cal.hour) continue;

		const tenantId = settings.tenantId;
		try {
			// idempotență: un singur raport per (tenant, săptămână)
			const [existing] = await db
				.select({ id: table.pagespeedReport.id })
				.from(table.pagespeedReport)
				.where(
					and(
						eq(table.pagespeedReport.tenantId, tenantId),
						eq(table.pagespeedReport.weekKey, weekKey)
					)
				)
				.limit(1);
			if (existing) continue;

			const [emailConfig] = await db
				.select({ isEnabled: table.emailSettings.isEnabled })
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, tenantId))
				.limit(1);

			const scan = await deps.runScan({ tenantId });
			const data = await deps.buildData(tenantId, weekKey, {
				includeOpportunities: settings.includeOpportunities,
				attachPdf: settings.attachPdf
			});

			const configuredRecipients = (settings.recipients as string[]) ?? [];
			const clientRecipients = settings.sendToClient
				? await collectClientRecipients(tenantId)
				: [];
			const recipients = [...new Set([...configuredRecipients, ...clientRecipients])];

			const notes: string[] = [];
			let status: 'sent' | 'partial' | 'skipped' = 'sent';
			let sentAt: Date | null = null;

			if (scan.failed > 0 || data.failedCount > 0) {
				notes.push(`${Math.max(scan.failed, data.failedCount)} măsurători au eșuat`);
			}

			if (settings.onlyOnDrop && data.alertCount === 0) {
				status = 'skipped';
				notes.push('nicio scădere peste prag — raportul nu s-a trimis (setare activă)');
			} else if (!recipients.length) {
				status = 'skipped';
				notes.push('fără destinatari — raportul nu s-a trimis');
			} else if (emailConfig && emailConfig.isEnabled === false) {
				status = 'skipped';
				notes.push('SMTP dezactivat pentru tenant — raportul nu s-a trimis');
			} else {
				let failedEmails = 0;
				for (const recipient of recipients) {
					try {
						await deps.sendEmail(tenantId, recipient, data, settings.alertThreshold);
						result.emailsSent++;
					} catch (error) {
						failedEmails++;
						const { message } = serializeError(error);
						logError('scheduler', `[pagespeed-weekly] email eșuat către ${recipient}: ${message}`);
						notes.push(`email eșuat: ${recipient}`);
					}
				}
				sentAt = new Date();
				if (failedEmails > 0) status = 'partial';
				else if (notes.length > 0) status = 'partial';
			}

			await db.insert(table.pagespeedReport).values({
				id: generateId(),
				tenantId,
				weekKey,
				sentAt,
				siteCount: data.siteCount,
				avgMobile: data.avgMobile,
				avgDesktop: data.avgDesktop,
				deltaMobile: data.deltaMobile,
				alertCount: data.alertCount,
				status,
				note: notes.length ? notes.join(' · ') : null,
				recipients,
				createdAt: new Date()
			});
			result.processed++;
			logInfo(
				'scheduler',
				`[pagespeed-weekly] tenant ${tenantId}: ${weekKey} ${status} — ${data.siteCount} site-uri, ${recipients.length} destinatari`
			);
		} catch (error) {
			result.errors++;
			const { message } = serializeError(error);
			logError('scheduler', `[pagespeed-weekly] tenant ${tenantId} a eșuat: ${message}`);
		}
	}

	logInfo(
		'scheduler',
		`[pagespeed-weekly] final — ${result.processed} rapoarte, ${result.emailsSent} emailuri, ${result.errors} erori`
	);
	return result;
}

async function collectClientRecipients(tenantId: string): Promise<string[]> {
	const rows = await db
		.select({ email: table.client.email })
		.from(table.pagespeedSite)
		.leftJoin(
			table.client,
			and(eq(table.pagespeedSite.clientId, table.client.id), eq(table.client.tenantId, tenantId))
		)
		.where(
			and(
				eq(table.pagespeedSite.tenantId, tenantId),
				eq(table.pagespeedSite.active, true),
				isNotNull(table.pagespeedSite.clientId)
			)
		);
	return rows.map((r) => r.email).filter((e): e is string => !!e);
}
