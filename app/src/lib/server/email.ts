import nodemailer from 'nodemailer';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { db } from './db';
import * as table from './db/schema';
import { eq, and, or, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { decrypt, DecryptionError } from './plugins/smartbill/crypto';
import {
	logEmailAttempt,
	logEmailProcessing,
	logEmailSuccess,
	logEmailFailure,
	logEmailRetry
} from './email-logger';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';
import { createNotification } from '$lib/server/notifications';
import { createGmailTransporter, isGmailOAuthError, isGmailRateLimitError } from '$lib/server/gmail/transporter';
import { generateInvoicePDF } from '$lib/server/invoice-pdf-generator';
import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';
import { createInvoiceViewToken } from '$lib/server/invoice-token';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape HTML special characters to prevent HTML injection in email templates.
 * Applied to all user-supplied values interpolated into HTML email bodies.
 */
function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Strip leading tabs from template literal plain text (caused by code indentation).
 */
function trimPlainText(text: string): string {
	return text.replace(/^\t+/gm, '').trim();
}

/**
 * Resolve the "from" email for a tenant or the global default.
 * Logs a warning if falling back to noreply@example.com (emails will be rejected).
 */
function resolveFromEmail(emailSettings?: { smtpFrom?: string | null; smtpUser?: string | null } | null): string {
	const resolved =
		emailSettings?.smtpFrom ||
		emailSettings?.smtpUser ||
		env.SMTP_FROM ||
		env.SMTP_USER ||
		null;
	if (!resolved) {
		logWarning('email', 'No SMTP_FROM configured — emails will use noreply@example.com and likely be rejected. Set SMTP_FROM in .env or tenant email settings.');
		return 'noreply@example.com';
	}
	return resolved;
}

/**
 * Format a date as dd.MM.yyyy (Romanian locale, consistent across environments).
 */
function formatDateRo(date: string | Date | null | undefined): string {
	if (!date) return 'N/A';
	const d = new Date(date);
	if (isNaN(d.getTime())) return 'N/A';
	return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Prepare logo as inline CID attachment for HTML emails.
 * Returns { logoAttachment, logoHtml } or nulls if no logo available.
 */
function prepareLogoAttachment(invoiceLogo: string | null | undefined) {
	if (!invoiceLogo) return { logoAttachment: null, logoHtml: '' };
	const logoAttachment = {
		filename: 'logo.png',
		content: Buffer.from(invoiceLogo.replace(/^data:image\/\w+;base64,/, ''), 'base64'),
		cid: 'companylogo',
		contentType: 'image/png'
	};
	const logoHtml =
		'<div style="text-align: center; margin-bottom: 20px;"><img src="cid:companylogo" alt="" style="max-width: 200px; max-height: 80px;" /></div>';
	return { logoAttachment, logoHtml };
}

// ---------------------------------------------------------------------------
// Shared branded email shell — letterhead layout used by every tenant-facing
// email. Color picks up tenant.themeColor (validated) with #2563eb fallback.
// ---------------------------------------------------------------------------
const BRAND_MOTTO = 'Digital Marketing &amp; Growth Solutions';
const DEFAULT_THEME_COLOR = '#2563eb';

function normalizeThemeColor(raw: string | null | undefined): string {
	if (!raw) return DEFAULT_THEME_COLOR;
	const trimmed = raw.trim();
	return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : DEFAULT_THEME_COLOR;
}

function buildHeaderLogoHtml(logoAttachment: { cid: string } | null): string {
	return logoAttachment
		? '<img src="cid:companylogo" alt="" style="display: block; max-height: 36px; max-width: 140px; margin-bottom: 18px;" />'
		: '';
}

interface BrandedEmailOptions {
	themeColor: string;
	headerLogoHtml: string;
	title: string;         // already-escaped or trusted string
	subtitle?: string;     // defaults to motto; pass empty string to hide
	bodyHtml: string;      // trusted HTML (callers escape user input themselves)
	footerHtml?: string;   // small muted line at bottom
	previewTitle?: string; // <title> tag content
}

function renderBrandedEmail(opts: BrandedEmailOptions): string {
	const subtitle = opts.subtitle ?? BRAND_MOTTO;
	const footer =
		opts.footerHtml ??
		'Pentru întrebări sau clarificări, nu ezitați să ne contactați.';
	const subtitleBlock = subtitle
		? `<p style="color: #6b7280; font-size: 13px; margin: 0 0 24px 0;">${subtitle}</p>`
		: '';
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${opts.previewTitle ?? opts.title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
	<div style="max-width: 600px; margin: 0 auto; padding: 32px 20px;">
		<div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 32px;">
			${opts.headerLogoHtml}
			<h1 style="color: ${opts.themeColor}; font-size: 22px; margin: 0 0 6px 0; line-height: 1.2;">${opts.title}</h1>
			${subtitleBlock}
			<div style="height: 1px; background-color: #e5e7eb; margin: 0 0 24px 0;"></div>
			${opts.bodyHtml}
			<div style="height: 1px; background-color: #e5e7eb; margin: 0 0 18px 0;"></div>
			<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0;">${footer}</p>
		</div>
	</div>
</body>
</html>`;
}

/**
 * CTA button (primary) — uses tenant theme color.
 */
function renderCtaButton(href: string, label: string, themeColor: string): string {
	return `<div style="text-align: center; margin: 24px 0;">
		<a href="${href}" style="background-color: ${themeColor}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">${label}</a>
	</div>`;
}

/**
 * Fetch tenant brand bundle: name, themeColor, logo attachment, header logo HTML.
 * Reuses existing invoiceSettings + tenant rows so callers can skip duplicate reads.
 */
async function fetchTenantBrand(tenantId: string): Promise<{
	tenantName: string;
	themeColor: string;
	logoAttachment: ReturnType<typeof prepareLogoAttachment>['logoAttachment'];
	headerLogoHtml: string;
}> {
	const [tenant] = await db
		.select({ name: table.tenant.name, themeColor: table.tenant.themeColor })
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);

	const [invoiceSettings] = await db
		.select({ invoiceLogo: table.invoiceSettings.invoiceLogo })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);

	const { logoAttachment } = prepareLogoAttachment(invoiceSettings?.invoiceLogo);
	return {
		tenantName: tenant?.name || 'CRM',
		themeColor: normalizeThemeColor(tenant?.themeColor),
		logoAttachment,
		headerLogoHtml: buildHeaderLogoHtml(logoAttachment)
	};
}

// ---------------------------------------------------------------------------
// Task email badge color helpers (hex equivalents of Tailwind classes in task-kanban-utils.ts)
// ---------------------------------------------------------------------------
function getEmailStatusColors(status: string | null): { bg: string; text: string; dot: string } {
	switch (status) {
		case 'pending-approval': return { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b' };
		case 'todo':             return { bg: '#f1f5f9', text: '#334155', dot: '#94a3b8' };
		case 'in-progress':      return { bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6' };
		case 'review':           return { bg: '#f3e8ff', text: '#7e22ce', dot: '#a855f7' };
		case 'done':             return { bg: '#dcfce7', text: '#15803d', dot: '#22c55e' };
		case 'cancelled':        return { bg: '#fee2e2', text: '#b91c1c', dot: '#ef4444' };
		default:                 return { bg: '#f1f5f9', text: '#334155', dot: '#94a3b8' };
	}
}

function getEmailPriorityColors(priority: string | null): { bg: string; text: string } {
	switch (priority) {
		case 'urgent': return { bg: '#fee2e2', text: '#b91c1c' };
		case 'high':   return { bg: '#ffedd5', text: '#c2410c' };
		case 'medium': return { bg: '#dcfce7', text: '#15803d' };
		case 'low':    return { bg: '#f3f4f6', text: '#374151' };
		default:       return { bg: '#f3f4f6', text: '#374151' };
	}
}

function formatStatusLabel(status: string): string {
	return status.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatPriorityLabel(priority: string): string {
	return priority.charAt(0).toUpperCase() + priority.slice(1);
}

// ---------------------------------------------------------------------------
// Notification recipients helper
// ---------------------------------------------------------------------------

export type NotificationCategory = 'invoices' | 'tasks' | 'contracts';

/**
 * Returns all email addresses that should receive a notification for a given client + category.
 * Always includes the primary client.email, then any secondary emails with the matching toggle.
 */
export type NotificationRecipient = { email: string; name: string | null };

export async function getNotificationRecipients(
	clientId: string,
	category: NotificationCategory
): Promise<NotificationRecipient[]> {
	const [client] = await db
		.select({ email: table.client.email, name: table.client.name, legalRepresentative: table.client.legalRepresentative })
		.from(table.client)
		.where(eq(table.client.id, clientId))
		.limit(1);

	const recipients: NotificationRecipient[] = [];
	if (client?.email) {
		recipients.push({ email: client.email, name: client.legalRepresentative || client.name || null });
	}

	const columnMap = {
		invoices: table.clientSecondaryEmail.notifyInvoices,
		tasks: table.clientSecondaryEmail.notifyTasks,
		contracts: table.clientSecondaryEmail.notifyContracts
	} as const;

	const secondaryEmails = await db
		.select({ email: table.clientSecondaryEmail.email, label: table.clientSecondaryEmail.label })
		.from(table.clientSecondaryEmail)
		.where(
			and(
				eq(table.clientSecondaryEmail.clientId, clientId),
				eq(columnMap[category], true)
			)
		);

	for (const se of secondaryEmails) {
		if (se.email && !recipients.map((r) => r.email.toLowerCase()).includes(se.email.toLowerCase())) {
			recipients.push({ email: se.email, name: se.label || null });
		}
	}

	return recipients;
}

// Cache tenant-specific transporters with TTL and max size
interface CachedTransporter {
  transporter: nodemailer.Transporter;
  provider: 'gmail' | 'smtp' | 'default';
  gmailEmail?: string;
  cachedAt: number;
  lastUsedAt: number;
}

const TRANSPORTER_MAX_ENTRIES = 50;
const TRANSPORTER_TTL_MS = 30 * 60 * 1000; // 30 minutes

const tenantTransporters = new Map<string, CachedTransporter>();

// Evict idle entries every 5 minutes (uses lastUsedAt for idle-based eviction).
// Cache-hit path uses cachedAt for age-based eviction (forces credential refresh every 30 min).
// globalThis guard prevents accumulating timers on HMR reloads in dev.
const TRANSPORTER_CLEANUP_SYM = Symbol.for('ots_transporter_cleanup');
if (!(globalThis as Record<symbol, unknown>)[TRANSPORTER_CLEANUP_SYM]) {
	(globalThis as Record<symbol, unknown>)[TRANSPORTER_CLEANUP_SYM] = setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of tenantTransporters) {
			if (now - entry.lastUsedAt > TRANSPORTER_TTL_MS) {
				try { entry.transporter.close(); } catch { /* ignore */ }
				tenantTransporters.delete(key);
			}
		}
	}, 5 * 60 * 1000).unref();
}

/** Evict least-recently-used entry when cache is full */
function evictLruTransporter(): void {
	let oldest: { key: string; lastUsedAt: number } | null = null;
	for (const [key, entry] of tenantTransporters) {
		if (!oldest || entry.lastUsedAt < oldest.lastUsedAt) {
			oldest = { key, lastUsedAt: entry.lastUsedAt };
		}
	}
	if (oldest) {
		const evicted = tenantTransporters.get(oldest.key);
		if (evicted) {
			try { evicted.transporter.close(); } catch { /* ignore */ }
		}
		tenantTransporters.delete(oldest.key);
	}
}

/**
 * Get the Gmail 'from' email for a tenant, if Gmail is the active provider.
 */
export function getGmailFromEmail(tenantId: string): string | null {
  const cached = tenantTransporters.get(tenantId);
  if (cached) cached.lastUsedAt = Date.now();
  return cached?.provider === 'gmail' ? (cached.gmailEmail ?? null) : null;
}

let defaultTransporter: nodemailer.Transporter | null = null;

function getDefaultTransporter(): nodemailer.Transporter {
	if (defaultTransporter) {
		return defaultTransporter;
	}

	// Check if SMTP is configured
	if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
		logWarning('email', 'SMTP not configured, email sending disabled');
		// Create a test transporter that won't actually send emails
		defaultTransporter = nodemailer.createTransport({
			host: 'localhost',
			port: 1025,
			secure: false,
			auth: {
				user: 'test',
				pass: 'test'
			}
		});
		return defaultTransporter;
	}

	defaultTransporter = nodemailer.createTransport({
		host: env.SMTP_HOST,
		port: parseInt(env.SMTP_PORT || '587'),
		secure: env.SMTP_PORT === '465', // true for 465, false for other ports
		auth: {
			user: env.SMTP_USER,
			pass: env.SMTP_PASSWORD
		},
		tls: { rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' }
	});

	return defaultTransporter;
}

/**
 * Get tenant-specific transporter or fall back to environment variables
 */
export async function getTenantTransporter(
	tenantId: string,
	options?: { skipGmail?: boolean }
): Promise<nodemailer.Transporter | null> {
	// Check cache first (with TTL validation)
	const cached = tenantTransporters.get(tenantId);
	if (cached) {
		if (Date.now() - cached.cachedAt < TRANSPORTER_TTL_MS) {
			cached.lastUsedAt = Date.now();
			return cached.transporter;
		}
		// TTL expired -- evict and recreate
		try { cached.transporter.close(); } catch { /* ignore */ }
		tenantTransporters.delete(tenantId);
	}

	// Load email settings from database
	let emailSettings: typeof table.emailSettings.$inferSelect | undefined;
	try {
		const [settings] = await db
			.select()
			.from(table.emailSettings)
			.where(eq(table.emailSettings.tenantId, tenantId))
			.limit(1);

		emailSettings = settings;
	} catch (error) {
		logError('email', 'Failed to load email settings', { tenantId, stackTrace: serializeError(error).stack });
	}

	// If tenant has email settings configured, use them
	if (emailSettings) {
		// Try Gmail first if preferred — Gmail has its own auth, independent of SMTP isEnabled
		if (emailSettings.emailProvider === 'gmail' && !options?.skipGmail) {
			try {
				const gmailResult = await createGmailTransporter(tenantId);
				if (gmailResult) {
					const now = Date.now();
					if (tenantTransporters.size >= TRANSPORTER_MAX_ENTRIES) evictLruTransporter();
					const cached: CachedTransporter = {
						transporter: gmailResult.transporter,
						provider: 'gmail',
						gmailEmail: gmailResult.gmailEmail,
						cachedAt: now,
						lastUsedAt: now
					};
					tenantTransporters.set(tenantId, cached);
					logInfo('email', 'Using Gmail transporter (primary)', {
						tenantId,
						metadata: { email: gmailResult.gmailEmail }
					});
					return gmailResult.transporter;
				}
				logWarning('email', 'Gmail transporter unavailable — falling back to SMTP', { tenantId });
			} catch (error) {
				logWarning('email', 'Gmail transporter creation failed — falling back to SMTP', {
					tenantId,
					stackTrace: serializeError(error).stack
				});
			}
		}

		// SMTP fallback — check isEnabled (applies to SMTP only, not Gmail)
		if (!emailSettings.isEnabled) {
			logWarning('email', 'Tenant SMTP disabled, falling back to default', { tenantId });
		} else if (!emailSettings.smtpHost || !emailSettings.smtpUser || !emailSettings.smtpPassword) {
			logWarning('email', 'Tenant email settings incomplete, falling back to default', {
				tenantId,
				metadata: { hasHost: !!emailSettings.smtpHost, hasUser: !!emailSettings.smtpUser, hasPassword: !!emailSettings.smtpPassword }
			});
		} else {
			// Helper to decrypt + create transporter
			const tryCreateTransporter = (password: string) => {
				const decryptedPassword = decrypt(tenantId, password);
				const port = emailSettings!.smtpPort || 587;
				const secure = emailSettings!.smtpSecure || port === 465;
				return { transporter: nodemailer.createTransport({
					host: emailSettings!.smtpHost!,
					port,
					secure,
					auth: { user: emailSettings!.smtpUser!, pass: decryptedPassword },
					tls: { rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' }
				}), port };
			};

			try {
				const { transporter, port } = tryCreateTransporter(emailSettings.smtpPassword);
				if (tenantTransporters.size >= TRANSPORTER_MAX_ENTRIES) evictLruTransporter();
				const now = Date.now();
				tenantTransporters.set(tenantId, { transporter, provider: 'smtp', cachedAt: now, lastUsedAt: now });
				logInfo('email', 'Created tenant transporter', { tenantId, metadata: { host: emailSettings.smtpHost, port } });
				return transporter;
			} catch (error) {
				// Turso transient read can return truncated ciphertext — retry once with fresh DB read
				if (error instanceof DecryptionError) {
					logWarning('email', 'SMTP password decrypt failed — retrying with fresh DB read (possible Turso transient)', {
						tenantId,
						metadata: { action: 'decrypt_retry', attempt: 1 }
					});

					await new Promise(r => setTimeout(r, 2000));

					try {
						const [freshSettings] = await db
							.select()
							.from(table.emailSettings)
							.where(eq(table.emailSettings.tenantId, tenantId))
							.limit(1);

						if (freshSettings?.smtpPassword) {
							const { transporter, port } = tryCreateTransporter(freshSettings.smtpPassword);
							if (tenantTransporters.size >= TRANSPORTER_MAX_ENTRIES) evictLruTransporter();
							const now2 = Date.now();
							tenantTransporters.set(tenantId, { transporter, provider: 'smtp', cachedAt: now2, lastUsedAt: now2 });
							logInfo('email', 'SMTP decrypt retry succeeded', { tenantId, metadata: { host: freshSettings.smtpHost, port } });
							return transporter;
						}
					} catch (retryError) {
						logError('email', 'SMTP decrypt retry also failed — re-save SMTP password in Settings to fix.', {
							tenantId,
							metadata: { action: 'decrypt_retry_exhausted', retriesExhausted: true },
							stackTrace: serializeError(retryError).stack
						});
						return null;
					}
				}

				logError('email', 'Failed to create tenant transporter (password decryption may have failed). Re-save SMTP password in settings to fix.', { tenantId, stackTrace: serializeError(error).stack });
				return null;
			}
		}
	}

	// Fall back to environment variables (default transporter)
	logInfo('email', 'Falling back to default transporter', { tenantId });
	return getDefaultTransporter();
}

/**
 * Clear cached transporter for a tenant (call this when settings are updated)
 */
export function clearTenantTransporterCache(tenantId: string): void {
	const cached = tenantTransporters.get(tenantId);
	if (cached) {
		try { cached.transporter.close(); } catch { /* ignore */ }
		tenantTransporters.delete(tenantId);
	}
}

/**
 * Check if an SMTP error is retryable (transient) vs permanent
 */
function isRetryableSmtpError(error: Error): boolean {
	const msg = error.message || '';
	// Permanent 5xx failures (except 421, 450, 451, 452 which are transient)
	const permanentMatch = msg.match(/\b(5\d{2})\b/);
	if (permanentMatch) {
		const code = parseInt(permanentMatch[1]);
		// These are transient even though 4xx/5xx
		if ([421, 450, 451, 452].includes(code)) return true;
		// Other 5xx = permanent
		if (code >= 500) return false;
	}
	// Connection errors, timeouts, etc. are retryable
	return true;
}

/**
 * Send email with retry logic
 */
async function sendMailWithRetry(
	transporter: nodemailer.Transporter,
	mailOptions: nodemailer.SendMailOptions,
	tenantId: string | null,
	logId: string,
	maxAttempts = 3
): Promise<{ messageId?: string; response?: string }> {
	let lastError: Error | null = null;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			if (attempt > 1) {
				logInfo('email', `Retry attempt ${attempt}/${maxAttempts}`, { tenantId, metadata: { email: mailOptions.to as string } });
			}
			const info = await transporter.sendMail(mailOptions);
			return { messageId: info.messageId, response: info.response };
		} catch (error) {
			lastError = error as Error;
			logError('email', `Attempt ${attempt}/${maxAttempts} failed`, { tenantId, metadata: { email: mailOptions.to as string, error: lastError.message } });

			if (!isRetryableSmtpError(lastError)) {
				// Gmail OAuth error — fall back to SMTP instead of giving up
				if (tenantId && isGmailOAuthError(lastError)) {
					logWarning('email', 'Gmail OAuth error — attempting SMTP fallback', {
						tenantId,
						metadata: { error: lastError.message, attempt }
					});
					clearTenantTransporterCache(tenantId);
					// skipGmail: true prevents re-creating Gmail transporter (which would fail again)
					const fallbackTransporter = await getTenantTransporter(tenantId, { skipGmail: true });
					if (fallbackTransporter) {
						transporter = fallbackTransporter;
						continue;
					}
				}
				// Gmail rate limit — retry with backoff, don't fall back to SMTP
				if (tenantId && isGmailRateLimitError(lastError)) {
					logWarning('email', 'Gmail rate limit — retrying with backoff', {
						tenantId,
						metadata: { error: lastError.message, attempt }
					});
					if (attempt < maxAttempts) {
						const delay = attempt * 2000;
						await new Promise(resolve => setTimeout(resolve, delay));
						continue;
					}
				}
				logWarning('email', 'Permanent SMTP error, not retrying', { tenantId, metadata: { error: lastError.message } });
				break;
			}

			if (attempt < maxAttempts) {
				// Clear cached transporter and get fresh one
				if (tenantId) {
					clearTenantTransporterCache(tenantId);
					const freshTransporter = await getTenantTransporter(tenantId);
					if (!freshTransporter) {
						// Transporter became unavailable mid-retry (e.g. SMTP password rotated or
						// decryption now fails). Don't keep using the stale one — surface the failure.
						lastError = new Error(
							'Transporter SMTP indisponibil pe retry — decriptarea parolei SMTP a eșuat. Re-salvează parola SMTP în Setări.'
						);
						break;
					}
					transporter = freshTransporter;
				}
				await logEmailRetry(logId, attempt, lastError.message);
				// Exponential backoff: 1s, 3s
				const delay = attempt * 1000 + (attempt - 1) * 1000;
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}

	throw lastError || new Error('Email send failed after retries');
}

/**
 * @deprecated Use getTenantTransporter(tenantId) instead
 */
function getTransporter(): nodemailer.Transporter {
	return getDefaultTransporter();
}

// ---------------------------------------------------------------------------
// Email suppression — bounce/complaint tracking
// ---------------------------------------------------------------------------

type SuppressionReason = 'hard_bounce' | 'complaint' | 'manual';

async function isEmailSuppressed(
	email: string,
	tenantId: string | null
): Promise<{ reason: string } | null> {
	try {
		const normalizedEmail = email.toLowerCase();
		// Check global suppression (tenantId IS NULL) and tenant-specific
		const conditions = tenantId
			? or(
				and(eq(table.emailSuppression.email, normalizedEmail), eq(table.emailSuppression.tenantId, tenantId)),
				and(eq(table.emailSuppression.email, normalizedEmail), sql`${table.emailSuppression.tenantId} IS NULL`)
			)
			: and(eq(table.emailSuppression.email, normalizedEmail), sql`${table.emailSuppression.tenantId} IS NULL`);

		const [suppressed] = await db
			.select({ reason: table.emailSuppression.reason })
			.from(table.emailSuppression)
			.where(conditions!)
			.limit(1);

		return suppressed ?? null;
	} catch {
		// Don't block email send if suppression check fails
		return null;
	}
}

export async function suppressEmail(params: {
	email: string;
	tenantId: string | null;
	reason: SuppressionReason;
	smtpCode?: string;
	smtpMessage?: string;
	sourceEmailLogId?: string;
}): Promise<void> {
	const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	try {
		await db.insert(table.emailSuppression).values({
			id,
			tenantId: params.tenantId,
			email: params.email.toLowerCase(),
			reason: params.reason,
			smtpCode: params.smtpCode ?? null,
			smtpMessage: params.smtpMessage ?? null,
			sourceEmailLogId: params.sourceEmailLogId ?? null
		});
		logInfo('email', `Suppressed email: ${params.email} (${params.reason})`, {
			tenantId: params.tenantId ?? undefined
		});
	} catch {
		// Ignore duplicate suppression
	}
}

/**
 * HMAC-based unsubscribe token to prevent unauthorized email suppression.
 * Token = HMAC-SHA256(secret, email + tenantId)
 */
import { createHmac } from 'node:crypto';

function getUnsubscribeSecret(): string {
	return env.ENCRYPTION_KEY || env.SMTP_PASSWORD || 'ots-unsubscribe-fallback-key';
}

export function generateUnsubscribeToken(email: string, tenantId: string | null): string {
	const data = `${email.toLowerCase()}:${tenantId || ''}`;
	return createHmac('sha256', getUnsubscribeSecret()).update(data).digest('hex').substring(0, 32);
}

export function verifyUnsubscribeToken(email: string, tenantId: string | null, token: string): boolean {
	const expected = generateUnsubscribeToken(email, tenantId);
	return token === expected;
}

/**
 * Detect hard bounce from SMTP error and auto-suppress the recipient.
 */
function isHardBounce(error: Error): { code: string; message: string } | null {
	const msg = error.message || '';
	const match = msg.match(/\b(550|551|552|553|554)\b/);
	if (match) {
		return { code: match[1], message: msg.substring(0, 200) };
	}
	if (/mailbox.*not found|user.*unknown|address.*rejected|account.*disabled/i.test(msg)) {
		return { code: 'unknown', message: msg.substring(0, 200) };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Persistent send helper — DB-backed outbox pattern
// ---------------------------------------------------------------------------

type EmailType =
	| 'invitation'
	| 'invoice'
	| 'magic-link'
	| 'admin-magic-link'
	| 'password-reset'
	| 'task-assignment'
	| 'task-update'
	| 'task-reminder'
	| 'task-client-notification'
	| 'daily-reminder'
	| 'contract-signing'
	| 'invoice-paid'
	| 'invoice-overdue-reminder'
	| 'notification_alert'
	| 'report';

export type EmailSendContext = {
	tenantId: string | null;
	toEmail: string;
	subject: string;
	emailType: EmailType;
	metadata: Record<string, unknown>;
	htmlBody: string;
	payload: { sendFn: string; args: unknown[] } | null;
	/** When set, skip creating a new email_log row and reuse this existing log ID (for retries). */
	_retryOfLogId?: string;
};

/**
 * Send an email with full DB-backed persistence.
 *
 * Critical invariant: **log first, send later**. The previous architecture checked the
 * transporter before calling logEmailAttempt, so when SMTP password decryption failed
 * the email vanished completely (no DB row, nothing to retry). This helper guarantees
 * a row in `email_log` exists no matter what fails downstream.
 *
 * Failure modes captured by this helper:
 *   1. getTenantTransporter returns null (decryption failed / SMTP disabled) → status='failed'
 *   2. buildMail() throws (template/data error) → status='failed'
 *   3. SMTP transport error after retries → status='failed'
 *
 * On success → status='completed' with smtpMessageId/smtpResponse persisted.
 *
 * The optional `payload` field captures (sendFn, args) so the admin retry UI and the
 * background `email_retry` scheduler task can replay the original send call after the
 * underlying issue (e.g. SMTP password) is fixed.
 */
export async function sendWithPersistence(
	ctx: EmailSendContext,
	buildMail: () => Promise<nodemailer.SendMailOptions>
): Promise<void> {
	// STEP 1: Log BEFORE anything else can fail. Guarantees a DB row exists.
	// If this is a retry (via scheduler), reuse the existing log ID instead of creating a duplicate row.
	const retryLogId = ctx._retryOfLogId ?? getRetryLogId();
	const logId = retryLogId ?? await logEmailAttempt({
		tenantId: ctx.tenantId,
		toEmail: ctx.toEmail,
		subject: ctx.subject,
		emailType: ctx.emailType,
		metadata: ctx.metadata,
		htmlBody: ctx.htmlBody,
		payload: ctx.payload
	});

	// STEP 1b: Check email suppression (bounced/complained addresses)
	const suppressed = await isEmailSuppressed(ctx.toEmail, ctx.tenantId);
	if (suppressed) {
		const msg = `Email suppressed (${suppressed.reason}): ${ctx.toEmail}`;
		await logEmailFailure(logId, msg);
		logWarning('email', msg, { tenantId: ctx.tenantId ?? undefined });
		throw new Error(msg);
	}

	// STEP 2: Get transporter. If null (decryption failed / SMTP disabled), mark failed.
	const transporter = ctx.tenantId
		? await getTenantTransporter(ctx.tenantId)
		: getDefaultTransporter();
	if (!transporter) {
		const msg =
			'Transporter SMTP indisponibil — decriptarea parolei SMTP a eșuat sau SMTP e dezactivat. Re-salvează parola SMTP în Setări.';
		await logEmailFailure(logId, msg);
		logError('email', msg, { tenantId: ctx.tenantId ?? undefined });
		throw new Error(msg);
	}

	// STEP 3: Build mail options (may throw if template building fails).
	let mailOptions: nodemailer.SendMailOptions;
	try {
		mailOptions = await buildMail();
	} catch (err) {
		const msg = `Eroare la construirea emailului: ${(err as Error).message}`;
		await logEmailFailure(logId, msg);
		logError('email', msg, {
			tenantId: ctx.tenantId ?? undefined,
			stackTrace: serializeError(err).stack
		});
		throw err;
	}

	// Override 'from' when using Gmail — Gmail OAuth2 enforces from = authenticated email
	const gmailFrom = ctx.tenantId ? getGmailFromEmail(ctx.tenantId) : null;
	if (gmailFrom && mailOptions.from) {
		const fromStr = String(mailOptions.from);
		const nameMatch = fromStr.match(/^"?([^"<]+)"?\s*</);
		mailOptions.from = nameMatch
			? `"${nameMatch[1].trim()}" <${gmailFrom}>`
			: gmailFrom;
	}

	// STEP 3a: Add RFC 8058 List-Unsubscribe headers for non-transactional emails.
	// Required by Gmail/Yahoo since Feb 2024 for bulk/notification-style mail.
	const TRANSACTIONAL_TYPES: EmailType[] = [
		'magic-link', 'admin-magic-link', 'password-reset',
		'invitation', 'invoice', 'invoice-paid', 'contract-signing'
	];
	if (!TRANSACTIONAL_TYPES.includes(ctx.emailType)) {
		const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';
		const token = generateUnsubscribeToken(ctx.toEmail, ctx.tenantId);
		const params = new URLSearchParams({
			email: ctx.toEmail,
			token,
			...(ctx.tenantId ? { tenantId: ctx.tenantId } : {})
		});
		const unsubUrl = `${baseUrl}/api/unsubscribe?${params.toString()}`;
		mailOptions.headers = {
			...mailOptions.headers,
			'List-Unsubscribe': `<${unsubUrl}>`,
			'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
		};
	}

	// STEP 3b: Persist HTML body for preview if not already saved.
	// Skip for sensitive email types that contain auth tokens in their HTML.
	const SENSITIVE_EMAIL_TYPES: EmailType[] = ['magic-link', 'admin-magic-link', 'password-reset'];
	const isSensitive = SENSITIVE_EMAIL_TYPES.includes(ctx.emailType);
	if (!isSensitive && !ctx.htmlBody && typeof mailOptions.html === 'string' && mailOptions.html) {
		try {
			await db
				.update(table.emailLog)
				.set({ htmlBody: mailOptions.html, updatedAt: new Date() })
				.where(eq(table.emailLog.id, logId));
		} catch (err) {
			logWarning('email', `Failed to update htmlBody for ${logId}: ${(err as Error).message}`);
		}
	}

	// STEP 4: Mark processing, send with retry, record outcome.
	try {
		await logEmailProcessing(logId);
		const info = await sendMailWithRetry(transporter, mailOptions, ctx.tenantId, logId);
		await logEmailSuccess(logId, info);
		logInfo('email', `Sent ${ctx.emailType}`, {
			tenantId: ctx.tenantId ?? undefined,
			metadata: { email: ctx.toEmail }
		});
	} catch (err) {
		await logEmailFailure(logId, (err as Error).message);
		logError('email', `Failed to send ${ctx.emailType}`, {
			tenantId: ctx.tenantId ?? undefined,
			stackTrace: serializeError(err).stack
		});

		// Auto-suppress on hard bounce (prevents retrying to invalid addresses)
		const bounce = isHardBounce(err as Error);
		if (bounce) {
			await suppressEmail({
				email: ctx.toEmail,
				tenantId: ctx.tenantId,
				reason: 'hard_bounce',
				smtpCode: bounce.code,
				smtpMessage: bounce.message,
				sourceEmailLogId: logId
			});
		}

		// Notify admins about email delivery failure
		if (ctx.tenantId) {
			try {
				const admins = await db
					.select({ userId: table.tenantUser.userId })
					.from(table.tenantUser)
					.where(
						and(
							eq(table.tenantUser.tenantId, ctx.tenantId),
							eq(table.tenantUser.role, 'owner')
						)
					);
				for (const admin of admins) {
					await createNotification({
						tenantId: ctx.tenantId,
						userId: admin.userId,
						type: 'email.delivery_failed',
						title: 'Email netrimis',
						message: `Email ${ctx.emailType} catre ${ctx.toEmail} a esuat: ${(err as Error).message?.substring(0, 100)}`,
						priority: 'high',
					}).catch((notifErr) => {
						logWarning('email', `Failed to notify admin about email failure: ${(notifErr as Error).message}`, {
							tenantId: ctx.tenantId ?? undefined
						});
					});
				}
			} catch (notifyErr) {
				// Don't let notification failure mask the original error, but log it
				logWarning('email', `Failed to notify admins about email failure: ${(notifyErr as Error).message}`, {
					tenantId: ctx.tenantId ?? undefined
				});
			}
		}

		throw err;
	}
}

export async function sendInvitationEmail(
	email: string,
	invitationToken: string,
	tenantName: string,
	inviterName: string,
	tenantId: string
): Promise<void> {
	const safeTenantName = escapeHtml(tenantName);
	const safeInviterName = escapeHtml(inviterName);
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';
	const invitationUrl = `${baseUrl}/invite/${invitationToken}`;
	const subject = `Invitație de alăturare la ${tenantName}`;

	await sendWithPersistence(
		{
			tenantId,
			toEmail: email,
			subject,
			emailType: 'invitation',
			metadata: { invitationToken, tenantName, inviterName },
			htmlBody: '',
			payload: {
				sendFn: 'sendInvitationEmail',
				args: [email, invitationToken, tenantName, inviterName, tenantId]
			}
		},
		async () => {
			const brand = await fetchTenantBrand(tenantId);
			const [emailSettings] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, tenantId))
				.limit(1);
			const fromEmail = resolveFromEmail(emailSettings);

			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua,</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;"><strong>${safeInviterName}</strong> v-a invitat să vă alăturați echipei <strong>${safeTenantName}</strong> pe platforma CRM.</p>
				${renderCtaButton(invitationUrl, 'Acceptă invitația', brand.themeColor)}
				<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 4px 0;">Sau copiați acest link în browser:</p>
				<p style="color: ${brand.themeColor}; font-size: 13px; line-height: 1.6; margin: 0 0 20px 0; word-break: break-all;">${invitationUrl}</p>
				<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0 0 6px 0;">Această invitație expiră în 7 zile.</p>
				<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0 0 18px 0;">Dacă nu ați așteptat această invitație, puteți ignora acest email.</p>
			`;

			const html = renderBrandedEmail({
				themeColor: brand.themeColor,
				headerLogoHtml: brand.headerLogoHtml,
				title: 'Invitație nouă',
				bodyHtml,
				previewTitle: `Invitație — ${safeTenantName}`
			});

			return {
				from: `"${brand.tenantName}" <${fromEmail}>`,
				to: email,
				subject,
				html,
				...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {}),
				text: trimPlainText(`
			Invitatie noua

			${inviterName} v-a invitat sa va alaturati echipei ${tenantName} pe platforma CRM.

			Acceptati invitatia accesand acest link:
			${invitationUrl}

			Aceasta invitatie expira in 7 zile.

			Daca nu ati asteptat aceasta invitatie, puteti ignora acest email.
		`)
			};
		}
	);
}

