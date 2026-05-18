<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import VideoIcon from '@lucide/svelte/icons/video';

	type Props = {
		tasks: Task[];
		/** Initial month to show (ISO 'YYYY-MM'). Defaults to current month. */
		initialMonth?: string;
		onTaskClick: (task: Task) => void;
		/** Open create dialog pre-filled with a due date (YYYY-MM-DD). Type 'meet' opens with type=meeting prefilled. */
		onAddDay?: (isoDate: string, kind: 'task' | 'meet') => void;
	};

	let { tasks, initialMonth, onTaskClick, onAddDay }: Props = $props();

	// ---- Month navigation ----
	function parseInitial(): { year: number; month: number } {
		if (initialMonth) {
			const [y, m] = initialMonth.split('-').map(Number);
			if (y && m) return { year: y, month: m - 1 };
		}
		const now = new Date();
		return { year: now.getFullYear(), month: now.getMonth() };
	}

	let cursor = $state(parseInitial());

	function prevMonth() {
		const nm = cursor.month - 1;
		cursor = nm < 0 ? { year: cursor.year - 1, month: 11 } : { year: cursor.year, month: nm };
	}
	function nextMonth() {
		const nm = cursor.month + 1;
		cursor = nm > 11 ? { year: cursor.year + 1, month: 0 } : { year: cursor.year, month: nm };
	}
	function gotoToday() {
		const now = new Date();
		cursor = { year: now.getFullYear(), month: now.getMonth() };
	}

	const monthLabel = $derived(
		new Date(cursor.year, cursor.month, 1)
			.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })
			.replace(/^./, (c) => c.toUpperCase())
	);

	// ---- Grid construction ----
	// Romanian week starts Monday (Lun, Mar, Mie, Joi, Vin, Sâm, Dum)
	function dayOfWeekMondayStart(d: Date): number {
		// JS getDay(): 0=Sun..6=Sat. Convert to 0=Mon..6=Sun
		return (d.getDay() + 6) % 7;
	}

	type Cell = {
		date: Date;
		iso: string;
		dayNum: number;
		inMonth: boolean;
		isToday: boolean;
		tasks: Task[];
	};

	function isoOf(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${dd}`;
	}

	// Group tasks by ISO date for O(1) lookup per cell
	const tasksByIso = $derived.by(() => {
		const map = new Map<string, Task[]>();
		for (const t of tasks) {
			if (!t.dueDate) continue;
			const d = t.dueDate instanceof Date ? t.dueDate : new Date(t.dueDate);
			if (Number.isNaN(d.getTime())) continue;
			const key = isoOf(d);
			const list = map.get(key) ?? [];
			list.push(t);
			map.set(key, list);
		}
		// Sort within each day: priority desc, then title asc
		const prioOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
		for (const list of map.values()) {
			list.sort((a, b) => {
				const dp =
					(prioOrder[a.priority ?? 'medium'] ?? 4) - (prioOrder[b.priority ?? 'medium'] ?? 4);
				if (dp !== 0) return dp;
				return a.title.localeCompare(b.title);
			});
		}
		return map;
	});

	const cells = $derived.by(() => {
		const first = new Date(cursor.year, cursor.month, 1);
		const offset = dayOfWeekMondayStart(first);
		const todayIso = isoOf(new Date());

		// Always render 6 rows × 7 = 42 cells to keep height stable
		const out: Cell[] = [];
		for (let i = 0; i < 42; i++) {
			const day = i - offset + 1;
			const d = new Date(cursor.year, cursor.month, day);
			const iso = isoOf(d);
			out.push({
				date: d,
				iso,
				dayNum: d.getDate(),
				inMonth: d.getMonth() === cursor.month,
				isToday: iso === todayIso,
				tasks: tasksByIso.get(iso) ?? []
			});
		}
		// Trim the last row if it's fully out-of-month (avoids stray blank week)
		if (out.slice(35).every((c) => !c.inMonth)) {
			return out.slice(0, 35);
		}
		return out;
	});

	const WEEK_HEADERS = ['Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm', 'Dum'];

	function priorityColor(priority: string | null | undefined): string {
		switch (priority) {
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
</script>

<div class="tk-calendar">
	<!-- Header: prev/next + month label + today -->
	<div
		class="tk-cal-head mb-3 flex items-center gap-3"
	>
		<button
			type="button"
			class="grid h-8 w-8 place-items-center rounded-md text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
			onclick={prevMonth}
			aria-label="Luna anterioară"
		>
			<ChevronLeftIcon class="h-4 w-4" />
		</button>
		<h3 class="min-w-[160px] text-center text-base font-bold text-[#0f172a] dark:text-zinc-100">
			{monthLabel}
		</h3>
		<button
			type="button"
			class="grid h-8 w-8 place-items-center rounded-md text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
			onclick={nextMonth}
			aria-label="Luna următoare"
		>
			<ChevronRightIcon class="h-4 w-4" />
		</button>
		<button
			type="button"
			class="ml-2 rounded-md border border-[#d5dbe5] bg-white px-3 py-1 text-[12.5px] font-medium text-[#475569] transition-colors hover:border-[#1877F2] hover:text-[#0f172a]"
			onclick={gotoToday}
		>
			Astăzi
		</button>
	</div>

	<!-- Grid: 7 cols × dynamic rows -->
	<div
		class="tk-cal-grid grid overflow-hidden rounded-xl border border-[#e5e9f0] bg-white dark:border-zinc-700 dark:bg-zinc-900"
		style:grid-template-columns="repeat(7, minmax(0, 1fr))"
	>
		<!-- Day-name headers -->
		{#each WEEK_HEADERS as name (name)}
			<div
				class="tk-cal-dayname border-b border-[#e5e9f0] bg-[#f7f8fa] p-2.5 text-center text-[11px] font-bold uppercase tracking-[.04em] text-[#475569] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
			>
				{name}
			</div>
		{/each}

		<!-- Cells -->
		{#each cells as cell (cell.iso)}
			{@const visibleTasks = cell.tasks.slice(0, 3)}
			{@const moreCount = cell.tasks.length - visibleTasks.length}
			<div
				class={[
					'tk-cal-cell group flex min-h-[110px] flex-col gap-1 border-b border-r border-[#f1f5f9] p-1.5 last:border-r-0 dark:border-zinc-800',
					!cell.inMonth ? 'bg-[#fafbfd] opacity-55 dark:bg-zinc-900/40' : '',
					cell.isToday ? 'bg-[#f0f7ff] dark:bg-[#1877F2]/10' : ''
				].filter(Boolean).join(' ')}
			>
				<!-- Day number + hover actions -->
				<div class="tk-cal-num-row flex items-center justify-between">
					<div
						class={[
							'tk-cal-num grid h-[22px] w-[22px] place-items-center rounded-md text-[11px] font-bold',
							cell.isToday ? 'bg-[#1877F2] text-white' : 'text-[#475569] dark:text-zinc-400'
						].join(' ')}
					>
						{cell.inMonth ? cell.dayNum : ''}
					</div>
					{#if cell.inMonth && onAddDay}
						<div
							class="tk-cal-actions flex gap-[3px] opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
						>
							<button
								type="button"
								class="tk-cal-add grid h-[20px] w-[20px] place-items-center rounded border border-[#e5e9f0] bg-white text-[#94a3b8] transition-colors hover:border-[#1877F2] hover:bg-[#1877F2] hover:text-white"
								title="Task nou"
								aria-label={`Adaugă task la ${cell.iso}`}
								onclick={() => onAddDay?.(cell.iso, 'task')}
							>
								<PlusIcon class="h-2.5 w-2.5" />
							</button>
							<button
								type="button"
								class="tk-cal-meet grid h-[20px] w-[20px] place-items-center rounded border border-[#e5e9f0] bg-white text-[#1877F2] transition-colors hover:border-[#1877F2] hover:bg-[#f7faff]"
								title="Google Meet"
								aria-label={`Adaugă meeting la ${cell.iso}`}
								onclick={() => onAddDay?.(cell.iso, 'meet')}
							>
								<VideoIcon class="h-2.5 w-2.5" />
							</button>
						</div>
					{/if}
				</div>

				<!-- Up to 3 task chips, sorted by priority -->
				{#each visibleTasks as t (t.id)}
					<button
						type="button"
						class="tk-cal-event truncate rounded border-l-[3px] bg-[#f0f7ff] px-1.5 py-0.5 text-left text-[10.5px] font-semibold text-[#0f172a] transition-colors hover:bg-[#dbeafe] dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
						style:border-left-color={priorityColor(t.priority)}
						onclick={(e) => {
							e.stopPropagation();
							onTaskClick(t);
						}}
						title={t.title}
					>
						{t.title}
					</button>
				{/each}

				{#if moreCount > 0}
					<div class="tk-cal-more px-1 text-[10px] font-semibold text-[#94a3b8]">
						+{moreCount}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
