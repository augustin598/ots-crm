<script lang="ts">
	// Bară segmentată a distribuției pe buckete de poziție (1-3 … 100+).
	type Dist = Record<string, number>;
	let { distribution }: { distribution: Dist } = $props();

	const BUCKETS = ['1-3', '4-10', '11-20', '21-50', '51-100', '100+'];
	const total = $derived(BUCKETS.reduce((a, b) => a + (distribution[b] ?? 0), 0));
	const segments = $derived(
		BUCKETS.map((b, i) => ({
			bucket: b,
			count: distribution[b] ?? 0,
			pct: total > 0 ? ((distribution[b] ?? 0) / total) * 100 : 0,
			cls: `rk-dist-${i + 1}`
		})).filter((s) => s.count > 0)
	);
</script>

<div class="rk-dist" title={BUCKETS.map((b) => `${b}: ${distribution[b] ?? 0}`).join(' · ')}>
	{#each segments as seg (seg.bucket)}
		<div class="rk-dist-seg {seg.cls}" style:width="{seg.pct}%"></div>
	{/each}
</div>
