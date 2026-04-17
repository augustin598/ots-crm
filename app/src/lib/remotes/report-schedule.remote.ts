import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { generateReportPdf } from '$lib/server/report-pdf-generator';
import { getPlatformSpendData } from '$lib/server/scheduler/tasks/pdf-report-send';
import { sendReportEmail } from '$lib/server/email';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/** Get all report schedules for the current tenant */
export const getReportSchedules = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const schedules = await db
		.select({
			id: table.reportSchedule.id,
			clientId: table.reportSchedule.clientId,
			clientName: table.client.name,
			clientEmail: table.client.email,
			frequency: table.reportSchedule.frequency,
			dayOfWeek: table.reportSchedule.dayOfWeek,
			dayOfMonth: table.reportSchedule.dayOfMonth,
			platforms: table.reportSchedule.platforms,
			recipientEmails: table.reportSchedule.recipientEmails,
			isEnabled: table.reportSchedule.isEnabled,
			lastSentAt: table.reportSchedule.lastSentAt,
			createdAt: table.reportSchedule.createdAt,
			updatedAt: table.reportSchedule.updatedAt
		})
		.from(table.reportSchedule)
		.leftJoin(
			table.client,
			and(
				eq(table.reportSchedule.clientId, table.client.id),
				eq(table.reportSchedule.tenantId, table.client.tenantId)
			)
		)
		.where(eq(table.reportSchedule.tenantId, event.locals.tenant.id))
		.orderBy(table.client.name);

	return schedules.map((s) => ({
		...s,
		platforms: safeParse<string[]>(s.platforms, ['meta', 'google', 'tiktok']),
		recipientEmails: safeParse<string[]>(s.recipientEmails, [])
	}));
});

/** Get schedule for a specific client (used by client portal) */
export const getMyReportSchedule = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	// Client portal: locals.client is set
	const clientId = (event.locals as any).client?.id;
	if (!clientId) throw error(403, 'Acces permis doar utilizatorilor client');

	const [schedule] = await db
		.select({
			id: table.reportSchedule.id,
			frequency: table.reportSchedule.frequency,
			dayOfWeek: table.reportSchedule.dayOfWeek,
			dayOfMonth: table.reportSchedule.dayOfMonth,
			platforms: table.reportSchedule.platforms,
			recipientEmails: table.reportSchedule.recipientEmails,
			isEnabled: table.reportSchedule.isEnabled,
			lastSentAt: table.reportSchedule.lastSentAt
		})
		.from(table.reportSchedule)
		.where(
			and(
				eq(table.reportSchedule.tenantId, event.locals.tenant.id),
				eq(table.reportSchedule.clientId, clientId)
			)
		)
		.limit(1);

	if (!schedule) return null;

	return {
		...schedule,
		platforms: safeParse<string[]>(schedule.platforms, ['meta', 'google', 'tiktok']),
		recipientEmails: safeParse<string[]>(schedule.recipientEmails, [])
	};
});

const upsertSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1)),
	frequency: v.picklist(['weekly', 'monthly', 'disabled']),
	dayOfWeek: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(7)), 1),
	dayOfMonth: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(28)), 1),
	platforms: v.optional(v.array(v.picklist(['meta', 'google', 'tiktok'])), ['meta', 'google', 'tiktok']),
	recipientEmails: v.optional(v.array(v.pipe(v.string(), v.email())), []),
	isEnabled: v.optional(v.boolean(), true)
});

