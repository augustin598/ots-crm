<script lang="ts">
	interface Props {
		data: number[];
		color?: string;
		w?: number;
		h?: number;
	}

	let { data, color = '#1877F2', w = 80, h = 28 }: Props = $props();

	const max = $derived(Math.max(...data, 1));
	const min = $derived(Math.min(...data, 0));
	const range = $derived(max - min || 1);
	const pts = $derived(
		data
			.map((v, i) => {
				const x = (i / (data.length - 1)) * w;
				const y = h - ((v - min) / range) * h;
				return `${x},${y}`;
			})
			.join(' ')
	);
	const area = $derived(`0,${h} ${pts} ${w},${h}`);
</script>

{#if data.length > 0}
	<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} class="kpi-spark">
		<polygon points={area} fill={color} opacity="0.12" />
		<polyline points={pts} fill="none" stroke={color} stroke-width="1.5" stroke-linejoin="round" />
	</svg>
{/if}
