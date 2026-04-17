import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { eq } from 'drizzle-orm';
import { logWarning } from '$lib/server/logger';

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
	| 'notification_alert';

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
	payload?: { sendFn: string; args: unknown[] } | null;
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
			payload: params.payload ? JSON.stringify(params.payload) : null,
			createdAt: new Date(),
			updatedAt: new Date()
		});
	} catch (err) {
		console.error('[email-logger] Failed to log email attempt:', err);
		// Re-throw so sendWithPersistence knows the log row doesn't exist.
		// Without this, all subsequent log updates silently fail on a phantom ID.
		throw err;
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
		logWarning('email', `Failed to log email processing for ${logId}: ${(err as Error).message}`);
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
		logWarning('email', `Failed to log email retry for ${logId}: ${(err as Error).message}`);
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
		logWarning('email', `Failed to log email success for ${logId}: ${(err as Error).message}`);
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
		// Critical: if we can't mark the email as failed, it stays 'pending' forever.
		// Log to structured logger so admin has visibility.
		logWarning('email', `CRITICAL: Failed to log email failure for ${logId}: ${(err as Error).message}`);
	}
}
