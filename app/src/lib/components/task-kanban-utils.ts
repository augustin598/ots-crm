/**
 * Utility functions for task display — single source of truth
 */

export type TaskStatus = 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled' | 'pending-approval';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in-progress', 'review', 'done', 'cancelled', 'pending-approval'];
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

export function formatStatus(status: string): string {
	return status
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

export function getPriorityColor(priority: string | null): string {
	switch (priority) {
		case 'urgent':
			return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
		case 'high':
			return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
		case 'medium':
			return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
		case 'low':
			return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
		default:
			return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
	}
}

export function getPriorityDotColor(priority: string | null): string {
	switch (priority) {
		case 'urgent':
			return 'bg-red-500';
		case 'high':
			return 'bg-orange-500';
		case 'medium':
			return 'bg-green-500';
		case 'low':
			return 'bg-gray-400';
		default:
			return 'bg-gray-400';
	}
}

export function getStatusColor(status: string | null): string {
	switch (status) {
		case 'pending-approval':
			return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
		case 'todo':
			return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';
		case 'in-progress':
			return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
		case 'review':
			return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
		case 'done':
			return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
		case 'cancelled':
			return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
		default:
			return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';
	}
}

export function getStatusDotColor(status: string | null): string {
	switch (status) {
		case 'pending-approval':
			return 'bg-amber-500';
		case 'todo':
			return 'bg-slate-400';
		case 'in-progress':
			return 'bg-blue-500';
		case 'review':
			return 'bg-purple-500';
		case 'done':
			return 'bg-green-500';
		case 'cancelled':
			return 'bg-red-500';
		default:
			return 'bg-slate-400';
	}
}

export function getStatusBadgeVariant(status: string | null): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
	switch (status) {
		case 'pending-approval':
			return 'warning';
		case 'in-progress':
			return 'default';
		case 'done':
			return 'success';
		case 'cancelled':
			return 'destructive';
		case 'review':
			return 'secondary';
		case 'todo':
		default:
			return 'outline';
	}
}

export function getActivityValueColor(field: string | null | undefined, value: string): string {
	if (field === 'priority' || field === 'status') {
		// Priority values
		switch (value) {
			case 'urgent': return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800';
			case 'high': return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800';
			case 'medium': return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800';
			case 'low': return 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700';
			// Status values
			case 'pending-approval': return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800';
			case 'todo': return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
			case 'in-progress': return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800';
			case 'review': return 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800';
			case 'done': return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800';
			case 'cancelled': return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800';
		}
	}
	return '';
}

export function formatPriority(priority: string): string {
	return priority.charAt(0).toUpperCase() + priority.slice(1);
}

export function formatDate(date: Date | string | null | undefined, style: 'short' | 'long' = 'long'): string {
	if (!date) return '-';
	try {
		const d = date instanceof Date ? date : new Date(date);
		if (style === 'short') {
			return d.toLocaleDateString('ro-RO', { month: 'short', day: 'numeric' });
		}
		return d.toLocaleDateString('ro-RO', { year: 'numeric', month: 'short', day: 'numeric' });
	} catch {
		return '-';
	}
}
