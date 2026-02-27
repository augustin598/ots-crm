import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { encrypt, decrypt } from '$lib/server/plugins/smartbill/crypto';
import { getTenantTransporter, clearTenantTransporterCache } from '$lib/server/email';

function generateEmailSettingsId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const getEmailSettings = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [settings] = await db
		.select()
		.from(table.emailSettings)
		.where(eq(table.emailSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	// Return default settings if none exist
	if (!settings) {
		return {
			smtpHost: null,
			smtpPort: 587,
			smtpSecure: false,
			smtpUser: null,
			smtpFrom: null,
			isEnabled: true,
			hasPassword: false
		};
	}

	// Never return the password, but indicate if one exists
	return {
		smtpHost: settings.smtpHost,
		smtpPort: settings.smtpPort || 587,
		smtpSecure: settings.smtpSecure || false,
		smtpUser: settings.smtpUser,
		smtpFrom: settings.smtpFrom,
		isEnabled: settings.isEnabled ?? true,
		hasPassword: !!settings.smtpPassword
	};
});

const emailSettingsSchema = v.object({
	smtpHost: v.optional(v.pipe(v.string(), v.minLength(1, 'SMTP Host is required'))),
	smtpPort: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(65535))),
	smtpSecure: v.optional(v.boolean()),
	smtpUser: v.optional(v.pipe(v.string(), v.minLength(1, 'SMTP User is required'))),
	smtpPassword: v.optional(v.string()), // Password is optional when updating (only update if provided)
	smtpFrom: v.optional(v.string()),
	isEnabled: v.optional(v.boolean())
});

export const updateEmailSettings = command(emailSettingsSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Only owners and admins can update email settings
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}

	// Validate that if enabled, required fields are provided
	if (data.isEnabled !== false) {
		if (!data.smtpHost || !data.smtpUser) {
			// Check existing settings
			const [existing] = await db
				.select()
				.from(table.emailSettings)
				.where(eq(table.emailSettings.tenantId, event.locals.tenant.id))
				.limit(1);

			if (!existing?.smtpHost || !existing?.smtpUser) {
				throw new Error('SMTP Host and SMTP User are required when email is enabled');
			}
		}
	}

	// Check if settings exist
	const [existing] = await db
		.select()
		.from(table.emailSettings)
		.where(eq(table.emailSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	const updateData: Partial<typeof table.emailSettings.$inferInsert> = {
		smtpHost: data.smtpHost !== undefined ? data.smtpHost : undefined,
		smtpPort: data.smtpPort !== undefined ? data.smtpPort : undefined,
		smtpSecure: data.smtpSecure !== undefined ? data.smtpSecure : undefined,
		smtpUser: data.smtpUser !== undefined ? data.smtpUser : undefined,
		smtpFrom: data.smtpFrom !== undefined ? data.smtpFrom : undefined,
		isEnabled: data.isEnabled !== undefined ? data.isEnabled : undefined,
		updatedAt: new Date()
	};

	// Only encrypt and update password if provided
	if (data.smtpPassword !== undefined && data.smtpPassword !== '') {
		const encryptedPassword = encrypt(event.locals.tenant.id, data.smtpPassword);
		updateData.smtpPassword = encryptedPassword;
	}

	if (existing) {
		// Update existing settings
		await db
			.update(table.emailSettings)
			.set(updateData)
			.where(eq(table.emailSettings.tenantId, event.locals.tenant.id));

		// Clear cached transporter so new settings are used
		clearTenantTransporterCache(event.locals.tenant.id);
	} else {
		// Create new settings
		const settingsId = generateEmailSettingsId();

		// Validate required fields for new settings
		if (!data.smtpHost || !data.smtpUser) {
			throw new Error('SMTP Host and SMTP User are required');
		}

		if (!data.smtpPassword || data.smtpPassword === '') {
			throw new Error('SMTP Password is required');
		}

		const encryptedPassword = encrypt(event.locals.tenant.id, data.smtpPassword);

		await db.insert(table.emailSettings).values({
			id: settingsId,
			tenantId: event.locals.tenant.id,
			smtpHost: data.smtpHost,
			smtpPort: data.smtpPort || 587,
			smtpSecure: data.smtpSecure || false,
			smtpUser: data.smtpUser,
			smtpPassword: encryptedPassword,
			smtpFrom: data.smtpFrom || null,
			isEnabled: data.isEnabled ?? true
		});

		// Clear cached transporter so new settings are used
		clearTenantTransporterCache(event.locals.tenant.id);
	}

	return { success: true };
});

export const testEmailSettings = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Only owners and admins can test email settings
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}

	// Get email settings
	const [settings] = await db
		.select()
		.from(table.emailSettings)
		.where(eq(table.emailSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	if (!settings || !settings.isEnabled || !settings.smtpHost || !settings.smtpUser) {
		throw new Error('Email settings are not configured or enabled');
	}

	// Clear cached transporter to ensure fresh settings are used for test
	clearTenantTransporterCache(event.locals.tenant.id);

	// Get transporter using tenant-specific settings
	const transporter = await getTenantTransporter(event.locals.tenant.id);
	if (!transporter) {
		throw new Error('Failed to create email transporter. Please check your SMTP settings.');
	}

	// Get tenant details
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, event.locals.tenant.id))
		.limit(1);

	const fromEmail = settings.smtpFrom || settings.smtpUser || 'noreply@example.com';
	const tenantName = tenant?.name || 'CRM';
	const userEmail = event.locals.user.email;

	try {
		await transporter.sendMail({
			from: `"${tenantName}" <${fromEmail}>`,
			to: userEmail,
			subject: `Test Email from ${tenantName}`,
			html: `
				<!DOCTYPE html>
				<html>
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>Test Email</title>
				</head>
				<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
					<div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
						<h1 style="color: #10b981; margin-top: 0;">Test Email Successful!</h1>
						<p>Hello ${event.locals.user.firstName || 'there'},</p>
						<p>This is a test email from <strong>${tenantName}</strong>.</p>
						<p>If you received this email, your SMTP settings are configured correctly.</p>
						<p style="font-size: 12px; color: #999; margin-top: 30px;">
							Sent at ${new Date().toLocaleString()}
						</p>
					</div>
				</body>
				</html>
			`,
			text: `
				Test Email Successful!
				
				Hello ${event.locals.user.firstName || 'there'},
				
				This is a test email from ${tenantName}.
				
				If you received this email, your SMTP settings are configured correctly.
				
				Sent at ${new Date().toLocaleString()}
			`
		});

		return { success: true, message: `Test email sent successfully to ${userEmail}` };
	} catch (error) {
		console.error('Failed to send test email:', error);
		throw new Error(
			`Failed to send test email: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
});
