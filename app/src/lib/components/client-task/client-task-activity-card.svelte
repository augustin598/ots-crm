<!-- src/lib/components/client-task/client-task-activity-card.svelte -->
<script lang="ts">
	import { getTaskActivities } from '$lib/remotes/task-activities.remote';
	import HistoryIcon from '@lucide/svelte/icons/history';

	type Props = { taskId: string };
	let { taskId }: Props = $props();

	const activityQuery = $derived(getTaskActivities(taskId));
	const activities = $derived(activityQuery.current ?? []);

	function fmtAgo(d: Date | string): string {
		const date = d instanceof Date ? d : new Date(d);
		const diff = Date.now() - date.getTime();
		const mins = Math.floor(diff / 60_000);
		if (mins < 1) return 'acum';
		if (mins < 60) return `${mins}m`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}z`;
		return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
	}

	function describe(a: any): string {
		switch (a.action) {
			case 'status_changed':
				return `Status: ${a.oldValue} → ${a.newValue}`;
			case 'priority_changed':
				return `Prioritate: ${a.oldValue} → ${a.newValue}`;
			case 'assignee_changed':
				return `Asignat: ${a.newValue}`;
			case 'subtask_toggled':
				return `Subtask ${a.newValue ? 'finalizat' : 'redeschis'}: ${a.field}`;
			case 'duplicated':
				return `Duplicat din alt task`;
			default:
				return a.action;
		}
	}
</script>

<div class="ct-card rounded-[12px] border border-[#e5e9f0] bg-white p-[18px]">
	<div class="ct-section-head mb-3 flex items-center gap-2">
		<HistoryIcon class="h-3.5 w-3.5 text-[#475569]" />
		<h4 class="text-[13px] font-bold uppercase tracking-[.04em] text-[#0f172a]">
			Activitate ({activities.length})
		</h4>
	</div>

	{#if activities.length === 0}
		<div class="text-[12px] text-[#94a3b8]">Nicio activitate încă.</div>
	{:else}
		<ul class="flex max-h-[420px] flex-col gap-2.5 overflow-y-auto pr-1">
			{#each activities as a (a.id)}
				<li class="flex items-start gap-2 text-[12px]">
					<span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1877F2]"></span>
					<div class="flex-1 min-w-0">
						<div class="text-[#0f172a]">{describe(a)}</div>
						<div class="text-[11px] text-[#94a3b8]">
							{a.userName ?? 'Sistem'} · {fmtAgo(a.createdAt)}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
