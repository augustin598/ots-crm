<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import { avatarColor, avatarInitials } from '$lib/config/team';
	import { formatPriority } from '$lib/components/task-kanban-utils';

	export type SubtaskProgress = { done: number; total: number };
	export type AssigneeInfo = {
		userId: string;
		firstName?: string | null;
		lastName?: string | null;
		email?: string | null;
		displayName?: string | null;
	};
	export type TagInfo = { id?: string; name: string; color?: string | null };
	export type DragState = 'idle' | 'dragging' | 'over' | 'pickedUp';

	type Props = {
		task: Task;
		projectName?: string | null;
		projectId?: string | null;
		clientName?: string | null;
		clientColor?: string | null;
		assignees?: AssigneeInfo[];
		tags?: TagInfo[];
		subtaskProgress?: SubtaskProgress | null;
		commentsCount?: number;
		attachmentsCount?: number;
		tenantSlug?: string;
		selected?: boolean;
		onSelectChange?: (selected: boolean) => void;
		onClick?: () => void;
		onEdit?: () => void;
		onDelete?: () => void;
		dragState?: DragState;
		showSelectionCheckbox?: boolean;
		/** Keyboard handler for DnD/picked-up support, e.g. from kanban board. */
		onKeyDown?: (e: KeyboardEvent) => void;
		/** Drag start handler from kanban board. */
		onDragStart?: (e: DragEvent) => void;
		onDragEnd?: (e: DragEvent) => void;
		/** Used by parent for ARIA + keyboard tracking. */
		ariaLabel?: string;
		dataTaskId?: string;
	};

	let {
		task,
		projectName = null,
		projectId = null,
		clientName = null,
		clientColor = null,
		assignees = [],
		tags = [],
		subtaskProgress = null,
		commentsCount = 0,
		attachmentsCount = 0,
		tenantSlug = '',
		selected = false,
		onSelectChange,
		onClick,
		onEdit,
		onDelete,
		dragState = 'idle',
		showSelectionCheckbox = false,
		onKeyDown,
		onDragStart,
		onDragEnd,
		ariaLabel,
		dataTaskId
	}: Props = $props();

	const priority = $derived(task.priority || 'medium');
	const isDone = $derived(task.status === 'done');
	const isCancelled = $derived(task.status === 'cancelled');

	// Overdue: due date past, and task not done/cancelled
	const dueInfo = $derived.by(() => {
		if (!task.dueDate) return null;
		const d = task.dueDate instanceof Date ? task.dueDate : new Date(task.dueDate);
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		const dueMidnight = new Date(d);
		dueMidnight.setHours(0, 0, 0, 0);
		const diffDays = Math.round((dueMidnight.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
		const inactive = isDone || isCancelled;
		if (inactive) {
			// Show date but not overdue styling
			return {
				cls: '',
				label: formatRoDate(d),
				overdue: false
			};
		}
		if (diffDays < 0) {
			return {
				cls: 'overdue',
				label: `${Math.abs(diffDays)}z întârziere`,
				overdue: true
			};
		}
		if (diffDays === 0) {
			return { cls: 'today', label: 'Astăzi', overdue: false };
		}
		if (diffDays <= 2) {
			return { cls: 'soon', label: `În ${diffDays}z`, overdue: false };
		}
		return { cls: '', label: formatRoDate(d), overdue: false };
	});

	function formatRoDate(d: Date): string {
		return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
	}

	function priorityClasses(p: string): string {
		switch (p) {
			case 'urgent':
				return 'bg-[#fee2e2] text-[#b91c1c]';
			case 'high':
				return 'bg-[#fef3c7] text-[#b45309]';
			case 'medium':
				return 'bg-[#d1fae5] text-[#047857]';
			case 'low':
				return 'bg-[#e2e8f0] text-[#475569]';
			default:
				return 'bg-[#e2e8f0] text-[#475569]';
		}
	}

	function priorityDotColor(p: string): string {
		switch (p) {
			case 'urgent':
				return '#b91c1c';
			case 'high':
				return '#b45309';
			case 'medium':
				return '#047857';
			case 'low':
				return '#475569';
			default:
				return '#475569';
		}
	}

	function dueClasses(cls: string): string {
		switch (cls) {
			case 'overdue':
				return 'text-[#ef4444]';
			case 'soon':
				return 'text-[#f59e0b]';
			case 'today':
				return 'text-[#1877F2]';
			default:
				return 'text-[#475569]';
		}
	}

	function assigneeDisplayName(a: AssigneeInfo): string {
		if (a.displayName) return a.displayName;
		const full = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
		return full || a.email || a.userId;
	}

	const visibleAssignees = $derived(assignees.slice(0, 3));
	const moreAssignees = $derived(Math.max(0, assignees.length - 3));

	function handleRootClick(e: MouseEvent) {
		// Don't trigger card click when interacting with checkbox / dropdown
		if (e.defaultPrevented) return;
		onClick?.();
	}

	function handleRootKeyDown(e: KeyboardEvent) {
		// Defer to parent for drag/picked-up behavior
		if (onKeyDown) onKeyDown(e);
		// Activate click on Enter/Space when no parent picked-up state owns these
		if (!onKeyDown && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			onClick?.();
		}
	}
</script>

<div
	class={[
		'tk-card group relative flex flex-col gap-2 rounded-[9px] border bg-white p-[11px_12px] cursor-grab transition-all',
		'border-[#e5e9f0] hover:border-[#1877F2] hover:shadow-[0_6px_16px_rgba(15,23,42,0.06)] hover:-translate-y-px',
		dueInfo?.overdue ? 'border-l-[3px] border-l-[#ef4444]' : '',
		dragState === 'dragging' ? 'opacity-40 cursor-grabbing' : '',
		dragState === 'over' ? 'ring-2 ring-[#1877F2]' : '',
		dragState === 'pickedUp' ? 'ring-2 ring-[#1877F2] bg-[#f0f7ff]' : '',
		selected ? 'ring-2 ring-[#1877F2]' : '',
		isDone || isCancelled
			? 'opacity-60 hover:opacity-95 [&_.tk-card-title]:line-through [&_.tk-card-title]:decoration-[#94a3b8]'
			: ''
	].filter(Boolean).join(' ')}
	role="button"
	tabindex={0}
	aria-label={ariaLabel ?? task.title}
	aria-roledescription="Draggable task card"
	data-task-id={dataTaskId ?? task.id}
	draggable={!!onDragStart}
	ondragstart={(e) => onDragStart?.(e)}
	ondragend={(e) => onDragEnd?.(e)}
	onclick={handleRootClick}
	onkeydown={handleRootKeyDown}
>
	<!-- Top row: priority + recurring + (selection) + menu -->
	<div class="tk-card-top flex items-center gap-1.5">
		{#if showSelectionCheckbox}
			<div
				class="shrink-0"
				onclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
				}}
				role="presentation"
			>
				<Checkbox
					checked={selected}
					onCheckedChange={(v) => onSelectChange?.(v === true)}
					aria-label={`Select ${task.title}`}
				/>
			</div>
		{/if}
		<span
			class={`tk-prio inline-flex items-center gap-1 rounded-[4px] px-[7px] py-[2px] text-[10px] font-bold uppercase tracking-[.05em] ${priorityClasses(priority)}`}
		>
			<span
				class="tk-prio-dot inline-block h-[5px] w-[5px] rounded-full"
				style:background-color={priorityDotColor(priority)}
			></span>
			{formatPriority(priority)}
		</span>
		{#if task.isRecurring || task.recurringParentId}
			<span
				class="tk-recurring grid h-4 w-4 place-items-center rounded-[4px] bg-[#ede9fe] text-[9px] text-[#7c3aed]"
				aria-label="Task recurent"
				title="Task recurent"
			>
				<RepeatIcon class="h-2.5 w-2.5" />
			</span>
		{/if}
		<DropdownMenu>
			<DropdownMenuTrigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						class="tk-card-menu ml-auto grid h-[22px] w-[22px] place-items-center rounded-[4px] text-[#94a3b8] opacity-0 transition-opacity hover:bg-[#f1f5f9] hover:text-[#0f172a] group-hover:opacity-100 focus-visible:opacity-100"
						aria-label="Task actions"
						onclick={(e) => e.stopPropagation()}
					>
						<MoreVerticalIcon class="h-3.5 w-3.5" />
					</button>
				{/snippet}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					onclick={(e) => {
						e.stopPropagation();
						onEdit?.();
					}}
				>
					Edit
				</DropdownMenuItem>
				<DropdownMenuItem
					class="text-destructive"
					onclick={(e) => {
						e.stopPropagation();
						onDelete?.();
					}}
				>
					Delete
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	</div>

	<!-- Title -->
	<div
		class="tk-card-title text-[13.5px] font-semibold leading-[1.35] tracking-[-.005em] text-[#0f172a]"
	>
		{task.title}
	</div>

	<!-- Client chip + project chip -->
	{#if clientName || projectName}
		<div class="flex flex-wrap items-center gap-1.5">
			{#if clientName}
				<span
					class="tk-card-client inline-flex items-center gap-1.5 self-start rounded-[5px] bg-[#f7f8fa] px-2 py-[3px] text-[11px] text-[#475569]"
				>
					<span
						class="dot inline-block h-1.5 w-1.5 rounded-full"
						style:background-color={clientColor ?? '#94a3b8'}
					></span>
					{clientName}
				</span>
			{/if}
			{#if projectName}
				{#if projectId && tenantSlug}
					<a
						href={`/${tenantSlug}/projects/${projectId}`}
						onclick={(e) => e.stopPropagation()}
						class="inline-flex items-center gap-1 self-start rounded-[5px] bg-[#dbeafe] px-2 py-[3px] text-[11px] font-medium text-[#1d4ed8] hover:bg-[#bfdbfe]"
					>
						{projectName}
					</a>
				{:else}
					<span
						class="inline-flex items-center gap-1 self-start rounded-[5px] bg-[#dbeafe] px-2 py-[3px] text-[11px] font-medium text-[#1d4ed8]"
					>
						{projectName}
					</span>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- Tags -->
	{#if tags && tags.length > 0}
		<div class="tk-card-tags flex flex-wrap gap-1">
			{#each tags as t (t.id ?? t.name)}
				<span class="tk-tag text-[10.5px] font-semibold text-[#1877F2]">#{t.name}</span>
			{/each}
		</div>
	{/if}

	<!-- Subtask progress -->
	{#if subtaskProgress && subtaskProgress.total > 0}
		{@const pct = Math.round((subtaskProgress.done / subtaskProgress.total) * 100)}
		<div class="tk-card-progress flex flex-col gap-1">
			<div class="tk-progress-bar h-1 overflow-hidden rounded-sm bg-[#f1f5f9]">
				<div
					class="tk-progress-fill h-full rounded-sm bg-gradient-to-r from-[#1877F2] to-[#60a5fa]"
					style:width={`${pct}%`}
				></div>
			</div>
			<div
				class="tk-progress-meta flex items-center gap-2 text-[10.5px] font-semibold text-[#94a3b8]"
			>
				<span class="check inline-flex text-[#10b981]">
					<CheckIcon class="h-2.5 w-2.5" />
				</span>
				{subtaskProgress.done}/{subtaskProgress.total} subtaskuri
			</div>
		</div>
	{/if}

	<!-- Footer: due + comment/attachment stats + assignees -->
	{#if dueInfo || commentsCount > 0 || attachmentsCount > 0 || assignees.length > 0}
		<div
			class="tk-card-foot flex items-center gap-2 border-t border-[#f1f5f9] pt-2"
		>
			{#if dueInfo}
				<span
					class={`tk-due inline-flex items-center gap-1 text-[11px] font-semibold ${dueClasses(dueInfo.cls)}`}
				>
					<CalendarIcon class="h-2.5 w-2.5" />
					{dueInfo.label}
				</span>
			{/if}

			{#if commentsCount > 0 || attachmentsCount > 0}
				<div
					class="tk-foot-stats flex items-center gap-2 text-[10.5px] font-semibold text-[#94a3b8]"
				>
					{#if commentsCount > 0}
						<span class="tk-foot-stat inline-flex items-center gap-[3px]">
							<MessageCircleIcon class="h-2.5 w-2.5" />
							{commentsCount}
						</span>
					{/if}
					{#if attachmentsCount > 0}
						<span class="tk-foot-stat inline-flex items-center gap-[3px]">
							<PaperclipIcon class="h-2.5 w-2.5" />
							{attachmentsCount}
						</span>
					{/if}
				</div>
			{/if}

			{#if assignees.length > 0}
				<div class="tk-avatars ml-auto flex">
					{#each visibleAssignees as a, i (a.userId)}
						<div
							class="tk-avatar grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2 border-white text-[9.5px] font-bold text-white"
							style:background-color={avatarColor(a.email ?? a.userId)}
							style:margin-left={i === 0 ? '0' : '-6px'}
							title={assigneeDisplayName(a)}
						>
							{avatarInitials(a.firstName ?? null, a.lastName ?? null, a.email ?? null)}
						</div>
					{/each}
					{#if moreAssignees > 0}
						<div
							class="tk-avatar tk-avatar-more grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2 border-white bg-[#e5e9f0] text-[9.5px] font-bold text-[#475569]"
							style:margin-left="-6px"
							title={`${moreAssignees} more`}
						>
							+{moreAssignees}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
