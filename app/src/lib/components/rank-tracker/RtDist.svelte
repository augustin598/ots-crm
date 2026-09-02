<script lang="ts">
	// Bara de distribuție a pozițiilor pe cele 6 buckete, cu legendă opțională.
	import type { RankBucket } from '$lib/logic/rank-tracker';
	import { RT_BUCKETS, RT_BUCKET_COLORS, RT_BUCKET_LABELS } from './lib';

	let {
		buckets,
		total,
		compact = false
	}: { buckets: Record<RankBucket, number>; total?: number; compact?: boolean } = $props();

	const n = $derived(total || RT_BUCKETS.reduce((a, k) => a + (buckets[k] ?? 0), 0) || 1);
</script>

<div>
	<div class="rt-dist">
		{#each RT_BUCKETS as k (k)}
			{#if (buckets[k] ?? 0) > 0}
				<i
					style:width="{((buckets[k] ?? 0) / n) * 100}%"
					style:background={RT_BUCKET_COLORS[k]}
					title="{RT_BUCKET_LABELS[k]}: {buckets[k]}"
				></i>
			{/if}
		{/each}
	</div>
	{#if !compact}
		<div class="rt-dist-legend">
			{#each RT_BUCKETS as k (k)}
				<span>
					<em style:background={RT_BUCKET_COLORS[k]}></em>
					{RT_BUCKET_LABELS[k]} <b>{buckets[k] ?? 0}</b>
				</span>
			{/each}
		</div>
	{/if}
</div>
