import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { logInfo, logError, logWarning } from '$lib/server/logger';
import { sendReportEmail } from '$lib/server/email';
import { generateReportPdf, type ReportPlatformData } from '$lib/server/report-pdf-generator';
import { sql, gte, lte } from 'drizzle-orm';

/**
 * Process scheduled PDF report emails.
 * Runs daily at 08:00 Europe/Bucharest.
 * Checks which reports are due (weekly on matching day, monthly on matching day).
 */
export async function processPdfReportSend() {
	const now = new Date();
	const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // 1=Mon, 7=Sun
	const dayOfMonth = now.getDate();

	logInfo('scheduler', `PDF Report Send: checking schedules (dayOfWeek=${dayOfWeek}, dayOfMonth=${dayOfMonth})`, { metadata: { dayOfWeek, dayOfMonth } });

	let reportsSent = 0;
	const errors: { clientId: string; error: string }[] = [];

	try {
		// Get all enabled schedules
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
				clientName: table.client.name,
				clientEmail: table.client.email,
				tenantName: table.tenant.name
			})
			.from(table.reportSchedule)
			.leftJoin(table.client, eq(table.reportSchedule.clientId, table.client.id))
			.leftJoin(table.tenant, eq(table.reportSchedule.tenantId, table.tenant.id))
			.where(
				and(
					eq(table.reportSchedule.isEnabled, true),
					ne(table.reportSchedule.frequency, 'disabled')
				)
			);

		for (const schedule of schedules) {
			try {
				// Check if today is the right day
				if (schedule.frequency === 'weekly' && schedule.dayOfWeek !== dayOfWeek) continue;
				if (schedule.frequency === 'monthly' && schedule.dayOfMonth !== dayOfMonth) continue;

				// Check SMTP
				const [emailConfig] = await db
					.select({ isEnabled: table.emailSettings.isEnabled })
					.from(table.emailSettings)
					.where(eq(table.emailSettings.tenantId, schedule.tenantId))
					.limit(1);
				if (!emailConfig?.isEnabled) continue;

				// Calculate date range
				const { since, until, label } = getDateRange(schedule.frequency, now);

				// Get platform data from DB
				const platformNames: string[] = JSON.parse(schedule.platforms || '["meta","google","tiktok"]');
				const platforms: ReportPlatformData[] = [];

				for (const platformName of platformNames) {
					const data = await getPlatformSpendData(schedule.tenantId, schedule.clientId, platformName, since, until);
					if (data) platforms.push(data);
				}

				if (platforms.length === 0) {
					logInfo('scheduler', `No spending data for client ${schedule.clientName}, skipping`, { tenantId: schedule.tenantId, metadata: { clientName: schedule.clientName } });
					continue;
				}

				// Generate PDF
				const pdfBuffer = await generateReportPdf({
					tenantName: schedule.tenantName || 'CRM',
					clientName: schedule.clientName || 'Client',
					period: { since, until, label },
					platforms,
					generatedAt: now
				});

				// Get recipients
				const recipients = schedule.recipientEmails
					? JSON.parse(schedule.recipientEmails) as string[]
					: schedule.clientEmail ? [schedule.clientEmail] : [];

				if (recipients.length === 0) {
					logWarning('scheduler', `No recipients for client ${schedule.clientName}`, { tenantId: schedule.tenantId });
					continue;
				}

				// Send to each recipient
				for (const email of recipients) {
					try {
						await sendReportEmail(
							schedule.tenantId,
							schedule.clientId,
							email,
							schedule.clientName || 'Client',
							label,
							pdfBuffer
						);
						reportsSent++;
					} catch (err) {
						errors.push({ clientId: schedule.clientId, error: `${email}: ${(err as Error).message}` });
					}
				}

				// Update lastSentAt
				await db.update(table.reportSchedule)
					.set({ lastSentAt: now, updatedAt: now })
					.where(eq(table.reportSchedule.id, schedule.id));

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

export function getDateRange(frequency: string, now: Date): { since: string; until: string; label: string } {
	const pad = (n: number) => String(n).padStart(2, '0');
	const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

	if (frequency === 'weekly') {
		// Last Monday to Sunday
		const lastSunday = new Date(now);
		lastSunday.setDate(now.getDate() - (now.getDay() === 0 ? 0 : now.getDay()));
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

export async function getPlatformSpendData(
	tenantId: string, clientId: string, platform: string, since: string, until: string
): Promise<ReportPlatformData | null> {
	if (platform === 'meta') {
		const [result] = await db.select({
			spend: sql<number>`coalesce(sum(${table.metaAdsSpending.spendCents}), 0)`,
			impressions: sql<number>`coalesce(sum(${table.metaAdsSpending.impressions}), 0)`,
			clicks: sql<number>`coalesce(sum(${table.metaAdsSpending.clicks}), 0)`,
			currency: table.metaAdsSpending.currencyCode
		}).from(table.metaAdsSpending).where(and(
			eq(table.metaAdsSpending.tenantId, tenantId),
			eq(table.metaAdsSpending.clientId, clientId),
			lte(table.metaAdsSpending.periodStart, until),
			gte(table.metaAdsSpending.periodEnd, since)
		)).groupBy(table.metaAdsSpending.currencyCode);

		if (!result || result.spend === 0) return null;
		return { name: 'Meta Ads', spend: result.spend / 100, impressions: result.impressions, clicks: result.clicks, conversions: 0, currency: result.currency || 'RON' };
	}

	if (platform === 'google') {
		const [result] = await db.select({
			spend: sql<number>`coalesce(sum(${table.googleAdsSpending.spendCents}), 0)`,
			impressions: sql<number>`coalesce(sum(${table.googleAdsSpending.impressions}), 0)`,
			clicks: sql<number>`coalesce(sum(${table.googleAdsSpending.clicks}), 0)`,
			conversions: sql<number>`coalesce(sum(${table.googleAdsSpending.conversions}), 0)`,
			currency: table.googleAdsSpending.currencyCode
		}).from(table.googleAdsSpending).where(and(
			eq(table.googleAdsSpending.tenantId, tenantId),
			eq(table.googleAdsSpending.clientId, clientId),
			lte(table.googleAdsSpending.periodStart, until),
			gte(table.googleAdsSpending.periodEnd, since)
		)).groupBy(table.googleAdsSpending.currencyCode);

		if (!result || result.spend === 0) return null;
		return { name: 'Google Ads', spend: result.spend / 100, impressions: result.impressions, clicks: result.clicks, conversions: result.conversions, currency: result.currency || 'RON' };
	}

	if (platform === 'tiktok') {
		const [result] = await db.select({
			spend: sql<number>`coalesce(sum(${table.tiktokAdsSpending.spendCents}), 0)`,
			impressions: sql<number>`coalesce(sum(${table.tiktokAdsSpending.impressions}), 0)`,
			clicks: sql<number>`coalesce(sum(${table.tiktokAdsSpending.clicks}), 0)`,
			conversions: sql<number>`coalesce(sum(${table.tiktokAdsSpending.conversions}), 0)`,
			currency: table.tiktokAdsSpending.currencyCode
		}).from(table.tiktokAdsSpending).where(and(
			eq(table.tiktokAdsSpending.tenantId, tenantId),
			eq(table.tiktokAdsSpending.clientId, clientId),
			lte(table.tiktokAdsSpending.periodStart, until),
			gte(table.tiktokAdsSpending.periodEnd, since)
		)).groupBy(table.tiktokAdsSpending.currencyCode);

		if (!result || result.spend === 0) return null;
		return { name: 'TikTok Ads', spend: result.spend / 100, impressions: result.impressions, clicks: result.clicks, conversions: result.conversions, currency: result.currency || 'RON' };
	}

	return null;
}
