<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import TaskCard, { type AssigneeInfo, type TagInfo, type SubtaskProgress } from './task-card.svelte';
	import { avatarColor, avatarInitials } from '$lib/config/team';
	import { isTaskOverdue } from '$lib/utils/task-filters';

	type TaskWithIncludes = Task & {
		subtaskCount?: number;
		subtaskDoneCount?: number;
		tags?: TagInfo[];
		assignees?: AssigneeInfo[];
	};

	type UserOpt = {
		id: string;
		firstName: string;
		lastName: string;
		email: string;
	};

	type Props = {
		tasks: TaskWithIncludes[];
		users: UserOpt[];
		projectMap: Map<string, string>;
		clientMap: Map<string, string>;
		tenantSlug: string;
		onTaskClick: (task: Task) => void;
		onEditTask: (task: Task) => void;
		onDeleteTask: (taskId: string) => void;
		/** Active-task capacity per user; design uses 8. */
		capacity?: number;
		/** Max tasks rendered per user column (the rest stay countable in meta). */
		maxPerColumn?: number;
	};

	let {
		tasks,
		users,
		projectMap,
		clientMap,
		tenantSlug,
		onTaskClick,
		onEditTask,
		onDeleteTask,
		capacity = 8,
		maxPerColumn = 5
	}: Props = $props();

	function assigneeIdsOf(t: TaskWithIncludes): string[] {
		if (Array.isArray(t.assignees) && t.assignees.length > 0) {
			return t.assignees.map((a) => a.id);
		}
		if (t.assignedToUserId) return [t.assignedToUserId];
		return [];
	}

	function isActive(t: TaskWithIncludes): boolean {
		return t.status !== 'done' && t.status !== 'cancelled';
	}

	const workloadRows = $derived.by(() => {
		return users.map((u) => {
			const userTasks = tasks.filter((t) => assigneeIdsOf(t).includes(u.id) && isActive(t));
			const overdue = userTasks.filter((t) => isTaskOverdue(t.dueDate)).length;
			const pct = Math.min(100, Math.round((userTasks.length / capacity) * 100));
			return {
				user: u,
				count: userTasks.length,
				overdue,
				pct
			};
		});
	});

	const teamColumns = $derived.by(() => {
		return users.map((u) => {
			const userTasks = tasks.filter((t) => assigneeIdsOf(t).includes(u.id) && isActive(t));
			return {
				user: u,
				tasks: userTasks
			};
		});
	});

	function barColor(pct: number): string {
		if (pct > 80) return '#ef4444';
		if (pct > 60) return '#f59e0b';
		return '#10b981';
	}

	function displayName(u: UserOpt): string {
		const full = `${u.firstName} ${u.lastName}`.trim();
		return full || u.email;
	}

	function buildAssigneeInfos(t: TaskWithIncludes): AssigneeInfo[] {
		if (Array.isArray(t.assignees) && t.assignees.length > 0) return t.assignees;
		if (t.assignedToUserId) {
			const u = users.find((x) => x.id === t.assignedToUserId);
			return [
				{
					id: t.assignedToUserId,
					firstName: u?.firstName ?? null,
					lastName: u?.lastName ?? null,
					email: u?.email ?? null,
					displayName: u ? displayName(u) : t.assignedToUserId
				}
			];
		}
		return [];
	}

	function buildSubtaskProgress(t: TaskWithIncludes): SubtaskProgress | null {
		const total = t.subtaskCount ?? 0;
		if (total <= 0) return null;
		return { done: t.subtaskDoneCount ?? 0, total };
	}
</script>

