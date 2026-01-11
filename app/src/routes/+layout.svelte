<script lang="ts">
	import './layout.css';
	import { NuqsAdapter } from 'nuqs-svelte/adapters/svelte-kit';

	const { children } = $props();
</script>

<NuqsAdapter>
	{@render children()}
</NuqsAdapter>