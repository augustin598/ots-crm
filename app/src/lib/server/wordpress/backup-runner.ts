import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import type {
	WpBackupJobProgress,
	WpClient,
	WpRestoreJobProgress
} from './client';
import { WpError } from './errors';
import { driveSteps, isRetryableWpError, STEP_BUDGET_SEC } from './backup-jobs';

type SiteRef = { id: string; tenantId: string; siteUrl: string };

export type BackupAdvance =
	| {
			status: 'running';
			phase?: string;
			progress?: WpBackupJobProgress;
			sizeBytes?: number;
			/** The last step failed on the transport; the browser retries it. */
			retryable?: boolean;
			error?: string;
	  }
	| { status: 'success'; sizeBytes: number; skipped: number }
	| { status: 'failed'; error: string };

export type RestoreAdvance =
	| {
			status: 'running';
			phase?: string;
			progress?: WpRestoreJobProgress;
			retryable?: boolean;
			error?: string;
	  }
	| { status: 'success' }
	| { status: 'failed'; error: string };

function describeError(err: unknown): { code: string; message: string } {
	const { message } = serializeError(err);
	return { code: WpError.isWpError(err) ? err.code : 'unknown_error', message };
}

/**
 * Run backup steps for up to ~20 s and persist the outcome on the
 * `wordpress_backup` row. A transport failure keeps the job `running`
 * (the connector resumes from its cursor); anything else fails it.
 */
export async function advanceBackup(args: {
	client: WpClient;
	site: SiteRef;
	backupId: string;
	backupName: string;
	userId: string;
}): Promise<BackupAdvance> {
	const { client, site, backupId, backupName, userId } = args;
	try {
		const r = await driveSteps(() =>
			client.backupStep(backupName, { budgetSec: STEP_BUDGET_SEC, siteId: site.id })
		);
		if (r.done) {
			const sizeBytes = r.sizeBytes ?? 0;
			await db
				.update(table.wordpressBackup)
				.set({ status: 'success', sizeBytes, error: null, finishedAt: new Date() })
				.where(eq(table.wordpressBackup.id, backupId));
			logInfo('wordpress', `Backup OK for ${site.siteUrl} — ${(sizeBytes / 1024 / 1024).toFixed(1)} MB (chunked)`, {
				tenantId: site.tenantId,
				userId,
				metadata: { siteId: site.id, backupId, backupName, sizeBytes, skipped: r.skipped ?? 0 }
			});
			return { status: 'success', sizeBytes, skipped: r.skipped ?? 0 };
		}
		await db
			.update(table.wordpressBackup)
			.set({ sizeBytes: r.sizeBytes ?? null, error: null })
			.where(eq(table.wordpressBackup.id, backupId));
		return { status: 'running', phase: r.phase, progress: r.progress, sizeBytes: r.sizeBytes };
	} catch (err) {
		const { code, message } = describeError(err);
		if (isRetryableWpError(err)) {
			await db
				.update(table.wordpressBackup)
				.set({ error: `${code}: ${message}`.slice(0, 500) })
				.where(eq(table.wordpressBackup.id, backupId));
			return { status: 'running', retryable: true, error: message };
		}
		await failBackup({ site, backupId, userId, error: `${code}: ${message}` });
		return { status: 'failed', error: message };
	}
}

export async function failBackup(args: {
	site: SiteRef;
	backupId: string;
	userId: string;
	error: string;
}): Promise<void> {
	await db
		.update(table.wordpressBackup)
		.set({ status: 'failed', error: args.error.slice(0, 500), finishedAt: new Date() })
		.where(eq(table.wordpressBackup.id, args.backupId));
	logWarning('wordpress', `Backup failed for ${args.site.siteUrl}: ${args.error.slice(0, 200)}`, {
		tenantId: args.site.tenantId,
		userId: args.userId,
		metadata: { siteId: args.site.id, backupId: args.backupId }
	});
}

/** Same for a restore; there is no row to update, only the audit log. */
export async function advanceRestore(args: {
	client: WpClient;
	site: SiteRef;
	backupId: string;
	backupName: string;
	userId: string;
}): Promise<RestoreAdvance> {
	const { client, site, backupId, backupName, userId } = args;
	try {
		const r = await driveSteps(() =>
			client.restoreStep(backupName, { budgetSec: STEP_BUDGET_SEC, siteId: site.id })
		);
		if (r.done) {
			logInfo('wordpress', `Restore OK for ${site.siteUrl} from ${backupName} (chunked)`, {
				tenantId: site.tenantId,
				userId,
				metadata: { siteId: site.id, backupId, backupName }
			});
			return { status: 'success' };
		}
		return { status: 'running', phase: r.phase, progress: r.progress };
	} catch (err) {
		const { code, message } = describeError(err);
		if (isRetryableWpError(err)) {
			return { status: 'running', retryable: true, error: message };
		}
		logWarning('wordpress', `Restore FAILED for ${site.siteUrl}: ${code}`, {
			tenantId: site.tenantId,
			userId,
			metadata: { siteId: site.id, backupId, backupName, code, reason: message }
		});
		return { status: 'failed', error: message };
	}
}
