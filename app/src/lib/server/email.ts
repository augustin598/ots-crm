import nodemailer from 'nodemailer';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { db } from './db';
import * as table from './db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from './plugins/smartbill/crypto';
import {
	logEmailAttempt,
	logEmailProcessing,
	logEmailSuccess,
	logEmailFailure,
	logEmailRetry
} from './email-logger';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';
import { generateInvoicePDF } from '$lib/server/invoice-pdf-generator';
import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';
import { createInvoiceViewToken } from '$lib/server/invoice-token';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
export async function getNotificationRecipients(
	clientId: string,
	category: NotificationCategory
): Promise<string[]> {
	const [client] = await db
		.select({ email: table.client.email })
		.from(table.client)
		.where(eq(table.client.id, clientId))
		.limit(1);

	const emails: string[] = [];
	if (client?.email) {
		emails.push(client.email);
	}

	const columnMap = {
		invoices: table.clientSecondaryEmail.notifyInvoices,
		tasks: table.clientSecondaryEmail.notifyTasks,
		contracts: table.clientSecondaryEmail.notifyContracts
	} as const;

	const secondaryEmails = await db
		.select({ email: table.clientSecondaryEmail.email })
		.from(table.clientSecondaryEmail)
		.where(
			and(
				eq(table.clientSecondaryEmail.clientId, clientId),
				eq(columnMap[category], true)
			)
		);

	for (const se of secondaryEmails) {
		if (se.email && !emails.map((e) => e.toLowerCase()).includes(se.email.toLowerCase())) {
			emails.push(se.email);
		}
	}

	return emails;
}

// Cache tenant-specific transporters
const tenantTransporters = new Map<string, nodemailer.Transporter>();

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
		tls: { rejectUnauthorized: false } // allow self-signed certs (e.g. sender.navitech.cloud)
	});

	return defaultTransporter;
}

/**
 * Get tenant-specific transporter or fall back to environment variables
 */
