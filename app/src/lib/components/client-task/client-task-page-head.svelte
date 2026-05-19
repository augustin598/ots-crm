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
			class="ct-meet-btn inline-flex items-center gap-2 rounded-lg border border-[#e5e9f0] bg-[#f7f8fa] px-3 py-2 text-[12.5px] font-semibold text-[#0f172a] transition-colors hover:border-[#cbd5e1] hover:bg-[#f1f5f9]"
			onclick={onScheduleMeet}
		>
			<svg width="16" height="16" viewBox="0 0 87 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="shrink-0">
				<path d="M49.5 36L57.8025 45.45L69 52.605L70.9425 36.084L69 19.929L57.654 26.214L49.5 36Z" fill="#00832D"/>
				<path d="M0 51.75V66.75C0 70.179 2.821 73 6.25 73H21.25L24.349 61.683L21.25 51.75L10.85 48.651L0 51.75Z" fill="#0066DA"/>
				<path d="M21.25 0L0 21.25L10.85 24.349L21.25 21.25L24.302 11.452L21.25 0Z" fill="#E94235"/>
				<path d="M21.25 21.25H0V51.75H21.25V21.25Z" fill="#2684FC"/>
				<path d="M82.604 7.396L69 18.643V52.605L82.654 63.852C84.696 65.451 87.694 64.026 87.694 61.452V10.546C87.694 7.944 84.642 6.527 82.604 7.396ZM49.5 36V51.75H21.25V72H62.75C66.179 72 69 69.179 69 65.75V52.605L49.5 36Z" fill="#FFBA00"/>
				<path d="M62.75 0H21.25V21.25H49.5V36L69 19.929V6.25C69 2.821 66.179 0 62.75 0Z" fill="#00AC47"/>
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
