<script lang="ts">
	// Câștig de poziții: pozitiv = a urcat (poziție mai mică). Aceeași convenție
	// ca `positionDelta` din $lib/logic/rank-tracker (delta = atunci − acum).
	let { value, suffix = '' }: { value: number | null; suffix?: string } = $props();

	const v = $derived(value == null ? null : Math.round(value * 10) / 10);
	const cls = $derived(v == null || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');
</script>

{#if v == null}
	<span class="iv-muted">—</span>
{:else}
	<span class="psi-delta {cls}">{v === 0 ? '=' : v > 0 ? '▲' : '▼'} {v > 0 ? '+' : ''}{v}{suffix}</span>
{/if}