/**
 * Send invoice email to client
 */
export async function sendInvoiceEmail(invoiceId: string, clientEmail: string): Promise<void> {
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get invoice details (needed up-front for tenantId & subject)
	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.limit(1);

	if (!invoice) {
		throw new Error('Invoice not found');
	}

	await sendWithPersistence(
		{
			tenantId: invoice.tenantId,
			toEmail: clientEmail,
			subject: `Factura ${invoice.invoiceNumber}`,
			emailType: 'invoice',
			metadata: { invoiceId, invoiceNumber: invoice.invoiceNumber },
			htmlBody: '',
			payload: {
				sendFn: 'sendInvoiceEmail',
				args: [invoiceId, clientEmail]
			}
		},
		async () => {
			// Get client details
			const [client] = await db
				.select()
				.from(table.client)
				.where(eq(table.client.id, invoice.clientId))
				.limit(1);

			// Get tenant details
			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.id, invoice.tenantId))
				.limit(1);

			// Get tenant email settings to determine from email
			const [emailSettings] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, invoice.tenantId))
				.limit(1);

			const fromEmail = resolveFromEmail(emailSettings);
			const tenantName = escapeHtml(tenant?.name || 'CRM');
			const clientDisplayName = escapeHtml(client?.name || 'Client');
			const themeColor = normalizeThemeColor(tenant?.themeColor);

			// Generate public view token and URL (accessible without authentication)
			const rawToken = await createInvoiceViewToken(invoiceId, invoice.tenantId);
			const invoiceUrl = `${baseUrl}/invoice/${tenant?.slug || 'tenant'}/${encodeURIComponent(rawToken)}`;

			// Get invoice settings for logo and PDF
			const [invoiceSettings] = await db
				.select()
				.from(table.invoiceSettings)
				.where(eq(table.invoiceSettings.tenantId, invoice.tenantId))
				.limit(1);

			const { logoAttachment } = prepareLogoAttachment(invoiceSettings?.invoiceLogo);
			const headerLogoHtml = buildHeaderLogoHtml(logoAttachment);

			// Generate PDF attachment
			const lineItems = await db
				.select()
				.from(table.invoiceLineItem)
				.where(eq(table.invoiceLineItem.invoiceId, invoiceId));

			const displayInvoiceNumber = formatInvoiceNumberDisplay(invoice, invoiceSettings);

			let pdfAttachment: { filename: string; content: Buffer; contentType: string } | undefined;
			try {
				const pdfBuffer = await generateInvoicePDF({
					invoice,
					lineItems,
					tenant: tenant!,
					client: client!,
					displayInvoiceNumber,
					invoiceLogo: invoiceSettings?.invoiceLogo || null
				});
				const safeFilename = `Factura-${displayInvoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
				pdfAttachment = { filename: safeFilename, content: pdfBuffer, contentType: 'application/pdf' };
			} catch (pdfError) {
				logWarning('email', 'Could not generate PDF attachment for invoice email', {
					tenantId: invoice.tenantId,
					metadata: { invoiceId, error: (pdfError as Error).message }
				});
			}

			// Format amounts
			const formatAmount = (cents: number | null | undefined, currency: string) => {
				if (cents === null || cents === undefined) return 'N/A';
				const amount = (cents / 100).toFixed(2);
				return `${amount} ${currency}`;
			};

			// IBAN payment details
			const ibanHtml = tenant?.iban
				? `<div style="background-color: #f9fafb; border-left: 3px solid ${themeColor}; padding: 14px 16px; border-radius: 6px; margin: 0 0 20px 0;">
				<p style="color: #111827; font-weight: 600; font-size: 14px; margin: 0 0 6px 0;">Date pentru plată</p>
				${tenant.bankName ? `<p style="color: #374151; font-size: 13px; margin: 2px 0;"><span style="color: #6b7280;">Banca</span> &nbsp;·&nbsp; ${escapeHtml(tenant.bankName)}</p>` : ''}
				<p style="color: #374151; font-size: 13px; margin: 2px 0;"><span style="color: #6b7280;">IBAN (LEI)</span> &nbsp;·&nbsp; ${escapeHtml(tenant.iban)}</p>
				${tenant.ibanEuro ? `<p style="color: #374151; font-size: 13px; margin: 2px 0;"><span style="color: #6b7280;">IBAN (EUR)</span> &nbsp;·&nbsp; ${escapeHtml(tenant.ibanEuro)}</p>` : ''}
			</div>`
				: '';

			const ibanText = tenant?.iban
				? `\n\t\t\tDate pentru plata:${tenant.bankName ? `\n\t\t\tBanca: ${tenant.bankName}` : ''}\n\t\t\tIBAN (LEI): ${tenant.iban}${tenant.ibanEuro ? `\n\t\t\tIBAN (EUR): ${tenant.ibanEuro}` : ''}\n`
				: '';

			const attachments = [
				...(pdfAttachment ? [pdfAttachment] : []),
				...(logoAttachment ? [logoAttachment] : [])
			];

			const statusRow =
				invoice.status === 'paid'
					? `<div><span style="color: #6b7280;">Status</span> &nbsp;·&nbsp; <strong style="color: #15803d;">Achitată</strong></div>`
					: invoice.status === 'partially_paid' && invoice.remainingAmount
						? `<div><span style="color: #6b7280;">Status</span> &nbsp;·&nbsp; <strong style="color: #d97706;">Achitată parțial</strong> — sold restant ${formatAmount(invoice.remainingAmount, invoice.currency)}</div>`
						: '';

			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Stimate/Stimată ${clientDisplayName},</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Vă transmitem factura de la <strong>${tenantName}</strong>.</p>
				<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
					<tr>
						<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
							<div><span style="color: #6b7280;">Număr factură</span> &nbsp;·&nbsp; <strong>${invoice.invoiceNumber}</strong></div>
							${invoice.issueDate ? `<div><span style="color: #6b7280;">Data emitere</span> &nbsp;·&nbsp; <strong>${formatDateRo(invoice.issueDate)}</strong></div>` : ''}
							${invoice.dueDate ? `<div><span style="color: #6b7280;">Scadență</span> &nbsp;·&nbsp; <strong>${formatDateRo(invoice.dueDate)}</strong></div>` : ''}
							<div><span style="color: #6b7280;">Total de plată</span> &nbsp;·&nbsp; <strong>${formatAmount(invoice.totalAmount, invoice.currency)}</strong></div>
							${statusRow}
						</td>
					</tr>
				</table>
				${ibanHtml}
				${pdfAttachment ? '<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 12px 0;">📎 Factura este atașată în format PDF la acest email.</p>' : ''}
				${renderCtaButton(invoiceUrl, 'Vezi factura online', themeColor)}
				${invoice.dueDate && invoice.status !== 'paid' && invoice.status !== 'partially_paid' ? `<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 8px 0;">Plata este scadentă la ${formatDateRo(invoice.dueDate)}.</p>` : ''}
			`;

			return {
				from: `"${tenantName}" <${fromEmail}>`,
				to: clientEmail,
				subject: `Factura ${invoice.invoiceNumber} de la ${tenantName}`,
				...(attachments.length > 0 ? { attachments } : {}),
				html: renderBrandedEmail({
					themeColor,
					headerLogoHtml,
					title: `Factura ${invoice.invoiceNumber}`,
					bodyHtml,
					previewTitle: `Factura ${invoice.invoiceNumber}`
				}),
				text: trimPlainText(`
			Factura ${invoice.invoiceNumber}

			Stimate/Stimata ${client?.name || 'Client'},

			Va transmitem factura de la ${tenantName}.

			Numar factura: ${invoice.invoiceNumber}
			${invoice.issueDate ? `Data emitere: ${formatDateRo(invoice.issueDate)}\n` : ''}
			${invoice.dueDate ? `Data scadenta: ${formatDateRo(invoice.dueDate)}\n` : ''}
			Total de plata: ${formatAmount(invoice.totalAmount, invoice.currency)}
			${ibanText}
			Vezi factura: ${invoiceUrl}

			${invoice.dueDate && invoice.status !== 'paid' && invoice.status !== 'partially_paid' ? `Plata este scadenta la ${formatDateRo(invoice.dueDate)}.\n` : ''}

			Pentru intrebari, nu ezitati sa ne contactati.
		`)
			};
		}
	);
}

/**
 * Send magic link email to client
 */
export async function sendMagicLinkEmail(
	email: string,
	token: string,
	tenantSlug: string,
	clientName: string
): Promise<void> {
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get tenant by slug
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);

	if (!tenant) {
		throw new Error('Tenant not found');
	}

	const tenantName = escapeHtml(tenant.name || 'CRM');
	clientName = escapeHtml(clientName);
	const loginUrl = `${baseUrl}/client/${tenantSlug}/verify?token=${encodeURIComponent(token)}`;

	await sendWithPersistence(
		{
			tenantId: tenant.id,
			toEmail: email,
			subject: `Autentificare ${tenantName} - Portal Client`,
			emailType: 'magic-link',
			metadata: { tenantSlug, clientName },
			htmlBody: '',
			// SECURITY: payload intentionally null — token is single-use and must not
			// be persisted in email_log (plaintext leak risk). Not retriable by design.
			payload: null
		},
		async () => {
			const brand = await fetchTenantBrand(tenant.id);
			const [emailSettings] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, tenant.id))
				.limit(1);
			const fromEmail = resolveFromEmail(emailSettings);

			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua ${clientName},</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Ați solicitat acces la portalul client pentru <strong>${tenantName}</strong>.</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 4px 0;">Apăsați butonul de mai jos pentru autentificare. Linkul expiră în 24 de ore.</p>
				${renderCtaButton(loginUrl, 'Intră în portalul client', brand.themeColor)}
				<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 4px 0;">Sau copiați acest link în browser:</p>
				<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0 0 18px 0; word-break: break-all;">${loginUrl}</p>
				<div style="background-color: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 14px; border-radius: 6px; margin: 0 0 20px 0;">
					<p style="color: #92400e; font-size: 13px; line-height: 1.5; margin: 0;"><strong>Securitate</strong> · Linkul este valabil 24 de ore și poate fi folosit o singură dată. Dacă nu ați solicitat acest email, ignorați-l.</p>
				</div>
			`;

			return {
				from: `"${tenantName}" <${fromEmail}>`,
				to: email,
				subject: `Autentificare ${tenantName} - Portal Client`,
				...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {}),
				html: renderBrandedEmail({
					themeColor: brand.themeColor,
					headerLogoHtml: brand.headerLogoHtml,
					title: `Autentificare în ${tenantName}`,
					bodyHtml,
					previewTitle: `Autentificare ${tenantName}`
				}),
				text: trimPlainText(`
			Autentificare ${tenantName}

			Buna ziua ${clientName},

			Ati solicitat acces la portalul client pentru ${tenantName}.

			Accesati acest link pentru autentificare (valabil 24h, o singura utilizare):
			${loginUrl}

			Daca nu ati solicitat acest email, ignorati-l.
		`)
			};
		}
	);
}

