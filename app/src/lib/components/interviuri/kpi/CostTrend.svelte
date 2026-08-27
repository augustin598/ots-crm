<script lang="ts">
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import {
		FIXED_COLOR,
		fmtInt,
		fmtLei,
		fmtLeiFine,
		type KpiMonthRow,
		type MonthFilter
	} from '$lib/logic/interviuri-kpi';
	import type { SourcePlatform } from './types';

	let {
		rows,
		year,
		selMonth,
		onPick,
		platforms
	}: {
		rows: KpiMonthRow[];
		year: number;
		selMonth: MonthFilter;
		onPick: (m: MonthFilter) => void;
		platforms: SourcePlatform[];
	} = $props();

	const max = $derived(Math.max(1, ...rows.map((r) => r.total)));
</script>

<div class="cl-section">
	<div class="cl-section-head">
		<h3><TrendingUpIcon size={15} /> Cost pe interviu, lună cu lună · {year}</h3>
		<p class="cl-section-sub" style="margin-left:auto">coloana = buget total · cifra de sus = cost / interviu</p>
	</div>
	<div class="ivk-trend">
		{#each rows as r (r.monthNum)}
			{@const sel = selMonth === r.monthNum}
			<button
				type="button"
				class="ivk-trend-col {sel ? 'sel' : ''}"
				aria-pressed={sel}
				aria-label="{r.month}: buget {fmtLei(r.total)}, {r.n} interviuri, cost pe interviu {fmtLeiFine(r.cpi)}. {sel ? 'Elimină filtrul' : 'Filtrează pe această lună'}"
				title="{r.month}: {fmtLei(r.total)} · {r.n} interviuri"
				onclick={() => onPick(sel ? 'all' : r.monthNum)}
			>
				<span class="ivk-trend-cpi">{r.cpi != null ? fmtInt(r.cpi) : '—'}</span>
				<span class="ivk-trend-stack-wrap">
					<span class="ivk-trend-stack" style="height:{(r.total / max) * 100}%">
						{#each platforms as p (p.id)}
							<span class="ivk-trend-seg" style="height:{r.total ? (r.ads[p.id] / r.total) * 100 : 0}%;background:{p.color}"></span>
						{/each}
						<span class="ivk-trend-seg" style="height:{r.total ? (r.fixed / r.total) * 100 : 0}%;background:{FIXED_COLOR};opacity:.55"></span>
					</span>
				</span>
				<span class="ivk-trend-lbl">{r.month.slice(0, 3)}</span>
				<span class="ivk-trend-n">{r.n} intv.</span>
			</button>
		{/each}
		{#if rows.length === 0}
			<div class="cl-budget-empty" style="margin:auto">Fără date pentru {year}.</div>
		{/if}
	</div>
	<div class="iv-legend">
		{#each platforms as p (p.id)}
			<span class="iv-legend-item"><span class="iv-legend-swatch" style="background:{p.color}"></span> {p.label} <b>{fmtLei(p.amount)}</b></span>
		{/each}
		<span class="iv-legend-item"><span class="iv-legend-swatch" style="background:{FIXED_COLOR};opacity:.55"></span> Cheltuieli fixe</span>
	</div>
</div>
