<!-- src/lib/components/client-task/client-task-pills.svelte -->
<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import { formatPriority, formatStatus } from '$lib/components/task-kanban-utils';
	import { isTaskOverdue } from '$lib/utils/task-filters';

	type TagInfo = { id?: string; name: string; color?: string | null };

	type Props = {
		task: Task;
		tags: TagInfo[];
	};

	let { task, tags }: Props = $props();

	function statusPill(s: string | null) {
		switch (s) {
			case 'pending-approval':
				return { color: '#f59e0b', bg: '#fffbeb' };
			case 'todo':
				return { color: '#64748b', bg: '#f1f5f9' };
			case 'in-progress':
				return { color: '#1877F2', bg: '#dbeafe' };
			case 'review':
				return { color: '#8b5cf6', bg: '#ede9fe' };
			case 'done':
				return { color: '#10b981', bg: '#d1fae5' };
			case 'cancelled':
			case 'blocked':
				return { color: '#ef4444', bg: '#fee2e2' };
			default:
				return { color: '#64748b', bg: '#f1f5f9' };
		}
	}

	function priorityPill(p: string | null) {
		const color = (() => {
			switch (p) {
				case 'urgent':
					return '#ef4444';
				case 'high':
					return '#f59e0b';
				case 'medium':
					return '#10b981';
				case 'low':
					return '#94a3b8';
				default:
					return '#94a3b8';
			}
		})();
		// Match design: bg = `${color}18` (hex8 alpha)
		return { color, bg: `${color}18` };
	}

	const overdue = $derived(
		task.status !== 'done' && task.status !== 'cancelled' && isTaskOverdue(task.dueDate)
	);

	const sCol = $derived(statusPill(task.status));
	const pCol = $derived(priorityPill(task.priority));
</script>

<div class="ct-pills mb-[22px] flex flex-wrap items-center gap-2">
	<span
		class="ct-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold"
		style:background-color={sCol.bg}
		style:color={sCol.color}
	>
		<span class="h-[7px] w-[7px] rounded-full" style:background-color={sCol.color}></span>
		{formatStatus(task.status ?? 'todo')}
	</span>
	<span
		class="ct-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold"
		style:background-color={pCol.bg}
		style:color={pCol.color}
	>
		<span class="h-[7px] w-[7px] rounded-full" style:background-color={pCol.color}></span>
		{formatPriority(task.priority ?? 'medium')}
	</span>
	{#if overdue}
		<span
			class="ct-pill inline-flex items-center gap-1.5 rounded-full bg-[#fee2e2] px-3 py-1.5 text-[12px] font-bold text-[#ef4444]"
		>
			<AlertTriangleIcon class="h-[11px] w-[11px]" />
			Overdue
		</span>
	{/if}
	{#each tags as t (t.id ?? t.name)}
		<span
			class="ct-pill inline-flex items-center rounded-full bg-[#f1f5f9] px-3 py-1.5 text-[12px] font-bold text-[#64748b]"
		>
			#{t.name}
		</span>
	{/each}
</div>
