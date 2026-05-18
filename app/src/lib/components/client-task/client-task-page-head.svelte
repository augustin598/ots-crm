<!-- src/lib/components/client-task/client-task-page-head.svelte -->
<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { formatPriority, formatStatus } from '$lib/components/task-kanban-utils';
	import { isTaskOverdue } from '$lib/utils/task-filters';

	type TagInfo = { id?: string; name: string; color?: string | null };

	type Props = {
		task: Task;
		clientName: string | null;
		tags: TagInfo[];
		onBack: () => void;
		onScheduleMeet: () => void;
	};

	let { task, clientName, tags, onBack, onScheduleMeet }: Props = $props();

	const overdue = $derived(
		task.status !== 'done' && task.status !== 'cancelled' && isTaskOverdue(task.dueDate)
	);

	function statusColors(s: string | null) {
		switch (s) {
			case 'pending-approval':
				return { color: '#b45309', bg: '#fef3c7' };
			case 'todo':
				return { color: '#475569', bg: '#f1f5f9' };
			case 'in-progress':
				return { color: '#1d4ed8', bg: '#dbeafe' };
			case 'review':
				return { color: '#6d28d9', bg: '#ede9fe' };
			case 'done':
				return { color: '#047857', bg: '#d1fae5' };
			case 'cancelled':
			case 'blocked':
				return { color: '#b91c1c', bg: '#fee2e2' };
			default:
				return { color: '#475569', bg: '#f1f5f9' };
		}
	}

	function priorityColors(p: string | null) {
		switch (p) {
			case 'urgent':
				return { color: '#b91c1c', bg: '#fee2e2' };
			case 'high':
				return { color: '#b45309', bg: '#fef3c7' };
			case 'medium':
				return { color: '#047857', bg: '#d1fae5' };
			case 'low':
				return { color: '#475569', bg: '#e2e8f0' };
			default:
				return { color: '#475569', bg: '#e2e8f0' };
		}
	}

	const sCol = $derived(statusColors(task.status));
	const pCol = $derived(priorityColors(task.priority));
</script>

<div class="ct-page-head flex flex-wrap items-start justify-between gap-3">
	<div class="flex-1 min-w-0">
		<div class="ct-crumb-tag mb-2 inline-flex items-center gap-1.5 rounded-md bg-[#f7f8fa] px-2.5 py-1 text-[11px] font-semibold text-[#475569]">
			Task{clientName ? ` · ${clientName}` : ''}
		</div>
		<h1 class="ct-title text-[26px] font-bold leading-tight tracking-tight text-[#0f172a]">
			{task.title}
		</h1>
		<div class="ct-pills mt-3 flex flex-wrap items-center gap-2">
			<span
				class="ct-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
				style:background-color={sCol.bg}
				style:color={sCol.color}
			>
				<span class="h-1.5 w-1.5 rounded-full" style:background-color={sCol.color}></span>
				{formatStatus(task.status ?? 'todo')}
			</span>
			<span
				class="ct-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
				style:background-color={pCol.bg}
				style:color={pCol.color}
			>
				<span class="h-1.5 w-1.5 rounded-full" style:background-color={pCol.color}></span>
				{formatPriority(task.priority ?? 'medium')}
			</span>
			{#if overdue}
				<span
					class="ct-pill inline-flex items-center gap-1.5 rounded-full bg-[#fee2e2] px-3 py-1.5 text-[12px] font-semibold text-[#b91c1c]"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-[#b91c1c]"></span>
					Overdue
				</span>
			{/if}
			{#each tags as t (t.id ?? t.name)}
				<span class="text-[11.5px] font-semibold text-[#1877F2]">#{t.name}</span>
			{/each}
		</div>
	</div>

	<div class="flex items-center gap-2 shrink-0">
		<button
			type="button"
			class="ct-meet-btn inline-flex items-center gap-2 rounded-lg bg-[#10b981] px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#0e9572]"
			onclick={onScheduleMeet}
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="shrink-0">
				<path d="M16 8.5V12.5L20 16V5L16 8.5Z" fill="#a7f3d0" />
				<path d="M3 6V18C3 18.5523 3.44772 19 4 19H14C14.5523 19 15 18.5523 15 18V14L11 14V6H3Z" fill="white" />
				<path d="M11 6V14H15V10L11 6Z" fill="#fef08a" />
				<path d="M15 14L11 10V14H15Z" fill="#fca5a5" />
				<path d="M11 6L15 10V6H11Z" fill="#bbf7d0" />
			</svg>
			Programează Google Meet
		</button>
		<button
			type="button"
			class="ct-back inline-flex items-center gap-1.5 rounded-lg border border-[#e5e9f0] bg-white px-3 py-2 text-[12.5px] font-semibold text-[#475569] transition-colors hover:border-[#1877F2] hover:text-[#0f172a]"
			onclick={onBack}
		>
			<ChevronLeftIcon class="h-3.5 w-3.5" />
			Back to Tasks
		</button>
	</div>
</div>
