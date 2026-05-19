<!-- src/lib/components/client-task/client-task-meta-card.svelte -->
<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import UserIcon from '@lucide/svelte/icons/user';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import FlameIcon from '@lucide/svelte/icons/flame';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { formatStatus, formatPriority } from '$lib/components/task-kanban-utils';

	type Props = {
		task: Task;
		createdByName: string | null;
	};
	let { task, createdByName }: Props = $props();

	function fmtDate(d: Date | string | null | undefined): string {
		if (!d) return '—';
		const date = d instanceof Date ? d : new Date(d);
		return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}
</script>

<div class="ct-card rounded-[12px] border border-[#e5e9f0] bg-white p-[18px]">
	<div class="ct-section-head mb-3 flex items-center gap-2">
		<InfoIcon class="h-3.5 w-3.5 text-[#475569]" />
		<h4 class="text-[13px] font-bold uppercase tracking-[.04em] text-[#0f172a]">Detalii</h4>
	</div>
	<dl class="flex flex-col gap-3 text-[13px]">
		<div class="flex items-start gap-2">
			<UserIcon class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
			<div class="flex-1 min-w-0">
				<dt class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">Status</dt>
				<dd class="font-semibold text-[#0f172a]">{formatStatus(task.status ?? 'todo')}</dd>
			</div>
		</div>
		<div class="flex items-start gap-2">
			<FlameIcon class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
			<div class="flex-1 min-w-0">
				<dt class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">Prioritate</dt>
				<dd class="font-semibold text-[#0f172a]">{formatPriority(task.priority ?? 'medium')}</dd>
			</div>
		</div>
		<div class="flex items-start gap-2">
			<CalendarIcon class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
			<div class="flex-1 min-w-0">
				<dt class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">Due date</dt>
				<dd class="font-semibold text-[#0f172a]">{fmtDate(task.dueDate)}</dd>
			</div>
		</div>
		<div class="flex items-start gap-2">
			<ClockIcon class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
			<div class="flex-1 min-w-0">
				<dt class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">Creat</dt>
				<dd class="font-semibold text-[#0f172a]">
					{fmtDate(task.createdAt)}{createdByName ? ` · ${createdByName}` : ''}
				</dd>
			</div>
		</div>
	</dl>
</div>
