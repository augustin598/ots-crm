<script lang="ts">
	// Vedere read-only pentru portalul clientului: pozițiile proiectelor sale.
	import '../pagespeed/pagespeed.css';
	import './rank-tracker.css';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import PsiFav from '../pagespeed/PsiFav.svelte';
	import PsiDelta from '../pagespeed/PsiDelta.svelte';
	import RtDist from './RtDist.svelte';
	import type { RankProjectsData } from '$lib/server/rank-tracker/projects-data';

	let { data }: { data: RankProjectsData } = $props();
	const nf = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 1 });
	const projects = $derived(data.projects.filter((p) => p.active));
</script>

<div class="cl-wrap" data-screen-label="Rank Tracker">
	<div class="cl-hero">
		<div class="cl-hero-main">
			<h1 class="cl-hero-title">Poziții Google</h1>
			<p class="cl-hero-sub">Evoluția pozițiilor organice pentru site-urile tale, actualizată zilnic.</p>
		</div>
	</div>

	<div class="cl-kpis">
		<div class="cl-kpi"><div class="cl-kpi-val">{data.totals.projectCount}</div><div class="cl-kpi-lbl">Proiecte</div></div>
		<div class="cl-kpi"><div class="cl-kpi-val">{data.totals.keywordCount}</div><div class="cl-kpi-lbl">Cuvinte cheie</div></div>
		<div class="cl-kpi"><div class="cl-kpi-val">{nf.format(data.totals.avgVisibility)}%</div><div class="cl-kpi-lbl">Vizibilitate medie</div></div>
	</div>

	<div class="cl-section">
		{#if projects.length === 0}
			<div class="cl-empty"><TrendingUpIcon size={28} /><p>Nu există încă proiecte de urmărire a pozițiilor.</p></div>
		{:else}
			<div class="psi-table-scroll">
				<table class="cl-list-table">
					<thead><tr><th>Domeniu</th><th>Cuvinte</th><th>Vizibilitate</th><th>Poz. medie</th><th>Distribuție</th></tr></thead>
					<tbody>
						{#each projects as p (p.id)}
							<tr>
								<td>
									<span class="cl-cell-link">
										<PsiFav id={p.id} domain={p.domain} url={`https://${p.domain}`} />
										<span>{p.domain}</span>
									</span>
								</td>
								<td>{p.keywordCount}</td>
								<td>
									{nf.format(p.visibility)}%
									{#if p.deltaVisibility != null && p.deltaVisibility !== 0}<PsiDelta value={p.deltaVisibility} suffix=" pct" />{/if}
								</td>
								<td>{p.avgPosition != null ? nf.format(p.avgPosition) : '—'}</td>
								<td><RtDist buckets={p.distribution} total={p.keywordCount} compact /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
