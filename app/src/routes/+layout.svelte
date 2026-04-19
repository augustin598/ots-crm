<script lang="ts">
	import './layout.css';
	import { NuqsAdapter } from 'nuqs-svelte/adapters/svelte-kit';
	import { ConfirmDialog } from '$lib/components/ui/confirm-dialog';

	const { children } = $props();
</script>

<NuqsAdapter>
	{@render children()}
</NuqsAdapter>

<ConfirmDialog />
