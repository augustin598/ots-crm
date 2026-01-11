<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import CreateTaskDialog from '$lib/components/create-task-dialog.svelte';

	const tenantSlug = $derived(page.params.tenant);
	const projectId = $derived(page.url.searchParams.get('projectId') || undefined);
	const clientId = $derived(page.url.searchParams.get('clientId') || undefined);

	let isDialogOpen = $state(true);

	function handleSuccess() {
		if (projectId) {
			goto(`/${tenantSlug}/projects/${projectId}/tasks`);
		} else {
			goto(`/${tenantSlug}/tasks`);
		}
	}

	function handleOpenChange(open: boolean) {
		if (!open) {
			if (projectId) {
				goto(`/${tenantSlug}/projects/${projectId}/tasks`);
			} else {
				goto(`/${tenantSlug}/tasks`);
			}
		}
	}
</script>

<svelte:head>
	<title>New Task - CRM</title>
</svelte:head>

<CreateTaskDialog
	open={isDialogOpen}
	onOpenChange={handleOpenChange}
	onSuccess={handleSuccess}
	defaultProjectId={projectId}
	defaultClientId={clientId}
/>
