<script lang="ts">
	import type { TaskItem } from './types';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PlusIcon from '@lucide/svelte/icons/plus';

	let { tasks, allHref, newHref }: { tasks: TaskItem[]; allHref: string; newHref: string } = $props();

	const PRIO: Record<TaskItem['priority'], string> = {
		urgent: 'var(--d-danger)',
		high: 'var(--d-warn)',
		medium: 'var(--d-primary)',
		low: 'var(--d-muted)'
	};
</script>

<div class="dash-card">
	<div class="dash-card-head">
		<div>
			<div class="dash-card-title">Taskuri prioritare</div>
			<div class="dash-card-sub">Asignate ție · {tasks.length} active</div>
		</div>
		<a href={allHref} class="dash-link">Toate <ChevronRightIcon size={12} /></a>
	</div>
	<div class="dash-tasks-list">
		{#each tasks as t (t.id)}
			{@const c = PRIO[t.priority]}
			<a href={t.href} class="dash-task-row">
				<input type="checkbox" class="dash-checkbox" aria-label="Marchează task finalizat" />
				<div class="dash-task-info">
					<div class="dash-task-title">{t.title}</div>
					<div class="dash-task-meta">
						<span class="dash-task-prio" style="background:color-mix(in oklch, {c} 14%, transparent);color:{c}">{t.priority}</span>
						<span>{t.project}</span>
						<span>·</span>
						<span>{t.due}</span>
					</div>
				</div>
				<div class="dash-task-assignee">{t.assignee}</div>
			</a>
		{:else}
			<div class="dash-empty">Niciun task cu termen apropiat.</div>
		{/each}
		<a href={newHref} class="dash-add-task"><PlusIcon size={13} /> Task nou</a>
	</div>
</div>
