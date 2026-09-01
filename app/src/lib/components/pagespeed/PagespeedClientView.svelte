<script lang="ts">
	// PageSpeed Insights — varianta READ-ONLY din portalul clientului.
	// Doar site-urile clientului din sesiune (scoping în +page.server.ts prin
	// buildPagespeedSites(tenantId, { clientId })); fără scanare/editare/setări.
	import './pagespeed.css';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import CheckCheckIcon from '@lucide/svelte/icons/check-check';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import SearchIcon from '@lucide/svelte/icons/search';

	import { psiScoreLevel, isoWeekKey, isoWeekInterval, type PsiStrategy } from '$lib/logic/pagespeed';
	import { psiFmtDateTime } from './lib';
	import PsiFav from './PsiFav.svelte';
	import PsiDonut from './PsiDonut.svelte';
	import PsiSpark from './PsiSpark.svelte';
	import PsiDelta from './PsiDelta.svelte';
	import PsiMetric from './PsiMetric.svelte';
	import PsiCwv from './PsiCwv.svelte';
	import PsiLine from './PsiLine.svelte';
	import PsiStratIcon from './PsiStratIcon.svelte';
	import type { PsiSiteRow } from './types';

	let {
		data
	}: {
		data: {
			lastScanAt: string | Date | null;
			trend: {
				weeks: { id: string; label: string }[];
				mobile: (number | null)[];
				desktop: (number | null)[];
			};
			sites: PsiSiteRow[];
		};
	} = $props();

	let strategy = $state<PsiStrategy>('mobile');

	const sites = $derived(data.sites.filter((s) => s.active));

	interface Row {
		site: PsiSiteRow;
		perf: number | null;
		delta: number | null;
		spark: number[];
		cwv: boolean | null;
	}
	const rows = $derived<Row[]>(
		sites.map((site) => {
			const d = site.data[strategy];
			const lastOk = d.lastOk;
			return {
				site,
				perf: lastOk?.performance ?? null,
				delta: d.delta,
				spark: d.spark,
				cwv: site.cwv
			};
		})
	);

	const avgOf = (get: (r: Row) => number | null): number | null => {
		const xs = rows.map(get).filter((v): v is number => v != null);
		return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
	};
	const avg = $derived(avgOf((r) => r.perf));
	const cwvPassCount = $derived(rows.filter((r) => r.cwv === true).length);
	const cwvKnownCount = $derived(rows.filter((r) => r.cwv != null).length);
	const currentWeekLabel = $derived(
		isoWeekInterval(data.trend.weeks[data.trend.weeks.length - 1]?.id ?? isoWeekKey(new Date()))
	);

	function psiLink(url: string): string {
		return `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}&form_factor=${strategy}`;
	}
</script>

