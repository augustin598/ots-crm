<script lang="ts">
	import { getTask } from '$lib/remotes/tasks.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TaskDetailBody from '$lib/components/task-detail/task-detail-body.svelte';

	const tenantSlug = $derived(page.params.tenant);
	const taskId = $derived(page.params.taskId!);
	const currentUserId = $derived((page.data as any)?.clientUser?.userId as string | undefined);

	const taskQuery = $derived(getTask(taskId));
	const task = $derived(taskQuery.current);

	function onClose() {
		goto(`/client/${tenantSlug}/tasks`);
	}
</script>

{#if task}
	<TaskDetailBody
		{task}
		mode="fullpage"
		isClient={true}
		{currentUserId}
		{tenantSlug}
		{onClose}
	/>
{:else}
	<div class="flex h-full items-center justify-center p-8">
		<p class="text-muted-foreground text-sm">Se încarcă...</p>
	</div>
{/if}
