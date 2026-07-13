<script lang="ts">
	import Users from '@lucide/svelte/icons/users';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Globe from '@lucide/svelte/icons/globe';
	import Phone from '@lucide/svelte/icons/phone';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import X from '@lucide/svelte/icons/x';
	import { fmtCompact, formatCurrency, formatNumber } from './rk-helpers';
	import { getDemographicLabel } from '$lib/utils/report-helpers';

	interface Segment {
		label: string;
		spend: number;
		impressions: number;
		clicks: number;
		results: number;
	}
	interface Breakdown {
		gender: Segment[];
		age: Segment[];
		region: Segment[];
		devicePlatform: Segment[];
	}
	let { demographics, loading = false, cur = 'RON' }: { demographics: Breakdown | null; loading?: boolean; cur?: string } = $props();

	const round1 = (n: number) => Math.round(n * 10) / 10;
	const AGE_SHADES = ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af'];
	const LOC_SHADES = ['#6ee7b7', '#34d399', '#10b981', '#059669', '#a7f3d0', '#047857'];
	const DEV_COLORS: Record<string, string> = { 'Mobil App': '#8b5cf6', Desktop: '#a78bfa', 'Mobil Web': '#c4b5fd', Necunoscut: '#cbd5e1' };
	const GEN_COLORS: Record<string, string> = { Femei: '#3b82f6', Bărbați: '#ec4899', Necunoscut: '#94a3b8' };

	type EnrichedSeg = { label: string; pct: number; spend: number; impressions: number; clicks: number; results: number; color: string };

	function enrich(segs: Segment[], type: 'gender' | 'age' | 'region' | 'devicePlatform', colorFor: (label: string, i: number) => string): EnrichedSeg[] {
		const total = segs.reduce((s, x) => s + x.spend, 0) || 1;
		return [...segs]
			.sort((a, b) => b.spend - a.spend)
			.map((s, i) => {
				const label = getDemographicLabel(type, s.label);
				return { label, pct: round1((s.spend / total) * 100), spend: s.spend, impressions: s.impressions, clicks: s.clicks, results: s.results, color: colorFor(label, i) };
			});
	}

	const gen = $derived(demographics ? enrich(demographics.gender, 'gender', (l) => GEN_COLORS[l] || '#94a3b8') : []);
	const age = $derived(demographics ? enrich(demographics.age, 'age', (_l, i) => AGE_SHADES[i % AGE_SHADES.length]) : []);
	const loc = $derived(demographics ? enrich(demographics.region, 'region', (_l, i) => LOC_SHADES[i % LOC_SHADES.length]) : []);
	const dev = $derived(demographics ? enrich(demographics.devicePlatform, 'devicePlatform', (l) => DEV_COLORS[l] || '#a78bfa') : []);

	const cards = $derived([
		{ icon: Users, title: 'Gen', subtitle: 'gen', segments: gen },
		{ icon: Calendar, title: 'Vârstă', subtitle: 'vârstă', segments: age },
		{ icon: Globe, title: 'Locație', subtitle: 'locație', segments: loc },
		{ icon: Phone, title: 'Dispozitive', subtitle: 'dispozitive', segments: dev }
	]);

	let modal = $state<{ title: string; subtitle: string; segments: EnrichedSeg[] } | null>(null);

	// modal chart geometry
	const MW = 560,
		rowH = 30,
		mPadL = 150,
		mPadR = 16,
		mPadT = 8;
	const modalSegs = $derived(modal?.segments ?? []);
	const maxSpend = $derived(Math.max(...modalSegs.map((s) => s.spend), 1));
	const MH = $derived(mPadT + modalSegs.length * rowH + 34);
	const mx = (v: number) => mPadL + (v / maxSpend) * (MW - mPadL - mPadR);
	const mTicks = $derived([0, 0.25, 0.5, 0.75, 1].map((t) => maxSpend * t));
	const modalTotals = $derived(
		modalSegs.reduce((a, s) => ({ spend: a.spend + s.spend, impressions: a.impressions + s.impressions, clicks: a.clicks + s.clicks, results: a.results + s.results }), {
			spend: 0,
			impressions: 0,
			clicks: 0,
			results: 0
		})
	);
