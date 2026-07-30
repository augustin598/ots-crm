import { getContext, setContext } from 'svelte';

export const TASK_LIVE_QUERIES_KEY = Symbol('task-live-queries');

/**
 * Getter pentru instanțele de query AFIȘATE de pagina de tasks (lista +
 * statisticile). Mutațiile fac `.updates(...getter())` pe ele, în loc să
 * reconstruiască argumentele `getTasks(...)` — reconstrucția a produs bugul
 * „task nou nu apare fără refresh": instanța afișată are `include: {...}` +
 * `excludeCompleted` condițional, iar orice nepotrivire de argumente
 * înseamnă alt cache entry, deci refresh pe o listă pe care n-o vede nimeni.
 *
 * E funcție (nu array) ca să citească instanțele $derived la momentul
 * apelului — contextul de filtre partajat capturează valori stale.
 */
export type TaskLiveQueries = () => any[];

export function setTaskLiveQueries(getter: TaskLiveQueries) {
	setContext(TASK_LIVE_QUERIES_KEY, getter);
}

/** Undefined pe paginile care nu publică getter-ul — consumatorii au fallback. */
export function getTaskLiveQueries(): TaskLiveQueries | undefined {
	return getContext<TaskLiveQueries>(TASK_LIVE_QUERIES_KEY);
}