/**
 * Send admin magic link email
 */
export async function sendAdminMagicLinkEmail(
	email: string,
	token: string,
	userName: string,
	userTenantId?: string | null
): Promise<void> {
	userName = escapeHtml(userName);
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';
	const appName = 'CRM Admin';
	const loginUrl = `${baseUrl}/login/verify?token=${encodeURIComponent(token)}`;

	await sendWithPersistence(
		{
			tenantId: userTenantId ?? null,
			toEmail: email,
			subject: `Autentificare ${appName}`,
			emailType: 'admin-magic-link',
			metadata: { userName },
			htmlBody: '',
			// SECURITY: payload intentionally null — token is single-use and must not
			// be persisted in email_log (plaintext leak risk). Not retriable by design.
			payload: null
		},
		async () => {
			const fromEmail = resolveFromEmail();
			const themeColor = DEFAULT_THEME_COLOR;
			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua ${userName},</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 4px 0;">Ați solicitat un link de autentificare pentru contul de administrator. Linkul expiră în 24 de ore.</p>
				${renderCtaButton(loginUrl, 'Intră în panoul admin', themeColor)}
				<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 4px 0;">Sau copiați acest link în browser:</p>
				<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0 0 18px 0; word-break: break-all;">${loginUrl}</p>
				<div style="background-color: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 14px; border-radius: 6px; margin: 0 0 20px 0;">
					<p style="color: #92400e; font-size: 13px; line-height: 1.5; margin: 0;"><strong>Securitate</strong> · Linkul este valabil 24 de ore și poate fi folosit o singură dată. Dacă nu ați solicitat acest email, ignorați-l.</p>
				</div>
			`;
			return {
				from: `"${appName}" <${fromEmail}>`,
				to: email,
				subject: `Autentificare ${appName}`,
				html: renderBrandedEmail({
					themeColor,
					headerLogoHtml: '',
					title: `Autentificare ${appName}`,
					bodyHtml,
					previewTitle: `Autentificare ${appName}`
				}),
				text: trimPlainText(`
			Autentificare ${appName}

			Buna ziua ${userName},

			Ati solicitat un link de autentificare (valabil 24h, o singura utilizare):
			${loginUrl}

			Daca nu ati solicitat acest email, ignorati-l.
		`)
			};
		}
	);
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
	email: string,
	token: string,
	userName: string,
	userTenantId?: string | null
): Promise<void> {
	userName = escapeHtml(userName);
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';
	const appName = 'CRM Admin';
	const resetUrl = `${baseUrl}/login/reset-password/${encodeURIComponent(token)}`;

	await sendWithPersistence(
		{
			tenantId: userTenantId ?? null,
			toEmail: email,
			subject: `Resetare parola - ${appName}`,
			emailType: 'password-reset',
			metadata: { userName },
			htmlBody: '',
			// SECURITY: payload intentionally null — token is single-use and must not
			// be persisted in email_log (plaintext leak risk). Not retriable by design.
			payload: null
		},
		async () => {
			const fromEmail = resolveFromEmail();
			const themeColor = DEFAULT_THEME_COLOR;
			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua ${userName},</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 4px 0;">Ați solicitat resetarea parolei pentru contul de administrator. Linkul expiră în 1 oră.</p>
				${renderCtaButton(resetUrl, 'Resetează parola', themeColor)}
				<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 4px 0;">Sau copiați acest link în browser:</p>
				<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0 0 18px 0; word-break: break-all;">${resetUrl}</p>
				<div style="background-color: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 14px; border-radius: 6px; margin: 0 0 20px 0;">
					<p style="color: #92400e; font-size: 13px; line-height: 1.5; margin: 0;"><strong>Securitate</strong> · Linkul este valabil 1 oră și poate fi folosit o singură dată. Dacă nu ați solicitat această resetare, ignorați emailul — parola rămâne neschimbată.</p>
				</div>
			`;
			return {
				from: `"${appName}" <${fromEmail}>`,
				to: email,
				subject: `Resetare parola - ${appName}`,
				html: renderBrandedEmail({
					themeColor,
					headerLogoHtml: '',
					title: 'Resetare parolă',
					bodyHtml,
					previewTitle: `Resetare parolă - ${appName}`
				}),
				text: trimPlainText(`
			Resetare parola - ${appName}

			Buna ziua ${userName},

			Ati solicitat resetarea parolei. Folositi linkul de mai jos (valabil 1h, o singura utilizare):
			${resetUrl}

			Daca nu ati solicitat aceasta resetare, ignorati emailul.
		`)
			};
		}
	);
}

