<script lang="ts">
	let {
		data,
		color = 'var(--d-primary)',
		w = 80,
		h = 28,
		fill = true
	}: { data: number[]; color?: string; w?: number; h?: number; fill?: boolean } = $props();

	const max = $derived(Math.max(...data));
	const min = $derived(Math.min(...data));
	const range = $derived(max - min || 1);
	const pts = $derived(
		data.map((v, i) => [(i / Math.max(1, data.length - 1)) * w, h - ((v - min) / range) * h])
	);
	const linePath = $derived(
		pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
	);
	const areaPath = $derived(`${linePath} L${w} ${h} L0 ${h} Z`);
</script>

{#if data.length > 1}
	<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} class="spark" aria-hidden="true">
		{#if fill}
			<path d={areaPath} fill={color} opacity="0.12" />
		{/if}
		<path
			d={linePath}
			fill="none"
			stroke={color}
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
{/if}

<style>
	.spark {
		flex-shrink: 0;
		display: block;
	}
</style>
