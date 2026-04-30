import { Queue, Worker } from 'bullmq';
import { env } from '$env/dynamic/private';
import { processRecurringInvoices } from './tasks/recurring-invoices';
import { processRecurringTasksSafety } from './tasks/recurring-tasks-safety';
import { processTaskReminders } from './tasks/task-reminders';
import { processDailyWorkReminders } from './tasks/daily-work-reminders';
import { processSpvInvoiceSync } from './tasks/spv-invoice-sync';
import { processRevolutTransactionSync } from './tasks/revolut-transaction-sync';
import { processKeezInvoiceSync } from './tasks/keez-invoice-sync';
import { processKeezInvoiceSyncRetry } from './tasks/keez-invoice-sync-retry';
import { processWhmcsKeezPushRetry } from './tasks/whmcs-keez-push-retry';
import { processWhmcsInvoiceReconcile } from './tasks/whmcs-invoice-reconcile';
import { processGmailInvoiceSync } from './tasks/gmail-invoice-sync';
import { processBnrRateSync } from './tasks/bnr-rate-sync';
import { processInvoiceOverdueReminders } from './tasks/invoice-overdue-reminders';
import { processContractLifecycle } from './tasks/contract-lifecycle';
import { processGoogleAdsInvoiceSync } from './tasks/google-ads-invoice-sync';
import { processMetaAdsInvoiceSync } from './tasks/meta-ads-invoice-sync';
import { processTiktokAdsSpendingSync } from './tasks/tiktok-ads-spending-sync';
import { processAdsStatusMonitor } from './tasks/ads-status-monitor';
import { processAdsPerformanceMonitor } from './tasks/ads-performance-monitor';
import { processAdsSnapshotRetention } from './tasks/ads-snapshot-retention';
import { processMetaAdsLeadsSync } from './tasks/meta-ads-leads-sync';
import { processTokenRefresh } from './tasks/token-refresh';
import { processDebugLogCleanup } from './tasks/debug-log-cleanup';
import { processTokenCleanup } from './tasks/token-cleanup';
import { processDbWriteHealthCheck } from './tasks/db-write-health-check';
import { processPdfReportSend } from './tasks/pdf-report-send';
import { processEmailRetry, recoverInterruptedRetries } from './tasks/email-retry';
import { cleanupOldNotifications } from './tasks/notification-cleanup';
import { processInvoiceReminderNotifications } from './tasks/invoice-reminder-notifications';
import { processTaskOverdueNotifications } from './tasks/task-overdue-notifications';
import { processWordpressUptimePing } from './tasks/wordpress-uptime-ping';
import { processWordpressUpdatesCheck } from './tasks/wordpress-updates-check';
import { processWordpressConnectorAutoUpdate } from './tasks/wordpress-connector-auto-update';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';

const REDIS_URL = env.REDIS_URL || 'redis://localhost:6379';

const parsedRedisUrl = new URL(REDIS_URL);
// Guard: 0.0.0.0 is a listen-wildcard, not a connection address. Rewrite to 127.0.0.1
// to prevent ECONNREFUSED loops if a stale env var leaks into a deployment.
let redisHost = parsedRedisUrl.hostname;
if (redisHost === '0.0.0.0') {
	logWarning('scheduler', 'REDIS_URL contained 0.0.0.0, rewriting to 127.0.0.1', {
		metadata: { original: REDIS_URL }
	});
	redisHost = '127.0.0.1';
}

const connection = {
	host: redisHost,
	port: parseInt(parsedRedisUrl.port, 10),
	password: parsedRedisUrl.password || undefined,
	// Node 18+ resolves "localhost" (and dual-stack k8s services) to both ::1 and
	// 127.0.0.1 → Happy Eyeballs. If Redis only binds IPv4, the parallel IPv6
	// attempt surfaces as an opaque NodeAggregateError on the Queue/Worker.
	family: 4,
	// Required by BullMQ Workers (blocking commands like bzpopmin). With the
	// default of 20, transient Redis hiccups cascade into reconnect storms.
	maxRetriesPerRequest: null,
	// Cap reconnect backoff so we don't churn during a Redis restart.
	retryStrategy: (times: number) => Math.min(times * 200, 3000)
};

