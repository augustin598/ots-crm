<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import type { Task } from '$lib/server/db/schema';
	import {
		formatStatus,
		formatPriority,
		TASK_STATUSES,
		TASK_PRIORITIES
	} from './task-kanban-utils';
	import { updateTaskStatus, updateTaskPriority, getTasks } from '$lib/remotes/tasks.remote';
	import { getTaskFilters } from '$lib/components/task-filters-context';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import { avatarColor, avatarInitials } from '$lib/config/team';

	type AssigneeInfo = {
		id: string;
		firstName?: string | null;
		lastName?: string | null;
		email?: string | null;
		displayName?: string | null;
	};
	type TagInfo = { id?: string; name: string; color?: string | null };

	type TaskWithIncludes = Task & {
		subtaskCount?: number;
		subtaskDoneCount?: number;
		tags?: TagInfo[];
		assignees?: AssigneeInfo[];
	};

	type UserMapValue = string;

	type Props = {
		tasks: TaskWithIncludes[];
		projectMap: Map<string, string>;
		userMap: Map<string, UserMapValue>;
		clientMap: Map<string, string>;
		clientColorMap?: Map<string, string>;
		tenantSlug: string;
		sortBy?: string | null;
		sortDir?: 'asc' | 'desc' | null;
		onSortChange: (sortBy: string, sortDir: 'asc' | 'desc') => void;
		onTaskClick: (task: Task) => void;
		onEditTask: (task: Task) => void;
		onDeleteTask: (taskId: string) => void;
		selectedIds?: Set<string>;
		onTaskSelectChange?: (taskId: string, selected: boolean) => void;
		onToggleSelectAll?: (selectAll: boolean) => void;
		showSelectionCheckbox?: boolean;
	};

	let {
		tasks,
		projectMap,
		userMap,
		clientMap,
		clientColorMap,
		tenantSlug,
		sortBy = null,
		sortDir = 'asc',
		onSortChange,
		onTaskClick,
		onEditTask,
		onDeleteTask,
		selectedIds,
		onTaskSelectChange,
		onToggleSelectAll,
		showSelectionCheckbox = false
	}: Props = $props();

	const filterParams = getTaskFilters();

	// Optimistic state for inline edits.
	let optimisticStatus = $state<Record<string, string>>({});
	let optimisticPriority = $state<Record<string, string>>({});
	let pendingTaskIds = $state<Record<string, boolean>>({});

	function effectiveStatus(t: TaskWithIncludes): string {
		return optimisticStatus[t.id] ?? t.status ?? 'todo';
	}
	function effectivePriority(t: TaskWithIncludes): string {
		return optimisticPriority[t.id] ?? t.priority ?? 'medium';
	}

	async function handleStatusChange(task: TaskWithIncludes, newStatus: string) {
		const oldStatus = task.status ?? 'todo';
		if (newStatus === oldStatus) return;
		optimisticStatus = { ...optimisticStatus, [task.id]: newStatus };
		pendingTaskIds = { ...pendingTaskIds, [task.id]: true };
		try {
			await updateTaskStatus({ taskId: task.id, newStatus: newStatus as any }).updates(
				getTasks({ ...(filterParams as any) })
			);
			toast.success('Status actualizat');
			const { [task.id]: _, ...restStatus } = optimisticStatus;
			optimisticStatus = restStatus;
		} catch (e) {
			const { [task.id]: _, ...restStatus } = optimisticStatus;
			optimisticStatus = restStatus;
			clientLogger.apiError('task_status_update', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la actualizarea status-ului');
		} finally {
			const { [task.id]: __, ...restPending } = pendingTaskIds;
			pendingTaskIds = restPending;
		}
	}

	async function handlePriorityChange(task: TaskWithIncludes, newPriority: string) {
		const oldPriority = task.priority ?? 'medium';
		if (newPriority === oldPriority) return;
		optimisticPriority = { ...optimisticPriority, [task.id]: newPriority };
		pendingTaskIds = { ...pendingTaskIds, [task.id]: true };
		try {
			await updateTaskPriority({
				taskId: task.id,
				newPriority: newPriority as any
			}).updates(getTasks({ ...(filterParams as any) }));
			toast.success('Prioritate actualizată');
			const { [task.id]: _, ...restPriority } = optimisticPriority;
			optimisticPriority = restPriority;
		} catch (e) {
			const { [task.id]: _, ...restPriority } = optimisticPriority;
			optimisticPriority = restPriority;
			clientLogger.apiError('task_priority_update', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la actualizarea priorității');
		} finally {
			const { [task.id]: __, ...restPending } = pendingTaskIds;
			pendingTaskIds = restPending;
		}
	}

	const allRowsSelected = $derived(
		tasks.length > 0 && tasks.every((t) => selectedIds?.has(t.id))
	);

	function handleSort(column: string) {
		const newSortDir = sortBy === column && sortDir === 'asc' ? 'desc' : 'asc';
		onSortChange(column, newSortDir);
	}

	function getSortIcon(column: string) {
		if (sortBy !== column) return '';
		return sortDir === 'asc' ? '↑' : '↓';
	}

	// ── Color tokens 1:1 from design ─────────────────────────────────────────
	type ColorPair = { color: string; bg: string };

	function priorityColors(p: string): ColorPair {
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

	function statusColors(s: string): ColorPair {
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
				return { color: '#b91c1c', bg: '#fee2e2' };
			case 'blocked':
				return { color: '#b91c1c', bg: '#fee2e2' };
			default:
				return { color: '#475569', bg: '#f1f5f9' };
		}
	}

	// ── Due badge (relative, color-coded) ────────────────────────────────────
	type DueInfo = { cls: 'overdue' | 'today' | 'soon' | 'normal' | 'done'; label: string };

	function formatDue(t: TaskWithIncludes): DueInfo | null {
		if (!t.dueDate) return null;
		const d = t.dueDate instanceof Date ? t.dueDate : new Date(t.dueDate);
		if (Number.isNaN(d.getTime())) return null;
		const inactive = t.status === 'done' || t.status === 'cancelled';
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		const dueMid = new Date(d);
		dueMid.setHours(0, 0, 0, 0);
		const diff = Math.round((dueMid.getTime() - now.getTime()) / 86_400_000);
		const niceDate = d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });

		if (inactive) return { cls: 'done', label: `Due ${niceDate}` };
		if (diff < 0) return { cls: 'overdue', label: `${Math.abs(diff)}z întârziere` };
		if (diff === 0) return { cls: 'today', label: 'Astăzi' };
		if (diff <= 2) return { cls: 'soon', label: `În ${diff}z` };
		return { cls: 'normal', label: `Due ${niceDate}` };
	}

	function dueClass(cls: DueInfo['cls']): string {
		switch (cls) {
			case 'overdue':
				return 'text-[#ef4444]';
			case 'today':
				return 'text-[#1877F2]';
			case 'soon':
				return 'text-[#f59e0b]';
			case 'done':
				return 'text-[#94a3b8]';
			default:
				return 'text-[#475569]';
		}
	}

	// ── Assignees ────────────────────────────────────────────────────────────
	function buildAssigneeInfos(t: TaskWithIncludes): AssigneeInfo[] {
		if (Array.isArray(t.assignees) && t.assignees.length > 0) return t.assignees;
		if (t.assignedToUserId) {
			const name = userMap.get(t.assignedToUserId) || '';
			const [firstName, ...rest] = name.split(' ');
			return [
				{
					id: t.assignedToUserId,
					firstName: firstName ?? null,
					lastName: rest.join(' ') || null,
					email: null,
					displayName: name
				}
			];
		}
		return [];
	}

	function displayName(a: AssigneeInfo): string {
		if (a.displayName) return a.displayName;
		const full = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
		return full || a.email || a.id;
	}

	// ── Client chip ──────────────────────────────────────────────────────────
	function clientColor(clientId: string | null | undefined): string {
		if (!clientId) return '#94a3b8';
		if (clientColorMap?.has(clientId)) return clientColorMap.get(clientId) ?? '#94a3b8';
		// Deterministic fallback if no color map supplied
		return avatarColor(clientId);
	}

	// Chevron-down svg as a data URL, used as bg-image in the inline selects so
	// the native triangle is replaced with a design-matched chevron.
	const CHEVRON_BG =
		"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")";