<div class="tk-team-view flex flex-col gap-3.5">
	<!-- Workload echipă card -->
	<div
		class="tk-workload-card rounded-xl border border-[#e5e9f0] bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
	>
		<div class="tk-workload-head mb-3.5 flex items-center justify-between">
			<div class="tk-workload-title text-sm font-bold text-[#0f172a] dark:text-zinc-100">
				Workload echipă
			</div>
			<span class="text-[12px] text-[#94a3b8]">capacitate {capacity} taskuri/persoană</span>
		</div>

		{#if workloadRows.length === 0}
			<div class="py-4 text-center text-[12px] text-[#94a3b8]">
				Niciun utilizator în tenant.
			</div>
		{:else}
			{#each workloadRows as row (row.user.id)}
				<div class="tk-workload-row flex items-center gap-3 py-2">
					<div
						class="tk-workload-avatar grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
						style:background-color={avatarColor(row.user.email ?? row.user.id)}
					>
						{avatarInitials(row.user.firstName, row.user.lastName, row.user.email)}
					</div>
					<div class="tk-workload-info min-w-0 flex-1">
						<div
							class="tk-workload-name text-[12.5px] font-semibold text-[#0f172a] dark:text-zinc-100"
						>
							{displayName(row.user)}
						</div>
						<div class="tk-workload-meta mt-px text-[11px] text-[#94a3b8]">
							{row.count}
							{row.count === 1 ? 'task activ' : 'taskuri active'}
							{#if row.overdue > 0}
								·
								<span class="font-bold text-[#ef4444]">{row.overdue} overdue</span>
							{/if}
						</div>
						<div
							class="tk-workload-bar mt-1 flex h-1.5 overflow-hidden rounded-[3px] bg-[#f1f5f9] dark:bg-zinc-800"
						>
							<div
								class="h-full transition-all"
								style:width={`${row.pct}%`}
								style:background-color={barColor(row.pct)}
							></div>
						</div>
					</div>
					<div
						class="tk-workload-pct min-w-[36px] shrink-0 text-right text-[12px] font-bold text-[#0f172a] dark:text-zinc-100"
					>
						{row.pct}%
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<!-- Distribuție pe responsabil card -->
	<div
		class="tk-team-tasks rounded-xl border border-[#e5e9f0] bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
	>
		<div class="tk-workload-head mb-3.5 flex items-center justify-between">
			<div class="tk-workload-title text-sm font-bold text-[#0f172a] dark:text-zinc-100">
				Distribuție pe responsabil
			</div>
			{#if maxPerColumn > 0}
				<span class="text-[12px] text-[#94a3b8]">
					primele {maxPerColumn} task-uri / coloană
				</span>
			{/if}
		</div>

		<div
			class="tk-team-cols grid gap-3"
			style:grid-template-columns="repeat(auto-fit, minmax(240px, 1fr))"
		>
			{#each teamColumns as col (col.user.id)}
				{@const visibleTasks = maxPerColumn > 0 ? col.tasks.slice(0, maxPerColumn) : col.tasks}
				{@const moreCount = col.tasks.length - visibleTasks.length}
				<div class="tk-team-col rounded-[10px] bg-[#eef1f6] p-2.5 dark:bg-zinc-800/60">
					<div class="tk-team-col-head flex items-center gap-2.5 px-1 pt-1 pb-2.5">
						<div
							class="tk-workload-avatar grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
							style:background-color={avatarColor(col.user.email ?? col.user.id)}
						>
							{avatarInitials(col.user.firstName, col.user.lastName, col.user.email)}
						</div>
						<div class="min-w-0">
							<div
								class="tk-workload-name truncate text-[12.5px] font-semibold text-[#0f172a] dark:text-zinc-100"
							>
								{displayName(col.user)}
							</div>
							<div class="tk-workload-meta text-[11px] text-[#94a3b8]">
								{col.tasks.length}
								{col.tasks.length === 1 ? 'task' : 'taskuri'}
							</div>
						</div>
					</div>

					<div class="tk-team-col-body flex flex-col gap-2">
						{#if col.tasks.length === 0}
							<div
								class="rounded-lg border border-dashed border-[#e5e9f0] bg-white py-5 text-center text-[11.5px] text-[#94a3b8] dark:border-zinc-700 dark:bg-zinc-900"
							>
								Niciun task activ
							</div>
						{:else}
							{#each visibleTasks as t (t.id)}
								<TaskCard
									task={t}
									projectName={t.projectId ? projectMap.get(t.projectId) || null : null}
									projectId={t.projectId}
									clientName={t.clientId ? clientMap.get(t.clientId) || null : null}
									assignees={buildAssigneeInfos(t)}
									tags={t.tags ?? []}
									subtaskProgress={buildSubtaskProgress(t)}
									{tenantSlug}
									onClick={() => onTaskClick(t)}
									onEdit={() => onEditTask(t)}
									onDelete={() => onDeleteTask(t.id)}
								/>
							{/each}
							{#if moreCount > 0}
								<div class="px-2 py-1 text-center text-[11px] font-semibold text-[#94a3b8]">
									+{moreCount} task-uri
								</div>
							{/if}
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
