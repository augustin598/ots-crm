<script lang="ts">
	import { fmtMoneyRound, pacingOf } from '$lib/utils/meta-campaigns';

	interface Props {
		spend: number;
		dailyBudget: number | null;
		periodDays: number;
		currency: string;
	}

	let { spend, dailyBudget, periodDays, currency }: Props = $props();

	const pacing = $derived(pacingOf({ spend, dailyBudget }, periodDays));
	const p = $derived(Math.min(pacing, 1.15));
	const tone = $derived(p >= 0.95 ? 'danger' : p >= 0.8 ? 'warn' : 'ok');
</script>

{#if dailyBudget && spend !== 0}
	<div
		class="pace"
		title="{fmtMoneyRound(spend, currency)} din {fmtMoneyRound(
			dailyBudget * periodDays,
			currency
		)} plafon pe perioadă"
	>
		<div class={['pace-track', tone]}>
			<div class="pace-fill" style:width="{Math.min(p * 100, 100)}%"></div>
		</div>
		<span class="pace-pct">{Math.round(pacing * 100)}%</span>
	</div>
{/if}