/**
 * Send task assignment email
 */
export async function sendTaskAssignmentEmail(
	taskId: string,
	assigneeEmail: string,
	assigneeName?: string
): Promise<void> {
	if (assigneeName) assigneeName = escapeHtml(assigneeName);
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get task details (needed up-front for tenantId & subject)
	const [task] = await db.select().from(table.task).where(eq(table.task.id, taskId)).limit(1);

	if (!task) {
		throw new Error('Task not found');
	}

	await sendWithPersistence(
		{
			tenantId: task.tenantId,
			toEmail: assigneeEmail,
			subject: `Task nou atribuit: ${task.title}`,
			emailType: 'task-assignment',
			metadata: { taskId, taskTitle: task.title },
			htmlBody: '',
			payload: {
				sendFn: 'sendTaskAssignmentEmail',
				args: [taskId, assigneeEmail, assigneeName]
			}
		},
		async () => {
			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.id, task.tenantId))
				.limit(1);

			const [emailSettings] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, task.tenantId))
				.limit(1);

			const [invoiceSettings] = await db
				.select()
				.from(table.invoiceSettings)
				.where(eq(table.invoiceSettings.tenantId, task.tenantId))
				.limit(1);
			const { logoAttachment: assignLogoAttachment } =
				prepareLogoAttachment(invoiceSettings?.invoiceLogo);
			const assignHeaderLogoHtml = buildHeaderLogoHtml(assignLogoAttachment);

			const fromEmail = resolveFromEmail(emailSettings);
			const tenantName = tenant?.name || 'CRM';
			const themeColor = normalizeThemeColor(tenant?.themeColor);
			const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${taskId}`;

			const assignStatusColors = getEmailStatusColors(task.status);
			const assignPriorityColors = getEmailPriorityColors(task.priority);
			const assignStatusLabel = formatStatusLabel(task.status || 'todo');
			const assignPriorityLabel = formatPriorityLabel(task.priority || 'medium');
			const assignBadgeStyle =
				'display:inline-block; padding:3px 12px; border-radius:9999px; font-size:13px; font-weight:600;';
			const assignDotStyle = (color: string) =>
				`display:inline-block; width:8px; height:8px; border-radius:50%; background:${color}; margin-right:6px; vertical-align:middle;`;
			const assignStatusBadge = `<span style="${assignBadgeStyle} background:${assignStatusColors.bg}; color:${assignStatusColors.text};"><span style="${assignDotStyle(assignStatusColors.dot)}"></span>${assignStatusLabel}</span>`;
			const assignPriorityBadge = `<span style="${assignBadgeStyle} background:${assignPriorityColors.bg}; color:${assignPriorityColors.text};">${assignPriorityLabel}</span>`;

			const safeAssignee = escapeHtml(assigneeName || '');
			const safeTitle = escapeHtml(task.title);
			const safeDesc = task.description ? escapeHtml(task.description) : '';

			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua${safeAssignee ? ` ${safeAssignee}` : ''},</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Ți-a fost atribuit un task nou:</p>
				<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
					<tr>
						<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
							<div style="font-weight: 600; color: #111827; font-size: 15px; margin-bottom: 8px;">${safeTitle}</div>
							${safeDesc ? `<div style="color: #6b7280; font-size: 13px; margin-bottom: 12px;">${safeDesc}</div>` : ''}
							<div><span style="color: #6b7280;">Prioritate</span> &nbsp;·&nbsp; ${assignPriorityBadge}</div>
							<div style="margin-top: 6px;"><span style="color: #6b7280;">Status</span> &nbsp;·&nbsp; ${assignStatusBadge}</div>
							${task.dueDate ? `<div style="margin-top: 6px;"><span style="color: #6b7280;">Termen</span> &nbsp;·&nbsp; <strong>${formatDateRo(task.dueDate)}</strong></div>` : ''}
						</td>
					</tr>
				</table>
				${renderCtaButton(taskUrl, 'Vezi task-ul', themeColor)}
			`;

			return {
				from: `"${tenantName}" <${fromEmail}>`,
				to: assigneeEmail,
				subject: `Task nou atribuit: ${task.title}`,
				...(assignLogoAttachment ? { attachments: [assignLogoAttachment] } : {}),
				html: renderBrandedEmail({
					themeColor,
					headerLogoHtml: assignHeaderLogoHtml,
					title: 'Task nou atribuit',
					bodyHtml,
					previewTitle: `Task: ${task.title}`,
					footerHtml: `Trimis automat de ${escapeHtml(tenantName)}.`
				}),
				text: trimPlainText(`
			Task nou atribuit

			Buna ziua${assigneeName ? ` ${assigneeName}` : ''},

			Ti-a fost atribuit un task nou:

			${task.title}
			${task.description ? `\n${task.description}\n` : ''}
			Prioritate: ${task.priority || 'Medium'}
			Status: ${task.status || 'Todo'}
			${task.dueDate ? `Termen: ${formatDateRo(task.dueDate)}\n` : ''}

			Vezi task: ${taskUrl}
		`)
			};
		}
	);
}

