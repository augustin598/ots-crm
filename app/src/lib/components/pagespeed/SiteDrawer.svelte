<script lang="ts">
	// Drawer detaliu site — port 1:1 din design (PSIDrawer), cu date reale din istoric.
	import XIcon from '@lucide/svelte/icons/x';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import UsersIcon from '@lucide/svelte/icons/users';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import LinkIcon from '@lucide/svelte/icons/link';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import PsiDonut from './PsiDonut.svelte';
	import PsiDelta from './PsiDelta.svelte';
	import PsiCwv from './PsiCwv.svelte';
	import PsiLine from './PsiLine.svelte';
	import PsiStratIcon from './PsiStratIcon.svelte';
	import { getPagespeedSiteHistory } from '$lib/remotes/pagespeed.remote';
	import {
		PSI_THRESHOLDS,
		cwvPass,
		isoWeekLabel,
		psiFmt,
		psiMetricLevel,
		type PsiMetricKey,
		type PsiStrategy
	} from '$lib/logic/pagespeed';
	import { PSI_LVL, psiDialog, psiFmtDate, psiFmtDateTime } from './lib';
	import PsiFav from './PsiFav.svelte';
	import type { PsiMeasurement, PsiSiteRow } from './types';

	let {
		site,
		strategy: initialStrategy,
		scanning = false,
		onclose,
		onrescan
	}: {
		site: PsiSiteRow;
		strategy: PsiStrategy;
		scanning?: boolean;
		onclose: () => void;
		onrescan: (siteId: string) => void;
	} = $props();

	// Doar valoarea inițială e preluată din prop; segmentul din drawer controlează apoi strategia.
	// svelte-ignore state_referenced_locally
	let strategy = $state<PsiStrategy>(initialStrategy);

	const historyQuery = $derived(getPagespeedSiteHistory(site.id));
	const history = $derived(historyQuery.current);

	const rows = $derived.by<PsiMeasurement[]>(() => {
		if (!history) return [];
		return (strategy === 'mobile' ? history.mobile : history.desktop) as PsiMeasurement[];
	});
	const okRows = $derived(rows.filter((r) => r.status === 'ok'));
	const last = $derived(okRows[okRows.length - 1] ?? null);
	const prev = $derived(okRows.length > 1 ? okRows[okRows.length - 2] : null);
	const lastAny = $derived(rows[rows.length - 1] ?? null);

	const field = $derived(
		last && last.fieldLcpMs != null
			? { lcpMs: last.fieldLcpMs, inpMs: last.fieldInpMs, cls: last.fieldCls }
			: null
	);
	const cwv = $derived(cwvPass(field));
	const opportunities = $derived(last?.opportunities ?? []);

	const labRows = $derived.by(() => {
		if (!last) return [];
		const defs: { k: PsiMetricKey; v: number | null; max: number }[] = [
			{ k: 'lcp', v: last.lcpMs, max: 6000 },
			{ k: 'fcp', v: last.fcpMs, max: 5000 },
			{ k: 'tbt', v: last.tbtMs, max: 1200 },
			{ k: 'si', v: last.speedIndexMs, max: 9000 },
			{ k: 'cls', v: last.cls, max: 0.5 }
		];
		return defs.map((r) => {
			const prevV = prev ? (r.k === 'si' ? prev.speedIndexMs : r.k === 'cls' ? prev.cls : prev[`${r.k}Ms` as 'lcpMs' | 'fcpMs' | 'tbtMs']) : null;
			return {
				...r,
				lvl: psiMetricLevel(r.k, r.v),
				pct: r.v == null ? 0 : Math.max(4, Math.min(100, (r.v / r.max) * 100)),
				dv: r.v != null && prevV != null ? r.v - prevV : null
			};
		});
	});

	const chartWeeks = $derived(
		okRows.map((r) => ({ id: r.id, label: isoWeekLabel(r.weekKey) }))
	);
	const chartValues = $derived(okRows.map((r) => r.performance));

	function psiLink(url: string): string {
		return `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}&form_factor=${strategy}`;
	}
</script>

