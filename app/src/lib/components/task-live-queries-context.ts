import { getContext, setContext } from 'svelte';

export const TASK_LIVE_QUERIES_KEY = Symbol('task-live-queries');

/**
 * Registru cu instanțele de query AFIȘATE pe pagina de tasks. Mutațiile fac
 * `.updates(...registry.collect())` pe ele, în loc să reconstruiască
 * argumentele `getTasks(...)` — reconstrucția a produs bugul „task nou nu
 * apare fără refresh": instanța afișată are `include: {...}` +
 * `excludeCompleted` condițional, iar orice nepotrivire de argumente
 * înseamnă alt cache entry, deci refresh pe o listă pe care n-o vede nimeni.
 *
 * E registru (nu un singur getter) ca și componentele copil care afișează
 * propriile instanțe (ex. TaskKanbanBoard cu paginile de getCompletedTasks)
 * să și le poată înscrie. Getter-ele se apelează la momentul `collect()` ca
 * să citească instanțele `$derived` curente.
 */
export type TaskLiveQueries = () => any[];

export class TaskLiveQueryRegistry {
	#getters = new Set<TaskLiveQueries>();

	register(getter: TaskLiveQueries): () => void {
		this.#getters.add(getter);
		return () => {
			this.#getters.delete(getter);
		};
	}

	collect(): any[] {
		const out: any[] = [];
		for (const getter of this.#getters) {
			const queries = getter();
			if (queries) out.push(...queries);
		}
		return out;
	}
}

/** Pagina creează registrul, îl publică în context și își înscrie instanțele. */
export function provideTaskLiveQueries(pageQueries: TaskLiveQueries): TaskLiveQueryRegistry {
	const registry = new TaskLiveQueryRegistry();
	registry.register(pageQueries);
	setContext(TASK_LIVE_QUERIES_KEY, registry);
	return registry;
}

/** Undefined pe paginile care nu publică registrul — consumatorii au fallback. */
export function getTaskLiveQueries(): TaskLiveQueryRegistry | undefined {
	return getContext<TaskLiveQueryRegistry>(TASK_LIVE_QUERIES_KEY);
}
