<script lang="ts">
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import PlayIcon from '@lucide/svelte/icons/play';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import BanIcon from '@lucide/svelte/icons/ban';

	export type CardFilter = '' | 'in-progress' | 'overdue' | 'completed' | 'blocked' | 'recurring';

	type Stats = {
		total: number;
		inProgress: number;
		overdue: number;
		completed: number;
		blocked?: number;
		recurring?: number;
	};

	type Props = {
		stats: Stats;
		activeFilter: CardFilter;
		onFilterChange: (value: CardFilter) => void;
		/** Optional 5th card slot. `null` = render only the 4 base cards. */
		extraCard?: 'blocked' | 'recurring' | null;
		/** Hide entire strip when there are zero tasks. Defaults to true. */
		hideWhenEmpty?: boolean;
	};

	let {
		stats,
		activeFilter,
		onFilterChange,
		extraCard = null,
		hideWhenEmpty = true
	}: Props = $props();

	function toggle(value: CardFilter) {
		onFilterChange(activeFilter === value ? '' : value);
	}

	const gridCols = $derived(extraCard ? 'md:grid-cols-5' : 'md:grid-cols-4');
</script>

{#if !hideWhenEmpty || stats.total > 0}
	<div class="grid gap-4 grid-cols-2 {gridCols}">
		<!-- Total -->
		<button
			type="button"
			onclick={() => onFilterChange('')}
			aria-pressed={activeFilter === ''}
			class="cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary {activeFilter ===
			''
				? 'border-primary/50 ring-2 ring-primary/30'
				: 'border-border/40'}"
		>
			<div class="flex items-center gap-3">
				<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10">
					<ListTodoIcon class="h-5 w-5 text-blue-600" />
				</div>
				<div>
					<p class="text-sm text-muted-foreground">Total</p>
					<p class="text-2xl font-bold">{stats.total}</p>
				</div>
			</div>
		</button>

		<!-- In Progress -->
		<button
			type="button"
			onclick={() => toggle('in-progress')}
			aria-pressed={activeFilter === 'in-progress'}
			class="cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary {activeFilter ===
			'in-progress'
				? 'border-primary/50 ring-2 ring-primary/30'
				: 'border-border/40'}"
		>
			<div class="flex items-center gap-3">
				<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10">
					<PlayIcon class="h-5 w-5 text-blue-600" />
				</div>
				<div>
					<p class="text-sm text-muted-foreground">In Progress</p>
					<p class="text-2xl font-bold">{stats.inProgress}</p>
				</div>
			</div>
		</button>

		<!-- Overdue -->
		<button
			type="button"
			onclick={() => toggle('overdue')}
			aria-pressed={activeFilter === 'overdue'}
			class="cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary {activeFilter ===
			'overdue'
				? 'border-primary/50 ring-2 ring-primary/30'
				: 'border-border/40'}"
		>
			<div class="flex items-center gap-3">
				<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10">
					<AlertTriangleIcon class="h-5 w-5 text-red-600" />
				</div>
				<div>
					<p class="text-sm text-muted-foreground">Overdue</p>
					<p class="text-2xl font-bold {stats.overdue > 0 ? 'text-red-600' : ''}">
						{stats.overdue}
					</p>
				</div>
			</div>
		</button>

		<!-- Completed -->
		<button
			type="button"
			onclick={() => toggle('completed')}
			aria-pressed={activeFilter === 'completed'}
			class="cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary {activeFilter ===
			'completed'
				? 'border-primary/50 ring-2 ring-primary/30'
				: 'border-border/40'}"
		>
			<div class="flex items-center gap-3">
				<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10">
					<CheckCircle2Icon class="h-5 w-5 text-green-600" />
				</div>
				<div>
					<p class="text-sm text-muted-foreground">Completed</p>
					<p class="text-2xl font-bold">{stats.completed}</p>
				</div>
			</div>
		</button>

		{#if extraCard === 'blocked'}
			<button
				type="button"
				onclick={() => toggle('blocked')}
				aria-pressed={activeFilter === 'blocked'}
				class="cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary {activeFilter ===
				'blocked'
					? 'border-primary/50 ring-2 ring-primary/30'
					: 'border-border/40'}"
			>
				<div class="flex items-center gap-3">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-500/10">
						<BanIcon class="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Blocked</p>
						<p class="text-2xl font-bold">{stats.blocked ?? 0}</p>
					</div>
				</div>
			</button>
		{:else if extraCard === 'recurring'}
			<button
				type="button"
				onclick={() => toggle('recurring')}
				aria-pressed={activeFilter === 'recurring'}
				class="cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary {activeFilter ===
				'recurring'
					? 'border-primary/50 ring-2 ring-primary/30'
					: 'border-border/40'}"
			>
				<div class="flex items-center gap-3">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10">
						<RepeatIcon class="h-5 w-5 text-blue-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Task recurent</p>
						<p class="text-2xl font-bold">{stats.recurring ?? 0}</p>
					</div>
				</div>
			</button>
		{/if}
	</div>
{/if}
