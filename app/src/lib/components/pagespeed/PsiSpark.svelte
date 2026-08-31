<script lang="ts">
	import { psiScoreLevel } from '$lib/logic/pagespeed';
	import { PSI_LVL } from './lib';

	let { values, w = 78, h = 26 }: { values: number[]; w?: number; h?: number } = $props();

	const pts = $derived.by(() => {
		if (!values || values.length < 2) return [];
		const min = Math.min(...values) - 4;
		const max = Math.max(...values) + 4;
		const span = Math.max(6, max - min);
		return values.map((v, i) => [
			(i / (values.length - 1)) * (w - 4) + 2,
			h - 3 - ((v - min) / span) * (h - 6)
		]);
	});
	const last = $derived(pts[pts.length - 1]);
	const color = $derived(PSI_LVL[psiScoreLevel(values?.[values.length - 1] ?? null)]);
</script>

{#if pts.length < 2}
	<span class="iv-muted">—</span>
{:else}
	<svg class="psi-spark" width={w} height={h} viewBox="0 0 {w} {h}" aria-hidden="true">
		<polyline
			points={pts.map((p) => p.join(',')).join(' ')}
			fill="none"
			stroke={color}
			stroke-width="1.7"
			stroke-linejoin="round"
			stroke-linecap="round"
			opacity=".85"
		/>
		<circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
	</svg>
{/if}

<style>
	.iv-muted {
		color: var(--cl-text-3);
	}
</style>
