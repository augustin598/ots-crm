import type { Task } from '$lib/server/db/schema';
import type { DateValue } from '@internationalized/date';

function toLocalYMD(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateValueToYMD(dv: { year: number; month: number; day: number }): string {
	return `${dv.year}-${String(dv.month).padStart(2, '0')}-${String(dv.day).padStart(2, '0')}`;
}

// ── status groups ─────────────────────────────────────────────────────────
export type StatusGroup = 'todo' | 'in-progress' | 'done' | 'cancelled';

export const STATUS_OPTIONS = [
	{ value: 'todo', label: 'To do' },
	{ value: 'pending-approval', label: 'Pending approval' },
	{ value: 'in-progress', label: 'In progress' },
	{ value: 'review', label: 'Review' },
	{ value: 'done', label: 'Done' },
	{ value: 'cancelled', label: 'Cancelled' }
] as const;

export type TaskStatus = (typeof STATUS_OPTIONS)[number]['value'];

export const PRIORITY_OPTIONS = [
	{ value: 'urgent', label: 'Urgent' },
	{ value: 'high', label: 'High' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'low', label: 'Low' }
] as const;

export type TaskPriority = (typeof PRIORITY_OPTIONS)[number]['value'];

export function getStatusGroup(status: string | null | undefined): StatusGroup {
	switch (status) {
		case 'done':
			return 'done';
		case 'cancelled':
			return 'cancelled';
		case 'in-progress':
		case 'review':
			return 'in-progress';
		default:
			return 'todo';
	}
}

// ── overdue ───────────────────────────────────────────────────────────────
export function isTaskOverdue(task: Pick<Task, 'dueDate' | 'status'>, now: DateValue): boolean {
	if (!task.dueDate) return false;
	if (task.status === 'done' || task.status === 'cancelled') return false;
	const dueYMD = toLocalYMD(new Date(task.dueDate));
	const nowYMD = dateValueToYMD(now);
	return dueYMD < nowYMD;
}

// ── filters ───────────────────────────────────────────────────────────────
export interface Filters {
	status: TaskStatus[];
	priority: TaskPriority[];
	clientId: string | null;
	onlyOverdue: boolean;
}

const VALID_STATUS = new Set(STATUS_OPTIONS.map((o) => o.value));
const VALID_PRIORITY = new Set(PRIORITY_OPTIONS.map((o) => o.value));

export function parseFilters(searchParams: URLSearchParams): Filters {
	const parseCsv = <T extends string>(key: string, allowed: Set<string>): T[] => {
		const raw = searchParams.get(key);
		if (!raw) return [];
		return raw
			.split(',')
			.map((s) => s.trim())
			.filter((s) => allowed.has(s)) as T[];
	};
	return {
		status: parseCsv<TaskStatus>('status', VALID_STATUS),
		priority: parseCsv<TaskPriority>('priority', VALID_PRIORITY),
		clientId: searchParams.get('client') || null,
		onlyOverdue: searchParams.get('overdue') === '1'
	};
}

export function filtersToSearchParams(filters: Filters): URLSearchParams {
	const params = new URLSearchParams();
	if (filters.status.length) params.set('status', filters.status.join(','));
	if (filters.priority.length) params.set('priority', filters.priority.join(','));
	if (filters.clientId) params.set('client', filters.clientId);
	if (filters.onlyOverdue) params.set('overdue', '1');
	return params;
}

export function hasActiveFilters(filters: Filters): boolean {
	return (
		filters.status.length > 0 ||
		filters.priority.length > 0 ||
		filters.clientId !== null ||
		filters.onlyOverdue
	);
}

export function matchesFilters(
	task: Pick<Task, 'status' | 'priority' | 'clientId' | 'dueDate'>,
	filters: Filters,
	now: DateValue
): boolean {
	if (filters.status.length && !filters.status.includes(task.status as TaskStatus)) return false;
	if (filters.priority.length && !filters.priority.includes(task.priority as TaskPriority))
		return false;
	if (filters.clientId && task.clientId !== filters.clientId) return false;
	if (filters.onlyOverdue && !isTaskOverdue(task, now)) return false;
	return true;
}

// ── counters ──────────────────────────────────────────────────────────────
export interface Counters {
	overdue: number;
	today: number;
	inProgress: number;
}

export function computeCounters(
	tasks: Pick<Task, 'dueDate' | 'status'>[],
	now: DateValue
): Counters {
	let overdue = 0;
	let todayCount = 0;
	let inProgress = 0;
	const nowYMD = dateValueToYMD(now);
	for (const t of tasks) {
		if (isTaskOverdue(t, now)) overdue++;
		if (t.dueDate) {
			const dueYMD = toLocalYMD(new Date(t.dueDate));
			if (dueYMD === nowYMD && t.status !== 'done' && t.status !== 'cancelled') todayCount++;
		}
		if (t.status === 'in-progress' || t.status === 'review') inProgress++;
	}
	return { overdue, today: todayCount, inProgress };
}

// ── styling maps (re-exported so components don't duplicate them) ─────────
export const STATUS_GROUP_CLASSES: Record<StatusGroup, string> = {
	todo: 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300',
	'in-progress': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
	done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 line-through opacity-60',
	cancelled:
		'bg-zinc-100 text-zinc-500 dark:bg-zinc-900/30 dark:text-zinc-400 line-through opacity-40 italic'
};

export const PRIORITY_BORDER_CLASSES: Record<TaskPriority | 'none', string> = {
	urgent: 'border-l-red-500',
	high: 'border-l-orange-500',
	medium: 'border-l-blue-500',
	low: 'border-l-emerald-500',
	none: 'border-l-gray-300'
};

// exported for legend component
export const STATUS_GROUP_DOT_CLASSES: Record<StatusGroup, string> = {
	todo: 'bg-slate-400',
	'in-progress': 'bg-blue-500',
	done: 'bg-emerald-500',
	cancelled: 'bg-zinc-400'
};

// filled badge classes for priority (used in dialogs where a solid Badge is rendered)
export const PRIORITY_BADGE_CLASSES: Record<TaskPriority | 'none', string> = {
	urgent: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
	high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
	medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
	low: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
	none: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300'
};

export function getPriorityBadgeClasses(priority: string | null | undefined): string {
	if (priority && priority in PRIORITY_BADGE_CLASSES) {
		return PRIORITY_BADGE_CLASSES[priority as TaskPriority];
	}
	return PRIORITY_BADGE_CLASSES.none;
}