<div class="cl-wrap" data-screen-label="PageSpeed Insights (portal)">
	<div class="cl-hero">
		<div>
			<h1>PageSpeed Insights</h1>
			<p>
				Performanța site-urilor tale, măsurată săptămânal ·
				{#if data.lastScanAt}ultima scanare: <strong>{psiFmtDateTime(data.lastScanAt)}</strong>{:else}în așteptarea primei scanări{/if}
			</p>
		</div>
		<div class="cl-hero-actions">
			<div class="psi-seg">
				{#each ['mobile', 'desktop'] as const as s (s)}
					<button class={strategy === s ? 'active' : ''} aria-pressed={strategy === s} onclick={() => (strategy = s)}>
						<PsiStratIcon strategy={s} />
						{s === 'mobile' ? 'Mobil' : 'Desktop'}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<div class="cl-hero" style="padding-top: 0; padding-bottom: 14px">
		<div class="cl-kpis" style="width: 100%; grid-template-columns: repeat(3, minmax(0, 1fr))">
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: var(--cl-accent-50); color: var(--cl-accent)"><PsiStratIcon {strategy} size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Scor mediu {strategy === 'mobile' ? 'mobil' : 'desktop'}</div>
					<div class="cl-kpi-val psi-{psiScoreLevel(avg)}">{avg ?? '—'}</div>
					<div class="cl-kpi-sub">săptămâna {currentWeekLabel}</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(16,185,129,.08); color: #10b981"><CheckCheckIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Trec Core Web Vitals</div>
					<div class="cl-kpi-val">
						{cwvPassCount}<span style="font-size: 15px; color: var(--cl-text-3); font-weight: 700"> / {cwvKnownCount}</span>
					</div>
					<div class="cl-kpi-sub">date reale CrUX, p75 mobil</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(100,116,139,.1); color: #64748b"><GlobeIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Site-uri monitorizate</div>
					<div class="cl-kpi-val">{sites.length}</div>
					<div class="cl-kpi-sub">{sites.reduce((n, s) => n + s.pages.length, 0)} URL-uri măsurate</div>
				</div>
			</div>
		</div>
	</div>

	<div class="psi-pad">
		<div class="cl-section" style="padding: 0">
			<div class="cl-section-head" style="padding: 16px 20px 12px; margin-bottom: 0">
				<h3><ActivityIcon size={15} /> Măsurători {strategy === 'mobile' ? 'mobil' : 'desktop'}</h3>
				<p class="cl-section-sub" style="margin-left: auto">scanare săptămânală automată</p>
			</div>
			<div class="psi-table-scroll">
				<table class="cl-list-table">
					<thead>
						<tr>
							<th>Site</th>
							<th class="num">Scor</th>
							<th class="num">Δ 7 zile</th>
							<th class="num">10 săptămâni</th>
							<th class="num">LCP</th>
							<th class="num">INP</th>
							<th class="num">CLS</th>
							<th class="num">TBT</th>
							<th>Core Web Vitals</th>
							<th class="num">Raport</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as r (r.site.id)}
							{@const lastOk = r.site.data[strategy].lastOk}
							<tr style="cursor: default">
								<td>
									<div class="psi-site">
										<PsiFav id={r.site.id} domain={r.site.domain} url={r.site.pages[0]?.url} />
										<div style="min-width: 0">
											<div class="psi-site-l1">{r.site.domain}</div>
											<div class="psi-site-l2">{r.site.name} · {r.site.pages.length} URL</div>
										</div>
									</div>
								</td>
								<td class="num">
									<div style="display: flex; justify-content: flex-end"><PsiDonut value={r.perf} size={38} /></div>
								</td>
								<td class="num"><PsiDelta value={r.delta} suffix=" pct" /></td>
								<td class="num"><div style="display: flex; justify-content: flex-end"><PsiSpark values={r.spark} /></div></td>
								<td class="num">{#if lastOk}<PsiMetric k="lcp" v={lastOk.lcpMs} />{:else}<span style="color: var(--cl-text-3)">—</span>{/if}</td>
								<td class="num">{#if lastOk}<PsiMetric k="inp" v={lastOk.inpMs} />{:else}<span style="color: var(--cl-text-3)">—</span>{/if}</td>
								<td class="num">{#if lastOk}<PsiMetric k="cls" v={lastOk.cls} />{:else}<span style="color: var(--cl-text-3)">—</span>{/if}</td>
								<td class="num">{#if lastOk}<PsiMetric k="tbt" v={lastOk.tbtMs} />{:else}<span style="color: var(--cl-text-3)">—</span>{/if}</td>
								<td><PsiCwv pass={r.cwv} /></td>
								<td class="num">
									<div style="display: flex; justify-content: flex-end">
										<a
											class="cl-icon-btn"
											title="Deschide în PageSpeed Insights"
											aria-label="Raport PageSpeed pentru {r.site.domain}"
											href={psiLink(r.site.pages[0]?.url ?? `https://${r.site.domain}/`)}
											target="_blank"
											rel="noreferrer"
										>
											<ExternalLinkIcon size={13} />
										</a>
									</div>
								</td>
							</tr>
						{:else}
							<tr style="cursor: default">
								<td colspan="10">
									<div class="cl-empty" style="padding: 40px 0; border: 0; background: transparent">
										<SearchIcon size={20} />
										<h3>Niciun site monitorizat</h3>
										<p>Site-urile companiei tale vor apărea aici după prima scanare.</p>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<div class="psi-pad" style="padding: 14px 28px 60px">
		<div class="cl-section">
			<div class="cl-section-head">
				<h3><TrendingUpIcon size={15} /> Evoluția scorului mediu</h3>
				<p class="cl-section-sub" style="margin-left: auto">o măsurătoare pe săptămână, pe site-urile tale</p>
			</div>
			{#if data.trend.weeks.length > 1 && (data.trend.mobile.some((v) => v != null) || data.trend.desktop.some((v) => v != null))}
				<PsiLine
					weeks={data.trend.weeks}
					height={210}
					series={[
						{ label: 'Medie mobil', color: '#1877F2', values: data.trend.mobile },
						{ label: 'Medie desktop', color: '#8b5cf6', values: data.trend.desktop }
					]}
				/>
			{:else}
				<div class="cl-budget-empty" style="padding: 30px 0; text-align: center">
					Graficul apare după primele măsurători săptămânale.
				</div>
			{/if}
		</div>
	</div>
</div>