/** Create or update a report schedule for a client */
export const upsertReportSchedule = command(upsertSchema, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const tenantId = event.locals.tenant.id;
	const now = new Date();

	// Verify client belongs to tenant
	const [client] = await db
		.select({ id: table.client.id })
		.from(table.client)
		.where(and(eq(table.client.id, params.clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);

	if (!client) throw error(404, 'Clientul nu a fost găsit');

	// Check if schedule already exists for this client
	const [existing] = await db
		.select({ id: table.reportSchedule.id })
		.from(table.reportSchedule)
		.where(
			and(
				eq(table.reportSchedule.tenantId, tenantId),
				eq(table.reportSchedule.clientId, params.clientId)
			)
		)
		.limit(1);

	const data = {
		frequency: params.frequency,
		dayOfWeek: params.dayOfWeek ?? 1,
		dayOfMonth: params.dayOfMonth ?? 1,
		platforms: JSON.stringify(params.platforms),
		recipientEmails: params.recipientEmails && params.recipientEmails.length > 0
			? JSON.stringify(params.recipientEmails)
			: null,
		isEnabled: params.isEnabled ?? true,
		updatedAt: now
	};

	if (existing) {
		await db
			.update(table.reportSchedule)
			.set(data)
			.where(eq(table.reportSchedule.id, existing.id));
		return { id: existing.id, created: false };
	}

	const id = generateId();
	await db.insert(table.reportSchedule).values({
		id,
		tenantId,
		clientId: params.clientId,
		...data,
		createdAt: now
	});
	return { id, created: true };
});

/** Update schedule from client portal (limited fields) */
export const updateMyReportSchedule = command(
	v.object({
		recipientEmails: v.optional(v.array(v.pipe(v.string(), v.email()))),
		isEnabled: v.optional(v.boolean())
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		const clientId = (event.locals as any).client?.id;
		if (!clientId) throw error(403, 'Acces permis doar utilizatorilor client');

		const [schedule] = await db
			.select({ id: table.reportSchedule.id })
			.from(table.reportSchedule)
			.where(
				and(
					eq(table.reportSchedule.tenantId, event.locals.tenant.id),
					eq(table.reportSchedule.clientId, clientId)
				)
			)
			.limit(1);

		if (!schedule) throw error(404, 'Nu există un program de raportare configurat');

		const updates: Record<string, unknown> = { updatedAt: new Date() };
		if (params.recipientEmails !== undefined) {
			updates.recipientEmails = params.recipientEmails.length > 0
				? JSON.stringify(params.recipientEmails)
				: null;
		}
		if (params.isEnabled !== undefined) {
			updates.isEnabled = params.isEnabled;
		}

		await db
			.update(table.reportSchedule)
			.set(updates)
			.where(eq(table.reportSchedule.id, schedule.id));

		return { success: true };
	}
);

/** Delete a report schedule */
export const deleteReportSchedule = command(
	v.object({ id: v.pipe(v.string(), v.minLength(1)) }),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		const [existing] = await db
			.select({ id: table.reportSchedule.id })
			.from(table.reportSchedule)
			.where(
				and(
					eq(table.reportSchedule.id, params.id),
					eq(table.reportSchedule.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) throw error(404, 'Programul nu a fost găsit');

		await db.delete(table.reportSchedule).where(eq(table.reportSchedule.id, params.id));

		return { success: true };
	}
);

/** Send a test copy of a scheduled report to the logged-in user's email so
 * operators can preview the actual email format before it goes to clients. */
export const sendTestReportEmail = command(
	v.object({ scheduleId: v.pipe(v.string(), v.minLength(1)) }),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		const toEmail = event.locals.user.email;
		if (!toEmail) {
			throw error(400, 'Utilizatorul curent nu are adresă de email setată');
		}

		const tenantId = event.locals.tenant.id;
		const tenantName = event.locals.tenant.name || 'CRM';

		const [schedule] = await db
			.select({
				id: table.reportSchedule.id,
				clientId: table.reportSchedule.clientId,
				frequency: table.reportSchedule.frequency,
				platforms: table.reportSchedule.platforms,
				clientName: table.client.name
			})
			.from(table.reportSchedule)
			.leftJoin(
				table.client,
				and(
					eq(table.reportSchedule.clientId, table.client.id),
					eq(table.reportSchedule.tenantId, table.client.tenantId)
				)
			)
			.where(and(
				eq(table.reportSchedule.id, params.scheduleId),
				eq(table.reportSchedule.tenantId, tenantId)
			))
			.limit(1);
		if (!schedule) throw error(404, 'Programul nu a fost găsit');

		// Same date range as the real scheduler would use for this frequency:
		// weekly → last full Mon–Sun, monthly → previous month.
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		let since: string, until: string, label: string;
		if (schedule.frequency === 'monthly') {
			const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
			const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
			since = fmt(lastMonth);
			until = fmt(lastMonthEnd);
			label = lastMonth.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
		} else {
			// weekly (also used as fallback for 'disabled')
			const lastSunday = new Date(now);
			lastSunday.setDate(now.getDate() - (now.getDay() === 0 ? 7 : now.getDay()));
			const lastMonday = new Date(lastSunday);
			lastMonday.setDate(lastSunday.getDate() - 6);
			since = fmt(lastMonday);
			until = fmt(lastSunday);
			label = `${lastMonday.getDate()} - ${lastSunday.getDate()} ${lastSunday.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })}`;
		}

		const allowedPlatforms = ['meta', 'google', 'tiktok'] as const;
		const platformNames = safeParse<string[]>(schedule.platforms, ['meta', 'google', 'tiktok'])
			.filter((p): p is string => (allowedPlatforms as readonly string[]).includes(p));
		const platformDisplayNames: Record<string, string> = {
			meta: 'Meta Ads', google: 'Google Ads', tiktok: 'TikTok Ads'
		};
		const platforms = [];
		for (const platformName of platformNames) {
			const data = await getPlatformSpendData(tenantId, schedule.clientId, platformName, since, until);
			platforms.push(data ?? {
				name: platformDisplayNames[platformName] || platformName,
				spend: 0, impressions: 0, clicks: 0, conversions: 0,
				currency: 'RON', accounts: []
			});
		}

		const [invoiceSettings] = await db
			.select({ invoiceLogo: table.invoiceSettings.invoiceLogo })
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, tenantId))
			.limit(1);

		const exchangeRates: Record<string, number> = {};
		const usdRate = await db.select({ rate: table.bnrExchangeRate.rate })
			.from(table.bnrExchangeRate)
			.where(eq(table.bnrExchangeRate.currency, 'USD'))
			.orderBy(desc(table.bnrExchangeRate.rateDate)).limit(1);
		const eurRate = await db.select({ rate: table.bnrExchangeRate.rate })
			.from(table.bnrExchangeRate)
			.where(eq(table.bnrExchangeRate.currency, 'EUR'))
			.orderBy(desc(table.bnrExchangeRate.rateDate)).limit(1);
		if (usdRate[0]) exchangeRates['USD'] = usdRate[0].rate;
		if (eurRate[0]) exchangeRates['EUR'] = eurRate[0].rate;

		const pdfBuffer = await generateReportPdf({
			tenantName,
			clientName: schedule.clientName || 'Client',
			period: { since, until, label },
			platforms,
			generatedAt: now,
			tenantLogo: invoiceSettings?.invoiceLogo || null,
			accentColor: event.locals.tenant.themeColor || null,
			exchangeRates
		});

		// Prefix the test subject so it's obvious in the inbox. sendReportEmail
		// builds its own subject, so we tag the client name instead.
		await sendReportEmail(
			tenantId,
			schedule.clientId,
			toEmail,
			`[TEST] ${schedule.clientName || 'Client'}`,
			label,
			pdfBuffer
		);

		return { success: true, sentTo: toEmail };
	}
);

function safeParse<T>(json: string | null | undefined, fallback: T): T {
	if (!json) return fallback;
	try {
		return JSON.parse(json) as T;
	} catch {
		return fallback;
	}
}