<div class="psi-drawer-back" onclick={onclose} role="presentation">
	<div
		class="psi-drawer"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			e.stopPropagation();
			if (e.key === 'Escape') onclose();
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		{@attach psiDialog}
		aria-label="Detalii {site.domain}"
	>
		<div class="psi-drawer-head">
			<PsiFav id={site.id} domain={site.domain} url={site.pages[0]?.url} size={40} radius={11} fontSize={14} />
			<div style="min-width: 0">
				<div style="display: flex; align-items: center; gap: 8px">
					<h3 style="margin: 0; font-size: 17px; font-weight: 800; letter-spacing: -.02em">{site.domain}</h3>
					{#if !site.active}<span class="psi-tag">în pauză</span>{/if}
					<span class="psi-tag info">{site.cms}</span>
				</div>
				<div class="psi-site-l2" style="max-width: 420px">
					{site.clientName ?? 'fără client'} · {site.pages.length}
					{site.pages.length === 1 ? 'pagină' : 'pagini'} testate · adăugat {psiFmtDate(site.createdAt)}
				</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>

		<div class="psi-drawer-body">
			<div style="display: flex; align-items: center; gap: 10px">
				<div class="psi-seg">
					{#each ['mobile', 'desktop'] as const as s (s)}
						<button class={strategy === s ? 'active' : ''} onclick={() => (strategy = s)}>
							<PsiStratIcon strategy={s} />
							{s === 'mobile' ? 'Mobil' : 'Desktop'}
						</button>
					{/each}
				</div>
				<div style="margin-left: auto; display: flex; gap: 8px">
					<button class="cl-btn-secondary cl-btn-sm" onclick={() => onrescan(site.id)} disabled={scanning}>
						<RefreshCwIcon size={12} /> Rescanează
					</button>
					<a class="cl-btn-secondary cl-btn-sm" href={psiLink(site.pages[0]?.url ?? `https://${site.domain}/`)} target="_blank" rel="noreferrer">
						<ExternalLinkIcon size={12} /> PageSpeed Insights
					</a>
				</div>
			</div>

			{#if historyQuery.loading && !history}
				<div class="cl-section"><div class="cl-budget-empty" style="padding: 26px 0">Se încarcă istoricul…</div></div>
			{:else if historyQuery.error}
				<div class="cl-section">
					<div class="psi-mail-alert" style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
						<b style="margin: 0">Istoricul nu a putut fi încărcat.</b>
						<button class="cl-btn-secondary cl-btn-sm" onclick={() => historyQuery.refresh()}>
							<RefreshCwIcon size={12} /> Reîncearcă
						</button>
					</div>
				</div>
			{:else if !last}
				<div class="cl-section">
					<div class="cl-budget-empty" style="padding: 26px 0">
						Site adăugat, fără scanare încă. Prima măsurătoare rulează la următorul raport săptămânal.
					</div>
					{#if lastAny?.status === 'failed'}
						<div class="psi-mail-alert" style="margin-top: 4px">
							<b><TriangleAlertIcon size={13} style="vertical-align: -2px" /> Ultima scanare a eșuat</b>
							{lastAny.errorMessage ?? 'eroare necunoscută'}
						</div>
					{/if}
				</div>
			{:else}
				{#if lastAny?.status === 'failed'}
					<div class="psi-mail-alert">
						<b>Ultima scanare a eșuat — se afișează măsurătoarea anterioară</b>
						{lastAny.errorMessage ?? 'eroare necunoscută'}
					</div>
				{/if}

				<div class="cl-section">
					<div class="cl-section-head">
						<h3><ActivityIcon size={15} /> Scoruri Lighthouse</h3>
						<p class="cl-section-sub" style="margin-left: auto">scanat {psiFmtDateTime(last.measuredAt)}</p>
					</div>
					<div class="psi-scores">
						{#each [
							{ lbl: 'Performance', v: last.performance },
							{ lbl: 'Accesibilitate', v: last.accessibility },
							{ lbl: 'Bune practici', v: last.bestPractices },
							{ lbl: 'SEO', v: last.seo }
						] as c (c.lbl)}
							<div class="psi-score-card">
								<PsiDonut value={c.v} size={62} stroke={6} />
								<div class="psi-score-lbl">{c.lbl}</div>
								{#if c.lbl === 'Performance' && prev && last.performance != null && prev.performance != null}
									<PsiDelta value={last.performance - prev.performance} suffix=" pct" />
								{/if}
							</div>
						{/each}
					</div>
				</div>

				<div class="cl-section">
					<div class="cl-section-head">
						<h3><ClockIcon size={15} /> Metrici de laborator</h3>
						<p class="cl-section-sub" style="margin-left: auto">
							{strategy === 'mobile' ? 'emulare Moto G Power · 4G lent' : 'desktop · conexiune cablu'}
						</p>
					</div>
					<div class="psi-mrows">
						{#each labRows as r (r.k)}
							<div class="psi-mrow">
								<span class="sq psi-sq-{r.lvl}" style="width: 10px; height: 10px; border-radius: 3px"></span>
								<div>
									<div class="psi-mrow-name">{PSI_THRESHOLDS[r.k].label} — {PSI_THRESHOLDS[r.k].name}</div>
									<div class="psi-mrow-sub">
										bun ≤ {psiFmt(r.k, PSI_THRESHOLDS[r.k].good)} · de îmbunătățit ≤ {psiFmt(r.k, PSI_THRESHOLDS[r.k].ni)}
									</div>
								</div>
								<div class="psi-mrow-val psi-{r.lvl}">{psiFmt(r.k, r.v)}</div>
								<div>
									<div class="psi-mrow-scale"><i style:width="{r.pct}%" style:background={PSI_LVL[r.lvl]}></i></div>
									<div class="psi-mrow-sub" style="text-align: right">
										{r.dv == null || Math.abs(r.dv) < 0.001
											? ''
											: `${r.dv > 0 ? '+' : '−'}${psiFmt(r.k, Math.abs(r.dv))} vs precedenta`}
									</div>
								</div>
							</div>
						{/each}
						<div class="psi-mrow">
							<span class="sq psi-sq-none" style="width: 10px; height: 10px; border-radius: 3px"></span>
							<div>
								<div class="psi-mrow-name">TTFB · greutate pagină</div>
								<div class="psi-mrow-sub">{last.requestCount ?? '—'} cereri de rețea</div>
							</div>
							<div class="psi-mrow-val">{last.ttfbMs != null ? `${last.ttfbMs} ms` : '—'}</div>
							<div class="psi-mrow-sub" style="text-align: right">
								{last.totalBytes != null
									? `${(last.totalBytes / 1_000_000).toFixed(1).replace('.', ',')} MB transferați`
									: '—'}
							</div>
						</div>
					</div>
				</div>

				<div class="cl-section">
					<div class="cl-section-head">
						<h3><UsersIcon size={15} /> Date reale de la utilizatori (CrUX, p75 / 28 zile)</h3>
						<div class="cl-section-actions"><PsiCwv pass={cwv} /></div>
					</div>
					{#if !field}
						<div class="cl-budget-empty" style="padding: 16px 0">
							Volum insuficient de trafic pentru raportul Chrome UX pe {strategy === 'mobile' ? 'mobil' : 'desktop'}.
							Rămân valabile doar metricile de laborator.
						</div>
					{:else}
						<div class="psi-mrows">
							{#each [
								{ k: 'lcp' as const, v: field.lcpMs },
								{ k: 'inp' as const, v: field.inpMs },
								{ k: 'cls' as const, v: field.cls }
							] as m (m.k)}
								{@const lvl = psiMetricLevel(m.k, m.v)}
								<div class="psi-mrow" style="grid-template-columns: 12px 1fr 92px 120px">
									<span class="sq psi-sq-{lvl}" style="width: 10px; height: 10px; border-radius: 3px"></span>
									<div>
										<div class="psi-mrow-name">{PSI_THRESHOLDS[m.k].label} — {PSI_THRESHOLDS[m.k].name}</div>
										<div class="psi-mrow-sub">prag Core Web Vitals: ≤ {psiFmt(m.k, PSI_THRESHOLDS[m.k].good)}</div>
									</div>
									<div class="psi-mrow-val psi-{lvl}">{psiFmt(m.k, m.v)}</div>
									<div class="psi-mrow-sub" style="text-align: right">
										{lvl === 'good' ? 'trece pragul' : lvl === 'ni' ? 'de îmbunătățit' : 'sub prag'}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				{#if opportunities && opportunities.length > 0}
					<div class="cl-section">
						<div class="cl-section-head">
							<h3><ZapIcon size={15} /> Oportunități de optimizare</h3>
							<p class="cl-section-sub" style="margin-left: auto">economie estimată de PageSpeed</p>
						</div>
						{#each opportunities as o (o.id)}
							<div class="psi-opp">
								<span>{o.title}</span>
								<span class="psi-opp-save psi-ni">−{(o.savingsMs / 1000).toFixed(2).replace('.', ',')} s</span>
							</div>
						{/each}
					</div>
				{/if}

				{#if chartValues.length > 1}
					<div class="cl-section">
						<div class="cl-section-head"><h3><TrendingUpIcon size={15} /> Evoluția scorului</h3></div>
						<PsiLine
							weeks={chartWeeks}
							height={180}
							series={[
								{
									label: strategy === 'mobile' ? 'Performance mobil' : 'Performance desktop',
									color: '#1877F2',
									values: chartValues
								}
							]}
						/>
					</div>
				{/if}

				<div class="cl-section">
					<div class="cl-section-head">
						<h3><LinkIcon size={15} /> Pagini incluse în scanare</h3>
						<p class="cl-section-sub" style="margin-left: auto">scorul se măsoară pe pagina principală</p>
					</div>
					{#each site.pages as p, i (p.url)}
						<div class="psi-page-row">
							<PsiDonut value={i === 0 ? (last.performance ?? null) : null} size={30} stroke={3} />
							<span class="psi-page-lbl">{p.label}</span>
							<span class="psi-page-url">{p.url}</span>
							<a class="cl-btn-mini" style="margin-left: auto" href={psiLink(p.url)} target="_blank" rel="noreferrer">
								<ExternalLinkIcon size={11} /> testează
							</a>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
