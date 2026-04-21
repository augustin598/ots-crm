<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import EditTaskForm from './edit-task-form.svelte';
	import type { Task } from '$lib/server/db/schema';

	interface Props {
		task: Task | null;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onSuccess?: () => void;
		additionalQueriesToUpdate?: any[];
	}

	let { task, open, onOpenChange, onSuccess, additionalQueriesToUpdate = [] }: Props = $props();
</script>

<Dialog bind:open {onOpenChange}>
	<DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[600px]">
		<DialogHeader>
			<DialogTitle>Edit Task</DialogTitle>
			<DialogDescription>Update task details</DialogDescription>
		</DialogHeader>
		{#if task}
			<EditTaskForm
				{task}
				{additionalQueriesToUpdate}
				onSuccess={() => {
					onSuccess?.();
					onOpenChange(false);
				}}
				onCancel={() => onOpenChange(false)}
			/>
		{/if}
	</DialogContent>
</Dialog>