// Use global symbols to store singleton instances (survives HMR)
const SCHEDULER_QUEUE_SYMBOL = Symbol.for('scheduler_queue');
const SCHEDULER_WORKER_SYMBOL = Symbol.for('scheduler_worker');

/**
 * Creates a singleton instance of the 'scheduler' queue.
 * This queue handles scheduled/recurring jobs.
 */
function createSchedulerQueue() {
	const queue = new Queue('scheduler', {
		connection,
		defaultJobOptions: {
			attempts: 3,
			backoff: {
				type: 'exponential',
				delay: 1000
			}
		}
	});

	queue.on('error', (error) => {
		const { message, stack } = serializeError(error);
		logError('scheduler', `Queue error: ${message}`, { stackTrace: stack });
	});

	return queue;
}

export const schedulerQueue =
	(globalThis as any)[SCHEDULER_QUEUE_SYMBOL] ||
	((globalThis as any)[SCHEDULER_QUEUE_SYMBOL] = createSchedulerQueue());

/**
 * Task handler type
 */
type TaskHandler = (params: Record<string, any>) => Promise<any>;

/**
 * Task registry - maps task types to their handlers
 */
const taskHandlers: Record<string, TaskHandler> = {
	recurring_invoices: processRecurringInvoices,
	recurring_tasks_safety: processRecurringTasksSafety,
	task_reminders: processTaskReminders,
	daily_work_reminders: processDailyWorkReminders,
	spv_invoice_sync: processSpvInvoiceSync,
	revolut_transaction_sync: processRevolutTransactionSync,
	keez_invoice_sync: processKeezInvoiceSync,
	keez_invoice_sync_retry: processKeezInvoiceSyncRetry,
	whmcs_keez_push_retry: processWhmcsKeezPushRetry,
	whmcs_invoice_reconcile: processWhmcsInvoiceReconcile,
	gmail_invoice_sync: processGmailInvoiceSync,
	bnr_rate_sync: processBnrRateSync,
	invoice_overdue_reminders: processInvoiceOverdueReminders,
	contract_lifecycle: processContractLifecycle,
	google_ads_invoice_sync: processGoogleAdsInvoiceSync,
	meta_ads_invoice_sync: processMetaAdsInvoiceSync,
	tiktok_ads_spending_sync: processTiktokAdsSpendingSync,
	ads_status_monitor: processAdsStatusMonitor,
	ads_performance_monitor: processAdsPerformanceMonitor,
	ads_snapshot_retention: processAdsSnapshotRetention,
	meta_ads_leads_sync: processMetaAdsLeadsSync,
	token_refresh: processTokenRefresh,
	debug_log_cleanup: processDebugLogCleanup,
	token_cleanup: processTokenCleanup,
	db_write_health_check: processDbWriteHealthCheck,
	pdf_report_send: processPdfReportSend,
	email_retry: processEmailRetry,
	notification_cleanup: cleanupOldNotifications,
	invoice_reminder_notifications: processInvoiceReminderNotifications,
	task_overdue_notifications: processTaskOverdueNotifications,
	wordpress_uptime_ping: processWordpressUptimePing,
	wordpress_updates_check: processWordpressUpdatesCheck,
	wordpress_connector_auto_update: processWordpressConnectorAutoUpdate
};

/**
 * Scheduler job data interface
 */
interface SchedulerJobData {
	type: string;
	params?: Record<string, any>;
}

/**
 * Create scheduler worker that processes scheduled jobs
 */
