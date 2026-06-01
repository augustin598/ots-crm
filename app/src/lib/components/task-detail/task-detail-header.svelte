<script lang="ts">
	import { ChevronLeft, Plus, Repeat, X } from '@lucide/svelte';
	import InlineEditableText from '$lib/components/inline-editable-text.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Popover from '$lib/components/ui/popover';
	import {
		formatStatus,
		getStatusBadgeVariant,
		getPriorityColor,
		getPriorityDotColor,
		getStatusDotColor,
		formatPriority
	} from '$lib/components/task-kanban-utils';
	import type { Task } from '$lib/server/db/schema';

	interface Props {
		currentTask: Task & { subtasks?: any[]; tags?: any[]; assignees?: any[] };
		tags: any[];
		isOverdue: boolean;
		onBack: () => void;
		onScheduleMeet: () => void;
		onSaveField: (field: any, value: any) => void | Promise<void>;
		onRemoveTag: (tagId: string) => void;
		onAddTag: (tagName: string) => void;
		isClient?: boolean;
	}

	let {
		currentTask,
		tags,
		isOverdue,
		onBack,
		onScheduleMeet,
		onSaveField,
		onRemoveTag,
		onAddTag,
		isClient = false
	}: Props = $props();

	const TYPE_COLORS: Record<string, string> = {
		design: 'bg-purple-100 text-purple-700',
		video: 'bg-pink-100 text-pink-700',
		ads: 'bg-blue-100 text-blue-700',
		dev: 'bg-cyan-100 text-cyan-700',
		content: 'bg-lime-100 text-lime-700',
		meeting: 'bg-amber-100 text-amber-700',
		other: 'bg-gray-100 text-gray-600'
	};

	function formatRecurrenceLabel(t: {
		isRecurring?: boolean | null;
		recurringType?: string | null;
		recurringInterval?: number | null;
	}): string {
		if (!t.isRecurring || !t.recurringType) return 'Recurent';
		const interval = t.recurringInterval || 1;
		const typeLabels: Record<string, [string, string]> = {
			daily: ['zi', 'zile'],
			weekly: ['săptămână', 'săptămâni'],
			monthly: ['lună', 'luni'],
			yearly: ['an', 'ani']
		};
		const [singular, plural] = typeLabels[t.recurringType] || ['', ''];
		if (interval === 1) return `Recurent · în fiecare ${singular}`;
		return `Recurent · la ${interval} ${plural}`;
	}

	let newTagInput = $state('');
	let tagInputOpen = $state(false);

	function handleAddTag() {
		if (!newTagInput.trim()) return;
		onAddTag(newTagInput.trim());
		newTagInput = '';
		tagInputOpen = false;
	}
</script>

<div class="sticky top-0 z-20 shrink-0 border-b bg-white px-6 pt-4 pb-3">
	<div class="mb-3 flex items-center justify-between">
		<button
			type="button"
			class="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
			onclick={onBack}
		>
			<ChevronLeft class="h-4 w-4" />
			Înapoi
		</button>
		{#if !isClient}
		<button
			type="button"
			class="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
			onclick={onScheduleMeet}
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" class="shrink-0" aria-hidden="true">
				<path d="M16 8.5V12.5L20 16V5L16 8.5Z" fill="#a7f3d0" />
				<path
					d="M3 6V18C3 18.5523 3.44772 19 4 19H14C14.5523 19 15 18.5523 15 18V14L11 14V6H3Z"
					fill="white"
				/>
				<path d="M11 6V14H15V10L11 6Z" fill="#fef08a" />
				<path d="M15 14L11 10V14H15Z" fill="#fca5a5" />
				<path d="M11 6L15 10V6H11Z" fill="#bbf7d0" />
			</svg>
			Programează Google Meet
		</button>
		{/if}
	</div>

	<h1 class="mb-2 text-xl font-bold leading-tight text-gray-900">
		<InlineEditableText
			value={currentTask.title}
			onSave={async (v) => { await onSaveField('title', v); }}
			displayClass="text-xl font-bold leading-tight"
			ariaLabel="Editează titlul task-ului"
		/>
	</h1>

	<div class="flex flex-wrap items-center gap-2">
		{#if isClient}
			<Badge variant={getStatusBadgeVariant(currentTask.status)}>
				{formatStatus(currentTask.status || 'todo')}
			</Badge>
			<Badge class={getPriorityColor(currentTask.priority || 'medium')}>
				{formatPriority(currentTask.priority || 'medium')}
			</Badge>
		{:else}
		<Popover.Root>
			<Popover.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						aria-label="Schimbă statusul"
						class="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Badge variant={getStatusBadgeVariant(currentTask.status)}>
							{formatStatus(currentTask.status || 'todo')}
						</Badge>
					</button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-52 p-1">
				{#each [['pending-approval', 'Pending Approval'], ['todo', 'To Do'], ['in-progress', 'In Progress'], ['review', 'Review'], ['done', 'Done'], ['cancelled', 'Cancelled']] as [val, label] (val)}
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
						onclick={() => onSaveField('status', val)}
					>
						<span class="h-2 w-2 rounded-full {getStatusDotColor(val)}"></span>{label}
					</button>
				{/each}
			</Popover.Content>
		</Popover.Root>

		<Popover.Root>
			<Popover.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						aria-label="Schimbă prioritatea"
						class="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Badge class={getPriorityColor(currentTask.priority || 'medium')}>
							{formatPriority(currentTask.priority || 'medium')}
						</Badge>
					</button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-48 p-1">
				{#each [['urgent', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] as [val, label] (val)}
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
						onclick={() => onSaveField('priority', val)}
					>
						<span class="h-2 w-2 rounded-full {getPriorityDotColor(val)}"></span>{label}
					</button>
				{/each}
			</Popover.Content>
		</Popover.Root>
		{/if}

		{#if isOverdue}
			<span
				class="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600"
				>Overdue</span
			>
		{/if}

		{#if currentTask.type}
			<span
				class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {TYPE_COLORS[currentTask.type] ?? 'bg-gray-100 text-gray-600'}"
				>{currentTask.type}</span
			>
		{/if}

		{#each tags as tag (tag.id)}
			<span
				class="group inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
			>
				{tag.name}
				<button
					type="button"
					aria-label="Șterge tag {tag.name}"
					class="hidden opacity-60 hover:opacity-100 group-hover:inline-flex"
					onclick={() => onRemoveTag(tag.id)}
				>
					<X class="h-3 w-3" />
				</button>
			</span>
		{/each}

		{#if tagInputOpen}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleAddTag();
				}}
				class="flex items-center gap-1"
			>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="text"
					bind:value={newTagInput}
					placeholder="#tag"
					class="h-6 w-24 rounded-full border bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
					autofocus
					onblur={() => {
						if (!newTagInput) tagInputOpen = false;
					}}
				/>
				<button
					type="submit"
					class="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">OK</button
				>
			</form>
		{:else}
			<button
				type="button"
				class="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 transition-colors hover:bg-slate-200"
				onclick={() => (tagInputOpen = true)}
			>
				<Plus class="h-3 w-3" /> Tag
			</button>
		{/if}

		{#if currentTask.recurringParentId}
			<span
				class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800"
			>
				<Repeat class="h-3 w-3" /> Din serie recurentă
			</span>
		{:else if currentTask.isRecurring}
			<span
				class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800"
			>
				<Repeat class="h-3 w-3" /> {formatRecurrenceLabel(currentTask)}
			</span>
		{/if}
	</div>
</div>
