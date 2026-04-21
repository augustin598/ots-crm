<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import { Circle, CircleDashed, CircleDot, Eye, CheckCircle2, XCircle } from '@lucide/svelte';
	import {
		getStatusGroup,
		STATUS_GROUP_CLASSES,
		PRIORITY_BORDER_CLASSES,
		type TaskPriority
	} from './filters';

	interface Props {
		task: Task;
		isOverdue: boolean;
		dimmed?: boolean;
		onclick?: (event: MouseEvent) => void;
		ondragstart?: (event: DragEvent) => void;
		ondragend?: (event: DragEvent) => void;
	}

	const { task, isOverdue, dimmed = false, onclick, ondragstart, ondragend }: Props = $props();

	const group = $derived(getStatusGroup(task.status));
	const priorityKey = $derived<keyof typeof PRIORITY_BORDER_CLASSES>(
		task.priority && task.priority in PRIORITY_BORDER_CLASSES
			? (task.priority as TaskPriority)
			: 'none'
	);

	const StatusIcon = $derived.by(() => {
		switch (task.status) {
			case 'todo':
				return Circle;
			case 'pending-approval':
				return CircleDashed;
			case 'in-progress':
				return CircleDot;
			case 'review':
				return Eye;
			case 'done':
				return CheckCircle2;
			case 'cancelled':
				return XCircle;
			default:
				return Circle;
		}
	});

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onclick?.(e as unknown as MouseEvent);
		}
	}
</script>

<div
	class="relative flex cursor-grab items-center gap-1.5 truncate rounded-md border border-l-4 border-current/20 px-2 py-1 text-start text-xs font-medium shadow-sm transition-opacity hover:opacity-80 active:cursor-grabbing {STATUS_GROUP_CLASSES[
		group
	]} {PRIORITY_BORDER_CLASSES[priorityKey]} {isOverdue
		? 'ring-1 ring-red-500 ring-offset-1'
		: ''} {dimmed ? 'pointer-events-none opacity-25' : ''}"
	title={task.title}
	draggable={true}
	{ondragstart}
	{ondragend}
	{onclick}
	onkeydown={handleKey}
	role="button"
	tabindex="0"
	aria-label={isOverdue ? `Overdue: ${task.title}` : task.title}
>
	<StatusIcon class="h-3 w-3 shrink-0" aria-hidden="true" />
	<span class="truncate">{task.title}</span>
	{#if isOverdue}
		<span
			class="absolute -top-1 -right-1 h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"
			aria-hidden="true"
		></span>
	{/if}
</div>
