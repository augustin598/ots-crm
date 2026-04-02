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
	return 'Altele';
}

/** All activity filter categories with their matching type prefixes. */
export const ACTIVITY_CATEGORIES = [
	{ id: 'all', label: 'Toate', prefixes: [] },
	{ id: 'invoices', label: 'Facturi', prefixes: ['invoice.'] },
	{ id: 'leads', label: 'Leaduri', prefixes: ['lead.'] },
	{ id: 'contracts', label: 'Contracte', prefixes: ['contract.'] },
	{ id: 'tasks', label: 'Taskuri', prefixes: ['task.'] },
	{ id: 'marketing', label: 'Marketing', prefixes: ['ad.'] }
] as const;
