<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import MousePointer from '@lucide/svelte/icons/mouse-pointer';
	import FileText from '@lucide/svelte/icons/file-text';
	import Target from '@lucide/svelte/icons/target';
	import { fmtCompact } from './rk-helpers';

	let { totals }: { totals: { impressions: number; linkClicks: number; landingPageViews: number; conversions: number } } = $props();

	const steps = $derived([
		{ label: 'Impresii', value: totals.impressions, color: '#6366f1', icon: Eye },
		{ label: 'Click-uri link', value: totals.linkClicks, color: '#1877F2', icon: MousePointer },
		{ label: 'Vizualizări pagină', value: totals.landingPageViews, color: '#0ea5e9', icon: FileText },
		{ label: 'Rezultate', value: totals.conversions, color: '#10b981', icon: Target }
	]);
	const max = $derived(steps[0].value || 1);
</script>

<div class="rk-card">
	<div class="rk-card-head"><h3 class="rk-card-title">Funnel de conversie</h3></div>
	<div class="rk-funnel">
		{#each steps as s, i (s.label)}
			{@const prev = i > 0 ? steps[i - 1].value : null}
			{@const conv = prev != null ? (prev > 0 ? (s.value / prev) * 100 : 0) : null}
			{@const Ic = s.icon}
			<div class="rk-funnel-step">
				<div class="rk-funnel-meta">
					<span class="rk-funnel-ic" style="background:{s.color}1a; color:{s.color}"><Ic size={14} /></span>
					<span class="rk-funnel-label">{s.label}</span>
					<span class="rk-funnel-val">{fmtCompact(s.value)}</span>
				</div>
				<div class="rk-funnel-bar"><div class="rk-funnel-fill" style="width:{Math.max((s.value / max) * 100, 1.5)}%; background:{s.color}"></div></div>
				{#if conv != null}
					<div class="rk-funnel-conv">{conv.toLocaleString('ro-RO', { maximumFractionDigits: 1 })}% din pasul anterior</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
