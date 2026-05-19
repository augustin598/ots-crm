<!-- src/lib/components/client-task/client-task-meta-card.svelte -->
<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { formatStatus, formatPriority } from '$lib/components/task-kanban-utils';
	import { isTaskOverdue } from '$lib/utils/task-filters';

	type Props = {
		task: Task;
		createdByName: string | null;
	};
	let { task, createdByName }: Props = $props();

	function statusColor(s: string | null): string {
		switch (s) {
			case 'pending-approval':
				return '#f59e0b';
			case 'todo':
				return '#64748b';
			case 'in-progress':
				return '#1877F2';
			case 'review':
				return '#8b5cf6';
			case 'done':
				return '#10b981';
			case 'cancelled':
			case 'blocked':
				return '#ef4444';
			default:
				return '#64748b';
		}
	}

	function priorityColor(p: string | null): string {
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
	}

	const overdue = $derived(
		task.status !== 'done' && task.status !== 'cancelled' && isTaskOverdue(task.dueDate)
	);

	const sColor = $derived(statusColor(task.status));
	const pColor = $derived(priorityColor(task.priority));

	function fmtDate(d: Date | string | null | undefined): string {
		if (!d) return '—';
		const date = d instanceof Date ? d : new Date(d);
		return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}
</script>

<div class="ct-card rounded-[12px] border border-[#e5e9f0] bg-white p-[18px]">
	<!-- Status row -->
	<div
		class="ct-meta-row flex gap-3 border-b border-[#f1f5f9] py-[11px] first:pt-0 last:border-b-0 last:pb-0"
	>
		<div
			class="ct-meta-icon grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[#f1f5f9] text-[#475569]"
		>
			<ClockIcon class="h-3.5 w-3.5" />
		</div>
		<div class="ct-meta-content min-w-0 flex-1">
			<span
				class="ct-meta-label mb-[3px] block text-[11px] font-bold uppercase tracking-[0.04em] text-[#94a3b8]"
			>
				Status
			</span>
			<span
				class="ct-meta-value inline-flex items-center gap-1.5 text-[13px] font-semibold"
				style:color={sColor}
			>
				<span class="h-[6px] w-[6px] rounded-full" style:background-color={sColor}></span>
				{formatStatus(task.status ?? 'todo')}
			</span>
		</div>
	</div>

	<!-- Priority row -->
	<div
		class="ct-meta-row flex gap-3 border-b border-[#f1f5f9] py-[11px] first:pt-0 last:border-b-0 last:pb-0"
	>
		<div
			class="ct-meta-icon grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[#f1f5f9] text-[#475569]"
		>
			<AlertTriangleIcon class="h-3.5 w-3.5" />
		</div>
		<div class="ct-meta-content min-w-0 flex-1">
			<span
				class="ct-meta-label mb-[3px] block text-[11px] font-bold uppercase tracking-[0.04em] text-[#94a3b8]"
			>
				Priority
			</span>
			<span
				class="ct-meta-value inline-flex items-center gap-1.5 text-[13px] font-semibold"
				style:color={pColor}
			>
				<span class="h-[6px] w-[6px] rounded-full" style:background-color={pColor}></span>
				{formatPriority(task.priority ?? 'medium')}
			</span>
		</div>
	</div>

	<!-- Due Date row -->
	<div
		class="ct-meta-row flex gap-3 border-b border-[#f1f5f9] py-[11px] first:pt-0 last:border-b-0 last:pb-0"
	>
		<div
			class="ct-meta-icon grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[#f1f5f9] text-[#475569]"
		>
			<CalendarIcon class="h-3.5 w-3.5" />
		</div>
		<div class="ct-meta-content min-w-0 flex-1">
			<span
				class="ct-meta-label mb-[3px] block text-[11px] font-bold uppercase tracking-[0.04em] text-[#94a3b8]"
			>
				Due Date
			</span>
			<span
				class={[
					'ct-meta-value block text-[13px] font-semibold',
					overdue ? 'text-[#ef4444]' : 'text-[#0f172a]'
				].join(' ')}
			>
				{fmtDate(task.dueDate)}
				{#if overdue}
					<span class="mt-[2px] block text-[11.5px] font-medium text-[#ef4444]">Overdue</span>
				{/if}
			</span>
		</div>
	</div>

	<!-- Created row -->
	<div
		class="ct-meta-row flex gap-3 border-b border-[#f1f5f9] py-[11px] first:pt-0 last:border-b-0 last:pb-0"
	>
		<div
			class="ct-meta-icon grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[#f1f5f9] text-[#475569]"
		>
			<PlusIcon class="h-3.5 w-3.5" />
		</div>
		<div class="ct-meta-content min-w-0 flex-1">
			<span
				class="ct-meta-label mb-[3px] block text-[11px] font-bold uppercase tracking-[0.04em] text-[#94a3b8]"
			>
				Created
			</span>
			<span class="ct-meta-value block text-[13px] font-semibold text-[#0f172a]">
				{fmtDate(task.createdAt)}
				{#if createdByName}
					<span class="mt-[2px] block text-[11.5px] font-medium text-[#94a3b8]">
						by {createdByName}
					</span>
				{/if}
			</span>
		</div>
	</div>
</div>
