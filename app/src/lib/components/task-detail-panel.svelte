<script lang="ts">
	import { getTask } from '$lib/remotes/tasks.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Sheet from '$lib/components/ui/sheet';
	import TaskDetailBody from '$lib/components/task-detail/task-detail-body.svelte';

	interface Props {
		taskId: string | null;
		onClose: () => void;
		tenantSlug?: string;
		currentUserId?: string;
		additionalQueriesToUpdate?: any[];
	}

	let {
		taskId,
		onClose,
		tenantSlug = '',
		currentUserId,
		additionalQueriesToUpdate = []
	}: Props = $props();

	const taskQuery = $derived(taskId ? getTask(taskId) : null);
	const task = $derived(taskQuery?.current ?? null);

	// Mobile redirect to full-page view
	$effect(() => {
		if (taskId && typeof window !== 'undefined' && window.innerWidth < 768) {
			const tenant = tenantSlug || page.params.tenant;
			onClose();
			goto(`/${tenant}/tasks/${taskId}`);
		}
	});
</script>

<Sheet.Root open={!!taskId} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Sheet.Content side="right" class="w-full overflow-y-auto bg-white p-0 sm:max-w-[860px]">
		<Sheet.Header class="sr-only">
			<Sheet.Title>{task?.title ?? 'Task Detail'}</Sheet.Title>
		</Sheet.Header>

		<TaskDetailBody
			{task}
			mode="panel"
			{tenantSlug}
			{currentUserId}
			{additionalQueriesToUpdate}
			{onClose}
		/>
	</Sheet.Content>
</Sheet.Root>
