import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { sendReportEmail } from '$lib/server/email';
import { generateReportPdf, type ReportPlatformData } from '$lib/server/report-pdf-generator';
import { fetchLivePlatformSpend, type LivePlatformResult } from '$lib/server/reports/live-spend';

const BUCHAREST_TZ = 'Europe/Bucharest';

function getBucharestCalendar(d: Date): { dayOfWeek: number; dayOfMonth: number; ymd: string } {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: BUCHAREST_TZ,
		year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
	}).formatToParts(d);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
	return {
		dayOfWeek: weekdayMap[get('weekday')] ?? 1,
		dayOfMonth: Number(get('day')),
		ymd: `${get('year')}-${get('month')}-${get('day')}`
	};
}

/**
 * Process scheduled PDF report emails.
 * Runs daily at 08:00 Europe/Bucharest.
 * Checks which reports are due (weekly on matching day, monthly on matching day).
 */
export async function processPdfReportSend() {
	const now = new Date();
	// Derive dayOfWeek/dayOfMonth from Europe/Bucharest, not the server's local
	// timezone. A worker running in UTC would otherwise fire a "Monday" schedule
	// on Sunday evening when it's already Monday in Romania.
	const { dayOfWeek, dayOfMonth, ymd } = getBucharestCalendar(now);

	logInfo('scheduler', `PDF Report Send: checking schedules (dayOfWeek=${dayOfWeek}, dayOfMonth=${dayOfMonth}, date=${ymd})`, { metadata: { dayOfWeek, dayOfMonth, ymd } });

	let reportsSent = 0;
	const errors: { clientId: string; error: string }[] = [];

	try {
		// Get all enabled schedules. We pull rows where EITHER the primary
		// frequency is active OR the monthly-summary toggle is on — the second
		// pass below decides which emails actually get sent today.
		const schedules = await db
			.select({
				id: table.reportSchedule.id,
				tenantId: table.reportSchedule.tenantId,
				clientId: table.reportSchedule.clientId,
				frequency: table.reportSchedule.frequency,
				dayOfWeek: table.reportSchedule.dayOfWeek,
				dayOfMonth: table.reportSchedule.dayOfMonth,
				platforms: table.reportSchedule.platforms,
				recipientEmails: table.reportSchedule.recipientEmails,
				monthlyReportEnabled: table.reportSchedule.monthlyReportEnabled,
				lastSentAt: table.reportSchedule.lastSentAt,
				clientName: table.client.name,
				clientEmail: table.client.email,
				tenantName: table.tenant.name,
				tenantThemeColor: table.tenant.themeColor
			})
			.from(table.reportSchedule)
			.leftJoin(
				table.client,
				and(
					eq(table.reportSchedule.clientId, table.client.id),
					eq(table.reportSchedule.tenantId, table.client.tenantId)
				)
			)
			.leftJoin(table.tenant, eq(table.reportSchedule.tenantId, table.tenant.id))
			.where(eq(table.reportSchedule.isEnabled, true));

		for (const schedule of schedules) {
			try {
				const shouldSendPrimary =
					(schedule.frequency === 'weekly' && schedule.dayOfWeek === dayOfWeek) ||
					(schedule.frequency === 'monthly' && schedule.dayOfMonth === dayOfMonth);
				// Monthly summary fires on day 1 of each month, regardless of
				// primary frequency (so a weekly schedule can also get a monthly
				// roll-up on the 1st). Uses ALL 3 platforms.
				const shouldSendMonthlySummary = !!schedule.monthlyReportEnabled && dayOfMonth === 1;

				if (!shouldSendPrimary && !shouldSendMonthlySummary) continue;

				// Check SMTP once per schedule (both passes share the transport).
				const [emailConfig] = await db
					.select({ isEnabled: table.emailSettings.isEnabled })
					.from(table.emailSettings)
					.where(eq(table.emailSettings.tenantId, schedule.tenantId))
					.limit(1);
				if (!emailConfig?.isEnabled) continue;

				// --- Pass 1: primary scheduled report ---
				if (shouldSendPrimary) {
					const sent = await sendReportForSchedule({
						schedule,
						now,
						variant: 'standard',
						errors
					});
					reportsSent += sent;
				}

				// --- Pass 2: monthly all-platforms summary ---
				if (shouldSendMonthlySummary) {
					const sent = await sendReportForSchedule({
						schedule,
						now,
						variant: 'monthly-summary',
						errors
					});
					reportsSent += sent;
				}
			} catch (err) {
				errors.push({ clientId: schedule.clientId, error: (err as Error).message });
				logError('scheduler', `Report error for client ${schedule.clientName}`, {
					tenantId: schedule.tenantId,
					metadata: { error: (err as Error).message }
				});
			}
		}

		logInfo('scheduler', `PDF Report Send complete: ${reportsSent} sent, ${errors.length} errors`, {
			metadata: { reportsSent, errors: errors.length > 0 ? errors : undefined }
		});

		return { success: true, reportsSent, errors };
	} catch (err) {
		logError('scheduler', 'PDF Report Send fatal error', { metadata: { error: (err as Error).message } });
		throw err;
	}
}

