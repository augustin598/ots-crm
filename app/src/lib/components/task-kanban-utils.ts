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
			return 'bg-red-100 text-red-700';
		case 'high':
			return 'bg-orange-100 text-orange-700';
		case 'medium':
			return 'bg-blue-100 text-blue-700';
		case 'low':
			return 'bg-gray-100 text-gray-700';
		default:
			return 'bg-gray-100 text-gray-700';
	}
}