</script>

<!-- 1:1 with design: white card with 12px radius, 1px border #e5e9f0 -->
<div
	class="tk-table-wrap overflow-x-auto rounded-xl border border-[#e5e9f0] bg-white dark:border-zinc-700 dark:bg-zinc-900"
>
	<table class="tk-table w-full border-collapse">
		<thead>
			<tr
				class="border-b border-[#e5e9f0] bg-[#f7f8fa] dark:border-zinc-700 dark:bg-zinc-800"
			>
				{#if showSelectionCheckbox}
					<th class="w-[40px] px-3.5 py-2.5 text-left">
						<Checkbox
							checked={allRowsSelected}
							onCheckedChange={(v) => onToggleSelectAll?.(v === true)}
							aria-label="Selectează toate"
						/>
					</th>
				{/if}
				<th class="px-3.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-[.04em] text-[#475569] dark:text-zinc-400">
					<button
						type="button"
						class="inline-flex items-center gap-1 hover:text-[#0f172a]"
						onclick={() => handleSort('title')}
					>
						Task
						<span class="text-[10px]">{getSortIcon('title')}</span>
					</button>
				</th>
				<th class="px-3.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-[.04em] text-[#475569] dark:text-zinc-400">
					Client
				</th>
				<th class="px-3.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-[.04em] text-[#475569] dark:text-zinc-400">
					<button
						type="button"
						class="inline-flex items-center gap-1 hover:text-[#0f172a]"
						onclick={() => handleSort('priority')}
					>
						Prioritate
						<span class="text-[10px]">{getSortIcon('priority')}</span>
					</button>
				</th>
				<th class="px-3.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-[.04em] text-[#475569] dark:text-zinc-400">
					Responsabili
				</th>
				<th class="px-3.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-[.04em] text-[#475569] dark:text-zinc-400">
					<button
						type="button"
						class="inline-flex items-center gap-1 hover:text-[#0f172a]"
						onclick={() => handleSort('dueDate')}
					>
						Due
						<span class="text-[10px]">{getSortIcon('dueDate')}</span>
					</button>
				</th>
				<th class="px-3.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-[.04em] text-[#475569] dark:text-zinc-400">
					Progres
				</th>
				<th class="px-3.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-[.04em] text-[#475569] dark:text-zinc-400">
					<button
						type="button"
						class="inline-flex items-center gap-1 hover:text-[#0f172a]"
						onclick={() => handleSort('status')}
					>
						Status
						<span class="text-[10px]">{getSortIcon('status')}</span>
					</button>
				</th>
				<th class="w-[40px]"></th>
			</tr>
		</thead>
		<tbody>
			{#if tasks.length === 0}
				<tr>
					<td
						colspan={showSelectionCheckbox ? 9 : 8}
						class="px-3.5 py-8 text-center text-sm text-[#94a3b8]"
					>
						Niciun task găsit
					</td>
				</tr>
			{:else}
				{#each tasks as task (task.id)}
					{@const currentStatus = effectiveStatus(task)}
					{@const currentPriority = effectivePriority(task)}
					{@const subDone = task.subtaskDoneCount ?? 0}
					{@const subTotal = task.subtaskCount ?? 0}
					{@const isPending = pendingTaskIds[task.id] === true}
					{@const due = formatDue(task)}
					{@const assignees = buildAssigneeInfos(task)}
					{@const visibleAssignees = assignees.slice(0, 3)}
					{@const moreAssignees = Math.max(0, assignees.length - 3)}
					{@const cName = task.clientId ? clientMap.get(task.clientId) : null}
					{@const pCol = priorityColors(currentPriority)}
					{@const sCol = statusColors(currentStatus)}
					<tr
						class="cursor-pointer border-b border-[#f1f5f9] transition-colors hover:bg-[#f7faff] dark:border-zinc-800 dark:hover:bg-zinc-800/40"
						onclick={() => onTaskClick(task)}
					>
						{#if showSelectionCheckbox}
							<td
								class="px-3.5 py-2.5"
								onclick={(e) => e.stopPropagation()}
							>
								<Checkbox
									checked={selectedIds?.has(task.id) ?? false}
									onCheckedChange={(v) => onTaskSelectChange?.(task.id, v === true)}
									aria-label={`Selectează ${task.title}`}
								/>
							</td>
						{/if}

						<!-- Task: title + tag chips below -->
						<td class="px-3.5 py-2.5 align-middle">
							<div class="tk-table-task flex flex-col gap-1">
								<div class="tk-table-title inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0f172a] dark:text-zinc-100">
									{#if task.isRecurring || task.recurringParentId}
										<RepeatIcon
											class="h-3.5 w-3.5 shrink-0 text-[#1877F2]"
											aria-label="Task recurent"
										/>
									{/if}
									<span>{task.title}</span>
								</div>
								{#if task.tags && task.tags.length > 0}
									<div class="tk-table-tags flex flex-wrap gap-1.5">
										{#each task.tags as tag (tag.id ?? tag.name)}
											<span class="text-[10.5px] font-semibold text-[#1877F2]">#{tag.name}</span>
										{/each}
									</div>
								{/if}
							</div>
						</td>

						<!-- Client chip with colored dot -->
						<td class="px-3.5 py-2.5 align-middle">
							{#if cName && task.clientId}
								<span class="inline-flex items-center gap-1.5 self-start rounded-md bg-[#f7f8fa] px-2 py-[3px] text-[11px] text-[#475569] dark:bg-zinc-800 dark:text-zinc-300">
									<span
										class="h-1.5 w-1.5 rounded-full"
										style:background-color={clientColor(task.clientId)}
									></span>
									{cName}
								</span>
							{:else}
								<span class="text-[#cbd5e1]">—</span>
							{/if}
						</td>

						<!-- Prioritate: inline select, design colors -->
						<td class="px-3.5 py-2.5 align-middle" onclick={(e) => e.stopPropagation()}>
							<select
								class="tk-prio-select cursor-pointer appearance-none rounded-md border bg-[var(--prio-bg)] py-[4px] pl-2 pr-[22px] text-[11.5px] font-bold focus:outline-none focus:ring-2 focus:ring-[#1877F2]/10 disabled:opacity-60"
								style:--prio-bg={pCol.bg}
								style:color={pCol.color}
								style:border-color={`${pCol.color}55`}
								style:background-image={CHEVRON_BG}
								style:background-repeat="no-repeat"
								style:background-position="right 6px center"
								value={currentPriority}
								onchange={(e) =>
									handlePriorityChange(task, (e.currentTarget as HTMLSelectElement).value)}
								disabled={isPending}
								aria-label={`Schimbă prioritate ${task.title}`}
							>
								{#each TASK_PRIORITIES as p (p)}
									<option value={p}>{formatPriority(p)}</option>
								{/each}
							</select>
						</td>

						<!-- Responsabili: avatar stack -->
						<td class="px-3.5 py-2.5 align-middle">
							{#if assignees.length === 0}
								<span class="text-[#cbd5e1]">—</span>
							{:else}
								<div class="flex">
									{#each visibleAssignees as a, i (a.id)}
										<div
											class="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2 border-white text-[9.5px] font-bold text-white dark:border-zinc-900"
											style:background-color={avatarColor(a.email ?? a.id)}
											style:margin-left={i === 0 ? '0' : '-6px'}
											title={displayName(a)}
										>
											{avatarInitials(a.firstName ?? null, a.lastName ?? null, a.email ?? null)}
										</div>
									{/each}
									{#if moreAssignees > 0}
										<div
											class="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2 border-white bg-[#e5e9f0] text-[9.5px] font-bold text-[#475569]"
											style:margin-left="-6px"
											title={`${moreAssignees} mai mulți`}
										>
											+{moreAssignees}
										</div>
									{/if}
								</div>
							{/if}
						</td>

						<!-- Due: relative, color-coded -->
						<td class="px-3.5 py-2.5 align-middle">
							{#if due}
								<span
									class={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${dueClass(due.cls)}`}
								>
									<CalendarIcon class="h-3 w-3" />
									{due.label}
								</span>
							{:else}
								<span class="text-[#cbd5e1]">—</span>
							{/if}
						</td>

						<!-- Progres: subtask bar + N/M -->
						<td class="px-3.5 py-2.5 align-middle">
							{#if subTotal > 0}
								{@const pct = Math.round((subDone / subTotal) * 100)}
								<div class="flex items-center gap-1.5 text-[11px] font-semibold text-[#475569]">
									<div class="flex h-1 min-w-[40px] flex-1 overflow-hidden rounded-sm bg-[#f1f5f9]">
										<div
											class="h-full bg-gradient-to-r from-[#1877F2] to-[#60a5fa]"
											style:width={`${pct}%`}
										></div>
									</div>
									<span>{subDone}/{subTotal}</span>
								</div>
							{:else}
								<span class="text-[12px] text-[#cbd5e1]">—</span>
							{/if}
						</td>

						<!-- Status: inline select, design colors -->
						<td class="px-3.5 py-2.5 align-middle" onclick={(e) => e.stopPropagation()}>
							<select
								class="tk-status-select cursor-pointer appearance-none rounded-md border bg-[var(--st-bg)] py-[4px] pl-2 pr-[22px] text-[11.5px] font-bold focus:outline-none focus:ring-2 focus:ring-[#1877F2]/10 disabled:opacity-60"
								style:--st-bg={sCol.bg}
								style:color={sCol.color}
								style:border-color={`${sCol.color}55`}
								style:background-image={CHEVRON_BG}
								style:background-repeat="no-repeat"
								style:background-position="right 6px center"
								value={currentStatus}
								onchange={(e) =>
									handleStatusChange(task, (e.currentTarget as HTMLSelectElement).value)}
								disabled={isPending}
								aria-label={`Schimbă status ${task.title}`}
							>
								{#each TASK_STATUSES as s (s)}
									{#if s !== 'cancelled'}
										<option value={s}>{formatStatus(s)}</option>
									{/if}
								{/each}
							</select>
						</td>

						<!-- Action menu -->
						<td class="px-2 py-2.5 align-middle text-right" onclick={(e) => e.stopPropagation()}>
							<DropdownMenu>
								<DropdownMenuTrigger>
									{#snippet child({ props })}
										<button
											{...props}
											type="button"
											class="grid h-[26px] w-[26px] place-items-center rounded text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
											aria-label={`Acțiuni pentru ${task.title}`}
										>
											<MoreVerticalIcon class="h-3.5 w-3.5" />
										</button>
									{/snippet}
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onclick={() => onEditTask(task)}>Editează</DropdownMenuItem>
									<DropdownMenuItem
										class="text-destructive"
										onclick={() => onDeleteTask(task.id)}
									>
										Șterge
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</td>
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>