/**
 * Send task update email to watchers
 */
export async function sendTaskUpdateEmail(
	taskId: string,
	watcherEmail: string,
	watcherName?: string,
	changeType?: string
): Promise<void> {
	if (watcherName) watcherName = escapeHtml(watcherName);
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	const [task] = await db.select().from(table.task).where(eq(table.task.id, taskId)).limit(1);

	if (!task) {
		throw new Error('Task not found');
	}

	await sendWithPersistence(
		{
			tenantId: task.tenantId,
			toEmail: watcherEmail,
			subject: `Task actualizat: ${task.title}`,
			emailType: 'task-update',
			metadata: { taskId, taskTitle: task.title, changeType },
			htmlBody: '',
			payload: {
				sendFn: 'sendTaskUpdateEmail',
				args: [taskId, watcherEmail, watcherName, changeType]
			}
		},
		async () => {
			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.id, task.tenantId))
				.limit(1);

			const [emailSettings] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, task.tenantId))
				.limit(1);

			const [updInvoiceSettings] = await db
				.select()
				.from(table.invoiceSettings)
				.where(eq(table.invoiceSettings.tenantId, task.tenantId))
				.limit(1);
			const { logoAttachment: updLogoAttachment } =
				prepareLogoAttachment(updInvoiceSettings?.invoiceLogo);
			const updHeaderLogoHtml = buildHeaderLogoHtml(updLogoAttachment);

			const fromEmail = resolveFromEmail(emailSettings);
			const tenantName = tenant?.name || 'CRM';
			const themeColor = normalizeThemeColor(tenant?.themeColor);
			const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${taskId}`;

			const changeDescription =
				changeType === 'status'
					? 'statusul a fost actualizat'
					: changeType === 'assigned'
						? 'atribuirea a fost modificată'
						: changeType === 'dueDate'
							? 'termenul a fost actualizat'
							: 'taskul a fost modificat';

			const updStatusColors = getEmailStatusColors(task.status);
			const updPriorityColors = getEmailPriorityColors(task.priority);
			const updStatusLabel = formatStatusLabel(task.status || 'todo');
			const updPriorityLabel = formatPriorityLabel(task.priority || 'medium');
			const updBadgeStyle =
				'display:inline-block; padding:3px 12px; border-radius:9999px; font-size:13px; font-weight:600;';
			const updDotStyle = (color: string) =>
				`display:inline-block; width:8px; height:8px; border-radius:50%; background:${color}; margin-right:6px; vertical-align:middle;`;
			const updStatusBadge = `<span style="${updBadgeStyle} background:${updStatusColors.bg}; color:${updStatusColors.text};"><span style="${updDotStyle(updStatusColors.dot)}"></span>${updStatusLabel}</span>`;
			const updPriorityBadge = `<span style="${updBadgeStyle} background:${updPriorityColors.bg}; color:${updPriorityColors.text};">${updPriorityLabel}</span>`;

			const safeWatcher = escapeHtml(watcherName || '');
			const safeTitle = escapeHtml(task.title);
			const safeDesc = task.description ? escapeHtml(task.description) : '';

			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua${safeWatcher ? ` ${safeWatcher}` : ''},</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Un task pe care îl urmăriți a fost actualizat — <em>${changeDescription}</em>.</p>
				<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
					<tr>
						<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
							<div style="font-weight: 600; color: #111827; font-size: 15px; margin-bottom: 8px;">${safeTitle}</div>
							${safeDesc ? `<div style="color: #6b7280; font-size: 13px; margin-bottom: 12px;">${safeDesc}</div>` : ''}
							<div><span style="color: #6b7280;">Prioritate</span> &nbsp;·&nbsp; ${updPriorityBadge}</div>
							<div style="margin-top: 6px;"><span style="color: #6b7280;">Status</span> &nbsp;·&nbsp; ${updStatusBadge}</div>
							${task.dueDate ? `<div style="margin-top: 6px;"><span style="color: #6b7280;">Termen</span> &nbsp;·&nbsp; <strong>${formatDateRo(task.dueDate)}</strong></div>` : ''}
						</td>
					</tr>
				</table>
				${renderCtaButton(taskUrl, 'Vezi task-ul', themeColor)}
			`;

			return {
				from: `"${tenantName}" <${fromEmail}>`,
				to: watcherEmail,
				subject: `Task actualizat: ${task.title}`,
				...(updLogoAttachment ? { attachments: [updLogoAttachment] } : {}),
				html: renderBrandedEmail({
					themeColor,
					headerLogoHtml: updHeaderLogoHtml,
					title: 'Task actualizat',
					bodyHtml,
					previewTitle: `Task actualizat: ${task.title}`,
					footerHtml: `Trimis automat de ${escapeHtml(tenantName)}.`
				}),
				text: trimPlainText(`
			Task actualizat

			Buna ziua${watcherName ? ` ${watcherName}` : ''},

			Un task pe care il urmariti a fost actualizat (${changeDescription}):

			${task.title}
			${task.description ? `\n${task.description}\n` : ''}
			Prioritate: ${task.priority || 'Medium'}
			Status: ${task.status || 'Todo'}
			${task.dueDate ? `Termen: ${formatDateRo(task.dueDate)}\n` : ''}

			Vezi task: ${taskUrl}
		`)
			};
		}
	);
}

