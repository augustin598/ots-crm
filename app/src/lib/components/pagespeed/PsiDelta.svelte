<script lang="ts">
	let {
		value,
		suffix = '',
		invert = false
	}: { value: number | null; suffix?: string; invert?: boolean } = $props();

	const v = $derived(value == null ? null : Math.round(value * 10) / 10);
	const cls = $derived.by(() => {
		if (v == null || v === 0) return 'flat';
		const good = invert ? v < 0 : v > 0;
		return good ? 'up' : 'down';
	});
</script>

{#if v == null}
	<span class="iv-muted">—</span>
{:else}
	<span class="psi-delta {cls}">{v === 0 ? '=' : v > 0 ? '▲' : '▼'} {v > 0 ? '+' : ''}{v}{suffix}</span>
{/if}

<style>
	.iv-muted {
		color: var(--cl-text-3);
	}
</style>
