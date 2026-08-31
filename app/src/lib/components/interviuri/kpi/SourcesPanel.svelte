<script lang="ts">
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import UsersIcon from '@lucide/svelte/icons/users';
	import TargetIcon from '@lucide/svelte/icons/target';
	import PlatformIcon from './PlatformIcon.svelte';
	import { FIXED_COLOR, fmtLei, pct } from '$lib/logic/interviuri-kpi';
	import type { SourcePlatform } from './types';

	let {
		platforms,
		adsTotal,
		fixedTotal,
		months,
		syncing,
		onSync,
		canSync = true,
		lastSync
	}: {
		platforms: SourcePlatform[];
		adsTotal: number;
		fixedTotal: number;
		months: number;
		syncing: boolean;
		onSync: () => void;
		/** false în portalul clientului — sync-ul e doar pentru staff */
		canSync?: boolean;
		lastSync: string;
	} = $props();

	const total = $derived(adsTotal + fixedTotal);
	const segs = $derived(
		[
			...platforms.map((p) => ({ id: p.id as string, label: p.label, color: p.color, amount: p.amount })),
			{ id: 'fixe', label: 'Cheltuieli fixe', color: FIXED_COLOR, amount: fixedTotal }
		].filter((s) => s.amount > 0)
	);
	const monthsLabel = $derived(months === 1 ? 'lună' : 'luni');
</script>

<div class="cl-section">
	<div class="cl-section-head">
		<h3><DollarSignIcon size={15} /> Compunerea bugetului</h3>
		{#if canSync}
			<div class="cl-section-actions" style="margin-left:auto">
				<button type="button" class="cl-btn-secondary cl-btn-sm" onclick={onSync} disabled={syncing} aria-busy={syncing}>
					<RepeatIcon size={12} class={syncing ? 'animate-spin' : ''} />
					{syncing ? 'Se sincronizează…' : 'Sincronizează bugetele'}
				</button>
			</div>
		{/if}
	</div>

	<div
		class="ivk-comp-bar"
		role="img"
		aria-label="Ponderea surselor în bugetul total: {segs
			.map((s) => `${s.label} ${pct(s.amount, total)}%`)
			.join(', ') || 'fără buget'}"
	>
		{#each segs as s (s.id)}
			{@const w = total ? (s.amount / total) * 100 : 0}
			<div class="ivk-comp-seg" style="width:{w}%;background:{s.color}" title="{s.label}: {fmtLei(s.amount)}">
				{w >= 9 ? `${Math.round(w)}%` : ''}
			</div>
		{/each}
	</div>

	<div class="ivk-src-list" style="margin-top:12px">
		{#each platforms as p (p.id)}
			<div class="ivk-src-row">
				<span class="ivk-src-ic" style="background:{p.soft};color:{p.color}"><PlatformIcon id={p.id} class="size-4" /></span>
				<div style="min-width:0">
					<div class="ivk-src-name">
						{p.label}
						{#if p.syncedAt}
							<span class="ivk-live"><span class="dot"></span>live</span>
						{:else}
							<span class="ivk-live ivk-manual"><span class="dot"></span>fără date</span>
						{/if}
					</div>
					<div class="ivk-src-sub" title={p.account ?? ''}>
						{p.account ?? 'niciun cont asociat clientului interviurilor'}
					</div>
				</div>
				<div class="ivk-amt">{fmtLei(p.amount)}</div>
				<div class="ivk-share">{pct(p.amount, total)}%</div>
			</div>
		{/each}

		<div class="ivk-src-row">
			<span class="ivk-src-ic" style="background:rgba(100,116,139,.1);color:{FIXED_COLOR}"><UsersIcon size={16} /></span>
			<div style="min-width:0">
				<div class="ivk-src-name">
					Cheltuieli fixe marketing<span class="ivk-live ivk-manual"><span class="dot"></span>manual</span>
				</div>
				<div class="ivk-src-sub">{months} {monthsLabel} × {fmtLei(months ? fixedTotal / months : 0)}/lună</div>
			</div>
			<div class="ivk-amt">{fmtLei(fixedTotal)}</div>
			<div class="ivk-share">{pct(fixedTotal, total)}%</div>
		</div>

		<div class="ivk-src-row total">
			<span class="ivk-src-ic" style="background:var(--cl-accent-50);color:var(--cl-accent)"><TargetIcon size={16} /></span>
			<div style="min-width:0">
				<div class="ivk-src-name">Buget total marketing</div>
				<div class="ivk-src-sub">ultima sincronizare: {lastSync}</div>
			</div>
			<div class="ivk-amt">{fmtLei(total)}</div>
			<div class="ivk-share">100%</div>
		</div>
	</div>
</div>
