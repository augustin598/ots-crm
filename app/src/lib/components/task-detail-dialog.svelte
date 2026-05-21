<script lang="ts">
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import TaskDetailBody from '$lib/components/task-detail/task-detail-body.svelte';
	import type { Task } from '$lib/server/db/schema';

	interface Props {
		task: Task | null;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		tenantSlug?: string;
		currentUserId?: string;
		additionalQueriesToUpdate?: any[];
		mode?: 'dialog' | 'panel';
	}

	let {
		task,
		open,
		onOpenChange,
		tenantSlug = '',
		currentUserId,
		additionalQueriesToUpdate = []
	}: Props = $props();
</script>

{#if task}
	<Dialog bind:open {onOpenChange}>
		<DialogContent class="max-h-[90vh] overflow-y-auto bg-white sm:max-w-5xl" showCloseButton={false}>
			<DialogHeader class="sr-only">
				<DialogTitle>{task.title}</DialogTitle>
			</DialogHeader>
			<TaskDetailBody
				{task}
				mode="dialog"
				{tenantSlug}
				{currentUserId}
				{additionalQueriesToUpdate}
				onClose={() => onOpenChange(false)}
			/>
		</DialogContent>
	</Dialog>
{/if}
