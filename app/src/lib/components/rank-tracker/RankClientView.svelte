<script lang="ts">
	// Vedere READ-ONLY pentru portalul clientului: pozițiile proiectelor sale.
	// Scoping-ul pe client se face în SQL (`buildRankProjects(tenantId, { clientId })`),
	// nu aici. Structura urmează 1:1 pagina soră din portal (PagespeedClientView):
	// hero → KPI-uri → tabel → grafic + distribuție, ca cele două module SEO din portal
	// să arate la fel.
	import '../pagespeed/pagespeed.css';
	import './rank-tracker.css';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import TargetIcon from '@lucide/svelte/icons/target';
	import StarIcon from '@lucide/svelte/icons/star';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import SearchIcon from '@lucide/svelte/icons/search';
	import BarChart3Icon from '@lucide/svelte/icons/chart-bar';

	import PsiFav from '../pagespeed/PsiFav.svelte';
	import PsiDelta from '../pagespeed/PsiDelta.svelte';
	import RtDist from './RtDist.svelte';
	import RtVis from './RtVis.svelte';
	import RtRankChart from './RtRankChart.svelte';
	import { rtDays, rtUpdatedLabel } from './lib';
	import type { RankProjectsData } from '$lib/server/rank-tracker/projects-data';

	let { data }: { data: RankProjectsData } = $props();
	const nf = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 1 });

	// Aceeași condiție ca la agregatele din read model (`activeRows`), ca KPI-urile să fie
	// exact suma rândurilor din tabel. Cele mai vizibile primele — clientul vrea să vadă
	// întâi site-ul care merge, nu ordinea alfabetică a domeniilor.
	const projects = $derived(
		data.projects.filter((p) => p.active && !p.paused).sort((a, b) => b.visibility - a.visibility)
	);
	const depth = $derived(data.searchDepth);
	const counts = $derived(data.totals.counts);
	const trackedKeywords = $derived(projects.reduce((a, p) => a + p.keywordCount, 0));
	const moves = $derived({
		up: projects.reduce((a, p) => a + p.upToday, 0),
		down: projects.reduce((a, p) => a + p.downToday, 0)
	});
	const days = $derived(rtDays(data.trend.days));
	const hasTrend = $derived(days.length > 1 && data.trend.avgPosition.some((v) => v != null));
	const avgSeries = $derived([
		{ label: 'Poziție medie', color: '#1877F2', values: data.trend.avgPosition }
	]);
	// Distribuția întregului portofoliu (suma bucketelor proiectelor afișate).
	const portfolioDist = $derived.by(() => {
		const out = { '1-3': 0, '4-10': 0, '11-20': 0, '21-50': 0, '51-100': 0, '100+': 0 };
		for (const p of projects) {
			for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] += p.distribution[k] ?? 0;
		}
		return out;
	});
</script>