type ScheduleRow = {
	id: string;
	tenantId: string;
	clientId: string;
	frequency: string;
	dayOfWeek: number | null;
	dayOfMonth: number | null;
	platforms: string;
	recipientEmails: string | null;
	monthlyReportEnabled: boolean;
	lastSentAt: Date | null;
	clientName: string | null;
	clientEmail: string | null;
	tenantName: string | null;
	tenantThemeColor: string | null;
};

/**
 * Build + send one report (either the primary schedule or the monthly
 * summary). Returns the count of recipients that received an email in this
 * pass. Errors are pushed to the caller's error collector.
 */
async function sendReportForSchedule(opts: {
	schedule: ScheduleRow;
	now: Date;
	variant: 'standard' | 'monthly-summary';
	errors: { clientId: string; error: string }[];
}): Promise<number> {
	const { schedule, now, variant, errors } = opts;
	const allowedPlatforms = ['meta', 'google', 'tiktok'] as const;

	// Monthly summary forces all 3 platforms regardless of the schedule's
	// configured subset; the primary send respects the user's selection.
	let platformNames: string[];
	if (variant === 'monthly-summary') {
		platformNames = [...allowedPlatforms];
	} else {
		try {
			const raw = JSON.parse(schedule.platforms || '[]');
			platformNames = Array.isArray(raw)
				? raw.filter((p): p is string => typeof p === 'string' && (allowedPlatforms as readonly string[]).includes(p))
				: [];
		} catch {
			logWarning('scheduler', `Corrupt platforms JSON for schedule ${schedule.id}, falling back to defaults`, { tenantId: schedule.tenantId, metadata: { scheduleId: schedule.id, raw: schedule.platforms } });
			platformNames = [];
		}
		if (platformNames.length === 0) platformNames = [...allowedPlatforms];
	}

	// Monthly summary always covers the previous full month.
	const { since, until, label } = variant === 'monthly-summary'
		? getDateRange('monthly', now)
		: getDateRange(schedule.frequency, now);

	const platforms: ReportPlatformData[] = [];
	for (const platformName of platformNames) {
		const data = await getPlatformSpendData(schedule.tenantId, schedule.clientId, platformName, since, until);
		if (data) platforms.push(data);
	}

	if (platforms.length === 0) {
		logInfo('scheduler', `No spending data for ${schedule.clientName} (${variant}), skipping`, { tenantId: schedule.tenantId, metadata: { clientName: schedule.clientName, variant } });
		return 0;
	}

	let tenantLogo: string | null = null;
	try {
		const [invoiceSettings] = await db
			.select({ invoiceLogo: table.invoiceSettings.invoiceLogo })
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, schedule.tenantId))
			.limit(1);
		tenantLogo = invoiceSettings?.invoiceLogo || null;
	} catch (err) {
		logWarning('scheduler', 'Failed to load invoice settings for report PDF, using default logo', { tenantId: schedule.tenantId, metadata: { error: (err as Error).message } });
	}

	const exchangeRates: Record<string, number> = {};
	try {
		const usdRate = await db.select({ rate: table.bnrExchangeRate.rate }).from(table.bnrExchangeRate)
			.where(eq(table.bnrExchangeRate.currency, 'USD')).orderBy(desc(table.bnrExchangeRate.rateDate)).limit(1);
		const eurRate = await db.select({ rate: table.bnrExchangeRate.rate }).from(table.bnrExchangeRate)
			.where(eq(table.bnrExchangeRate.currency, 'EUR')).orderBy(desc(table.bnrExchangeRate.rateDate)).limit(1);
		if (usdRate[0]) exchangeRates['USD'] = usdRate[0].rate;
		if (eurRate[0]) exchangeRates['EUR'] = eurRate[0].rate;
	} catch (err) {
		logWarning('scheduler', 'Failed to load BNR exchange rates for report PDF, using original currencies', { tenantId: schedule.tenantId, metadata: { error: (err as Error).message } });
	}

	const pdfBuffer = await generateReportPdf({
		tenantName: schedule.tenantName || 'CRM',
		clientName: schedule.clientName || 'Client',
		period: { since, until, label },
		platforms,
		generatedAt: now,
		tenantLogo,
		accentColor: schedule.tenantThemeColor || null,
		exchangeRates
	});

	const recipients = schedule.recipientEmails
		? JSON.parse(schedule.recipientEmails) as string[]
		: schedule.clientEmail ? [schedule.clientEmail] : [];

	if (recipients.length === 0) {
		logWarning('scheduler', `No recipients for ${schedule.clientName} (${variant})`, { tenantId: schedule.tenantId });
		return 0;
	}

	// Per-recipient idempotency: subject encodes variant + clientName + label,
	// so primary and monthly-summary can coexist on the same day (day 1 of the
	// month when monthly frequency is also chosen) without colliding.
	const subjectPrefix = variant === 'monthly-summary' ? 'Raport Marketing Lunar' : 'Raport Marketing';
	const expectedSubject = `${subjectPrefix} — ${schedule.clientName || 'Client'} — ${label}`;
	const alreadyDelivered = await db.select({ toEmail: table.emailLog.toEmail })
		.from(table.emailLog)
		.where(and(
			eq(table.emailLog.tenantId, schedule.tenantId),
			eq(table.emailLog.emailType, 'report'),
			eq(table.emailLog.status, 'completed'),
			eq(table.emailLog.subject, expectedSubject),
			inArray(table.emailLog.toEmail, recipients)
		));
	const deliveredSet = new Set(alreadyDelivered.map((r) => r.toEmail));

	let sentCount = 0;
	for (const email of recipients) {
		if (deliveredSet.has(email)) {
			logInfo('scheduler', `Skipping already-delivered recipient ${email} for ${schedule.clientName} (${variant})`, { tenantId: schedule.tenantId, metadata: { scheduleId: schedule.id, variant } });
			continue;
		}
		try {
			await sendReportEmail(
				schedule.tenantId,
				schedule.clientId,
				email,
				schedule.clientName || 'Client',
				label,
				pdfBuffer,
				variant
			);
			sentCount++;
		} catch (err) {
			errors.push({ clientId: schedule.clientId, error: `${email} (${variant}): ${(err as Error).message}` });
		}
	}

	// Only stamp lastSentAt for the primary send — the monthly summary is a
	// secondary artefact and we don't want it to mask the primary cadence.
	if (variant === 'standard' && sentCount > 0) {
		await db.update(table.reportSchedule)
			.set({ lastSentAt: now, updatedAt: now })
			.where(eq(table.reportSchedule.id, schedule.id));
	}

	return sentCount;
}

