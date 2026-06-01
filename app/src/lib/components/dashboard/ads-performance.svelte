<script lang="ts">
	import type { AdsPlatform } from './types';
	import { fmtRON } from './format';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';

	let { platforms, allHref, demo = false }: { platforms: AdsPlatform[]; allHref: string; demo?: boolean } = $props();

	const totalSpend = $derived(platforms.reduce((s, p) => s + p.spend, 0));
	const totalConv = $derived(platforms.reduce((s, p) => s + p.conv, 0));
	const avgRoas = $derived(
		totalSpend ? platforms.reduce((s, p) => s + p.roas * p.spend, 0) / totalSpend : 0
	);
	const BRAND: Record<AdsPlatform['id'], typeof IconFacebook> = {
		meta: IconFacebook,
		google: IconGoogleAds,
		tiktok: IconTiktok
	};
</script>

<div class="dash-card">
	<div class="dash-card-head">
		<div>
			<div class="dash-card-title">Performanță Ads {#if demo}<span class="dash-demo-badge">demo</span>{/if}</div>
			<div class="dash-card-sub">
				Spend total {fmtRON(totalSpend)} · ROAS mediu {avgRoas.toFixed(1)}x · {totalConv} conversii
			</div>
		</div>
		<a href={allHref} class="dash-link">Vezi tot <ChevronRightIcon size={12} /></a>
	</div>
	<div class="dash-ads-list">
		{#each platforms as p (p.id)}
			{@const Brand = BRAND[p.id]}
			{@const pct = Math.min((p.spend / p.budget) * 100, 100)}
			<div class="dash-ad-row">
				<div class="dash-ad-head">
					<div class="dash-ad-name">
						<div class="dash-ad-icon" style="color:{p.color};background:color-mix(in oklch, {p.color} 14%, transparent)">
							<Brand class="h-[18px] w-[18px]" />
						</div>
						<div>
							<div class="dash-ad-title">{p.name}</div>
							<div class="dash-ad-meta">{p.campaigns} campanii · CPA {fmtRON(p.cpa)}</div>
						</div>
					</div>
					<div class="dash-ad-roas">
						<div class="dash-ad-roas-label">ROAS</div>
						<div class="dash-ad-roas-val">{p.roas.toFixed(1)}x</div>
					</div>
				</div>
				<div class="dash-ad-stats">
					<div class="dash-ad-stat"><span>Spend</span><strong>{fmtRON(p.spend)}</strong></div>
					<div class="dash-ad-stat"><span>Conversii</span><strong>{p.conv}</strong></div>
					<div class="dash-ad-stat"><span>CTR</span><strong>{p.ctr}%</strong></div>
				</div>
				<div class="dash-ad-bar">
					<div class="dash-ad-bar-fill" style="width:{pct}%;background:{p.color}"></div>
				</div>
				<div class="dash-ad-budget">
					{fmtRON(p.spend)} / {fmtRON(p.budget)} buget · <strong>{((p.spend / p.budget) * 100).toFixed(0)}%</strong>
				</div>
			</div>
		{/each}
	</div>
</div>
