<script lang="ts">
	import { getTask } from '$lib/remotes/tasks.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ClientTaskDetailBody from '$lib/components/client-task/client-task-detail-body.svelte';

	const tenantSlug = $derived(page.params.tenant ?? '');
	const taskId = $derived(page.params.taskId!);
	const currentUserId = $derived(((page.data as any)?.clientUser?.userId as string) ?? '');

	const taskQuery = $derived(getTask(taskId));
	const task = $derived(taskQuery.current ?? null);

	function onClose() {
		goto(`/client/${tenantSlug}/tasks`);
	}
</script>

<svelte:head>
	<title>{task?.title ?? 'Task'} · Client Portal</title>
</svelte:head>

<ClientTaskDetailBody {task} {currentUserId} {tenantSlug} {onClose} />