</script>

<div>
	<h2 class="rk-section-title">Audiență</h2>
	{#if loading}
		<div class="rk-aud-grid">
			{#each [0, 1, 2, 3] as i (i)}<div class="rk-card rk-audcard"><div class="rk-skel" style="height:140px"></div></div>{/each}
		</div>
	{:else}
		<div class="rk-aud-grid">
			{#each cards as card (card.title)}
				{@const Ic = card.icon}
				{@const shown = card.segments.slice(0, 4)}
				{@const rest = card.segments.length - shown.length}
				{@const segMax = Math.max(...shown.map((s) => s.pct), 1)}
				<button class="rk-card rk-audcard" onclick={() => (modal = { title: card.title, subtitle: card.subtitle, segments: card.segments })}>
					<div class="rk-aud-head"><span class="rk-aud-ic"><Ic size={15} /></span>{card.title}<ArrowUpRight size={13} class="rk-aud-open" /></div>
					<div class="rk-seglist">
						{#each shown as s (s.label)}
							<div class="rk-segrow">
								<div class="rk-segtop"><span class="rk-seglabel">{s.label}</span><span class="rk-segpct">{s.pct.toLocaleString('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span></div>
								<div class="rk-segbar"><div class="rk-segfill" style="width:{Math.max((s.pct / segMax) * 100, 1.5)}%; background:{s.color}"></div></div>
							</div>
						{/each}
						{#if shown.length === 0}<p class="rk-card-sub">Fără date</p>{/if}
					</div>
					<div class="rk-aud-more">{rest > 0 ? `+${rest} alte segmente` : 'Vezi detalii'}</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if modal}
	<div
		class="rk-modal-backdrop"
		role="button"
		tabindex="0"
		onclick={() => (modal = null)}
		onkeydown={(e) => e.key === 'Escape' && (modal = null)}>
		<div class="rk-modal" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
			<button class="rk-modal-x" onclick={() => (modal = null)}><X size={15} /></button>
			<div class="rk-modal-head"><h3>{modal.title}</h3><p>Distribuție cheltuieli pe {modal.subtitle}</p></div>
			<div class="rk-modal-chart">
				<svg viewBox="0 0 {MW} {MH}" preserveAspectRatio="xMinYMid meet" style="width:100%">
					{#each mTicks as t, i (i)}
						<line x1={mx(t)} y1={mPadT} x2={mx(t)} y2={mPadT + modalSegs.length * rowH} stroke="#eef1f6" />
						<text x={mx(t)} y={MH - 8} text-anchor="middle" class="rk-axis">{fmtCompact(t)} RON</text>
					{/each}
					{#each modalSegs as s, i (s.label)}
						{@const yy = mPadT + i * rowH}
						<text x={mPadL - 10} y={yy + rowH / 2 + 3} text-anchor="end" class="rk-modal-blabel">{s.label}</text>
						<rect x={mPadL} y={yy + 5} width={Math.max(mx(s.spend) - mPadL, 2)} height={rowH - 12} rx="3" fill={s.color} />
					{/each}
				</svg>
			</div>
			<div class="rk-modal-tablewrap">
				<table class="rk-modal-table">
					<thead><tr><th>Segment</th><th>Cheltuieli</th><th>Impresii</th><th>Click-uri</th><th>Rezultate</th><th>% Total</th></tr></thead>
					<tbody>
						{#each modalSegs as s (s.label)}
							<tr>
								<td><span class="rk-modal-dot" style="background:{s.color}"></span>{s.label}</td>
								<td>{formatCurrency(s.spend, cur)}</td>
								<td>{formatNumber(s.impressions)}</td>
								<td>{formatNumber(s.clicks)}</td>
								<td>{formatNumber(s.results)}</td>
								<td>{s.pct.toLocaleString('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
							</tr>
						{/each}
						<tr class="rk-modal-total">
							<td>Total</td>
							<td>{formatCurrency(modalTotals.spend, cur)}</td>
							<td>{formatNumber(modalTotals.impressions)}</td>
							<td>{formatNumber(modalTotals.clicks)}</td>
							<td>{formatNumber(modalTotals.results)}</td>
							<td>100%</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>
{/if}