export async function getTenantTransporter(
	tenantId: string
): Promise<nodemailer.Transporter | null> {
	// Check cache first
	if (tenantTransporters.has(tenantId)) {
		logInfo('email', 'Using cached transporter', { tenantId });
		return tenantTransporters.get(tenantId)!;
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

	// If tenant has email settings configured and enabled, use them
	if (
		emailSettings &&
		emailSettings.isEnabled &&
		emailSettings.smtpHost &&
		emailSettings.smtpUser &&
		emailSettings.smtpPassword
	) {
		try {
			// Decrypt password
			const decryptedPassword = decrypt(tenantId, emailSettings.smtpPassword);

			// Create transporter with tenant-specific settings
			const port = emailSettings.smtpPort || 587;
			const secure = emailSettings.smtpSecure || port === 465;
			const transporter = nodemailer.createTransport({
				host: emailSettings.smtpHost,
				port,
				secure,
				auth: {
					user: emailSettings.smtpUser,
					pass: decryptedPassword
				},
				tls: { rejectUnauthorized: false }
			});

			// Cache the transporter
			tenantTransporters.set(tenantId, transporter);
			logInfo('email', 'Created tenant transporter', { tenantId, metadata: { host: emailSettings.smtpHost, port } });
			return transporter;
		} catch (error) {
			logError('email', 'Failed to create tenant transporter', { tenantId, stackTrace: serializeError(error).stack });
			// Fall through to default transporter
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
	tenantTransporters.delete(tenantId);
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
	tenantId: string,
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
				logWarning('email', 'Permanent SMTP error, not retrying', { tenantId, metadata: { error: lastError.message } });
				break;
			}

			if (attempt < maxAttempts) {
				// Clear cached transporter and get fresh one
				clearTenantTransporterCache(tenantId);
				const freshTransporter = await getTenantTransporter(tenantId);
				if (freshTransporter) {
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

export async function sendInvitationEmail(
	email: string,
	invitationToken: string,
	tenantName: string,
	inviterName: string,
	tenantId: string
): Promise<void> {
	const transporter = await getTenantTransporter(tenantId);
	if (!transporter) {
		throw new Error('Email transporter not available');
	}
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';
	const invitationUrl = `${baseUrl}/invite/${invitationToken}`;

	// Get tenant email settings to determine from email
	const [emailSettings] = await db
		.select()
		.from(table.emailSettings)
		.where(eq(table.emailSettings.tenantId, tenantId))
		.limit(1);

	const fromEmail =
		emailSettings?.smtpFrom ||
		emailSettings?.smtpUser ||
		env.SMTP_FROM ||
		env.SMTP_USER ||
		'noreply@example.com';

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: email,
		subject: `You've been invited to join ${tenantName}`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Invitation to ${tenantName}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					<h1 style="color: #2563eb; margin-top: 0;">You've been invited!</h1>
					<p>Hello,</p>
					<p><strong>${inviterName}</strong> has invited you to join <strong>${tenantName}</strong> on the CRM platform.</p>
					<p>Click the button below to accept the invitation:</p>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${invitationUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Accept Invitation</a>
					</div>
					<p style="font-size: 14px; color: #666;">Or copy and paste this link into your browser:</p>
					<p style="font-size: 14px; color: #2563eb; word-break: break-all;">${invitationUrl}</p>
					<p style="font-size: 12px; color: #999; margin-top: 30px;">This invitation will expire in 7 days.</p>
					<p style="font-size: 12px; color: #999;">If you didn't expect this invitation, you can safely ignore this email.</p>
				</div>
			</body>
			</html>
		`,
		text: `
			You've been invited!
			
			${inviterName} has invited you to join ${tenantName} on the CRM platform.
			
			Accept the invitation by visiting this link:
			${invitationUrl}
			
			This invitation will expire in 7 days.
			
			If you didn't expect this invitation, you can safely ignore this email.
		`
	};

	const logId = await logEmailAttempt({
		tenantId,
		toEmail: email,
		subject: mailOptions.subject,
		emailType: 'invitation',
		metadata: { invitationToken, tenantName },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		const info = await transporter.sendMail(mailOptions);
		await logEmailSuccess(logId, { messageId: info.messageId, response: info.response });
		logInfo('email', 'Invitation email sent', { tenantId, metadata: { email } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', 'Failed to send invitation email', { tenantId, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send invitation email');
	}
}

/**
 * Send invoice email to client
 */
export async function sendInvoiceEmail(invoiceId: string, clientEmail: string): Promise<void> {
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get invoice details
	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.limit(1);

	if (!invoice) {
		throw new Error('Invoice not found');
	}

	// Get tenant-specific transporter
	const transporter = await getTenantTransporter(invoice.tenantId);
	if (!transporter) {
		throw new Error('Email transporter not available');
	}

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

	const fromEmail =
		emailSettings?.smtpFrom ||
		emailSettings?.smtpUser ||
		env.SMTP_FROM ||
		env.SMTP_USER ||
		'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';

	// Generate public view token and URL (accessible without authentication)
	const rawToken = await createInvoiceViewToken(invoiceId, invoice.tenantId);
	const invoiceUrl = `${baseUrl}/invoice/${tenant?.slug || 'tenant'}/${encodeURIComponent(rawToken)}`;

	// Get invoice settings for logo and PDF
	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, invoice.tenantId))
		.limit(1);

	const { logoAttachment, logoHtml } = prepareLogoAttachment(invoiceSettings?.invoiceLogo);

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
		? `<div style="background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; border-left: 4px solid #2563eb;">
				<p style="font-weight: bold; margin-top: 0;">Date pentru plata:</p>
				${tenant.bankName ? `<p style="margin: 4px 0;"><strong>Banca:</strong> ${tenant.bankName}</p>` : ''}
				<p style="margin: 4px 0;"><strong>IBAN (LEI):</strong> ${tenant.iban}</p>
				${tenant.ibanEuro ? `<p style="margin: 4px 0;"><strong>IBAN (EUR):</strong> ${tenant.ibanEuro}</p>` : ''}
			</div>`
		: '';

	const ibanText = tenant?.iban
		? `\n\t\t\tDate pentru plata:${tenant.bankName ? `\n\t\t\tBanca: ${tenant.bankName}` : ''}\n\t\t\tIBAN (LEI): ${tenant.iban}${tenant.ibanEuro ? `\n\t\t\tIBAN (EUR): ${tenant.ibanEuro}` : ''}\n`
		: '';

	const attachments = [
		...(pdfAttachment ? [pdfAttachment] : []),
		...(logoAttachment ? [logoAttachment] : [])
	];

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: clientEmail,
		subject: `Factura ${invoice.invoiceNumber} de la ${tenantName}`,
		...(attachments.length > 0 ? { attachments } : {}),
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Factura ${invoice.invoiceNumber}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					${logoHtml}
					<h1 style="color: #2563eb; margin-top: 0;">Factura ${invoice.invoiceNumber}</h1>
					<p>Stimate/Stimata ${client?.name || 'Client'},</p>
					<p>Va transmitem factura de la <strong>${tenantName}</strong>.</p>
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0;">
						<p><strong>Numar factura:</strong> ${invoice.invoiceNumber}</p>
						${invoice.issueDate ? `<p><strong>Data emitere:</strong> ${formatDateRo(invoice.issueDate)}</p>` : ''}
						${invoice.dueDate ? `<p><strong>Data scadenta:</strong> ${formatDateRo(invoice.dueDate)}</p>` : ''}
						<p><strong>Total de plata:</strong> ${formatAmount(invoice.totalAmount, invoice.currency)}</p>
						${invoice.status === 'paid' ? '<p style="color: green;"><strong>Status:</strong> Platita</p>' : ''}
					</div>
					${ibanHtml}
					${pdfAttachment ? '<p style="font-size: 13px; color: #666;">Factura este atasata in format PDF la acest email.</p>' : ''}
					<div style="text-align: center; margin: 30px 0;">
						<a href="${invoiceUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Vezi Factura Online</a>
					</div>
					${invoice.dueDate && invoice.status !== 'paid' ? `<p style="font-size: 14px; color: #666;">Plata este scadenta la ${formatDateRo(invoice.dueDate)}.</p>` : ''}
					<p style="font-size: 12px; color: #999; margin-top: 30px;">Pentru intrebari, nu ezitati sa ne contactati.</p>
				</div>
			</body>
			</html>
		`,
		text: `
			Factura ${invoice.invoiceNumber}

			Stimate/Stimata ${client?.name || 'Client'},

			Va transmitem factura de la ${tenantName}.

			Numar factura: ${invoice.invoiceNumber}
			${invoice.issueDate ? `Data emitere: ${formatDateRo(invoice.issueDate)}\n` : ''}
			${invoice.dueDate ? `Data scadenta: ${formatDateRo(invoice.dueDate)}\n` : ''}
			Total de plata: ${formatAmount(invoice.totalAmount, invoice.currency)}
			${ibanText}
			Vezi factura: ${invoiceUrl}

			${invoice.dueDate && invoice.status !== 'paid' ? `Plata este scadenta la ${formatDateRo(invoice.dueDate)}.\n` : ''}

			Pentru intrebari, nu ezitati sa ne contactati.
		`
	};

	const logId = await logEmailAttempt({
		tenantId: invoice.tenantId,
		toEmail: clientEmail,
		subject: mailOptions.subject,
		emailType: 'invoice',
		metadata: { invoiceId, invoiceNumber: invoice.invoiceNumber },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		const info = await sendMailWithRetry(transporter, mailOptions, invoice.tenantId, logId);
		await logEmailSuccess(logId, { messageId: info.messageId, response: info.response });
		logInfo('email', 'Invoice email sent', { tenantId: invoice.tenantId, metadata: { email: clientEmail, invoiceNumber: invoice.invoiceNumber } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', 'Failed to send invoice email', { tenantId: invoice.tenantId, metadata: { email: clientEmail, invoiceNumber: invoice.invoiceNumber }, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send invoice email');
	}
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

	// Get tenant-specific transporter
	const transporter = await getTenantTransporter(tenant.id);
	if (!transporter) {
		throw new Error('Email transporter not available');
	}

	// Get tenant email settings to determine from email
	const [emailSettings] = await db
		.select()
		.from(table.emailSettings)
		.where(eq(table.emailSettings.tenantId, tenant.id))
		.limit(1);

	const fromEmail =
		emailSettings?.smtpFrom ||
		emailSettings?.smtpUser ||
		env.SMTP_FROM ||
		env.SMTP_USER ||
		'noreply@example.com';
	const tenantName = tenant.name || 'CRM';
	const loginUrl = `${baseUrl}/client/${tenantSlug}/verify?token=${encodeURIComponent(token)}`;

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: email,
		subject: `Login to ${tenantName} Client Portal`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Login to ${tenantName}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					<h1 style="color: #2563eb; margin-top: 0;">Welcome to ${tenantName}</h1>
					<p>Dear ${clientName},</p>
					<p>You have requested access to the client portal for <strong>${tenantName}</strong>.</p>
					<p>Click the button below to log in to your account. This link will expire in 24 hours.</p>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${loginUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Log In to Client Portal</a>
					</div>
					<p style="font-size: 14px; color: #666;">Or copy and paste this link into your browser:</p>
					<p style="font-size: 12px; color: #999; word-break: break-all;">${loginUrl}</p>
					<div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; border-radius: 4px;">
						<p style="margin: 0; font-size: 14px; color: #856404;">
							<strong>Security Notice:</strong> This link is valid for 24 hours and can only be used once. If you did not request this link, please ignore this email.
						</p>
					</div>
					<p style="font-size: 12px; color: #999; margin-top: 30px;">If you have any questions, please contact your administrator.</p>
				</div>
			</body>
			</html>
		`,
		text: `
			Welcome to ${tenantName}

			Dear ${clientName},

			You have requested access to the client portal for ${tenantName}.

			Click the link below to log in to your account. This link will expire in 24 hours.

			${loginUrl}

			Security Notice: This link is valid for 24 hours and can only be used once. If you did not request this link, please ignore this email.

			If you have any questions, please contact your administrator.
		`
	};

	const logId = await logEmailAttempt({
		tenantId: tenant.id,
		toEmail: email,
		subject: mailOptions.subject,
		emailType: 'magic-link',
		metadata: { tenantSlug, clientName },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		const info = await transporter.sendMail(mailOptions);
		await logEmailSuccess(logId, { messageId: info.messageId, response: info.response });
		logInfo('email', 'Magic link email sent', { tenantId: tenant.id, metadata: { email } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', 'Failed to send magic link email', { tenantId: tenant.id, metadata: { email }, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send magic link email');
	}
}

/**
 * Send admin magic link email
 */
export async function sendAdminMagicLinkEmail(
	email: string,
	token: string,
	userName: string
): Promise<void> {
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Use default transporter (not tenant-specific for admin login)
	const transporter = getDefaultTransporter();

	const fromEmail = env.SMTP_FROM || env.SMTP_USER || 'noreply@example.com';
	const appName = 'CRM Admin';
	const loginUrl = `${baseUrl}/login/verify?token=${encodeURIComponent(token)}`;

	const mailOptions = {
		from: `"${appName}" <${fromEmail}>`,
		to: email,
		subject: `Login to ${appName}`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Login to ${appName}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					<h1 style="color: #2563eb; margin-top: 0;">Welcome to ${appName}</h1>
					<p>Dear ${userName},</p>
					<p>You have requested a magic link to log in to your admin account.</p>
					<p>Click the button below to log in. This link will expire in 24 hours.</p>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${loginUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Log In to Admin Panel</a>
					</div>
					<p style="font-size: 14px; color: #666;">Or copy and paste this link into your browser:</p>
					<p style="font-size: 12px; color: #999; word-break: break-all;">${loginUrl}</p>
					<div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; border-radius: 4px;">
						<p style="margin: 0; font-size: 14px; color: #856404;">
							<strong>Security Notice:</strong> This link is valid for 24 hours and can only be used once. If you did not request this link, please ignore this email.
						</p>
					</div>
					<p style="font-size: 12px; color: #999; margin-top: 30px;">If you have any questions, please contact your administrator.</p>
				</div>
			</body>
			</html>
		`,
		text: `
			Welcome to ${appName}

			Dear ${userName},

			You have requested a magic link to log in to your admin account.

			Click the link below to log in. This link will expire in 24 hours.

			${loginUrl}

			Security Notice: This link is valid for 24 hours and can only be used once. If you did not request this link, please ignore this email.

			If you have any questions, please contact your administrator.
		`
	};

	const logId = await logEmailAttempt({
		tenantId: null,
		toEmail: email,
		subject: mailOptions.subject,
		emailType: 'admin-magic-link',
		metadata: { userName },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		const info = await transporter.sendMail(mailOptions);
		await logEmailSuccess(logId, { messageId: info.messageId, response: info.response });
		logInfo('email', 'Admin magic link email sent', { metadata: { email } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', 'Failed to send admin magic link email', { metadata: { email }, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send magic link email');
	}
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
	email: string,
	token: string,
	userName: string
): Promise<void> {
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	const transporter = getDefaultTransporter();

	const fromEmail = env.SMTP_FROM || env.SMTP_USER || 'noreply@example.com';
	const appName = 'CRM Admin';
	const resetUrl = `${baseUrl}/login/reset-password/${encodeURIComponent(token)}`;

	const mailOptions = {
		from: `"${appName}" <${fromEmail}>`,
		to: email,
		subject: `Reset your password - ${appName}`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Reset Password - ${appName}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					<h1 style="color: #2563eb; margin-top: 0;">Reset your password</h1>
					<p>Dear ${userName},</p>
					<p>You have requested to reset your password for your admin account.</p>
					<p>Click the button below to set a new password. This link will expire in 1 hour.</p>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${resetUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Reset Password</a>
					</div>
					<p style="font-size: 14px; color: #666;">Or copy and paste this link into your browser:</p>
					<p style="font-size: 12px; color: #999; word-break: break-all;">${resetUrl}</p>
					<div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; border-radius: 4px;">
						<p style="margin: 0; font-size: 14px; color: #856404;">
							<strong>Security Notice:</strong> This link is valid for 1 hour and can only be used once. If you did not request this, please ignore this email and your password will remain unchanged.
						</p>
					</div>
					<p style="font-size: 12px; color: #999; margin-top: 30px;">If you have any questions, please contact your administrator.</p>
				</div>
			</body>
			</html>
		`,
		text: `
			Reset your password

			Dear ${userName},

			You have requested to reset your password for your admin account.

			Click the link below to set a new password. This link will expire in 1 hour.

			${resetUrl}

			Security Notice: This link is valid for 1 hour and can only be used once. If you did not request this, please ignore this email and your password will remain unchanged.

			If you have any questions, please contact your administrator.
		`
	};

	const logId = await logEmailAttempt({
		tenantId: null,
		toEmail: email,
		subject: mailOptions.subject,
		emailType: 'password-reset',
		metadata: { userName },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		const info = await transporter.sendMail(mailOptions);
		await logEmailSuccess(logId, { messageId: info.messageId, response: info.response });
		logInfo('email', 'Password reset email sent', { metadata: { email } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', 'Failed to send password reset email', { metadata: { email }, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send password reset email');
	}
}

/**
 * Send task assignment email
 */
export async function sendTaskAssignmentEmail(
	taskId: string,
	assigneeEmail: string,
	assigneeName?: string
): Promise<void> {
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get task details
	const [task] = await db.select().from(table.task).where(eq(table.task.id, taskId)).limit(1);

	if (!task) {
		throw new Error('Task not found');
	}

	// Get tenant-specific transporter
	const transporter = await getTenantTransporter(task.tenantId);
	if (!transporter) {
		throw new Error('Email transporter not available');
	}

	// Get tenant details
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, task.tenantId))
		.limit(1);

	// Get tenant email settings to determine from email
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
	const { logoAttachment: assignLogoAttachment, logoHtml: assignLogoHtml } = prepareLogoAttachment(invoiceSettings?.invoiceLogo);

	const fromEmail =
		emailSettings?.smtpFrom ||
		emailSettings?.smtpUser ||
		env.SMTP_FROM ||
		env.SMTP_USER ||
		'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';
	const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${taskId}`;

	const assignStatusColors = getEmailStatusColors(task.status);
	const assignPriorityColors = getEmailPriorityColors(task.priority);
	const assignStatusLabel = formatStatusLabel(task.status || 'todo');
	const assignPriorityLabel = formatPriorityLabel(task.priority || 'medium');
	const assignBadgeStyle = 'display:inline-block; padding:3px 12px; border-radius:9999px; font-size:13px; font-weight:600;';
	const assignDotStyle = (color: string) => `display:inline-block; width:8px; height:8px; border-radius:50%; background:${color}; margin-right:6px; vertical-align:middle;`;
	const assignStatusBadge = `<span style="${assignBadgeStyle} background:${assignStatusColors.bg}; color:${assignStatusColors.text};"><span style="${assignDotStyle(assignStatusColors.dot)}"></span>${assignStatusLabel}</span>`;
	const assignPriorityBadge = `<span style="${assignBadgeStyle} background:${assignPriorityColors.bg}; color:${assignPriorityColors.text};">${assignPriorityLabel}</span>`;

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: assigneeEmail,
		subject: `New Task Assigned: ${task.title}`,
		...(assignLogoAttachment ? { attachments: [assignLogoAttachment] } : {}),
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Task Assigned: ${task.title}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					${assignLogoHtml}
					<h1 style="color: #2563eb; margin-top: 0;">Task Assigned to You</h1>
					<p>Hello ${assigneeName || 'there'},</p>
					<p>You have been assigned a new task:</p>
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0;">
						<h2 style="margin-top: 0; color: #2563eb;">${task.title}</h2>
						${task.description ? `<p style="color: #666;">${task.description}</p>` : ''}
						<p><strong>Priority:</strong> ${assignPriorityBadge}</p>
						<p><strong>Status:</strong> ${assignStatusBadge}</p>
						${task.dueDate ? `<p><strong>Due Date:</strong> ${formatDateRo(task.dueDate)}</p>` : ''}
					</div>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${taskUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">View Task</a>
					</div>
					<p style="color: #999; font-size: 12px; margin-top: 20px; text-align: center;">Sent automatically by ${tenantName}.</p>
				</div>
			</body>
			</html>
		`,
		text: `
			Task Assigned to You

			Hello ${assigneeName || 'there'},

			You have been assigned a new task:

			${task.title}
			${task.description ? `\n${task.description}\n` : ''}
			Priority: ${task.priority || 'Medium'}
			Status: ${task.status || 'Todo'}
			${task.dueDate ? `Due Date: ${formatDateRo(task.dueDate)}\n` : ''}

			View task: ${taskUrl}
		`
	};

	const logId = await logEmailAttempt({
		tenantId: task.tenantId,
		toEmail: assigneeEmail,
		subject: mailOptions.subject,
		emailType: 'task-assignment',
		metadata: { taskId, taskTitle: task.title },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		const info = await transporter.sendMail(mailOptions);
		await logEmailSuccess(logId, { messageId: info.messageId, response: info.response });
		logInfo('email', 'Task assignment email sent', { tenantId: task.tenantId, metadata: { email: assigneeEmail, taskId } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', 'Failed to send task assignment email', { tenantId: task.tenantId, metadata: { email: assigneeEmail, taskId }, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send task assignment email');
	}
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
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get task details
	const [task] = await db.select().from(table.task).where(eq(table.task.id, taskId)).limit(1);

	if (!task) {
		throw new Error('Task not found');
	}

	// Get tenant-specific transporter
	const transporter = await getTenantTransporter(task.tenantId);
	if (!transporter) {
		throw new Error('Email transporter not available');
	}

	// Get tenant details
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, task.tenantId))
		.limit(1);

	// Get tenant email settings to determine from email
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
	const { logoAttachment: updLogoAttachment, logoHtml: updLogoHtml } = prepareLogoAttachment(updInvoiceSettings?.invoiceLogo);

	const fromEmail =
		emailSettings?.smtpFrom ||
		emailSettings?.smtpUser ||
		env.SMTP_FROM ||
		env.SMTP_USER ||
		'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';
	const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${taskId}`;

	const changeDescription =
		changeType === 'status'
			? 'status was updated'
			: changeType === 'assigned'
				? 'assignment was changed'
				: changeType === 'dueDate'
					? 'due date was updated'
					: 'task was updated';

	const updStatusColors = getEmailStatusColors(task.status);
	const updPriorityColors = getEmailPriorityColors(task.priority);
	const updStatusLabel = formatStatusLabel(task.status || 'todo');
	const updPriorityLabel = formatPriorityLabel(task.priority || 'medium');
	const updBadgeStyle = 'display:inline-block; padding:3px 12px; border-radius:9999px; font-size:13px; font-weight:600;';
	const updDotStyle = (color: string) => `display:inline-block; width:8px; height:8px; border-radius:50%; background:${color}; margin-right:6px; vertical-align:middle;`;
	const updStatusBadge = `<span style="${updBadgeStyle} background:${updStatusColors.bg}; color:${updStatusColors.text};"><span style="${updDotStyle(updStatusColors.dot)}"></span>${updStatusLabel}</span>`;
	const updPriorityBadge = `<span style="${updBadgeStyle} background:${updPriorityColors.bg}; color:${updPriorityColors.text};">${updPriorityLabel}</span>`;

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: watcherEmail,
		subject: `Task Updated: ${task.title}`,
		...(updLogoAttachment ? { attachments: [updLogoAttachment] } : {}),
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Task Updated: ${task.title}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					${updLogoHtml}
					<h1 style="color: #2563eb; margin-top: 0;">Task Updated</h1>
					<p>Hello ${watcherName || 'there'},</p>
					<p>A task you're watching has been updated:</p>
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0;">
						<h2 style="margin-top: 0; color: #2563eb;">${task.title}</h2>
						<p><strong>What changed:</strong> The task's ${changeDescription}.</p>
						${task.description ? `<p style="color: #666;">${task.description}</p>` : ''}
						<p><strong>Priority:</strong> ${updPriorityBadge}</p>
						<p><strong>Status:</strong> ${updStatusBadge}</p>
						${task.dueDate ? `<p><strong>Due Date:</strong> ${formatDateRo(task.dueDate)}</p>` : ''}
					</div>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${taskUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">View Task</a>
					</div>
					<p style="color: #999; font-size: 12px; margin-top: 20px; text-align: center;">Sent automatically by ${tenantName}.</p>
				</div>
			</body>
			</html>
		`,
		text: `
			Task Updated

			Hello ${watcherName || 'there'},

			A task you're watching has been updated:

			${task.title}
			What changed: The task's ${changeDescription}.

			${task.description ? `\n${task.description}\n` : ''}
			Priority: ${task.priority || 'Medium'}
			Status: ${task.status || 'Todo'}
			${task.dueDate ? `Due Date: ${formatDateRo(task.dueDate)}\n` : ''}

			View task: ${taskUrl}
		`
	};

	const logId = await logEmailAttempt({
		tenantId: task.tenantId,
		toEmail: watcherEmail,
		subject: mailOptions.subject,
		emailType: 'task-update',
		metadata: { taskId, taskTitle: task.title, changeType },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		const info = await transporter.sendMail(mailOptions);
		await logEmailSuccess(logId, { messageId: info.messageId, response: info.response });
		logInfo('email', 'Task update email sent', { tenantId: task.tenantId, metadata: { email: watcherEmail, taskId } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', 'Failed to send task update email', { tenantId: task.tenantId, metadata: { email: watcherEmail, taskId }, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send task update email');
	}
}

/**
 * Send task notification email to client
 */
export async function sendTaskClientNotificationEmail(
	taskId: string,
	clientEmail: string,
	clientName: string,
	notificationType: 'created' | 'status-change' | 'comment' | 'modified',
	extra?: { newStatus?: string; commentPreview?: string; changedFields?: string }
): Promise<void> {
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	const [task] = await db.select().from(table.task).where(eq(table.task.id, taskId)).limit(1);
	if (!task) {
		throw new Error('Task not found');
	}

	const transporter = await getTenantTransporter(task.tenantId);
	if (!transporter) {
		throw new Error('Email transporter not available');
	}

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
	const { logoAttachment, logoHtml } = prepareLogoAttachment(invoiceSettings?.invoiceLogo);

	const fromEmail =
		emailSettings?.smtpFrom ||
		emailSettings?.smtpUser ||
		env.SMTP_FROM ||
		env.SMTP_USER ||
		'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';
	const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${taskId}`;

	// Subject and description based on notification type
	let subject: string;
	let changeDescription: string;
	let headerColor = '#2563eb';

	switch (notificationType) {
		case 'created':
			subject = `Task nou: ${task.title}`;
			changeDescription = 'Un task nou a fost creat pentru dumneavoastră.';
			break;
		case 'status-change': {
			const statusLabels: Record<string, string> = {
				'todo': 'De făcut',
				'in-progress': 'În lucru',
				'review': 'În review',
				'done': 'Finalizat',
				'cancelled': 'Anulat',
				'pending-approval': 'Așteaptă aprobare'
			};
			const statusLabel = statusLabels[extra?.newStatus || task.status] || extra?.newStatus || task.status;
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

	const badgeStyle = 'display:inline-block; padding:3px 12px; border-radius:9999px; font-size:13px; font-weight:600;';
	const dotStyle = (color: string) => `display:inline-block; width:8px; height:8px; border-radius:50%; background:${color}; margin-right:6px; vertical-align:middle;`;

	const statusBadge = `<span style="${badgeStyle} background:${statusColors.bg}; color:${statusColors.text};"><span style="${dotStyle(statusColors.dot)}"></span>${statusLabel}</span>`;
	const priorityBadge = `<span style="${badgeStyle} background:${priorityColors.bg}; color:${priorityColors.text};">${priorityLabel}</span>`;

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: clientEmail,
		subject,
		...(logoAttachment ? { attachments: [logoAttachment] } : {}),
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>${subject}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					${logoHtml}
					<h1 style="color: ${headerColor}; margin-top: 0;">${subject}</h1>
					<p>Bună ${clientName || 'ziua'},</p>
					<p>${changeDescription}</p>
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0;">
						<h2 style="margin-top: 0; color: #2563eb;">${task.title}</h2>
						${task.description ? `<p style="color: #666;">${task.description}</p>` : ''}
						<p><strong>Prioritate:</strong> ${priorityBadge}</p>
						<p><strong>Status:</strong> ${statusBadge}</p>
						${task.dueDate ? `<p><strong>Termen:</strong> ${formatDateRo(task.dueDate)}</p>` : ''}
					</div>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${taskUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Vezi Task</a>
					</div>
					<p style="color: #999; font-size: 12px; margin-top: 20px; text-align: center;">Acest email a fost trimis automat de ${tenantName}.</p>
				</div>
			</body>
			</html>
		`,
		text: `
${subject}

Bună ${clientName || 'ziua'},

${changeDescription.replace(/<[^>]+>/g, '')}

${task.title}
${task.description ? `\n${task.description}\n` : ''}
Prioritate: ${task.priority || 'Medium'}
Status: ${task.status || 'Todo'}
${task.dueDate ? `Termen: ${formatDateRo(task.dueDate)}\n` : ''}

Vezi task: ${taskUrl}
		`
	};

	const logId = await logEmailAttempt({
		tenantId: task.tenantId,
		toEmail: clientEmail,
		subject: mailOptions.subject,
		emailType: 'task-client-notification',
		metadata: { taskId, taskTitle: task.title, notificationType, ...extra },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		logInfo('email', `Sending task client ${notificationType} notification`, { tenantId: task.tenantId, metadata: { email: clientEmail, taskId } });
		const info = await sendMailWithRetry(transporter, mailOptions, task.tenantId, logId);
		await logEmailSuccess(logId, info);
		logInfo('email', `Task client ${notificationType} notification sent`, { tenantId: task.tenantId, metadata: { email: clientEmail, taskId } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', `Failed to send task client ${notificationType} notification`, { tenantId: task.tenantId, metadata: { email: clientEmail, taskId }, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send task client notification email');
	}
}

/**
 * Send invoice paid confirmation email
 */
export async function sendInvoicePaidEmail(invoiceId: string, clientEmail: string): Promise<void> {
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get invoice details
	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.limit(1);

	if (!invoice) {
		throw new Error('Invoice not found');
	}

	// Get tenant-specific transporter
	const transporter = await getTenantTransporter(invoice.tenantId);
	if (!transporter) {
		throw new Error('Email transporter not available');
	}

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

	const fromEmail =
		emailSettings?.smtpFrom ||
		emailSettings?.smtpUser ||
		env.SMTP_FROM ||
		env.SMTP_USER ||
		'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';

	// Generate public view token and URL (accessible without authentication)
	const rawToken = await createInvoiceViewToken(invoiceId, invoice.tenantId);
	const invoiceUrl = `${baseUrl}/invoice/${tenant?.slug || 'tenant'}/${encodeURIComponent(rawToken)}`;

	// Get invoice settings for logo
	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, invoice.tenantId))
		.limit(1);

	const { logoAttachment, logoHtml } = prepareLogoAttachment(invoiceSettings?.invoiceLogo);

	// Format amounts
	const formatAmount = (cents: number | null | undefined, currency: string) => {
		if (cents === null || cents === undefined) return 'N/A';
		const amount = (cents / 100).toFixed(2);
		return `${amount} ${currency}`;
	};

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: clientEmail,
		subject: `Plata primita: Factura ${invoice.invoiceNumber}`,
		...(logoAttachment ? { attachments: [logoAttachment] } : {}),
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Plata primita: Factura ${invoice.invoiceNumber}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					${logoHtml}
					<h1 style="color: #10b981; margin-top: 0;">Plata primita</h1>
					<p>Stimate/Stimata ${client?.name || 'Client'},</p>
					<p>Am primit plata pentru urmatoarea factura:</p>
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #10b981;">
						<p><strong>Numar factura:</strong> ${invoice.invoiceNumber}</p>
						<p><strong>Suma platita:</strong> ${formatAmount(invoice.totalAmount, invoice.currency)}</p>
						${invoice.paidDate ? `<p><strong>Data plata:</strong> ${formatDateRo(invoice.paidDate)}</p>` : ''}
						${invoice.issueDate ? `<p><strong>Data emitere:</strong> ${formatDateRo(invoice.issueDate)}</p>` : ''}
					</div>
					<p style="color: #10b981; font-weight: bold;">Va multumim pentru plata!</p>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${invoiceUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Vezi Factura</a>
					</div>
					<p style="font-size: 12px; color: #999;">Pentru intrebari, nu ezitati sa ne contactati.</p>
				</div>
			</body>
			</html>
		`,
		text: `
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
		`
	};

	const logId = await logEmailAttempt({
		tenantId: invoice.tenantId,
		toEmail: clientEmail,
		subject: mailOptions.subject,
		emailType: 'invoice-paid',
		metadata: { invoiceId, invoiceNumber: invoice.invoiceNumber },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		const info = await sendMailWithRetry(transporter, mailOptions, invoice.tenantId, logId);
		await logEmailSuccess(logId, { messageId: info.messageId, response: info.response });
		logInfo('email', 'Invoice paid email sent', { tenantId: invoice.tenantId, metadata: { email: clientEmail, invoiceNumber: invoice.invoiceNumber } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', 'Failed to send invoice paid email', { tenantId: invoice.tenantId, metadata: { email: clientEmail, invoiceNumber: invoice.invoiceNumber }, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send invoice paid email');
	}
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

	// Get invoice details
	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.limit(1);

	if (!invoice) {
		throw new Error('Invoice not found');
	}

	// Get tenant-specific transporter
	const transporter = await getTenantTransporter(invoice.tenantId);
	if (!transporter) {
		throw new Error('Email transporter not available');
	}

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

	const fromEmail =
		emailSettings?.smtpFrom ||
		emailSettings?.smtpUser ||
		env.SMTP_FROM ||
		env.SMTP_USER ||
		'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';

	// Generate public view token and URL
	const rawToken = await createInvoiceViewToken(invoiceId, invoice.tenantId);
	const invoiceUrl = `${baseUrl}/invoice/${tenant?.slug || 'tenant'}/${encodeURIComponent(rawToken)}`;

	// Get invoice settings for PDF generation
	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, invoice.tenantId))
		.limit(1);

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
		logWarning('email', 'Could not generate PDF attachment for overdue reminder', {
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

	const dueDateStr = formatDateRo(invoice.dueDate);

	// Prepare logo
	const { logoAttachment, logoHtml } = prepareLogoAttachment(invoiceSettings?.invoiceLogo);

	// IBAN payment details
	const ibanHtml = tenant?.iban
		? `<div style="background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; border-left: 4px solid #2563eb;">
				<p style="font-weight: bold; margin-top: 0;">Date pentru plata:</p>
				${tenant.bankName ? `<p style="margin: 4px 0;"><strong>Banca:</strong> ${tenant.bankName}</p>` : ''}
				<p style="margin: 4px 0;"><strong>IBAN (LEI):</strong> ${tenant.iban}</p>
				${tenant.ibanEuro ? `<p style="margin: 4px 0;"><strong>IBAN (EUR):</strong> ${tenant.ibanEuro}</p>` : ''}
			</div>`
		: '';

	const ibanText = tenant?.iban
		? `\n\t\t\tDate pentru plata:${tenant.bankName ? `\n\t\t\tBanca: ${tenant.bankName}` : ''}\n\t\t\tIBAN (LEI): ${tenant.iban}${tenant.ibanEuro ? `\n\t\t\tIBAN (EUR): ${tenant.ibanEuro}` : ''}\n`
		: '';

	const attachments = [
		...(pdfAttachment ? [pdfAttachment] : []),
		...(logoAttachment ? [logoAttachment] : [])
	];

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: clientEmail,
		subject: `Reminder: Factura ${invoice.invoiceNumber} este restanta de ${daysOverdue} zile`,
		...(attachments.length > 0 ? { attachments } : {}),
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Reminder: Factura ${invoice.invoiceNumber}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					${logoHtml}
					<h1 style="color: #d97706; margin-top: 0;">Reminder plata factura</h1>
					<p>Stimate/Stimata ${client?.name || 'Client'},</p>
					<p>Va reamintim ca factura de mai jos este restanta de <strong>${daysOverdue} zile</strong>.</p>
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #d97706;">
						<p><strong>Numar factura:</strong> ${invoice.invoiceNumber}</p>
						<p><strong>Suma de plata:</strong> ${formatAmount(invoice.totalAmount, invoice.currency)}</p>
						<p><strong>Data scadenta:</strong> ${dueDateStr}</p>
						<p style="color: #d97706;"><strong>Zile restanta:</strong> ${daysOverdue}</p>
						${reminderNumber > 1 ? `<p style="font-size: 12px; color: #999;">Reminder #${reminderNumber}</p>` : ''}
					</div>
					${ibanHtml}
					<p>Va rugam sa efectuati plata cat mai curand posibil.</p>
					${pdfAttachment ? '<p style="font-size: 13px; color: #666;">Factura este atasata in format PDF la acest email.</p>' : ''}
					<div style="text-align: center; margin: 30px 0;">
						<a href="${invoiceUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">Vezi Factura Online</a>
					</div>
					<p style="font-size: 12px; color: #999; margin-top: 30px;">Daca ati efectuat deja plata, va rugam sa ignorati acest email. Pentru intrebari, nu ezitati sa ne contactati.</p>
				</div>
			</body>
			</html>
		`,
		text: `
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
		`
	};

	const logId = await logEmailAttempt({
		tenantId: invoice.tenantId,
		toEmail: clientEmail,
		subject: mailOptions.subject,
		emailType: 'invoice-overdue-reminder',
		metadata: { invoiceId, invoiceNumber: invoice.invoiceNumber, daysOverdue, reminderNumber },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		const info = await sendMailWithRetry(transporter, mailOptions, invoice.tenantId, logId);
		await logEmailSuccess(logId, { messageId: info.messageId, response: info.response });
		logInfo('email', 'Overdue reminder email sent', { tenantId: invoice.tenantId, metadata: { email: clientEmail, invoiceNumber: invoice.invoiceNumber, daysOverdue, reminderNumber } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', 'Failed to send overdue reminder email', { tenantId: invoice.tenantId, metadata: { email: clientEmail, invoiceNumber: invoice.invoiceNumber }, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send overdue reminder email');
	}
}

/**
 * Send task reminder email
 */
export async function sendTaskReminderEmail(
	taskId: string,
	assigneeEmail: string,
	assigneeName?: string
): Promise<void> {
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get task details
	const [task] = await db.select().from(table.task).where(eq(table.task.id, taskId)).limit(1);

	if (!task || !task.dueDate) {
		throw new Error('Task not found or has no due date');
	}

	// Get tenant-specific transporter
	const transporter = await getTenantTransporter(task.tenantId);
	if (!transporter) {
		throw new Error('Email transporter not available');
	}

	// Get tenant details
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, task.tenantId))
		.limit(1);

	// Get tenant email settings to determine from email
	const [emailSettings] = await db
		.select()
		.from(table.emailSettings)
		.where(eq(table.emailSettings.tenantId, task.tenantId))
		.limit(1);

	const fromEmail =
		emailSettings?.smtpFrom ||
		emailSettings?.smtpUser ||
		env.SMTP_FROM ||
		env.SMTP_USER ||
		'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';
	const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${taskId}`;

	const dueDate = new Date(task.dueDate);
	const now = new Date();
	const isOverdue = dueDate < now;
	const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: assigneeEmail,
		subject: isOverdue
			? `Overdue Task Reminder: ${task.title}`
			: `Task Reminder: ${task.title} - Due ${daysUntilDue === 0 ? 'Today' : `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`}`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Task Reminder: ${task.title}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					<h1 style="color: ${isOverdue ? '#dc2626' : '#f59e0b'}; margin-top: 0;">${isOverdue ? 'Overdue Task Reminder' : 'Task Reminder'}</h1>
					<p>Hello ${assigneeName || 'there'},</p>
					${isOverdue ? '<p style="color: #dc2626; font-weight: bold;">This task is overdue!</p>' : `<p>This task is due ${daysUntilDue === 0 ? 'today' : `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`}.</p>`}
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid ${isOverdue ? '#dc2626' : '#f59e0b'};">
						<h2 style="margin-top: 0; color: #2563eb;">${task.title}</h2>
						${task.description ? `<p style="color: #666;">${task.description}</p>` : ''}
						<p><strong>Priority:</strong> ${task.priority || 'Medium'}</p>
						<p><strong>Status:</strong> ${task.status || 'Todo'}</p>
						<p><strong>Due Date:</strong> <span style="color: ${isOverdue ? '#dc2626' : '#333'};">${formatDateRo(dueDate)}</span></p>
					</div>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${taskUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">View Task</a>
					</div>
				</div>
			</body>
			</html>
		`,
		text: `
			${isOverdue ? 'Overdue Task Reminder' : 'Task Reminder'}

			Hello ${assigneeName || 'there'},

			${isOverdue ? 'This task is overdue!' : `This task is due ${daysUntilDue === 0 ? 'today' : `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`}.`}

			${task.title}
			${task.description ? `\n${task.description}\n` : ''}
			Priority: ${task.priority || 'Medium'}
			Status: ${task.status || 'Todo'}
			Due Date: ${formatDateRo(dueDate)}

			View task: ${taskUrl}
		`
	};

	const logId = await logEmailAttempt({
		tenantId: task.tenantId,
		toEmail: assigneeEmail,
		subject: mailOptions.subject,
		emailType: 'task-reminder',
		metadata: { taskId, taskTitle: task.title, isOverdue },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		const info = await transporter.sendMail(mailOptions);
		await logEmailSuccess(logId, { messageId: info.messageId, response: info.response });
		logInfo('email', 'Task reminder email sent', { tenantId: task.tenantId, metadata: { email: assigneeEmail, taskId } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', 'Failed to send task reminder email', { tenantId: task.tenantId, metadata: { email: assigneeEmail, taskId }, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send task reminder email');
	}
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
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	// Get user details
	const [user] = await db.select().from(table.user).where(eq(table.user.id, userId)).limit(1);

	if (!user?.email) {
		throw new Error('User email not found');
	}

	// Get tenant-specific transporter
	const transporter = await getTenantTransporter(tenantId);
	if (!transporter) {
		throw new Error('Email transporter not available');
	}

	// Get tenant details
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);

	// Get tenant email settings to determine from email
	const [emailSettings] = await db
		.select()
		.from(table.emailSettings)
		.where(eq(table.emailSettings.tenantId, tenantId))
		.limit(1);

	const fromEmail =
		emailSettings?.smtpFrom ||
		emailSettings?.smtpUser ||
		env.SMTP_FROM ||
		env.SMTP_USER ||
		'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';
	const myPlansUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/my-plans`;

	// Format priority badge color
	const getPriorityColor = (priority: string | null) => {
		switch (priority) {
			case 'urgent':
				return '#dc2626';
			case 'high':
				return '#f59e0b';
			case 'medium':
				return '#2563eb';
			case 'low':
				return '#10b981';
			default:
				return '#6b7280';
		}
	};

	// Format tasks list HTML
	const tasksListHtml = tasks
		.map((task) => {
			const priorityColor = getPriorityColor(task.priority);
			const taskUrl = `${baseUrl}/${tenant?.slug || 'tenant'}/tasks/${task.id}`;
			const dueDate = task.dueDate ? formatDateRo(task.dueDate) : 'No due date';
			return `
				<div style="background-color: white; padding: 16px; border-radius: 6px; margin-bottom: 12px; border-left: 4px solid ${priorityColor};">
					<h3 style="margin: 0 0 8px 0; color: #2563eb;">
						<a href="${taskUrl}" style="color: #2563eb; text-decoration: none;">${task.title}</a>
					</h3>
					${task.description ? `<p style="color: #666; margin: 8px 0; font-size: 14px;">${task.description}</p>` : ''}
					<div style="display: flex; gap: 16px; margin-top: 12px; font-size: 14px;">
						<span><strong>Priority:</strong> <span style="color: ${priorityColor};">${task.priority || 'Medium'}</span></span>
						<span><strong>Status:</strong> ${task.status || 'Todo'}</span>
						<span><strong>Due:</strong> ${dueDate}</span>
					</div>
				</div>
			`;
		})
		.join('');

	// Format tasks list text
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

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: user.email,
		subject: `Your Daily Work Plan - ${tasks.length} task${tasks.length !== 1 ? 's' : ''} for today`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Daily Work Reminder</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					<h1 style="color: #2563eb; margin-top: 0;">Good Morning, ${userName}!</h1>
					<p>Here's your work plan for <strong>${today}</strong>:</p>
					<div style="background-color: white; padding: 20px; border-radius: 6px; margin: 20px 0;">
						<h2 style="margin-top: 0; color: #2563eb;">You have ${tasks.length} task${tasks.length !== 1 ? 's' : ''} scheduled for today</h2>
						${tasksListHtml}
					</div>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${myPlansUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">View My Plans</a>
					</div>
					<p style="font-size: 12px; color: #999; margin-top: 30px;">Have a productive day!</p>
				</div>
			</body>
			</html>
		`,
		text: `
			Good Morning, ${userName}!

			Here's your work plan for ${today}:

			You have ${tasks.length} task${tasks.length !== 1 ? 's' : ''} scheduled for today:

			${tasksListText}

			View My Plans: ${myPlansUrl}

			Have a productive day!
		`
	};

	const logId = await logEmailAttempt({
		tenantId,
		toEmail: user.email,
		subject: mailOptions.subject,
		emailType: 'daily-reminder',
		metadata: { userName, taskCount: tasks.length },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		const info = await transporter.sendMail(mailOptions);
		await logEmailSuccess(logId, { messageId: info.messageId, response: info.response });
		logInfo('email', 'Daily work reminder email sent', { tenantId, metadata: { email: user.email, taskCount: tasks.length } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', 'Failed to send daily work reminder email', { tenantId, metadata: { email: user.email }, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send daily work reminder email');
	}
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
	const baseUrl = publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);

	if (!tenant) {
		throw new Error('Tenant not found');
	}

	const transporter = await getTenantTransporter(tenant.id);
	if (!transporter) {
		throw new Error('Email transporter not available');
	}

	const [emailSettings] = await db
		.select()
		.from(table.emailSettings)
		.where(eq(table.emailSettings.tenantId, tenant.id))
		.limit(1);

	const fromEmail =
		emailSettings?.smtpFrom ||
		emailSettings?.smtpUser ||
		env.SMTP_FROM ||
		env.SMTP_USER ||
		'noreply@example.com';
	const tenantName = tenant.name || 'CRM';
	const signingUrl = `${baseUrl}/sign/${tenantSlug}/${encodeURIComponent(rawToken)}`;

	// Get invoice settings for logo
	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenant.id))
		.limit(1);

	const { logoAttachment, logoHtml } = prepareLogoAttachment(invoiceSettings?.invoiceLogo);

	const mailOptions = {
		from: `"${tenantName}" <${fromEmail}>`,
		to: email,
		subject: `Semnare contract ${contractNumber} - ${tenantName}`,
		...(logoAttachment ? { attachments: [logoAttachment] } : {}),
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Semnare contract ${contractNumber}</title>
			</head>
			<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
				<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
					${logoHtml}
					<h1 style="color: #1e293b; margin-top: 0;">${tenantName}</h1>
					<p>Stimate/Stimată ${clientName},</p>
					<p>Ați primit o invitație pentru a semna contractul <strong>${contractNumber}</strong> emis de <strong>${tenantName}</strong>.</p>
					<p>Faceți clic pe butonul de mai jos pentru a vizualiza și semna contractul. Link-ul este valabil 7 zile.</p>
					<div style="text-align: center; margin: 30px 0;">
						<a href="${signingUrl}" style="background-color: #1e293b; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold; font-size: 16px;">Vizualizează și Semnează Contractul</a>
					</div>
					<p style="font-size: 14px; color: #666;">Sau copiați și lipiți acest link în browser:</p>
					<p style="font-size: 12px; color: #999; word-break: break-all;">${signingUrl}</p>
					<div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; border-radius: 4px;">
						<p style="margin: 0; font-size: 14px; color: #856404;">
							<strong>Notă de securitate:</strong> Acest link este valabil 7 zile și poate fi folosit o singură dată. Dacă nu ați solicitat semnarea acestui contract, vă rugăm să ignorați acest email.
						</p>
					</div>
					<p style="font-size: 12px; color: #999; margin-top: 30px;">Pentru orice întrebări, vă rugăm să contactați ${tenantName}.</p>
				</div>
			</body>
			</html>
		`,
		text: `
			${tenantName}

			Stimate/Stimată ${clientName},

			Ați primit o invitație pentru a semna contractul ${contractNumber} emis de ${tenantName}.

			Accesați link-ul de mai jos pentru a vizualiza și semna contractul (valabil 7 zile):

			${signingUrl}

			Notă de securitate: Acest link este valabil 7 zile și poate fi folosit o singură dată.

			Pentru orice întrebări, contactați ${tenantName}.
		`
	};

	const logId = await logEmailAttempt({
		tenantId: tenant.id,
		toEmail: email,
		subject: mailOptions.subject,
		emailType: 'contract-signing',
		metadata: { contractNumber, clientName, tenantSlug },
		htmlBody: mailOptions.html as string
	});

	try {
		await logEmailProcessing(logId);
		const info = await transporter.sendMail(mailOptions);
		await logEmailSuccess(logId, { messageId: info.messageId, response: info.response });
		logInfo('email', 'Contract signing email sent', { tenantId: tenant.id, metadata: { email, contractNumber } });
	} catch (error) {
		await logEmailFailure(logId, (error as Error).message);
		logError('email', 'Failed to send contract signing email', { tenantId: tenant.id, metadata: { email, contractNumber }, stackTrace: serializeError(error).stack });
		throw new Error('Failed to send contract signing email');
	}
}