/**
 * Send task notification email to client
 */
export async function sendTaskClientNotificationEmail(
	taskId: string,
	clientEmail: string,
	clientName: string | null,
	notificationType: 'created' | 'status-change' | 'comment' | 'modified',
	extra?: { newStatus?: string; commentPreview?: string; changedFields?: string }
): Promise<void> {
	if (clientName) clientName = escapeHtml(clientName);
	if (extra?.commentPreview) extra.commentPreview = escapeHtml(extra.commentPreview);
	if (extra?.changedFields) extra.changedFields = escapeHtml(extra.changedFields);
	// Extract first name for a more personal greeting
	const greeting = clientName?.split(' ')[0] || 'ziua';
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	const [task] = await db.select().from(table.task).where(eq(table.task.id, taskId)).limit(1);
	if (!task) {
		throw new Error('Task not found');
	}

	// Pre-compute the log subject (one of 4 forms based on notificationType)
	let logSubject: string;
	switch (notificationType) {
		case 'created':
			logSubject = `Task nou: ${task.title}`;
			break;
		case 'status-change':
			logSubject = `Task actualizat: ${task.title}`;
			break;
		case 'comment':
			logSubject = `Comentariu nou pe task: ${task.title}`;
			break;
		case 'modified':
			logSubject = `Task modificat: ${task.title}`;
			break;
	}

	await sendWithPersistence(
		{
			tenantId: task.tenantId,
			toEmail: clientEmail,
			subject: logSubject,
			emailType: 'task-client-notification',
			metadata: { taskId, taskTitle: task.title, notificationType, ...extra },
			htmlBody: '',
			payload: {
				sendFn: 'sendTaskClientNotificationEmail',
				args: [taskId, clientEmail, clientName, notificationType, extra]
			}
		},
		async () => {
			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.id, task.tenantId))
				.limit(1);

			const [emailSettings] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, task.tenantId))
				.limit(1);

			const [invoiceSettings] = await db
				.select()
				.from(table.invoiceSettings)
				.where(eq(table.invoiceSettings.tenantId, task.tenantId))
				.limit(1);
			const { logoAttachment } = prepareLogoAttachment(invoiceSettings?.invoiceLogo);
			const clientNotifHeaderLogoHtml = buildHeaderLogoHtml(logoAttachment);

			const fromEmail = resolveFromEmail(emailSettings);
			const tenantName = tenant?.name || 'CRM';
			const themeColor = normalizeThemeColor(tenant?.themeColor);
			const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${taskId}`;

			// Full subject + description based on notification type
			let subject: string;
			let changeDescription: string;
			let headerColor = themeColor;

			switch (notificationType) {
				case 'created':
					subject = `Task nou: ${task.title}`;
					changeDescription = 'Un task nou a fost creat pentru dumneavoastră.';
					break;
				case 'status-change': {
					const statusLabels: Record<string, string> = {
						todo: 'De făcut',
						'in-progress': 'În lucru',
						review: 'În review',
						done: 'Finalizat',
						cancelled: 'Anulat',
						'pending-approval': 'Așteaptă aprobare'
					};
					const statusLabel =
						statusLabels[extra?.newStatus || task.status] || extra?.newStatus || task.status;
					subject = `Task actualizat: ${task.title} — ${statusLabel}`;
					changeDescription = `Statusul taskului a fost schimbat în: <strong>${statusLabel}</strong>.`;
					if (extra?.newStatus === 'done') headerColor = '#16a34a';
					if (extra?.newStatus === 'cancelled') headerColor = '#dc2626';
					break;
				}
				case 'comment':
					subject = `Comentariu nou pe task: ${task.title}`;
					changeDescription = extra?.commentPreview
						? `Un comentariu nou a fost adăugat: "${extra.commentPreview.substring(0, 200)}${extra.commentPreview.length > 200 ? '...' : ''}"`
						: 'Un comentariu nou a fost adăugat pe task.';
					break;
				case 'modified':
					subject = `Task modificat: ${task.title}`;
					changeDescription = extra?.changedFields
						? `Următoarele câmpuri au fost modificate: ${extra.changedFields}.`
						: 'Taskul a fost modificat.';
					break;
			}

			const statusColors = getEmailStatusColors(task.status);
			const priorityColors = getEmailPriorityColors(task.priority);
			const statusLabel = formatStatusLabel(task.status || 'todo');
			const priorityLabel = formatPriorityLabel(task.priority || 'medium');

			const badgeStyle =
				'display:inline-block; padding:3px 12px; border-radius:9999px; font-size:13px; font-weight:600;';
			const dotStyle = (color: string) =>
				`display:inline-block; width:8px; height:8px; border-radius:50%; background:${color}; margin-right:6px; vertical-align:middle;`;

			const statusBadge = `<span style="${badgeStyle} background:${statusColors.bg}; color:${statusColors.text};"><span style="${dotStyle(statusColors.dot)}"></span>${statusLabel}</span>`;
			const priorityBadge = `<span style="${badgeStyle} background:${priorityColors.bg}; color:${priorityColors.text};">${priorityLabel}</span>`;

			const safeTitle = escapeHtml(task.title);
			const safeDesc = task.description ? escapeHtml(task.description) : '';
			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ${greeting},</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">${changeDescription}</p>
				<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
					<tr>
						<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
							<div style="font-weight: 600; color: #111827; font-size: 15px; margin-bottom: 8px;">${safeTitle}</div>
							${safeDesc ? `<div style="color: #6b7280; font-size: 13px; margin-bottom: 12px;">${safeDesc}</div>` : ''}
							<div><span style="color: #6b7280;">Prioritate</span> &nbsp;·&nbsp; ${priorityBadge}</div>
							<div style="margin-top: 6px;"><span style="color: #6b7280;">Status</span> &nbsp;·&nbsp; ${statusBadge}</div>
							${task.dueDate ? `<div style="margin-top: 6px;"><span style="color: #6b7280;">Termen</span> &nbsp;·&nbsp; <strong>${formatDateRo(task.dueDate)}</strong></div>` : ''}
						</td>
					</tr>
				</table>
				${renderCtaButton(taskUrl, 'Vezi task-ul', themeColor)}
			`;

			return {
				from: `"${tenantName}" <${fromEmail}>`,
				to: clientEmail,
				subject,
				...(logoAttachment ? { attachments: [logoAttachment] } : {}),
				html: renderBrandedEmail({
					themeColor: headerColor,
					headerLogoHtml: clientNotifHeaderLogoHtml,
					title: subject,
					bodyHtml,
					previewTitle: subject,
					footerHtml: `Trimis automat de ${escapeHtml(tenantName)}.`
				}),
				text: trimPlainText(`
${subject}

Bună ${greeting},

${changeDescription.replace(/<[^>]+>/g, '')}

${task.title}
${task.description ? `\n${task.description}\n` : ''}
Prioritate: ${task.priority || 'Medium'}
Status: ${task.status || 'Todo'}
${task.dueDate ? `Termen: ${formatDateRo(task.dueDate)}\n` : ''}

Vezi task: ${taskUrl}
		`)
			};
		}
	);
}

/**
 * Send invoice paid confirmation email
 */
