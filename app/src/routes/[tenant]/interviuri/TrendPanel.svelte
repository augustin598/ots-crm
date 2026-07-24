<script lang="ts">
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import { IV_MONTHS, type ChannelMeta, type IvRow } from './lib';

	let {
		records,
		prevRecords,
		prevYear,
		year,
		channelMeta,
		channelOrder
	}: {
		records: IvRow[];
		prevRecords: IvRow[];
		prevYear: number;
		year: number;
		channelMeta: Record<string, ChannelMeta>;
		channelOrder: string[];
	} = $props();

	let compare = $state(false);

	const data = $derived.by(() => {
		const byMonth: Record<number, { label: string; total: number; ch: Record<string, number> }> = {};
		IV_MONTHS.forEach((m, i) => (byMonth[i + 1] = { label: m, total: 0, ch: {} }));
		const channelTotals: Record<string, number> = {};
		for (const r of records) {
			const col = byMonth[r.monthNum];
			if (!col) continue;
			col.total++;
			col.ch[r.channel] = (col.ch[r.channel] || 0) + 1;
			channelTotals[r.channel] = (channelTotals[r.channel] || 0) + 1;
		}
		const cols = Object.values(byMonth).filter((c) => c.total > 0);
		const prevByMonth: Record<number, number> = {};
		for (const r of prevRecords) prevByMonth[r.monthNum] = (prevByMonth[r.monthNum] || 0) + 1;
		const maxTotal = Math.max(
			1,
			...cols.map((c) => c.total),
			...(compare ? Object.values(prevByMonth) : [0])
		);
		return { cols, channelTotals, maxTotal, prevByMonth };
	});

	const legendChannels = $derived(channelOrder.filter((ch) => data.channelTotals[ch]));
	const hasPrev = $derived(prevRecords.length > 0);
	const colorOf = (ch: string) => channelMeta[ch]?.color ?? '#94a3b8';
	const monthIdx = (label: string) => IV_MONTHS.indexOf(label) + 1;
</script>

<div class="cl-section">
	<div class="cl-section-head">
		<h3><BarChart3Icon size={15} /> Evoluție lunară {year}</h3>
		{#if hasPrev}
			<button
				class="iv-clear-filters"
				style="margin-left:auto; color:{compare ? 'var(--cl-accent)' : 'var(--cl-text-3)'}"
				onclick={() => (compare = !compare)}
			>
				<RepeatIcon size={12} /> Compară cu {prevYear}
			</button>
		{/if}
	</div>
	<div class="iv-trend">
		{#each data.cols as col (col.label)}
			{@const prev = data.prevByMonth[monthIdx(col.label)]}
			<div class="iv-trend-col">
				<div class="iv-trend-total">
					{col.total}{#if compare && prev != null}<span
							style="font-size:10px;font-weight:600;color:var(--cl-text-3);margin-left:4px"
							>/{prev}</span
						>{/if}
				</div>
				<div
					style="position:relative;flex:1;width:100%;max-width:46px;display:flex;align-items:flex-end;justify-content:center"
				>
					{#if compare && prev != null}
						<div
							title="{prevYear}: {prev}"
							style="position:absolute;left:50%;transform:translateX(-50%);bottom:0;width:100%;height:{(prev /
								data.maxTotal) *
								100}%;border:1.5px dashed var(--cl-text-3);border-radius:6px;opacity:.6;pointer-events:none"
						></div>
					{/if}
					<div
						class="iv-trend-stack"
						style="height:{(col.total / data.maxTotal) * 100}%;position:relative;z-index:1"
					>
						{#each channelOrder.filter((ch) => col.ch[ch]) as ch (ch)}
							<div
								class="iv-trend-seg"
								style="height:{(col.ch[ch] / col.total) *
									100}%;background:{colorOf(ch)};opacity:{ch === 'Nespecificat' ? 0.4 : 1}"
								title="{col.label}: {col.ch[ch]} din {ch}"
							></div>
						{/each}
					</div>
				</div>
				<div class="iv-trend-lbl">{col.label.slice(0, 3)}</div>
			</div>
		{/each}
		{#if data.cols.length === 0}
			<div class="cl-budget-empty" style="margin:auto">Fără date pentru {year}.</div>
		{/if}
	</div>
	<div class="iv-legend">
		{#if compare}
			<span class="iv-legend-item"
				><span
					class="iv-legend-swatch"
					style="border:1.5px dashed var(--cl-text-3); background:transparent"
				></span>
				{prevYear}</span
			>
		{/if}
		{#each legendChannels as ch (ch)}
			<span class="iv-legend-item">
				<span
					class="iv-legend-swatch"
					style="background:{colorOf(ch)};opacity:{ch === 'Nespecificat' ? 0.4 : 1}"
				></span>
				{ch} <b>{data.channelTotals[ch]}</b>
			</span>
		{/each}
	</div>
</div>
