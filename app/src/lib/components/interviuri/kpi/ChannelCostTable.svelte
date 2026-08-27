<script lang="ts">
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import ChannelIcon from '../ChannelIcon.svelte';
	import type { ChannelMeta } from '../lib';
	import { fmtLei, fmtLeiFine, type FixedMode, type KpiChannelRow } from '$lib/logic/interviuri-kpi';

	let {
		rows,
		channelMeta,
		mode,
		unallocatedAds = 0,
		unallocatedFixed = 0
	}: {
		rows: KpiChannelRow[];
		channelMeta: Record<string, ChannelMeta>;
		mode: FixedMode;
		unallocatedAds?: number;
		unallocatedFixed?: number;
	} = $props();

	const maxTotal = $derived(Math.max(1, ...rows.map((r) => r.total)));
	// culoarea canalului TikTok (#111827) ar dispărea în dark → aceeași variabilă ca platforma
	const colorOf = (ch: string) => {
		const c = channelMeta[ch]?.color ?? '#94a3b8';
		return c.toLowerCase() === '#111827' ? 'var(--ivk-tiktok, #111827)' : c;
	};
	const softOf = (ch: string) => {
		const c = channelMeta[ch]?.color ?? '#94a3b8';
		return c.toLowerCase() === '#111827' ? 'rgba(100,116,139,.15)' : `${c}1a`;
	};
	const iconOf = (ch: string) => channelMeta[ch]?.icon ?? 'circle-help';
</script>

<div class="cl-section" style="padding:0">
	<div class="cl-section-head" style="padding:18px 20px 14px; margin-bottom:0">
		<h3><MegaphoneIcon size={15} /> Cost pe canal de proveniență</h3>
		<p class="cl-section-sub" style="margin-left:auto">
			bugetul platformei se împarte pe interviurile venite din ea; cheltuielile fixe
			{mode === 'toate' ? 'pe toate interviurile' : 'doar pe sursele plătite'}
		</p>
	</div>
	<div style="overflow-x:auto">
		<table class="cl-list-table">
			<thead>
				<tr>
					<th scope="col">Canal</th>
					<th scope="col" class="num">Interviuri</th>
					<th scope="col" class="num">Admise</th>
					<th scope="col" class="num">Buget ads</th>
					<th scope="col" class="num">Cheltuieli fixe</th>
					<th scope="col" class="num">Cost total</th>
					<th scope="col" class="num">Cost / interviu</th>
					<th scope="col" class="num">Cost / admisă</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.channel)}
					{@const color = colorOf(r.channel)}
					<tr class="ivk-static">
						<td>
							<div class="iv-attr-name">
								<span class="iv-attr-ic" style="background:{softOf(r.channel)};color:{color}"><ChannelIcon icon={iconOf(r.channel)} size={14} /></span>
								<span>{r.channel}</span>
								{#if !r.paid}<span class="ivk-tag">organic</span>{/if}
							</div>
							<div class="ivk-bar-mini" aria-hidden="true"><i style="width:{(r.total / maxTotal) * 100}%;background:{color}"></i></div>
						</td>
						<td class="num">{r.n}</td>
						<td class="num">{r.ok}</td>
						<td class="num">{#if r.ads}{fmtLei(r.ads)}{:else}<span class="iv-muted">—</span>{/if}</td>
						<td class="num">{#if r.fixed}{fmtLei(r.fixed)}{:else}<span class="iv-muted">—</span>{/if}</td>
						<td class="num">{fmtLei(r.total)}</td>
						<td class="num ivk-cpi-cell">{#if r.total}{fmtLeiFine(r.cpi)}{:else}<span class="iv-muted">0 lei</span>{/if}</td>
						<td class="num">{#if r.ok}{fmtLeiFine(r.cpiOk)}{:else}<span class="iv-muted">—</span>{/if}</td>
					</tr>
				{/each}
				{#if rows.length === 0}
					<tr class="ivk-static"><td colspan="8"><div class="cl-budget-empty">Niciun interviu în perioada selectată.</div></td></tr>
				{/if}
			</tbody>
		</table>
	</div>
	{#if Math.round(unallocatedAds) > 0 || Math.round(unallocatedFixed) > 0}
		<div class="cl-budget-empty" style="padding:10px 20px 14px">
			Nealocat pe canale (nu apare în tabel):
			{#if Math.round(unallocatedAds) > 0}<b>{fmtLei(unallocatedAds)}</b> ads pe platforme fără interviuri din canalele lor{/if}{#if Math.round(unallocatedAds) > 0 && Math.round(unallocatedFixed) > 0};
			{/if}{#if Math.round(unallocatedFixed) > 0}<b>{fmtLei(unallocatedFixed)}</b> cheltuieli fixe fără interviuri din surse plătite{/if}.
		</div>
	{/if}
</div>
