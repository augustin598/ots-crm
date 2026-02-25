/**
 * Utility functions for task kanban board
 */

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
			return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
		case 'low':
			return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
		default:
			return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
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
