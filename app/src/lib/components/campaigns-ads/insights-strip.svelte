<script lang="ts">
	import IconActivity from '@lucide/svelte/icons/activity';
	import IconCircleAlert from '@lucide/svelte/icons/circle-alert';
	import IconCircleCheck from '@lucide/svelte/icons/circle-check';
	import IconCircleDollarSign from '@lucide/svelte/icons/circle-dollar-sign';
	import IconTrendingUp from '@lucide/svelte/icons/trending-up';
	import IconZap from '@lucide/svelte/icons/zap';
	import {
		campaignInsightRules,
		type CampaignRow,
		type InsightRule
	} from '$lib/utils/meta-campaigns';

	interface Props {
		rows: CampaignRow[];
		periodDays: number;
		active: string;
		onPick: (id: string) => void;
	}

	let { rows, periodDays, active, onPick }: Props = $props();

	const ICONS: Record<InsightRule['icon'], typeof IconCircleAlert> = {
		alert: IconCircleAlert,
		dollar: IconCircleDollarSign,
		trending: IconTrendingUp,
		zap: IconZap
	};

	const hits = $derived(
		campaignInsightRules
			.map((rule) => ({ rule, n: rows.filter((r) => rule.test(r, periodDays)).length }))
			.filter((h) => h.n > 0)
	);
</script>

{#if hits.length === 0}
	<div class="insights-ok">
		<IconCircleCheck /> Nimic de reparat — toate campaniile sunt în parametri.
	</div>
{:else}
	<div class="insights-strip">
		<div class="insights-lead">
			<IconActivity />
			<span>Necesită atenție</span>
		</div>
		{#each hits as hit (hit.rule.id)}
			{@const Ico = ICONS[hit.rule.icon]}
			<button
				type="button"
				class={['insight', hit.rule.tone, active === hit.rule.id && 'on']}
				aria-pressed={active === hit.rule.id}
				onclick={() => onPick(active === hit.rule.id ? '' : hit.rule.id)}
				title="Filtrează: {hit.rule.label}"
			>
				<span class="insight-ico"><Ico /></span>
				<span class="insight-txt">
					<span class="insight-l"><b class="insight-n">{hit.n}</b> {hit.rule.label}</span>
					<span class="insight-h">{hit.rule.hint}</span>
				</span>
			</button>
		{/each}
	</div>
{/if}
