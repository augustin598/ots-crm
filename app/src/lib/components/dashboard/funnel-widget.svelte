<script lang="ts">
	import type { FunnelStage } from './types';
	import { fmtNum } from './format';

	let { stages }: { stages: FunnelStage[] } = $props();

	const max = $derived(Math.max(1, stages[0]?.value ?? 1));
	const hasData = $derived((stages[0]?.value ?? 0) > 0);
	const conv = $derived(
		stages.length ? ((stages[stages.length - 1].value / max) * 100).toFixed(1) : '0'
	);
</script>

<div class="dash-card">
	<div class="dash-card-head">
		<div>
			<div class="dash-card-title">Funnel conversie</div>
			<div class="dash-card-sub">Lead → Client · rată {conv}%</div>
		</div>
	</div>
	{#if hasData}
		<div class="dash-funnel">
			{#each stages as s, i (s.stage)}
				{@const w = (s.value / max) * 100}
				{@const drop = i > 0 && stages[i - 1].value > 0 ? (((stages[i - 1].value - s.value) / stages[i - 1].value) * 100).toFixed(0) : null}
				<div class="dash-funnel-row">
					<div class="dash-funnel-label">{s.stage}</div>
					<div class="dash-funnel-bar-wrap">
						<div class="dash-funnel-bar" style="width:{w}%;background:{s.colorVar}">
							<span>{fmtNum(s.value)}</span>
						</div>
						{#if drop}<span class="dash-funnel-drop">−{drop}%</span>{/if}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="dash-empty">Niciun lead înregistrat încă.</div>
	{/if}
</div>
