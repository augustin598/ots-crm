<script lang="ts">
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import Instagram from '@lucide/svelte/icons/instagram';
	import { fmtCompact, formatCurrency } from './rk-helpers';
	import type { PlatformSplitEntry } from '$lib/server/meta-ads/client';

	let {
		split,
		loading = false,
		cur = 'RON'
	}: { split: { facebook: PlatformSplitEntry; instagram: PlatformSplitEntry } | null; loading?: boolean; cur?: string } = $props();

	const fb = $derived(split?.facebook);
	const ig = $derived(split?.instagram);
	const totalSpend = $derived((fb?.spend ?? 0) + (ig?.spend ?? 0) || 1);
	const fbPct = $derived(((fb?.spend ?? 0) / totalSpend) * 100);
</script>

<div class="rk-card">
	<div class="rk-card-head"><h3 class="rk-card-title">Facebook vs Instagram</h3></div>
	{#if loading}
		<div class="rk-skel" style="height:32px; border-radius:9px; margin-bottom:16px"></div>
		<div class="rk-skel" style="height:64px"></div>
	{:else if !split || totalSpend <= 1}
		<p class="rk-card-sub">Fără date de platformă pentru perioada selectată.</p>
	{:else}
		<div class="rk-split-bar">
			<div class="rk-split-fb" style="width:{fbPct}%">{#if fbPct >= 12}<span>FB {Math.round(fbPct)}%</span>{/if}</div>
			<div class="rk-split-ig" style="width:{100 - fbPct}%">{#if 100 - fbPct >= 12}<span>IG {Math.round(100 - fbPct)}%</span>{/if}</div>
		</div>
		<div class="rk-plat-row" style="border-top:none; padding-top:0">
			<div class="rk-plat-name"><span class="rk-plat-ic" style="color:#1877F2"><IconFacebook class="h-4 w-4" /></span>Facebook</div>
			<div class="rk-plat-stats">
				<div><span>Cheltuieli</span><strong>{formatCurrency(fb?.spend ?? 0, cur)}</strong></div>
				<div><span>Impresii</span><strong>{fmtCompact(fb?.impressions ?? 0)}</strong></div>
				<div><span>Reach</span><strong>{fmtCompact(fb?.reach ?? 0)}</strong></div>
				<div><span>Click-uri</span><strong>{fmtCompact(fb?.linkClicks ?? 0)}</strong></div>
				<div><span>Rezultate</span><strong>{fmtCompact(fb?.conversions ?? 0)}</strong></div>
			</div>
		</div>
		<div class="rk-plat-row">
			<div class="rk-plat-name"><span class="rk-plat-ic" style="color:#E1306C"><Instagram size={16} /></span>Instagram</div>
			<div class="rk-plat-stats">
				<div><span>Cheltuieli</span><strong>{formatCurrency(ig?.spend ?? 0, cur)}</strong></div>
				<div><span>Impresii</span><strong>{fmtCompact(ig?.impressions ?? 0)}</strong></div>
				<div><span>Reach</span><strong>{fmtCompact(ig?.reach ?? 0)}</strong></div>
				<div><span>Click-uri</span><strong>{fmtCompact(ig?.linkClicks ?? 0)}</strong></div>
				<div><span>Rezultate</span><strong>{fmtCompact(ig?.conversions ?? 0)}</strong></div>
			</div>
		</div>
	{/if}
</div>
