<script lang="ts">
	interface Props {
		values: Array<number | null>;
		width?: number;
		height?: number;
		ariaLabel: string;
		color?: string;
	}
	let { values, width = 60, height = 16, ariaLabel, color = 'currentColor' }: Props = $props();

	const numeric = $derived(values.filter((v): v is number => typeof v === 'number'));
	const min = $derived(numeric.length > 0 ? Math.min(...numeric) : 0);
	const max = $derived(numeric.length > 0 ? Math.max(...numeric) : 1);
	const range = $derived(max - min || 1);
	const step = $derived(values.length > 1 ? width / (values.length - 1) : width);

	const points = $derived(
		values
			.map((v, i) => {
				if (typeof v !== 'number') return null;
				const x = i * step;
				const y = height - ((v - min) / range) * height;
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.filter((p): p is string => p !== null)
			.join(' ')
	);
</script>

{#if numeric.length === 0}
	<span class="text-xs text-muted-foreground" aria-label={ariaLabel}>—</span>
{:else}
	<svg
		role="img"
		aria-label={ariaLabel}
		{width}
		{height}
		viewBox="0 0 {width} {height}"
		class="inline-block"
	>
		<polyline fill="none" stroke={color} stroke-width="1.5" points={points} />
	</svg>
{/if}
