<script lang="ts">
	// Starea în AI Overview: citat / apare fără noi / absent.
	import SparklesIcon from '@lucide/svelte/icons/sparkles';

	let { state }: { state: 'absent' | 'present' | 'cited' } = $props();
</script>

{#if state === 'cited'}
	<span class="rt-ai cited"><SparklesIcon size={11} /> citat</span>
{:else if state === 'present'}
	<span class="rt-ai present">apare, fără noi</span>
{:else}
	<span class="rt-ai none">—</span>
{/if}