export async function sendInvoicePaidEmail(invoiceId: string, clientEmail: string): Promise<void> {
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.limit(1);

	if (!invoice) {
		throw new Error('Invoice not found');
	}

	await sendWithPersistence(
		{
			tenantId: invoice.tenantId,
			toEmail: clientEmail,
			subject: `Plata primita: Factura ${invoice.invoiceNumber}`,
			emailType: 'invoice-paid',
			metadata: { invoiceId, invoiceNumber: invoice.invoiceNumber },
			htmlBody: '',
			payload: {
				sendFn: 'sendInvoicePaidEmail',
				args: [invoiceId, clientEmail]
			}
		},
		async () => {
			const [client] = await db
				.select()
				.from(table.client)
				.where(eq(table.client.id, invoice.clientId))
				.limit(1);

			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.id, invoice.tenantId))
				.limit(1);

			const [emailSettings] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, invoice.tenantId))
				.limit(1);

			const fromEmail = resolveFromEmail(emailSettings);
			const tenantName = tenant?.name || 'CRM';
			const themeColor = normalizeThemeColor(tenant?.themeColor);

			const rawToken = await createInvoiceViewToken(invoiceId, invoice.tenantId);
			const invoiceUrl = `${baseUrl}/invoice/${tenant?.slug || 'tenant'}/${encodeURIComponent(rawToken)}`;

			const [invoiceSettings] = await db
				.select()
				.from(table.invoiceSettings)
				.where(eq(table.invoiceSettings.tenantId, invoice.tenantId))
				.limit(1);

			const { logoAttachment } = prepareLogoAttachment(invoiceSettings?.invoiceLogo);
			const paidHeaderLogoHtml = buildHeaderLogoHtml(logoAttachment);

			const formatAmount = (cents: number | null | undefined, currency: string) => {
				if (cents === null || cents === undefined) return 'N/A';
				const amount = (cents / 100).toFixed(2);
				return `${amount} ${currency}`;
			};

			const safeClientName = escapeHtml(client?.name || 'Client');
			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Stimate/Stimată ${safeClientName},</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Am primit plata pentru următoarea factură:</p>
				<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f0fdf4; border-left: 3px solid #10b981; border-radius: 8px; margin: 0 0 20px 0;">
					<tr>
						<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
							<div><span style="color: #6b7280;">Număr factură</span> &nbsp;·&nbsp; <strong>${invoice.invoiceNumber}</strong></div>
							<div><span style="color: #6b7280;">Suma plătită</span> &nbsp;·&nbsp; <strong>${formatAmount(invoice.totalAmount, invoice.currency)}</strong></div>
							${invoice.paidDate ? `<div><span style="color: #6b7280;">Data plății</span> &nbsp;·&nbsp; <strong>${formatDateRo(invoice.paidDate)}</strong></div>` : ''}
							${invoice.issueDate ? `<div><span style="color: #6b7280;">Data emitere</span> &nbsp;·&nbsp; <strong>${formatDateRo(invoice.issueDate)}</strong></div>` : ''}
						</td>
					</tr>
				</table>
				<p style="color: #15803d; font-weight: 600; font-size: 15px; margin: 0 0 20px 0;">Vă mulțumim pentru plată!</p>
				${renderCtaButton(invoiceUrl, 'Vezi factura', themeColor)}
			`;

			return {
				from: `"${tenantName}" <${fromEmail}>`,
				to: clientEmail,
				subject: `Plata primita: Factura ${invoice.invoiceNumber}`,
				...(logoAttachment ? { attachments: [logoAttachment] } : {}),
				html: renderBrandedEmail({
					themeColor,
					headerLogoHtml: paidHeaderLogoHtml,
					title: 'Plată primită',
					bodyHtml,
					previewTitle: `Plata primita: Factura ${invoice.invoiceNumber}`
				}),
				text: trimPlainText(`
			Plata primita

			Stimate/Stimata ${client?.name || 'Client'},

			Am primit plata pentru urmatoarea factura:

			Numar factura: ${invoice.invoiceNumber}
			Suma platita: ${formatAmount(invoice.totalAmount, invoice.currency)}
			${invoice.paidDate ? `Data plata: ${formatDateRo(invoice.paidDate)}\n` : ''}
			${invoice.issueDate ? `Data emitere: ${formatDateRo(invoice.issueDate)}\n` : ''}

			Va multumim pentru plata!

			Vezi factura: ${invoiceUrl}

			Pentru intrebari, nu ezitati sa ne contactati.
		`)
			};
		}
	);
}

/**
 * Send overdue invoice reminder email to client
 */
export async function sendOverdueReminderEmail(
	invoiceId: string,
	clientEmail: string,
	daysOverdue: number,
	reminderNumber: number
): Promise<void> {
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.limit(1);

	if (!invoice) {
		throw new Error('Invoice not found');
	}

	await sendWithPersistence(
		{
			tenantId: invoice.tenantId,
			toEmail: clientEmail,
			subject: `Reminder: Factura ${invoice.invoiceNumber} este restanta de ${daysOverdue} zile`,
			emailType: 'invoice-overdue-reminder',
			metadata: { invoiceId, invoiceNumber: invoice.invoiceNumber, daysOverdue, reminderNumber },
			htmlBody: '',
			payload: {
				sendFn: 'sendOverdueReminderEmail',
				args: [invoiceId, clientEmail, daysOverdue, reminderNumber]
			}
		},
		async () => {
			const [client] = await db
				.select()
				.from(table.client)
				.where(eq(table.client.id, invoice.clientId))
				.limit(1);

			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.id, invoice.tenantId))
				.limit(1);

			const [emailSettings] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, invoice.tenantId))
				.limit(1);

			const fromEmail = resolveFromEmail(emailSettings);
			const tenantName = tenant?.name || 'CRM';
			const themeColor = normalizeThemeColor(tenant?.themeColor);

			const rawToken = await createInvoiceViewToken(invoiceId, invoice.tenantId);
			const invoiceUrl = `${baseUrl}/invoice/${tenant?.slug || 'tenant'}/${encodeURIComponent(rawToken)}`;

			const [invoiceSettings] = await db
				.select()
				.from(table.invoiceSettings)
				.where(eq(table.invoiceSettings.tenantId, invoice.tenantId))
				.limit(1);

			const lineItems = await db
				.select()
				.from(table.invoiceLineItem)
				.where(eq(table.invoiceLineItem.invoiceId, invoiceId));

			const displayInvoiceNumber = formatInvoiceNumberDisplay(invoice, invoiceSettings);

			let pdfAttachment: { filename: string; content: Buffer; contentType: string } | undefined;
			try {
				const pdfBuffer = await generateInvoicePDF({
					invoice,
					lineItems,
					tenant: tenant!,
					client: client!,
					displayInvoiceNumber,
					invoiceLogo: invoiceSettings?.invoiceLogo || null
				});
				const safeFilename = `Factura-${displayInvoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
				pdfAttachment = { filename: safeFilename, content: pdfBuffer, contentType: 'application/pdf' };
			} catch (pdfError) {
				logWarning('email', 'Could not generate PDF attachment for overdue reminder', {
					tenantId: invoice.tenantId,
					metadata: { invoiceId, error: (pdfError as Error).message }
				});
			}

			const formatAmount = (cents: number | null | undefined, currency: string) => {
				if (cents === null || cents === undefined) return 'N/A';
				const amount = (cents / 100).toFixed(2);
				return `${amount} ${currency}`;
			};

			const dueDateStr = formatDateRo(invoice.dueDate);

			const { logoAttachment } = prepareLogoAttachment(invoiceSettings?.invoiceLogo);
			const overdueHeaderLogoHtml = buildHeaderLogoHtml(logoAttachment);

			const ibanHtml = tenant?.iban
				? `<div style="background-color: #f9fafb; border-left: 3px solid ${themeColor}; padding: 14px 16px; border-radius: 6px; margin: 0 0 20px 0;">
				<p style="color: #111827; font-weight: 600; font-size: 14px; margin: 0 0 6px 0;">Date pentru plată</p>
				${tenant.bankName ? `<p style="color: #374151; font-size: 13px; margin: 2px 0;"><span style="color: #6b7280;">Banca</span> &nbsp;·&nbsp; ${escapeHtml(tenant.bankName)}</p>` : ''}
				<p style="color: #374151; font-size: 13px; margin: 2px 0;"><span style="color: #6b7280;">IBAN (LEI)</span> &nbsp;·&nbsp; ${escapeHtml(tenant.iban)}</p>
				${tenant.ibanEuro ? `<p style="color: #374151; font-size: 13px; margin: 2px 0;"><span style="color: #6b7280;">IBAN (EUR)</span> &nbsp;·&nbsp; ${escapeHtml(tenant.ibanEuro)}</p>` : ''}
			</div>`
				: '';

			const ibanText = tenant?.iban
				? `\n\t\t\tDate pentru plata:${tenant.bankName ? `\n\t\t\tBanca: ${tenant.bankName}` : ''}\n\t\t\tIBAN (LEI): ${tenant.iban}${tenant.ibanEuro ? `\n\t\t\tIBAN (EUR): ${tenant.ibanEuro}` : ''}\n`
				: '';

			const attachments = [
				...(pdfAttachment ? [pdfAttachment] : []),
				...(logoAttachment ? [logoAttachment] : [])
			];

			const safeClientName = escapeHtml(client?.name || 'Client');
			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Stimate/Stimată ${safeClientName},</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Vă reamintim că factura de mai jos este restantă de <strong>${daysOverdue} zile</strong>.</p>
				<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #fffbeb; border-left: 3px solid #d97706; border-radius: 8px; margin: 0 0 20px 0;">
					<tr>
						<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
							<div><span style="color: #6b7280;">Număr factură</span> &nbsp;·&nbsp; <strong>${invoice.invoiceNumber}</strong></div>
							<div><span style="color: #6b7280;">Suma de plată</span> &nbsp;·&nbsp; <strong>${formatAmount(invoice.totalAmount, invoice.currency)}</strong></div>
							<div><span style="color: #6b7280;">Scadență</span> &nbsp;·&nbsp; <strong>${dueDateStr}</strong></div>
							<div><span style="color: #6b7280;">Zile restanță</span> &nbsp;·&nbsp; <strong style="color: #d97706;">${daysOverdue}</strong></div>
							${reminderNumber > 1 ? `<div style="color: #9ca3af; font-size: 12px; margin-top: 6px;">Reminder #${reminderNumber}</div>` : ''}
						</td>
					</tr>
				</table>
				${ibanHtml}
				<p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0;">Vă rugăm să efectuați plata cât mai curând posibil.</p>
				${pdfAttachment ? '<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 12px 0;">📎 Factura este atașată în format PDF la acest email.</p>' : ''}
				${renderCtaButton(invoiceUrl, 'Vezi factura online', themeColor)}
				<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0;">Dacă ați efectuat deja plata, vă rugăm să ignorați acest email.</p>
			`;

			return {
				from: `"${tenantName}" <${fromEmail}>`,
				to: clientEmail,
				subject: `Reminder: Factura ${invoice.invoiceNumber} este restanta de ${daysOverdue} zile`,
				...(attachments.length > 0 ? { attachments } : {}),
				html: renderBrandedEmail({
					themeColor,
					headerLogoHtml: overdueHeaderLogoHtml,
					title: 'Reminder plată factură',
					bodyHtml,
					previewTitle: `Reminder: Factura ${invoice.invoiceNumber}`
				}),
				text: trimPlainText(`
			Reminder plata factura

			Stimate/Stimata ${client?.name || 'Client'},

			Va reamintim ca factura de mai jos este restanta de ${daysOverdue} zile.

			Numar factura: ${invoice.invoiceNumber}
			Suma de plata: ${formatAmount(invoice.totalAmount, invoice.currency)}
			Data scadenta: ${dueDateStr}
			Zile restanta: ${daysOverdue}
			${reminderNumber > 1 ? `Reminder #${reminderNumber}` : ''}

			${ibanText}
			Va rugam sa efectuati plata cat mai curand posibil.

			Vezi factura: ${invoiceUrl}

			Daca ati efectuat deja plata, va rugam sa ignorati acest email.
		`)
			};
		}
	);
}

/**
 * Send task reminder email
 */
export async function sendTaskReminderEmail(
	taskId: string,
	assigneeEmail: string,
	assigneeName?: string
): Promise<void> {
	if (assigneeName) assigneeName = escapeHtml(assigneeName);
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	const [task] = await db.select().from(table.task).where(eq(table.task.id, taskId)).limit(1);

	if (!task || !task.dueDate) {
		throw new Error('Task not found or has no due date');
	}

	const dueDate = new Date(task.dueDate);
	const now = new Date();
	const isOverdue = dueDate < now;
	const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

	await sendWithPersistence(
		{
			tenantId: task.tenantId,
			toEmail: assigneeEmail,
			subject: isOverdue
				? `Overdue Task Reminder: ${task.title}`
				: `Task Reminder: ${task.title} - Due ${daysUntilDue === 0 ? 'Today' : `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`}`,
			emailType: 'task-reminder',
			metadata: { taskId, taskTitle: task.title, isOverdue },
			htmlBody: '',
			payload: {
				sendFn: 'sendTaskReminderEmail',
				args: [taskId, assigneeEmail, assigneeName]
			}
		},
		async () => {
			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.id, task.tenantId))
				.limit(1);

			const [emailSettings] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, task.tenantId))
				.limit(1);

			const fromEmail = resolveFromEmail(emailSettings);
			const tenantName = tenant?.name || 'CRM';
			const themeColor = normalizeThemeColor(tenant?.themeColor);
			const brand = await fetchTenantBrand(task.tenantId);
			const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${taskId}`;
			const accent = isOverdue ? '#dc2626' : '#d97706';

			const safeAssignee = escapeHtml(assigneeName || '');
			const safeTitle = escapeHtml(task.title);
			const safeDesc = task.description ? escapeHtml(task.description) : '';
			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua${safeAssignee ? ` ${safeAssignee}` : ''},</p>
				${isOverdue ? `<p style="color: ${accent}; font-weight: 600; font-size: 15px; margin: 0 0 16px 0;">Acest task este restant!</p>` : `<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Acest task are termen ${daysUntilDue === 0 ? 'astăzi' : `în ${daysUntilDue} ${daysUntilDue === 1 ? 'zi' : 'zile'}`}.</p>`}
				<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f9fafb; border-left: 3px solid ${accent}; border-radius: 8px; margin: 0 0 20px 0;">
					<tr>
						<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
							<div style="font-weight: 600; color: #111827; font-size: 15px; margin-bottom: 8px;">${safeTitle}</div>
							${safeDesc ? `<div style="color: #6b7280; font-size: 13px; margin-bottom: 12px;">${safeDesc}</div>` : ''}
							<div><span style="color: #6b7280;">Prioritate</span> &nbsp;·&nbsp; <strong>${task.priority || 'medium'}</strong></div>
							<div><span style="color: #6b7280;">Status</span> &nbsp;·&nbsp; <strong>${task.status || 'todo'}</strong></div>
							<div><span style="color: #6b7280;">Termen</span> &nbsp;·&nbsp; <strong style="color: ${isOverdue ? accent : '#111827'};">${formatDateRo(dueDate)}</strong></div>
						</td>
					</tr>
				</table>
				${renderCtaButton(taskUrl, 'Vezi task-ul', themeColor)}
			`;

			return {
				from: `"${tenantName}" <${fromEmail}>`,
				to: assigneeEmail,
				subject: isOverdue
					? `Task restant: ${task.title}`
					: `Reminder task: ${task.title} — ${daysUntilDue === 0 ? 'astăzi' : `în ${daysUntilDue} ${daysUntilDue === 1 ? 'zi' : 'zile'}`}`,
				...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {}),
				html: renderBrandedEmail({
					themeColor,
					headerLogoHtml: brand.headerLogoHtml,
					title: isOverdue ? 'Task restant' : 'Reminder task',
					bodyHtml,
					previewTitle: `Reminder: ${task.title}`,
					footerHtml: `Trimis automat de ${escapeHtml(tenantName)}.`
				}),
				text: trimPlainText(`
			${isOverdue ? 'Task restant' : 'Reminder task'}

			Buna ziua${assigneeName ? ` ${assigneeName}` : ''},

			${isOverdue ? 'Acest task este restant!' : `Acest task are termen ${daysUntilDue === 0 ? 'astazi' : `in ${daysUntilDue} zile`}.`}

			${task.title}
			${task.description ? `\n${task.description}\n` : ''}
			Prioritate: ${task.priority || 'medium'}
			Status: ${task.status || 'todo'}
			Termen: ${formatDateRo(dueDate)}

			Vezi task: ${taskUrl}
		`)
			};
		}
	);
}

/**
 * Send daily work reminder email with tasks scheduled for today
 */
export async function sendDailyWorkReminderEmail(
	userId: string,
	tenantId: string,
	tasks: Array<typeof table.task.$inferSelect>,
	userName: string
): Promise<void> {
	userName = escapeHtml(userName);
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	const [user] = await db.select().from(table.user).where(eq(table.user.id, userId)).limit(1);

	if (!user?.email) {
		throw new Error('User email not found');
	}

	await sendWithPersistence(
		{
			tenantId,
			toEmail: user.email,
			subject: `Your Daily Work Plan - ${tasks.length} task${tasks.length !== 1 ? 's' : ''} for today`,
			emailType: 'daily-reminder',
			metadata: { userName, taskCount: tasks.length },
			htmlBody: '',
			// payload: null — daily reminders are regenerated by the daily_work_reminders
			// scheduler task on its next run, so retrying a stale one would re-email yesterday's
			// list of tasks. Skip auto-retry; failure will be re-tried tomorrow morning.
			payload: null
		},
		async () => {
			const [tenant] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.id, tenantId))
				.limit(1);

			const [emailSettings] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, tenantId))
				.limit(1);

			const fromEmail = resolveFromEmail(emailSettings);
			const tenantName = tenant?.name || 'CRM';
			const themeColor = normalizeThemeColor(tenant?.themeColor);
			const brand = await fetchTenantBrand(tenantId);
			const myPlansUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/my-plans`;

			const getPriorityColor = (priority: string | null) => {
				switch (priority) {
					case 'urgent': return '#dc2626';
					case 'high':   return '#f59e0b';
					case 'medium': return themeColor;
					case 'low':    return '#10b981';
					default:       return '#6b7280';
				}
			};

			const tasksListHtml = tasks
				.map((task) => {
					const priorityColor = getPriorityColor(task.priority);
					const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${task.id}`;
					const dueDate = task.dueDate ? formatDateRo(task.dueDate) : 'Fără termen';
					const safeTitle = escapeHtml(task.title);
					const safeDesc = task.description ? escapeHtml(task.description) : '';
					return `
				<div style="background-color: #f9fafb; padding: 14px 16px; border-radius: 8px; margin-bottom: 10px; border-left: 3px solid ${priorityColor};">
					<div style="margin: 0 0 6px 0;"><a href="${taskUrl}" style="color: ${themeColor}; text-decoration: none; font-weight: 600; font-size: 15px;">${safeTitle}</a></div>
					${safeDesc ? `<div style="color: #6b7280; font-size: 13px; margin: 0 0 8px 0;">${safeDesc}</div>` : ''}
					<div style="color: #374151; font-size: 13px; line-height: 1.6;">
						<span style="color: #6b7280;">Prioritate</span> · <strong style="color: ${priorityColor};">${task.priority || 'medium'}</strong>
						&nbsp;&nbsp;<span style="color: #6b7280;">Status</span> · <strong>${task.status || 'todo'}</strong>
						&nbsp;&nbsp;<span style="color: #6b7280;">Termen</span> · <strong>${dueDate}</strong>
					</div>
				</div>
			`;
				})
				.join('');

			const tasksListText = tasks
				.map((task) => {
					const dueDate = task.dueDate ? formatDateRo(task.dueDate) : 'No due date';
					const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${task.id}`;
					return `
${task.title}
${task.description ? `  ${task.description}\n` : ''}  Priority: ${task.priority || 'Medium'}
  Status: ${task.status || 'Todo'}
  Due: ${dueDate}
  View: ${taskUrl}
`;
				})
				.join('\n---\n');

			const today = new Date().toLocaleDateString('ro-RO', {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});

			const taskCount = tasks.length;
			const countLabel = `${taskCount} task${taskCount !== 1 ? '-uri' : ''}`;
			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună dimineața, ${userName}!</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Planul tău pentru <strong>${today}</strong> — ai ${countLabel} programate astăzi:</p>
				${tasksListHtml}
				<div style="height: 4px;"></div>
				${renderCtaButton(myPlansUrl, 'Vezi planurile mele', themeColor)}
				<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0;">Spor la treabă!</p>
			`;

			return {
				from: `"${tenantName}" <${fromEmail}>`,
				to: user.email!,
				subject: `Planul tău de astăzi — ${countLabel}`,
				...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {}),
				html: renderBrandedEmail({
					themeColor,
					headerLogoHtml: brand.headerLogoHtml,
					title: `Bună dimineața, ${userName}!`,
					bodyHtml,
					previewTitle: 'Planul zilei de lucru'
				}),
				text: trimPlainText(`
			Buna dimineata, ${userName}!

			Planul tau pentru ${today} — ${countLabel} programate astazi:

			${tasksListText}

			Vezi planurile mele: ${myPlansUrl}

			Spor la treaba!
		`)
			};
		}
	);
}

/**
 * Send contract signing invitation email to client
 */
export async function sendContractSigningEmail(
	email: string,
	rawToken: string,
	tenantSlug: string,
	contractNumber: string,
	clientName: string
): Promise<void> {
	clientName = escapeHtml(clientName);
	contractNumber = escapeHtml(contractNumber);
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);

	if (!tenant) {
		throw new Error('Tenant not found');
	}

	const tenantName = tenant.name || 'CRM';
	const signingUrl = `${baseUrl}/sign/${tenantSlug}/${encodeURIComponent(rawToken)}`;

	await sendWithPersistence(
		{
			tenantId: tenant.id,
			toEmail: email,
			subject: `Semnare contract ${contractNumber} - ${tenantName}`,
			emailType: 'contract-signing',
			metadata: { contractNumber, clientName, tenantSlug },
			htmlBody: '',
			payload: {
				sendFn: 'sendContractSigningEmail',
				args: [email, rawToken, tenantSlug, contractNumber, clientName]
			}
		},
		async () => {
			const brand = await fetchTenantBrand(tenant.id);
			const [emailSettings] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, tenant.id))
				.limit(1);
			const fromEmail = resolveFromEmail(emailSettings);

			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Stimate/Stimată ${clientName},</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Ați primit o invitație pentru a semna contractul <strong>${contractNumber}</strong> emis de <strong>${escapeHtml(tenantName)}</strong>.</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 4px 0;">Apăsați butonul de mai jos pentru a vizualiza și semna contractul. Linkul este valabil 7 zile.</p>
				${renderCtaButton(signingUrl, 'Vizualizează și semnează contractul', brand.themeColor)}
				<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 4px 0;">Sau copiați acest link în browser:</p>
				<p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0 0 18px 0; word-break: break-all;">${signingUrl}</p>
				<div style="background-color: #fffbeb; border-left: 3px solid #f59e0b; padding: 12px 14px; border-radius: 6px; margin: 0 0 20px 0;">
					<p style="color: #92400e; font-size: 13px; line-height: 1.5; margin: 0;"><strong>Securitate</strong> · Linkul este valabil 7 zile și poate fi folosit o singură dată. Dacă nu ați solicitat semnarea, ignorați emailul.</p>
				</div>
			`;

			return {
				from: `"${tenantName}" <${fromEmail}>`,
				to: email,
				subject: `Semnare contract ${contractNumber} - ${tenantName}`,
				...(brand.logoAttachment ? { attachments: [brand.logoAttachment] } : {}),
				html: renderBrandedEmail({
					themeColor: brand.themeColor,
					headerLogoHtml: brand.headerLogoHtml,
					title: `Semnare contract ${contractNumber}`,
					bodyHtml,
					previewTitle: `Semnare contract ${contractNumber}`,
					footerHtml: `Pentru orice întrebări, contactați ${escapeHtml(tenantName)}.`
				}),
				text: trimPlainText(`
			${tenantName}

			Stimate/Stimată ${clientName},

			Ați primit o invitație pentru a semna contractul ${contractNumber} emis de ${tenantName}.

			Accesați link-ul de mai jos pentru a vizualiza și semna contractul (valabil 7 zile):

			${signingUrl}

			Notă de securitate: Acest link este valabil 7 zile și poate fi folosit o singură dată.

			Pentru orice întrebări, contactați ${tenantName}.
		`)
			};
		}
	);
}

