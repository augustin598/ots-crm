import { Queue, Worker } from 'bullmq';
import { env } from '$env/dynamic/private';
import { processRecurringInvoices } from './tasks/recurring-invoices';
import { processTaskReminders } from './tasks/task-reminders';
import { processDailyWorkReminders } from './tasks/daily-work-reminders';
import { processSpvInvoiceSync } from './tasks/spv-invoice-sync';
import { processRevolutTransactionSync } from './tasks/revolut-transaction-sync';
import { processKeezInvoiceSync } from './tasks/keez-invoice-sync';
import { processGmailInvoiceSync } from './tasks/gmail-invoice-sync';
import { processBnrRateSync } from './tasks/bnr-rate-sync';
import { processInvoiceOverdueReminders } from './tasks/invoice-overdue-reminders';
import { processContractLifecycle } from './tasks/contract-lifecycle';
import { processGoogleAdsInvoiceSync } from './tasks/google-ads-invoice-sync';
import { processMetaAdsInvoiceSync } from './tasks/meta-ads-invoice-sync';
import { processTiktokAdsSpendingSync } from './tasks/tiktok-ads-spending-sync';
import { processMetaAdsLeadsSync } from './tasks/meta-ads-leads-sync';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';

const REDIS_URL = env.REDIS_URL || 'redis://localhost:6379';

const connection = {
	host: new URL(REDIS_URL).hostname,
	port: parseInt(new URL(REDIS_URL).port, 10),
	password: new URL(REDIS_URL).password || undefined
};

// Use a global symbol to store the scheduler queue instance
const SCHEDULER_QUEUE_SYMBOL = Symbol.for('scheduler_queue');

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

const schedulerQueue =
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
	task_reminders: processTaskReminders,
	daily_work_reminders: processDailyWorkReminders,
	spv_invoice_sync: processSpvInvoiceSync,
	revolut_transaction_sync: processRevolutTransactionSync,
	keez_invoice_sync: processKeezInvoiceSync,
	gmail_invoice_sync: processGmailInvoiceSync,
	bnr_rate_sync: processBnrRateSync,
	invoice_overdue_reminders: processInvoiceOverdueReminders,
	contract_lifecycle: processContractLifecycle,
	google_ads_invoice_sync: processGoogleAdsInvoiceSync,
	meta_ads_invoice_sync: processMetaAdsInvoiceSync,
	tiktok_ads_spending_sync: processTiktokAdsSpendingSync,
	meta_ads_leads_sync: processMetaAdsLeadsSync
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
		{ connection }
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
	logInfo('scheduler', 'Starting scheduler...');

	// DB health check
	try {
		const [result] = await db.select({ count: sql<number>`count(*)` }).from(table.recurringInvoice);
		logInfo('scheduler', `DB health check OK: ${result?.count ?? 0} recurring invoice templates`);
	} catch (e) {
		const { message, stack } = serializeError(e);
		logError('scheduler', `DB health check FAILED — scheduler may not work correctly: ${message}`, { stackTrace: stack });
	}

	// Create scheduler worker
	const worker = createSchedulerWorker();
	logInfo('scheduler', 'Scheduler worker created');

	// Schedule recurring invoice job to run daily at 2:00 AM
	schedulerQueue.add(
		'recurring-invoices',
		{
			type: 'recurring_invoices',
			params: {}
		},
		{
			repeat: {
				pattern: '0 2 * * *', // Every day at 2:00 AM
				tz: 'Europe/Bucharest'
			},
			jobId: 'recurring-invoices'
		}
	);

	// Schedule task reminders job to run daily at 9:00 AM
	schedulerQueue.add(
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
	schedulerQueue.add(
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
	schedulerQueue.add(
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
	schedulerQueue.add(
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
	schedulerQueue.add(
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

	// Schedule Gmail invoice sync job to run daily at 5:00 AM
	schedulerQueue.add(
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
	schedulerQueue.add(
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
	schedulerQueue.add(
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
	schedulerQueue.add(
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
	schedulerQueue.add(
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
	schedulerQueue.add(
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
	schedulerQueue.add(
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
	schedulerQueue.add(
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

	// Schedule Meta Ads lead sync every 4 hours
	schedulerQueue.add(
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

	logInfo('scheduler', `Scheduler started: ${Object.keys(taskHandlers).length} task types, 15 jobs registered`);

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
	meta_ads_leads_sync: 'Sync Leaduri Meta Ads'
};

/** Default params for jobs that need specific parameters */
export const JOB_PARAMS: Record<string, Record<string, any>> = {
	gmail_invoice_sync_evening: { timeSlot: 'evening' }
};
