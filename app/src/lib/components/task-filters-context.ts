import { getContext, setContext } from 'svelte';

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

/**
 * Contextul stochează un GETTER, nu obiectul: `filterParams` e `$derived` în
 * pagină și produce un obiect NOU la fiecare recalcul — `setContext(obj)`
 * captura primul obiect pentru totdeauna (de-aia exista
 * `svelte-ignore state_referenced_locally`), deci consumatorii vedeau filtre
 * stale și coloana Done nu reacționa la schimbarea filtrelor. Apelul
 * getter-ului într-un context reactiv ($derived/$effect) urmărește
 * dependența; apelul în handler citește valoarea curentă.
 */
export type TaskFiltersGetter = () => TaskFilters;

export function setTaskFilters(getter: TaskFiltersGetter) {
	setContext(TASK_FILTERS_CONTEXT_KEY, getter);
}

export function getTaskFilters(): TaskFiltersGetter | undefined {
	return getContext<TaskFiltersGetter>(TASK_FILTERS_CONTEXT_KEY);
}