export function getDateRange(frequency: string, now: Date): { since: string; until: string; label: string } {
	const pad = (n: number) => String(n).padStart(2, '0');
	const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

	if (frequency === 'weekly') {
		// Last full Monday–Sunday. When run on Sunday we still want the PREVIOUS
		// full week, never today (data for today is incomplete at 08:00).
		const lastSunday = new Date(now);
		lastSunday.setDate(now.getDate() - (now.getDay() === 0 ? 7 : now.getDay()));
		const lastMonday = new Date(lastSunday);
		lastMonday.setDate(lastSunday.getDate() - 6);
		const label = `${lastMonday.getDate()} - ${lastSunday.getDate()} ${lastSunday.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })}`;
		return { since: fmt(lastMonday), until: fmt(lastSunday), label };
	}

	// Monthly — last full month
	const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
	const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
	const label = lastMonth.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
	return { since: fmt(lastMonth), until: fmt(lastMonthEnd), label };
}

/**
 * Thin wrapper around `fetchLivePlatformSpend` with scheduler-specific skip
 * rules. Returns null when the platform should NOT appear in the emailed PDF:
 *   - `no-integration`: client hasn't connected this platform at all
 *   - `ok` with spend === 0: platform was fetched fine but had no activity
 *
 * `api-error` IS included so the PDF shows the "live data unavailable" warning
 * banner instead of silently hiding a platform the client expects to see.
 *
 * Historical note: this used to read from `meta_ads_spending` / `google_ads_spending`
 * / `tiktok_ads_spending`. Those tables are refreshed once per month on day 1
 * via `time_increment: 'monthly'` sync jobs, so any weekly report fired between
 * day 2 and the next day 1 showed zeroes even when the client had active spend.
 * Switching to live API calls fixes that, at the cost of a few extra seconds
 * per schedule during the 08:00 send window.
 */
export async function getPlatformSpendData(
	tenantId: string, clientId: string, platform: string, since: string, until: string
): Promise<ReportPlatformData | null> {
	const result: LivePlatformResult = await fetchLivePlatformSpend(tenantId, clientId, platform, since, until);

	if (result.fetchStatus === 'no-integration') return null;
	if (result.fetchStatus === 'ok' && result.spend === 0) return null;

	return result;
}
