<script lang="ts">
	// Chips-urile de SERP features (2 litere, colorate). „ai" are coloana lui.
	import { RT_FEATURES } from './lib';

	let { list }: { list: string[] } = $props();

	const items = $derived((list ?? []).filter((f) => f !== 'ai' && RT_FEATURES[f]));
</script>

{#if items.length === 0}
	<span class="iv-muted">—</span>
{:else}
	<span class="rt-feats">
		{#each items as f (f)}
			<i class="rt-feat" style:background={RT_FEATURES[f].color} title={RT_FEATURES[f].label}>
				{RT_FEATURES[f].short}
			</i>
		{/each}
	</span>
{/if}
