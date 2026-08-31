<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';

	let { pass }: { pass: boolean | null } = $props();
</script>

{#if pass == null}
	<span class="psi-cwv na">fără date CrUX</span>
{:else if pass}
	<span class="psi-cwv pass"><CheckIcon size={11} /> trece</span>
{:else}
	<span class="psi-cwv fail"><XIcon size={11} /> nu trece</span>
{/if}
