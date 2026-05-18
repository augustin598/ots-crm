<script lang="ts">
	import CheckSquareIcon from '@lucide/svelte/icons/check-square';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import CheckIcon from '@lucide/svelte/icons/check';
	import RepeatIcon from '@lucide/svelte/icons/repeat';

	export type CardFilter =
		| ''
		| 'all'
		| 'overdue'
		| 'today'
		| 'week'
		| 'completed'
		| 'in-progress'
		| 'blocked'
		| 'recurring';

	type Stats = {
		total: number;
		/** Active = not done, not cancelled */
		totalActive?: number;
		overdue: number;
		dueToday?: number;
		dueWeek?: number;
		inProgress?: number;
		completed: number;
		blocked?: number;
		recurring?: number;
	};

	type Props = {
		stats: Stats;
		activeFilter: CardFilter;
		onFilterChange: (value: CardFilter) => void;
		/** Which 5 cards to show. Defaults to admin set per design (all/overdue/today/week/completed). */
		cards?: Array<
			'all' | 'overdue' | 'today' | 'week' | 'completed' | 'in-progress' | 'blocked' | 'recurring'
		>;
		hideWhenEmpty?: boolean;
	};

	let {
		stats,
		activeFilter,
		onFilterChange,
		cards = ['all', 'overdue', 'today', 'week', 'completed'],
		hideWhenEmpty = false
	}: Props = $props();

	type CardConfig = {
		id: 'all' | 'overdue' | 'today' | 'week' | 'completed' | 'in-progress' | 'blocked' | 'recurring';
		label: string;
		value: number;
		sub: string;
		iconColor: string;
		iconBg: string;
		barColor: string;
		filterValue: CardFilter;
		Icon: typeof CheckSquareIcon;
	};

	function buildCard(id: CardConfig['id']): CardConfig {
		switch (id) {
			case 'all':
				return {
					id,
					label: 'Total active',
					value: stats.totalActive ?? stats.total ?? 0,
					sub: `din ${stats.total ?? 0} taskuri`,
					iconColor: '#1877F2',
					iconBg: '#dbeafe',
					barColor: '#1877F2',
					filterValue: '',
					Icon: CheckSquareIcon
				};
			case 'overdue':
				return {
					id,
					label: 'Overdue',
					value: stats.overdue ?? 0,
					sub: 'atenție urgentă',
					iconColor: '#ef4444',
					iconBg: '#fee2e2',
					barColor: '#ef4444',
					filterValue: 'overdue',
					Icon: AlertTriangleIcon
				};
			case 'today':
				return {
					id,
					label: 'Scadente azi',
					value: stats.dueToday ?? 0,
					sub: 'deadline azi',
					iconColor: '#f59e0b',
					iconBg: '#fef3c7',
					barColor: '#f59e0b',
					filterValue: 'today',
					Icon: ClockIcon
				};
			case 'week':
				return {
					id,
					label: 'Săptămâna asta',
					value: stats.dueWeek ?? 0,
					sub: 'next 7 days',
					iconColor: '#8b5cf6',
					iconBg: '#ede9fe',
					barColor: '#8b5cf6',
					filterValue: 'week',
					Icon: CalendarIcon
				};
			case 'completed':
				return {
					id,
					label: 'Finalizate',
					value: stats.completed ?? 0,
					sub: 'luna aceasta',
					iconColor: '#10b981',
					iconBg: '#d1fae5',
					barColor: '#10b981',
					filterValue: 'completed',
					Icon: CheckIcon
				};
			case 'in-progress':
				return {
					id,
					label: 'În lucru',
					value: stats.inProgress ?? 0,
					sub: 'activ acum',
					iconColor: '#1877F2',
					iconBg: '#dbeafe',
					barColor: '#1877F2',
					filterValue: 'in-progress',
					Icon: ClockIcon
				};
			case 'blocked':
				return {
					id,
					label: 'Blocked',
					value: stats.blocked ?? 0,
					sub: 'necesită acțiune',
					iconColor: '#ef4444',
					iconBg: '#fee2e2',
					barColor: '#ef4444',
					filterValue: 'blocked',
					Icon: AlertTriangleIcon
				};
			case 'recurring':
				return {
					id,
					label: 'Recurente',
					value: stats.recurring ?? 0,
					sub: 'task-uri recurente',
					iconColor: '#1877F2',
					iconBg: '#dbeafe',
					barColor: '#1877F2',
					filterValue: 'recurring',
					Icon: RepeatIcon
				};
		}
	}

	const cardConfigs = $derived(cards.map(buildCard));

	function toggleCard(c: CardConfig) {
		if (isActive(c)) {
			onFilterChange('');
		} else {
			onFilterChange(c.filterValue);
		}
	}

	function isActive(c: CardConfig): boolean {
		if (c.id === 'all') return activeFilter === '' || activeFilter === 'all';
		return activeFilter === c.filterValue;
	}
</script>

{#if !hideWhenEmpty || (stats.total ?? 0) > 0}
	<div
		class="grid gap-3"
		style:grid-template-columns="repeat({cardConfigs.length}, minmax(0, 1fr))"
	>
		{#each cardConfigs as c (c.id)}
			<button
				type="button"
				onclick={() => toggleCard(c)}
				aria-pressed={isActive(c)}
				class={[
					'group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-px hover:border-[#1877F2] hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/30 dark:border-zinc-700 dark:bg-zinc-900',
					isActive(c)
						? 'border-[#1877F2] bg-[#f0f7ff] dark:border-[#1877F2] dark:bg-[#1877F2]/10'
						: 'border-[#e5e9f0] dark:border-zinc-700'
				].join(' ')}
			>
				<div
					class="grid h-9 w-9 shrink-0 place-items-center rounded-[9px]"
					style:background-color={c.iconBg}
					style:color={c.iconColor}
				>
					<c.Icon class="h-[18px] w-[18px]" />
				</div>
				<div class="flex min-w-0 flex-col gap-0.5 leading-none">
					<span
						class="text-[10.5px] font-semibold uppercase tracking-[.04em] text-[#475569] dark:text-zinc-400"
					>
						{c.label}
					</span>
					<span
						class="text-[22px] font-bold leading-[1.1] tracking-[-.02em] text-[#0f172a] dark:text-zinc-100"
					>
						{c.value}
					</span>
					<span class="text-[11px] text-[#94a3b8] dark:text-zinc-500">{c.sub}</span>
				</div>
				<span
					class="pointer-events-none absolute bottom-0 left-0 right-0 h-[3px]"
					style:background-color={c.barColor}
				></span>
			</button>
		{/each}
	</div>
{/if}
