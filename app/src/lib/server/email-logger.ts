import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { eq } from 'drizzle-orm';

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
	| 'invoice-overdue-reminder';

function generateId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export async function logEmailAttempt(params: {
	tenantId?: string | null;
	toEmail: string;
	subject: string;
	emailType: EmailType;
	metadata?: Record<string, unknown>;
	htmlBody?: string;
}): Promise<string> {
	const id = generateId();
	try {
		await db.insert(table.emailLog).values({
			id,
			tenantId: params.tenantId ?? null,
			toEmail: params.toEmail,
			subject: params.subject,
			emailType: params.emailType,
			status: 'pending',
			attempts: 0,
			maxAttempts: 3,
			metadata: params.metadata ? JSON.stringify(params.metadata) : null,
			htmlBody: params.htmlBody ?? null,
			createdAt: new Date(),
			updatedAt: new Date()
		});
	} catch (err) {
		console.error('[email-logger] Failed to log email attempt:', err);
	}
	return id;
}

export async function logEmailProcessing(logId: string) {
	try {
		await db
			.update(table.emailLog)
			.set({
				status: 'active',
				processedAt: new Date(),
				attempts: 1,
				updatedAt: new Date()
			})
			.where(eq(table.emailLog.id, logId));
	} catch (err) {
		console.error('[email-logger] Failed to log email processing:', err);
	}
}

export async function logEmailRetry(logId: string, attempt: number, errorMessage: string) {
	try {
		await db
			.update(table.emailLog)
			.set({
				attempts: attempt,
				errorMessage,
				updatedAt: new Date()
			})
			.where(eq(table.emailLog.id, logId));
	} catch (err) {
		console.error('[email-logger] Failed to log email retry:', err);
	}
}

export async function logEmailSuccess(
	logId: string,
	smtpInfo?: { messageId?: string; response?: string }
) {
	try {
		await db
			.update(table.emailLog)
			.set({
				status: 'completed',
				completedAt: new Date(),
				smtpMessageId: smtpInfo?.messageId ?? null,
				smtpResponse: smtpInfo?.response ?? null,
				updatedAt: new Date()
			})
			.where(eq(table.emailLog.id, logId));
	} catch (err) {
		console.error('[email-logger] Failed to log email success:', err);
	}
}

export async function logEmailFailure(logId: string, errorMessage: string) {
	try {
		await db
			.update(table.emailLog)
			.set({
				status: 'failed',
				errorMessage,
				updatedAt: new Date()
			})
			.where(eq(table.emailLog.id, logId));
	} catch (err) {
		console.error('[email-logger] Failed to log email failure:', err);
	}
}