<div class="cl-wrap" data-screen-label="Rank Tracker (portal)">
	<div class="cl-hero">
		<div>
			<h1>Poziții Google</h1>
			<p>
				<strong>{trackedKeywords}</strong>
				{trackedKeywords === 1 ? 'cuvânt cheie' : 'cuvinte cheie'} pe
				<strong>{projects.length}</strong>
				{projects.length === 1 ? 'site' : 'site-uri'} · verificare zilnică automată ·
				{#if data.lastRunAt}
					ultima actualizare <strong>{rtUpdatedLabel(data.lastRunAt)}</strong>
				{:else}
					în așteptarea primei verificări
				{/if}
			</p>
		</div>
	</div>

	<div class="cl-hero" style="padding-top: 0; padding-bottom: 14px">
		<div class="cl-kpis" style="width: 100%; grid-template-columns: repeat(5, minmax(0, 1fr))">
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: var(--cl-accent-50); color: var(--cl-accent)">
					<EyeIcon size={16} />
				</div>
				<div>
					<div class="cl-kpi-lbl">Vizibilitate</div>
					<div class="cl-kpi-val">{nf.format(data.totals.avgVisibility)}%</div>
					<div class="cl-kpi-sub">estimare din CTR</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(139,92,246,.08); color: #8b5cf6">
					<TargetIcon size={16} />
				</div>
				<div>
					<div class="cl-kpi-lbl">Poziție medie</div>
					<div class="cl-kpi-val">
						{data.totals.avgPosition != null ? nf.format(data.totals.avgPosition) : '—'}
					</div>
					<div class="cl-kpi-sub">{counts.ranked} din {trackedKeywords} clasate</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(16,185,129,.08); color: #10b981">
					<StarIcon size={16} />
				</div>
				<div>
					<div class="cl-kpi-lbl">În primele 5</div>
					<div class="cl-kpi-val">
						<!-- &nbsp;: Svelte taie spațiul de la începutul conținutului unui element -->
						{counts.top5}<span style="font-size: 15px; color: var(--cl-text-3); font-weight: 700"
							>&nbsp;/ {trackedKeywords}</span
						>
					</div>
					<div class="cl-kpi-sub">{counts.top10} în primele 10</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(16,185,129,.08); color: #10b981">
					<TrendingUpIcon size={16} />
				</div>
				<div>
					<div class="cl-kpi-lbl">Mișcări azi</div>
					<div class="cl-kpi-val">
						{moves.up}<span style="font-size: 15px; color: var(--cl-text-3); font-weight: 700"
							>&nbsp;↑ / {moves.down} ↓</span
						>
					</div>
					<div class="cl-kpi-sub">față de ziua precedentă</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(245,158,11,.08); color: #f59e0b">
					<ClockIcon size={16} />
				</div>
				<div>
					<div class="cl-kpi-lbl">Ultima actualizare</div>
					<div class="cl-kpi-val" style="font-size: 17px">
						{data.lastRunAt ? rtUpdatedLabel(data.lastRunAt) : '—'}
					</div>
					<div class="cl-kpi-sub">căutăm în primele {depth}</div>
				</div>
			</div>
		</div>
	</div>

	<div class="rt-pad">
		<div class="cl-section">
			<div class="cl-section-head">
				<h3><BarChart3Icon size={15} /> Distribuția pozițiilor</h3>
				<p class="cl-section-sub" style="margin-left: auto">
					{trackedKeywords} cuvinte urmărite pe {projects.length}
					{projects.length === 1 ? 'site' : 'site-uri'}
				</p>
			</div>
			<RtDist buckets={portfolioDist} total={trackedKeywords} {depth} />
			<p class="cl-hint" style="margin-top: 14px">
				Un cuvânt „peste {depth}" nu a fost găsit în primele {depth} rezultate căutate — nu
				înseamnă că site-ul nu apare deloc, doar că e mai jos decât căutăm noi.
			</p>
		</div>
	</div>

	<div class="rt-pad" style="padding-top: 14px">
		<div class="cl-section" style="padding: 0">
			<div class="cl-section-head" style="padding: 16px 20px 12px; margin-bottom: 0">
				<h3><TargetIcon size={15} /> Site-urile tale</h3>
				<p class="cl-section-sub" style="margin-left: auto">
					pozițiile organice pe Google, pe desktop
				</p>
			</div>
			<div class="rt-table-scroll rt-client-table">
				<table class="cl-list-table">
					<thead>
						<tr>
							<th>Domeniu</th>
							<th class="num">Cuvinte</th>
							<th class="num" title="Cuvinte aflate pe primele 5 poziții din Google">Top 5</th>
							<th class="num" title="Cuvinte aflate pe prima pagină Google (primele 10)">
								Top 10
							</th>
							<th class="num" title="Cuvinte găsite în primele {depth} rezultate căutate">
								Top {depth}
							</th>
							<th>Vizibilitate</th>
							<th class="num" title="Media pozițiilor cuvintelor clasate">Poz. medie</th>
							<th class="num" title="Când s-a făcut ultima verificare pentru acest site">
								Verificat
							</th>
						</tr>
					</thead>
					<tbody>
						{#each projects as p (p.id)}
							<tr style="cursor: default">
								<td>
									<div class="psi-site">
										<PsiFav id={p.id} domain={p.domain} url={`https://${p.domain}`} />
										<div style="min-width: 0">
											<div class="psi-site-l1">{p.domain}</div>
											<div class="psi-site-l2">{p.name}</div>
										</div>
									</div>
								</td>
								<td class="num">{p.keywordCount}</td>
								<td class="num" style="font-weight: 700">
									{#if p.counts.top5}{p.counts.top5}{:else}<span class="iv-muted">0</span>{/if}
								</td>
								<td class="num" style="font-weight: 700">
									{#if p.counts.top10}{p.counts.top10}{:else}<span class="iv-muted">0</span>{/if}
								</td>
								<td class="num">
									{#if p.counts.ranked}{p.counts.ranked}{:else}<span class="iv-muted">0</span>{/if}
								</td>
								<td>
									<div style="display: flex; align-items: center; gap: 8px">
										<RtVis pct={p.visibility} />
										{#if p.deltaVisibility != null && p.deltaVisibility !== 0}
											<PsiDelta value={p.deltaVisibility} suffix=" pct" />
										{/if}
									</div>
								</td>
								<td class="num" style="font-weight: 800">
									{p.avgPosition != null ? nf.format(p.avgPosition) : '—'}
								</td>
								<td class="num">
									{#if p.lastRunAt}
										<span style="color: var(--cl-text-3)">{rtUpdatedLabel(p.lastRunAt)}</span>
									{:else}
										<span class="iv-muted">—</span>
									{/if}
								</td>
							</tr>
						{:else}
							<tr style="cursor: default">
								<td colspan="8">
									<div class="cl-empty" style="padding: 40px 0; border: 0; background: transparent">
										<SearchIcon size={20} />
										<h3>Niciun site în monitorizare</h3>
										<p>
											Nu urmărim încă poziții pentru contul tău. Scrie-ne ce cuvinte cheie te
											interesează și le adăugăm.
										</p>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<!-- grafic și distribuție pe RÂNDURI separate, nu în două coloane: cardul de
	     distribuție e mult mai scund decât graficul și lăsa un gol mare în dreapta -->

	<div class="rt-pad" style="padding: 14px 28px 60px">
		<div class="cl-section">
			<div class="cl-section-head">
				<h3><TrendingUpIcon size={15} /> Evoluția poziției medii · 30 de zile</h3>
				<p class="cl-section-sub" style="margin-left: auto">
					o verificare pe zi, media cuvintelor tale
				</p>
			</div>
			{#if hasTrend}
				<RtRankChart {days} height={170} series={avgSeries} {depth} />
			{:else}
				<div class="cl-budget-empty" style="padding: 30px 0; text-align: center">
					Graficul apare după primele verificări zilnice.
				</div>
			{/if}
		</div>
	</div>
</div>