function createSchedulerWorker() {
	const worker = new Worker<SchedulerJobData>(
		'scheduler',
		async (job) => {
			const { type, params } = job.data;

			const handler = taskHandlers[type];
			if (!handler) {
				throw new Error(`Unknown scheduler job type: ${type}`);
			}

			return await handler(params || {});
		},
		{
			connection,
			// Tasks like meta_ads_leads_sync iterate many external API calls and can
			// legitimately run for several minutes. Default 30s lockDuration causes
			// "could not renew lock" noise on long jobs.
			lockDuration: 5 * 60 * 1000
		}
	);

	worker.on('completed', (job) => {
		logInfo('scheduler', `Job completed: ${job.data.type}`, { metadata: { jobId: job.id } });
	});

	worker.on('failed', (job, err) => {
		const { message, stack } = serializeError(err);
		logError('scheduler', `Job failed: ${job?.data.type} - ${message}`, { metadata: { jobId: job?.id }, stackTrace: stack });
	});

	return worker;
}

/**
 * Register a task handler
 */
export function registerTask(type: string, handler: TaskHandler) {
	taskHandlers[type] = handler;
}

/**
 * Start the scheduler - sets up recurring jobs and starts the worker
 */
export const startScheduler = async () => {
	logInfo('scheduler', 'Starting scheduler...', { metadata: { taskTypes: Object.keys(taskHandlers).length, redisUrl: REDIS_URL.replace(/\/\/.*@/, '//***@') } });

	// DB health check
	try {
		const [result] = await db.select({ count: sql<number>`count(*)` }).from(table.recurringInvoice);
		logInfo('scheduler', `DB health check OK: ${result?.count ?? 0} recurring invoice templates`, { metadata: { recurringTemplates: result?.count ?? 0 } });
	} catch (e) {
		const { message, stack } = serializeError(e);
		logError('scheduler', `DB health check FAILED — scheduler may not work correctly: ${message}`, { stackTrace: stack });
	}

	// Mark any in-flight SEO link discovery jobs as interrupted — they cannot resume
	// automatically across a server restart (the in-process pipeline was lost).
	try {
		const now = new Date();
		const res = await db
			.update(table.seoLinkDiscoveryJob)
			.set({
				status: 'interrupted',
				phase: 'done',
				error: 'Serverul a repornit în timpul rulării',
				finishedAt: now,
				updatedAt: now
			})
			.where(sql`${table.seoLinkDiscoveryJob.status} = 'running'`);
		const count = (res as { rowsAffected?: number })?.rowsAffected ?? 0;
		if (count > 0) {
			logWarning('scheduler', `Marked ${count} SEO discovery job(s) as interrupted after restart`);
		}
	} catch (e) {
		const { message } = serializeError(e);
		logWarning('scheduler', `Failed to mark interrupted discovery jobs: ${message}`);
	}

	// Recover any email retries stuck in 'retrying' state from a crash
	await recoverInterruptedRetries();

	// Create scheduler worker (singleton — close existing on HMR/restart)
	const existingWorker = (globalThis as any)[SCHEDULER_WORKER_SYMBOL] as Worker | undefined;
	if (existingWorker) {
		try {
			await existingWorker.close();
			logInfo('scheduler', 'Closed existing worker before creating new one');
		} catch {
			// Worker may already be closed
		}
	}
	const worker = createSchedulerWorker();
	(globalThis as any)[SCHEDULER_WORKER_SYMBOL] = worker;
	logInfo('scheduler', 'Scheduler worker created', { metadata: { queueName: 'scheduler', concurrency: 1 } });

	// Clean up stale repeatable jobs from Redis (from old code deployments with different patterns)
	const expectedJobIds = new Set([
		'recurring-invoices', 'recurring-tasks-safety', 'task-reminders', 'daily-work-reminders',
		'spv-invoice-sync', 'revolut-transaction-sync', 'keez-invoice-sync',
		'gmail-invoice-sync', 'gmail-invoice-sync-evening', 'bnr-rate-sync',
		'invoice-overdue-reminders', 'contract-lifecycle', 'google-ads-invoice-sync',
		'meta-ads-invoice-sync', 'tiktok-ads-spending-sync', 'ads-status-monitor',
		'ads-performance-monitor', 'ads-snapshot-retention', 'meta-ads-leads-sync',
		'token-refresh-frequent', 'token-refresh-daily', 'debug-log-cleanup', 'token-cleanup',
		'db-write-health-check', 'pdf-report-send', 'email-retry',
		'notification-cleanup', 'invoice-reminder-notifications', 'task-overdue-notifications',
		'wordpress-uptime-ping', 'wordpress-updates-check', 'wordpress-connector-auto-update',
		'whmcs-invoice-reconcile'
	]);

	try {
		const existingJobs = await schedulerQueue.getRepeatableJobs();
		for (const job of existingJobs) {
			if (!expectedJobIds.has(job.name)) {
				await schedulerQueue.removeRepeatableByKey(job.key);
				logWarning('scheduler', `Removed stale repeatable job: ${job.name} (pattern: ${job.pattern})`, { metadata: { jobName: job.name, pattern: job.pattern, key: job.key } });
			}
		}
	} catch (e) {
		const { message } = serializeError(e);
		logWarning('scheduler', `Failed to clean stale jobs: ${message}`);
	}

	// Schedule recurring invoice job to run daily at 9:00 AM
	await schedulerQueue.add(
		'recurring-invoices',
		{
			type: 'recurring_invoices',
			params: {}
		},
		{
			repeat: {
				pattern: '0 9 * * *', // Every day at 9:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'recurring-invoices'
		}
	);

	// Schedule recurring tasks safety-net to run daily at 8:00 AM (catches orphaned recurring tasks)
	await schedulerQueue.add(
		'recurring-tasks-safety',
		{
			type: 'recurring_tasks_safety',
			params: {}
		},
		{
			repeat: {
				pattern: '0 8 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'recurring-tasks-safety'
		}
	);

	// Schedule task reminders job to run daily at 9:00 AM
	await schedulerQueue.add(
		'task-reminders',
		{
			type: 'task_reminders',
			params: {}
		},
		{
			repeat: {
				pattern: '0 9 * * *', // Every day at 9:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'task-reminders'
		}
	);

	// Schedule daily work reminders job to run every hour
	await schedulerQueue.add(
		'daily-work-reminders',
		{
			type: 'daily_work_reminders',
			params: {}
		},
		{
			repeat: {
				pattern: '0 * * * *', // Every hour at minute 0
				tz: 'Europe/Bucharest'
			},
			jobId: 'daily-work-reminders'
		}
	);

	// Schedule SPV invoice sync job to run daily at 3:00 AM
	await schedulerQueue.add(
		'spv-invoice-sync',
		{
			type: 'spv_invoice_sync',
			params: {}
		},
		{
			repeat: {
				pattern: '0 3 * * *', // Every day at 3:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'spv-invoice-sync'
		}
	);

	// Schedule Revolut transaction sync job to run daily at 3:00 AM
	await schedulerQueue.add(
		'revolut-transaction-sync',
		{
			type: 'revolut_transaction_sync',
			params: {}
		},
		{
			repeat: {
				pattern: '0 3 * * *', // Every day at 3:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'revolut-transaction-sync'
		}
	);

	// Schedule Keez invoice sync job to run daily at 4:00 AM
	await schedulerQueue.add(
		'keez-invoice-sync',
		{
			type: 'keez_invoice_sync',
			params: {}
		},
		{
			repeat: {
				pattern: '0 4 * * *', // Every day at 4:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'keez-invoice-sync'
		}
	);

	// Schedule WHMCS invoice reconcile every 10 min — picks up orphaned in_flight
	// rows (from process restarts mid-push) and re-enqueues lost retry hops.
	await schedulerQueue.add(
		'whmcs-invoice-reconcile',
		{
			type: 'whmcs_invoice_reconcile',
			params: {}
		},
		{
			repeat: {
				pattern: '*/10 * * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'whmcs-invoice-reconcile'
		}
	);

	// Schedule Gmail invoice sync job to run daily at 5:00 AM
	await schedulerQueue.add(
		'gmail-invoice-sync',
		{
			type: 'gmail_invoice_sync',
			params: {}
		},
		{
			repeat: {
				pattern: '0 5 * * *', // Every day at 5:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'gmail-invoice-sync'
		}
	);

	// Schedule Gmail invoice sync evening run for twice_daily tenants
	await schedulerQueue.add(
		'gmail-invoice-sync-evening',
		{
			type: 'gmail_invoice_sync',
			params: { timeSlot: 'evening' }
		},
		{
			repeat: {
				pattern: '0 17 * * *', // Every day at 5:00 PM
				tz: 'Europe/Bucharest'
			},
			jobId: 'gmail-invoice-sync-evening'
		}
	);

	// Schedule BNR exchange rate sync daily at 10:00 AM (BNR publishes around 10:00)
	await schedulerQueue.add(
		'bnr-rate-sync',
		{
			type: 'bnr_rate_sync',
			params: {}
		},
		{
			repeat: {
				pattern: '0 10 * * *', // Every day at 10:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'bnr-rate-sync'
		}
	);

	// Schedule invoice overdue reminders weekdays at 9:00 AM
	await schedulerQueue.add(
		'invoice-overdue-reminders',
		{
			type: 'invoice_overdue_reminders',
			params: {}
		},
		{
			repeat: {
				pattern: '0 9 * * 1-5', // Weekdays at 9:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'invoice-overdue-reminders'
		}
	);

	// Schedule contract lifecycle (auto-activate, auto-expire) daily at 1:00 AM
	await schedulerQueue.add(
		'contract-lifecycle',
		{
			type: 'contract_lifecycle',
			params: {}
		},
		{
			repeat: {
				pattern: '0 1 * * *', // Every day at 1:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'contract-lifecycle'
		}
	);

	// Schedule Google Ads invoice sync monthly (1st of each month at 6:00 AM)
	await schedulerQueue.add(
		'google-ads-invoice-sync',
		{
			type: 'google_ads_invoice_sync',
			params: {}
		},
		{
			repeat: {
				pattern: '0 6 1 * *', // 1st of each month at 6:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'google-ads-invoice-sync'
		}
	);

	// Schedule Meta Ads invoice sync monthly (1st of each month at 7:00 AM)
	await schedulerQueue.add(
		'meta-ads-invoice-sync',
		{
			type: 'meta_ads_invoice_sync',
			params: {}
		},
		{
			repeat: {
				pattern: '0 7 1 * *', // 1st of each month at 7:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'meta-ads-invoice-sync'
		}
	);

	// Schedule TikTok Ads spending sync monthly (2nd of each month at 8:00 AM)
	await schedulerQueue.add(
		'tiktok-ads-spending-sync',
		{
			type: 'tiktok_ads_spending_sync',
			params: {}
		},
		{
			repeat: {
				pattern: '0 8 2 * *', // 2nd of each month at 8:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'tiktok-ads-spending-sync'
		}
	);

	// Schedule ads status monitor hourly — detects payment/suspension status changes
	await schedulerQueue.add(
		'ads-status-monitor',
		{
			type: 'ads_status_monitor',
			params: {}
		},
		{
			repeat: {
				pattern: '0 * * * *', // Every hour on the hour
				tz: 'Europe/Bucharest'
			},
			jobId: 'ads-status-monitor'
		}
	);

	// Schedule daily Meta ads performance monitor — pulls insights, runs deviation engine.
	// 07:00 Europe/Bucharest. Per-tenant stagger handled inside the task to spread load.
	await schedulerQueue.add(
		'ads-performance-monitor',
		{
			type: 'ads_performance_monitor',
			params: {}
		},
		{
			repeat: {
				pattern: '0 7 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'ads-performance-monitor'
		}
	);

	// Schedule daily snapshot retention — keeps ad_metric_snapshot capped at 90 days.
	await schedulerQueue.add(
		'ads-snapshot-retention',
		{
			type: 'ads_snapshot_retention',
			params: {}
		},
		{
			repeat: {
				pattern: '0 3 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'ads-snapshot-retention'
		}
	);

	// Schedule Meta Ads lead sync every 4 hours
	await schedulerQueue.add(
		'meta-ads-leads-sync',
		{
			type: 'meta_ads_leads_sync',
			params: {}
		},
		{
			repeat: {
				pattern: '0 */4 * * *', // Every 4 hours
				tz: 'Europe/Bucharest'
			},
			jobId: 'meta-ads-leads-sync'
		}
	);

	// Token refresh — frequent (every 45 min) for Google/Gmail (1h token lifetime)
	await schedulerQueue.add(
		'token-refresh-frequent',
		{
			type: 'token_refresh',
			params: { platforms: ['gmail', 'google_ads'] }
		},
		{
			repeat: {
				pattern: '*/45 * * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'token-refresh-frequent'
		}
	);

	// Token refresh — every 6 hours for Meta/TikTok (24h-60d token lifetime)
	await schedulerQueue.add(
		'token-refresh-daily',
		{
			type: 'token_refresh',
			params: { platforms: ['meta_ads', 'tiktok_ads'] }
		},
		{
			repeat: {
				pattern: '30 */6 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'token-refresh-daily'
		}
	);

	// Debug log cleanup — daily at 2:00 AM (info 7d, warning 30d, error 90d)
	await schedulerQueue.add(
		'debug-log-cleanup',
		{
			type: 'debug_log_cleanup',
			params: {}
		},
		{
			repeat: {
				pattern: '0 2 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'debug-log-cleanup'
		}
	);

	// Token cleanup — daily at 3:00 AM (delete tokens expired > 7 days ago)
	await schedulerQueue.add(
		'token-cleanup',
		{
			type: 'token_cleanup',
			params: {}
		},
		{
			repeat: {
				pattern: '0 3 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'token-cleanup'
		}
	);

	// DB write health check — every 5 minutes (no retries — next scheduled run is sufficient)
	await schedulerQueue.add(
		'db-write-health-check',
		{
			type: 'db_write_health_check',
			params: {}
		},
		{
			repeat: {
				pattern: '*/5 * * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'db-write-health-check',
			attempts: 1
		}
	);

	// PDF report send — daily at 08:00
	await schedulerQueue.add(
		'pdf-report-send',
		{
			type: 'pdf_report_send',
			params: {}
		},
		{
			repeat: {
				pattern: '0 8 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'pdf-report-send'
		}
	);

	// Invoice reminder notifications — daily at 08:00 (overdue invoices)
	await schedulerQueue.add(
		'invoice-reminder-notifications',
		{
			type: 'invoice_reminder_notifications',
			params: {}
		},
		{
			repeat: {
				pattern: '0 8 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'invoice-reminder-notifications'
		}
	);

	// Task overdue notifications — daily at 09:00 (tasks >3 days past deadline)
	await schedulerQueue.add(
		'task-overdue-notifications',
		{
			type: 'task_overdue_notifications',
			params: {}
		},
		{
			repeat: {
				pattern: '0 9 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'task-overdue-notifications'
		}
	);

	// Notification cleanup — daily at 2:30 AM (read >30d, all >90d)
	await schedulerQueue.add(
		'notification-cleanup',
		{
			type: 'notification_cleanup',
			params: {}
		},
		{
			repeat: {
				pattern: '30 2 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'notification-cleanup'
		}
	);

	// Email retry — every 15 minutes. Drains failed email_log rows that have a payload
	// (set by sendWithPersistence) and replays them via the original send function.
	// After admin re-saves SMTP password, this is what auto-recovers vanished emails.
	await schedulerQueue.add(
		'email-retry',
		{
			type: 'email_retry',
			params: {}
		},
		{
			repeat: {
				pattern: '*/15 * * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'email-retry'
		}
	);

	// WordPress uptime ping — every 5 minutes. HEAD requests to every site
	// root so we surface outages independently of the plugin's /health endpoint.
	await schedulerQueue.add(
		'wordpress-uptime-ping',
		{
			type: 'wordpress_uptime_ping',
			params: {}
		},
		{
			repeat: {
				pattern: '*/5 * * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'wordpress-uptime-ping',
			attempts: 1
		}
	);

	// WordPress updates check — daily at 04:00. Polls each connected site
	// for core/plugin/theme updates and caches them for the dashboard.
	await schedulerQueue.add(
		'wordpress-updates-check',
		{
			type: 'wordpress_updates_check',
			params: {}
		},
		{
			repeat: {
				pattern: '0 4 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'wordpress-updates-check'
		}
	);

	// OTS Connector auto-update — daily at 04:30, right after the updates
	// check run. Pushes the latest connector release (from MinIO) to every
	// unpaused site whose installed version is older than the release.
	// Manual push is still available via the /connector-update endpoint
	// when operators need to ship a fix outside the daily window.
	await schedulerQueue.add(
		'wordpress-connector-auto-update',
		{
			type: 'wordpress_connector_auto_update',
			params: {}
		},
		{
			repeat: {
				pattern: '30 4 * * *',
				tz: 'Europe/Bucharest'
			},
			jobId: 'wordpress-connector-auto-update'
		}
	);

	const registeredJobs = await schedulerQueue.getRepeatableJobs();
	logInfo('scheduler', `Scheduler started: ${Object.keys(taskHandlers).length} task types, ${registeredJobs.length} jobs registered`, { metadata: { taskTypes: Object.keys(taskHandlers), jobCount: registeredJobs.length } });

	return { queue: schedulerQueue, worker };
};

/** Expose the queue singleton for admin operations */
export function getSchedulerQueue(): Queue {
	return schedulerQueue;
}

/** Human-readable labels for job types */
export const JOB_LABELS: Record<string, string> = {
	recurring_invoices: 'Facturi Recurente',
	task_reminders: 'Reminder-e Task-uri',
	daily_work_reminders: 'Reminder-e Zilnice Lucru',
	spv_invoice_sync: 'Sync Facturi SPV',
	revolut_transaction_sync: 'Sync Tranzactii Revolut',
	keez_invoice_sync: 'Sync Facturi Keez',
	gmail_invoice_sync: 'Sync Facturi Gmail',
	gmail_invoice_sync_evening: 'Sync Facturi Gmail (Seara)',
	bnr_rate_sync: 'Sync Curs BNR',
	invoice_overdue_reminders: 'Reminder-e Facturi Restante',
	contract_lifecycle: 'Lifecycle Contracte',
	google_ads_invoice_sync: 'Sync Facturi Google Ads',
	meta_ads_invoice_sync: 'Sync Facturi Meta Ads',
	tiktok_ads_spending_sync: 'Sync Cheltuieli TikTok Ads',
	ads_status_monitor: 'Monitor Status Plată Ads (Meta/Google/TikTok)',
	ads_performance_monitor: 'Monitor Performanță Ads (Meta) — alerte deviații',
	ads_snapshot_retention: 'Retenție 90z — snapshots metrici Ads',
	meta_ads_leads_sync: 'Sync Leaduri Meta Ads',
	token_refresh: 'Refresh Token-uri Integrări',
	token_refresh_frequent: 'Refresh Token-uri (Gmail/Google Ads)',
	token_refresh_daily: 'Refresh Token-uri (Meta/TikTok)',
	debug_log_cleanup: 'Cleanup Loguri Debug',
	token_cleanup: 'Cleanup Token-uri Expirate',
	db_write_health_check: 'Health Check Scriere DB',
	pdf_report_send: 'Trimitere Rapoarte PDF',
	email_retry: 'Retry Emailuri Eșuate',
	notification_cleanup: 'Cleanup Notificari Vechi',
	invoice_reminder_notifications: 'Notificari Facturi Restante',
	task_overdue_notifications: 'Notificari Taskuri Intarziate',
	wordpress_uptime_ping: 'Ping Uptime WordPress',
	wordpress_updates_check: 'Verificare Update-uri WordPress'
};

/** Default params for jobs that need specific parameters */
export const JOB_PARAMS: Record<string, Record<string, any>> = {
	gmail_invoice_sync_evening: { timeSlot: 'evening' }
};

/** Maps job name (kebab-to-snake typeKey) → actual handler type used in job.data.type
 *  Only needed for jobs where typeKey !== handlerType (e.g. token-refresh-frequent → token_refresh) */
export const JOB_HANDLER_TYPES: Record<string, string> = {
	token_refresh_frequent: 'token_refresh',
	token_refresh_daily: 'token_refresh',
	gmail_invoice_sync_evening: 'gmail_invoice_sync'
};