/**
 * Send a scheduled marketing report email with PDF attachment.
 */
export async function sendReportEmail(
	tenantId: string,
	clientId: string,
	recipientEmail: string,
	clientName: string,
	periodLabel: string,
	pdfBuffer: Buffer,
	variant: 'standard' | 'monthly-summary' = 'standard'
): Promise<void> {
	const titlePrefix = variant === 'monthly-summary' ? 'Raport Marketing Lunar' : 'Raport Marketing';
	const subject = `${titlePrefix} — ${clientName} — ${periodLabel}`;
	const fileSlug = variant === 'monthly-summary' ? 'raport-lunar' : 'raport';
	const filename = `${fileSlug}-${clientName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${periodLabel.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.pdf`;

	await sendWithPersistence(
		{
			tenantId,
			toEmail: recipientEmail,
			subject,
			emailType: 'report',
			metadata: { clientId, clientName, periodLabel, variant },
			htmlBody: '',
			// payload: null — pdfBuffer is non-serializable, and the pdf_report_send scheduler
			// task regenerates and re-sends scheduled reports on its next run.
			payload: null
		},
		async () => {
			const brand = await fetchTenantBrand(tenantId);
			const [emailSettings] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, tenantId))
				.limit(1);
			const fromEmail = resolveFromEmail(emailSettings);

			const safeClientName = escapeHtml(clientName);
			const safePeriodLabel = escapeHtml(periodLabel);

			const bodyHtml = `
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 12px 0;">Bună ziua,</p>
				<p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Vă transmitem raportul de marketing pentru <strong>${safeClientName}</strong>.</p>
				<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f9fafb; border-radius: 8px; margin: 0 0 20px 0;">
					<tr>
						<td style="padding: 16px 18px; color: #374151; font-size: 14px; line-height: 1.7;">
							<div><span style="color: #6b7280;">Client</span> &nbsp;·&nbsp; <strong>${safeClientName}</strong></div>
							<div><span style="color: #6b7280;">Perioadă</span> &nbsp;·&nbsp; <strong>${safePeriodLabel}</strong></div>
						</td>
					</tr>
				</table>
				<p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0 0 12px 0;">Raportul conține sumarul performanței campaniilor publicitare pe toate platformele active: cheltuieli, impresii, click-uri, CTR, CPC și rezultate per platformă.</p>
				<p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 0 0 20px 0;">📎 Raportul este atașat în format PDF la acest email.</p>
			`;

			const html = renderBrandedEmail({
				themeColor: brand.themeColor,
				headerLogoHtml: brand.headerLogoHtml,
				title: titlePrefix,
				bodyHtml,
				previewTitle: `${titlePrefix} — ${safeClientName}`
			});

			const attachments = [
				{ filename, content: pdfBuffer, contentType: 'application/pdf' },
				...(brand.logoAttachment ? [brand.logoAttachment] : [])
			];

			return {
				from: `"${brand.tenantName}" <${fromEmail}>`,
				to: recipientEmail,
				subject,
				html,
				text: trimPlainText(`
				Raport Marketing

				Buna ziua,

				Va transmitem raportul de marketing pentru ${clientName}.

				Client: ${clientName}
				Perioada: ${periodLabel}

				Raportul include un sumar al performantei campaniilor publicitare pe toate platformele active (cheltuieli, impresii, click-uri, CTR, CPC si rezultate per platforma).

				Raportul este atasat in format PDF la acest email.

				Pentru intrebari sau clarificari, nu ezitati sa ne contactati.
			`),
				attachments
			};
		}
	);
}

// ---------------------------------------------------------------------------
// Outbox replay registry — used by `retryEmailLog`, `retryAllFailedEmails`,
// and the `email_retry` scheduler task to replay a failed email by `sendFn` name.
//
// Add the corresponding entry whenever you add a new send function that uses
// `sendWithPersistence` with a non-null payload.
// ---------------------------------------------------------------------------
/**
 * AsyncLocalStorage-based retry context. Prevents the global state concurrency issue
 * where an HTTP-triggered email send could inherit the retry log ID from the scheduler.
 * Each async call chain gets its own isolated context.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const retryContext = new AsyncLocalStorage<{ logId: string }>();

export function runWithRetryLogId<T>(logId: string, fn: () => Promise<T>): Promise<T> {
	return retryContext.run({ logId }, fn);
}

function getRetryLogId(): string | null {
	return retryContext.getStore()?.logId ?? null;
}

export const EMAIL_SEND_REGISTRY: Record<string, (...args: any[]) => Promise<void>> = {
	sendInvitationEmail,
	sendInvoiceEmail,
	sendTaskAssignmentEmail,
	sendTaskUpdateEmail,
	sendTaskClientNotificationEmail,
	sendInvoicePaidEmail,
	sendOverdueReminderEmail,
	sendTaskReminderEmail,
	sendContractSigningEmail
	// NOTE: Intentionally omitted (payload: null, not replay-able):
	// - sendMagicLinkEmail, sendAdminMagicLinkEmail, sendPasswordResetEmail
	//   (contain single-use auth tokens that must not be persisted)
	// - sendDailyWorkReminderEmail, sendReportEmail
	//   (Buffer attachments, large task arrays — scheduled tasks regenerate them)
};
