import type { Component } from 'svelte';
import CheckSquareIcon from '@lucide/svelte/icons/check-square';
import FileTextIcon from '@lucide/svelte/icons/file-text';
import FilePlusIcon from '@lucide/svelte/icons/file-plus';
import ClockAlertIcon from '@lucide/svelte/icons/clock-alert';
import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
import FileCheckIcon from '@lucide/svelte/icons/file-check';
import FileXIcon from '@lucide/svelte/icons/file-x';
import UserPlusIcon from '@lucide/svelte/icons/user-plus';
import UserCheckIcon from '@lucide/svelte/icons/user-check';
import BarChartIcon from '@lucide/svelte/icons/bar-chart';
import InfoIcon from '@lucide/svelte/icons/info';
import KeyIcon from '@lucide/svelte/icons/key';
import MailXIcon from '@lucide/svelte/icons/mail-x';
import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
import AtSignIcon from '@lucide/svelte/icons/at-sign';
import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
import DatabaseIcon from '@lucide/svelte/icons/database';
import TimerIcon from '@lucide/svelte/icons/timer';

/**
 * Returns the appropriate Lucide icon component for a notification type.
 */
export function getActivityIcon(type: string): Component {
	switch (type) {
		case 'task.assigned':
			return CheckSquareIcon;
		case 'task.completed':
			return CheckSquareIcon;
		case 'invoice.created':
			return FilePlusIcon;
		case 'invoice.paid':
			return FileTextIcon;
		case 'invoice.overdue':
			return ClockAlertIcon;
		case 'contract.signed':
			return FileCheckIcon;
		case 'contract.activated':
			return FileCheckIcon;
		case 'contract.expired':
			return FileXIcon;
		case 'lead.imported':
			return UserPlusIcon;
		case 'lead.status_changed':
			return UserCheckIcon;
		case 'ad.spending_synced':
			return BarChartIcon;
		case 'sync.error':
			return AlertCircleIcon;
		case 'integration.auth_expiring':
		case 'integration.auth_expired':
			return KeyIcon;
		case 'keez.sync_error':
		case 'smartbill.sync_error':
			return AlertCircleIcon;
		case 'email.delivery_failed':
			return MailXIcon;
		case 'invoice.reminder':
			return ClockAlertIcon;
		case 'budget.exceeded':
		case 'budget.warning':
			return TrendingUpIcon;
		case 'client.created':
			return UserPlusIcon;
		case 'contract.expiring':
			return TimerIcon;
		case 'task.overdue':
			return ClockAlertIcon;
		case 'comment.mention':
			return AtSignIcon;
		case 'approval.requested':
			return CircleCheckIcon;
		case 'system.db_error':
		case 'scheduler.job_failed':
			return DatabaseIcon;
		default:
			return InfoIcon;
	}
}

/**
 * Returns a Tailwind color class for a notification type.
 */
export function getActivityColor(type: string): string {
	switch (type) {
		case 'sync.error':
		case 'invoice.overdue':
		case 'contract.expired':
			return 'text-destructive';
		case 'invoice.paid':
		case 'task.completed':
		case 'contract.activated':
			return 'text-green-600 dark:text-green-400';
		case 'task.assigned':
		case 'lead.imported':
		case 'lead.status_changed':
			return 'text-blue-600 dark:text-blue-400';
		case 'contract.signed':
			return 'text-purple-600 dark:text-purple-400';
		case 'invoice.created':
		case 'ad.spending_synced':
			return 'text-orange-600 dark:text-orange-400';
		case 'integration.auth_expiring':
		case 'keez.sync_error':
		case 'smartbill.sync_error':
		case 'budget.warning':
		case 'invoice.reminder':
		case 'contract.expiring':
		case 'task.overdue':
			return 'text-amber-600 dark:text-amber-400';
		case 'integration.auth_expired':
		case 'email.delivery_failed':
		case 'budget.exceeded':
		case 'system.db_error':
		case 'scheduler.job_failed':
			return 'text-destructive';
		case 'comment.mention':
		case 'approval.requested':
			return 'text-blue-600 dark:text-blue-400';
		case 'client.created':
			return 'text-green-600 dark:text-green-400';
		default:
			return 'text-muted-foreground';
	}
}

/**
 * Maps a notification type to a human-readable category label (Romanian).
 */
export function getActivityCategory(type: string): string {
	if (type.startsWith('invoice.')) return 'Facturi';
	if (type.startsWith('contract.')) return 'Contracte';
	if (type.startsWith('task.')) return 'Taskuri';
	if (type.startsWith('lead.')) return 'Leaduri';
	if (type.startsWith('ad.')) return 'Marketing';
	if (type === 'sync.error') return 'Sistem';
	if (type.startsWith('budget.')) return 'Financiar';
	if (type.startsWith('keez.') || type.startsWith('smartbill.')) return 'Sistem';
	if (type === 'email.delivery_failed') return 'Sistem';
	if (type === 'comment.mention' || type === 'approval.requested') return 'Comunicare';
	if (type === 'client.created') return 'Clienti';
	if (type === 'system.db_error' || type === 'scheduler.job_failed') return 'Sistem';
	return 'Altele';
}

/** All activity filter categories with their matching type prefixes. */
export const ACTIVITY_CATEGORIES = [
	{ id: 'all', label: 'Toate', prefixes: [] },
	{ id: 'invoices', label: 'Facturi', prefixes: ['invoice.', 'budget.'] },
	{ id: 'leads', label: 'Leaduri', prefixes: ['lead.'] },
	{ id: 'contracts', label: 'Contracte', prefixes: ['contract.'] },
	{ id: 'tasks', label: 'Taskuri', prefixes: ['task.'] },
	{ id: 'marketing', label: 'Marketing', prefixes: ['ad.'] },
	{ id: 'system', label: 'Sistem', prefixes: ['sync.', 'integration.', 'system.', 'scheduler.', 'keez.', 'smartbill.', 'email.'] },
	{ id: 'communication', label: 'Comunicare', prefixes: ['comment.', 'approval.'] },
] as const;
