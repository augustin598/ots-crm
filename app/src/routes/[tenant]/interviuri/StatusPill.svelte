<script lang="ts">
	import type { StatusSlug } from './lib';
	let { status }: { status: StatusSlug } = $props();
</script>

{#if status === 'admisa'}
	<span class="iv-st ok"><span class="dot"></span>Admisă</span>
{:else if status === 'respinsa'}
	<span class="iv-st no"><span class="dot"></span>Respinsă</span>
{:else}
	<span class="iv-st wait"><span class="dot"></span>În evaluare</span>
{/if}
