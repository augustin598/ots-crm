<!-- src/lib/components/client-team/client-team-stats.svelte -->
<script lang="ts">
	import UsersIcon from '@lucide/svelte/icons/users';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CheckSquareIcon from '@lucide/svelte/icons/check-square';

	type Props = {
		total: number;
		online: number;
		pending: number;
		openTasks: number;
	};
	let { total, online, pending, openTasks }: Props = $props();
</script>

<div class="cteam-stats mx-7 mt-4 grid grid-cols-4 gap-3">
	<div class="cteam-stat flex items-center gap-3 rounded-[12px] border border-[#e5e9f0] bg-white p-3.5">
		<div class="grid h-9 w-9 place-items-center rounded-[9px] bg-[#1877F2]/10 text-[#1877F2]">
			<UsersIcon class="h-[18px] w-[18px]" />
		</div>
		<div>
			<div class="text-[10.5px] font-semibold uppercase tracking-[.04em] text-[#475569]">Active Members</div>
			<div class="text-[22px] font-bold leading-[1.1] tracking-tight text-[#0f172a]">{total}</div>
		</div>
	</div>
	<div class="cteam-stat flex items-center gap-3 rounded-[12px] border border-[#e5e9f0] bg-white p-3.5">
		<div class="grid h-9 w-9 place-items-center rounded-[9px] bg-[#10b981]/10 text-[#10b981]">
			<CircleIcon class="h-[18px] w-[18px]" />
		</div>
		<div>
			<div class="text-[10.5px] font-semibold uppercase tracking-[.04em] text-[#475569]">Online</div>
			<div class="text-[22px] font-bold leading-[1.1] tracking-tight text-[#0f172a]">{online}</div>
		</div>
	</div>
	<div class="cteam-stat flex items-center gap-3 rounded-[12px] border border-[#e5e9f0] bg-white p-3.5">
		<div class="grid h-9 w-9 place-items-center rounded-[9px] bg-[#f59e0b]/10 text-[#f59e0b]">
			<ClockIcon class="h-[18px] w-[18px]" />
		</div>
		<div>
			<div class="text-[10.5px] font-semibold uppercase tracking-[.04em] text-[#475569]">Pending Approvals</div>
			<div class="text-[22px] font-bold leading-[1.1] tracking-tight text-[#0f172a]">{pending}</div>
		</div>
	</div>
	<div class="cteam-stat flex items-center gap-3 rounded-[12px] border border-[#e5e9f0] bg-white p-3.5">
		<div class="grid h-9 w-9 place-items-center rounded-[9px] bg-[#8b5cf6]/10 text-[#8b5cf6]">
			<CheckSquareIcon class="h-[18px] w-[18px]" />
		</div>
		<div>
			<div class="text-[10.5px] font-semibold uppercase tracking-[.04em] text-[#475569]">Open Tasks</div>
			<div class="text-[22px] font-bold leading-[1.1] tracking-tight text-[#0f172a]">{openTasks}</div>
		</div>
	</div>
</div>
