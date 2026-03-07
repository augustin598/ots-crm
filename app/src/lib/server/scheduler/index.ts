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
import { logInfo, logError, serializeError } from '$lib/server/logger';

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
	contract_lifecycle: processContractLifecycle
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
export const startScheduler = () => {
	logInfo('scheduler', 'Starting scheduler...');

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

	logInfo('scheduler', 'Scheduled recurring invoice generation: daily at 2:00 AM');

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

	logInfo('scheduler', 'Scheduled task reminders: daily at 9:00 AM');

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

	logInfo('scheduler', 'Scheduled daily work reminders: every hour at minute 0');

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

	logInfo('scheduler', 'Scheduled SPV invoice sync: daily at 3:00 AM');

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

	logInfo('scheduler', 'Scheduled Revolut transaction sync: daily at 3:00 AM');

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

	logInfo('scheduler', 'Scheduled Keez invoice sync: daily at 4:00 AM');

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

	logInfo('scheduler', 'Scheduled Gmail invoice sync: daily at 5:00 AM');

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

	logInfo('scheduler', 'Scheduled Gmail invoice sync (evening): daily at 5:00 PM');

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

	logInfo('scheduler', 'Scheduled BNR rate sync: daily at 10:00 AM');

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

	logInfo('scheduler', 'Scheduled invoice overdue reminders: weekdays at 9:00 AM');

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

	logInfo('scheduler', 'Scheduled contract lifecycle: daily at 1:00 AM');

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
	bnr_rate_sync: 'Sync Curs BNR',
	invoice_overdue_reminders: 'Reminder-e Facturi Restante',
	contract_lifecycle: 'Lifecycle Contracte'
};
