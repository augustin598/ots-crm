<script lang="ts">
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import ChannelIcon from './ChannelIcon.svelte';
	import type { ChannelMeta, IvRow } from './lib';

	let {
		records,
		channelMeta,
		channelOrder
	}: {
		records: IvRow[];
		channelMeta: Record<string, ChannelMeta>;
		channelOrder: string[];
	} = $props();

	const rows = $derived.by(() => {
		const map: Record<string, { total: number; ok: number; no: number }> = {};
		for (const r of records) {
			const m = (map[r.channel] ??= { total: 0, ok: 0, no: 0 });
			m.total++;
			if (r.status === 'admisa') m.ok++;
			else if (r.status === 'respinsa') m.no++;
		}
		return channelOrder
			.filter((ch) => map[ch])
			.map((ch) => ({ channel: ch, ...map[ch] }))
			.sort((a, b) => b.total - a.total);
	});
	const max = $derived(Math.max(1, ...rows.map((r) => r.total)));
	const total = $derived(records.length || 1);
	const metaOf = (ch: string) => channelMeta[ch] ?? { color: '#94a3b8', icon: 'circle-help' };
</script>

<div class="cl-section">
	<div class="cl-section-head">
		<h3><MegaphoneIcon size={15} /> Sursă interviuri pe canal</h3>
		<p class="cl-section-sub" style="margin-left:auto">de unde au aflat candidatele de noi</p>
	</div>
	<div class="iv-attr-list">
		{#each rows as r (r.channel)}
			{@const c = metaOf(r.channel)}
			{@const pct = Math.round((r.total / total) * 100)}
			{@const okW = r.total ? (r.ok / r.total) * 100 : 0}
			{@const noW = r.total ? (r.no / r.total) * 100 : 0}
			{@const waitW = 100 - okW - noW}
			<div class="iv-attr-row">
				<div class="iv-attr-name">
					<span class="iv-attr-ic" style="background:{c.color}14; color:{c.color}">
						<ChannelIcon icon={c.icon} size={14} />
					</span>
					<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{r.channel}</span>
				</div>
				<div class="iv-attr-bar-wrap">
					<div class="iv-attr-track">
						<div
							class="iv-attr-fill"
							style="width:{(r.total / max) * 100}%; background:{c.color}14"
							title="{r.ok} admise · {r.no} respinse"
						>
							<div class="split" style="width:{okW}%; background:{c.color}"></div>
							<div class="split" style="width:{waitW}%; background:{c.color}; opacity:.35"></div>
							<div class="split" style="width:{noW}%; background:{c.color}; opacity:.16"></div>
						</div>
					</div>
				</div>
				<div class="iv-attr-vals" style="flex-direction:column; align-items:flex-end; gap:0">
					<div style="display:flex; align-items:baseline; gap:6px">
						<span class="iv-attr-count">{r.total}</span>
						<span class="iv-attr-pct">{pct}%</span>
					</div>
					<span class="iv-attr-sub">{r.total ? Math.round((r.ok / r.total) * 100) : 0}% admise</span>
				</div>
			</div>
		{/each}
		{#if rows.length === 0}
			<div class="cl-budget-empty">Niciun interviu în perioada selectată.</div>
		{/if}
	</div>
	<div class="iv-legend">
		<span class="iv-legend-item"
			><span class="iv-legend-swatch" style="background:#334155"></span> Admisă</span
		>
		<span class="iv-legend-item"
			><span class="iv-legend-swatch" style="background:#334155; opacity:.35"></span> În evaluare</span
		>
		<span class="iv-legend-item"
			><span class="iv-legend-swatch" style="background:#334155; opacity:.16"></span> Respinsă</span
		>
	</div>
</div>
