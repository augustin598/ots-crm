import { getContext } from 'svelte';

export const TASK_FILTERS_CONTEXT_KEY = Symbol('task-filters');

export type TaskFilters = {
	status?: string | string[];
	priority?: string | string[];
	assignee?: string | string[];
	project?: string | string[];
	milestone?: string | string[];
	search?: string;
	dueDate?: string;
	sortBy?: string;
	sortDir?: 'asc' | 'desc';
};

export function getTaskFilters(): TaskFilters | undefined {
	return getContext<TaskFilters>(TASK_FILTERS_CONTEXT_KEY);
}
