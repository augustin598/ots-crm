<script lang="ts">
	// Drawer per cuvânt cheie — port 1:1 din `RTKwDrawer` (rank-modals.jsx):
	// KPI mini, istoric 30 de zile (desktop + mobil), SERP-ul zilei, competitori,
	// tabelul rulărilor zilnice.
	import XIcon from '@lucide/svelte/icons/x';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import UsersIcon from '@lucide/svelte/icons/users';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';

	import PsiFav from '../pagespeed/PsiFav.svelte';
	import { psiDialog } from '../pagespeed/lib';
	import RtPos from './RtPos.svelte';
	import RtGain from './RtGain.svelte';
	import RtRankChart from './RtRankChart.svelte';
	import RtCompRow from './RtCompRow.svelte';
	import { ctrForPosition } from '$lib/logic/rank-tracker';
	import { RT_FEATURES, rtDays, rtLocaleLabel, rtNum, rtSerpLink } from './lib';
	import type { RankKeywordDetail } from '$lib/server/rank-tracker/projects-data';

	let {
		keyword,
		sibling,
		device,
		domain,
		name,
		locale,
		days,
		checkHour,
		searchDepth = 100,
		onclose,
		ondelete
	}: {
		keyword: RankKeywordDetail;
		sibling: RankKeywordDetail | null;
		device: 'desktop' | 'mobile';
		domain: string;
		name: string;
		locale: string;
		days: string[];
		checkHour: string;
		searchDepth?: number;
		onclose: () => void;
		ondelete: (id: string) => void;
	} = $props();

	const desktopRow = $derived(device === 'desktop' ? keyword : sibling);
	const mobileRow = $derived(device === 'mobile' ? keyword : sibling);
	const rtd = $derived(rtDays(days));

	const url = $derived(keyword.rankingUrl ?? keyword.targetUrl);
	// `competitorPositions` scrie o intrare pentru FIECARE competitor configurat, cu `null`
	// când nu e în top 10 — cazul obișnuit, nu excepția. Fără filtrare, `null - 5` sorta
	// competitorii absenți ÎNAINTEA poziției 1 și îi injecta în lista „SERP azi" cu numărul gol.
	const compsAll = $derived(Object.entries(keyword.competitors ?? {}) as [string, number | null][]);
	const comps = $derived(
		compsAll
			.filter((e): e is [string, number] => typeof e[1] === 'number')
			.sort((a, b) => a[1] - b[1])
	);
	const compsAbsent = $derived(compsAll.filter((e) => typeof e[1] !== 'number').map((e) => e[0]));
	/** Dispozitivul are date doar dacă proiectul îl urmărește; altfel coloana rămâne goală. */
	const hasDesktop = $derived(!!desktopRow);
	const hasMobile = $derived(!!mobileRow);

	const series = $derived(
		[
			desktopRow && { label: 'Desktop', color: '#1877F2', values: desktopRow.spark30 },
			mobileRow && { label: 'Mobil', color: '#8b5cf6', values: mobileRow.spark30, thin: true }
		].filter((s): s is { label: string; color: string; values: (number | null)[]; thin?: boolean } => !!s)
	);

	const selfDomain = $derived(domain.replace(/^www\./i, '').toLowerCase());
	/** Domeniile urmărite explicit ca fiind competitori, ca să le putem marca în listă. */
	const trackedDomains = $derived(
		new Set(compsAll.map(([d]) => d.replace(/^www\./i, '').toLowerCase()))
	);

	interface SerpRow {
		pos: number;
		dom: string;
		title: string;
		url: string;
		self: boolean;
		tracked: boolean;
	}

	/**
	 * SERP-ul de azi = prima pagină reală din snapshot (`topResults`), cu tot cu
	 * domeniile pe care nu le urmărim. Snapshoturile scrise înainte de coloana
	 * `top_results` nu o au, așa că pentru ele rămânem pe vechea reconstrucție din
	 * competitorii configurați — altfel drawerul ar arăta gol pentru istoricul deja
	 * colectat.
	 */
	const hasTopResults = $derived((keyword.topResults?.length ?? 0) > 0);
	const serp = $derived<SerpRow[]>(
		hasTopResults
			? keyword.topResults.map((r) => {
					const dom = r.domain.replace(/^www\./i, '').toLowerCase();
					const self = dom === selfDomain;
					return {
						pos: r.position,
						dom,
						title: r.title || (self ? name : dom),
						url: r.url || dom,
						self,
						tracked: !self && trackedDomains.has(dom)
					};
				})
			: [
					...comps.map(([dom, pos]) => ({
						pos,
						dom,
						title: dom,
						url: dom,
						self: false,
						tracked: true
					})),
					...(keyword.position != null
						? [
								{
									pos: keyword.position,
									dom: selfDomain,
									title: name,
									url: url ?? selfDomain,
									self: true,
									tracked: false
								}
							]
						: [])
				]
					.filter((r) => r.pos <= 10)
					.sort((a, b) => a.pos - b.pos)
	);

	/** Toată prima pagină în afară de noi — nu doar competitorii configurați. */
	const compRows = $derived(serp.filter((r) => !r.self));
	const maxVis = $derived(
		Math.max(ctrForPosition(keyword.position), ...compRows.map((r) => ctrForPosition(r.pos)), 0.1)
	);

	// ultimele 12 zile, cea mai recentă prima
	const rows = $derived.by(() => {
		const out: {
			key: string;
			full: string;
			d: number | null;
			dRan: boolean;
			dDelta: number | null;
			m: number | null;
			mRan: boolean;
			mDelta: number | null;
		}[] = [];
		for (let i = days.length - 1; i >= Math.max(0, days.length - 12); i--) {
			const d = desktopRow?.spark30[i] ?? null;
			const m = mobileRow?.spark30[i] ?? null;
			const dRan = desktopRow ? desktopRow.checked30[i] !== false : false;
			const mRan = mobileRow ? mobileRow.checked30[i] !== false : false;
			const dPrev = i > 0 ? (desktopRow?.spark30[i - 1] ?? null) : null;
			const mPrev = i > 0 ? (mobileRow?.spark30[i - 1] ?? null) : null;
			out.push({
				key: days[i],
				full: rtd[i]?.full ?? days[i],
				d,
				dRan,
				dDelta: d != null && dPrev != null ? dPrev - d : null,
				m,
				mRan,
				mDelta: m != null && mPrev != null ? mPrev - m : null
			});
		}
		return out;
	});
</script>

<div class="psi-drawer-back" onclick={onclose} role="presentation">
	<div
		class="psi-drawer rt-drawer"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			e.stopPropagation();
			if (e.key === 'Escape') onclose();
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		{@attach psiDialog}
		aria-label="Istoricul cuvântului cheie {keyword.keyword}"
	>
		<div class="psi-drawer-head">
			<PsiFav id={domain} {domain} url={`https://${domain}`} size={38} radius={10} fontSize={13} />
			<div style="min-width: 0">
				<div style="font-size: 16.5px; font-weight: 800; letter-spacing: -.01em; display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
					{keyword.keyword}
					{#if keyword.tag}<span class="rt-tag">{keyword.tag}</span>{/if}
				</div>
				<div style="font-size: 12px; color: var(--cl-text-3); margin-top: 3px">
					{domain} · {rtLocaleLabel(locale)}{keyword.location ? ` · ${keyword.location}` : ''} ·
					{device === 'mobile' ? 'mobil' : 'desktop'} ·
					volum {keyword.volume != null ? rtNum(keyword.volume) + '/lună' : '—'} · dificultate —
				</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>

		<div class="psi-drawer-body">
			<div class="rt-kpi-mini">
				<div class="rt-mini">
					<span>Poziție azi</span>
					<b>{keyword.position == null ? `${searchDepth}+` : '#' + keyword.position}</b>
					<em>
						{keyword.position == null
							? `negăsit în primele ${searchDepth}`
							: `pagina ${keyword.page} · ${rtd.length ? rtd[rtd.length - 1].short : ''}`}
					</em>
				</div>
				<div class="rt-mini">
					<span>7 zile</span>
					<b><RtGain value={keyword.delta7} /></b>
					<em>vs {rtd.length >= 8 ? rtd[rtd.length - 8].short : '—'}</em>
				</div>
				<div class="rt-mini">
					<span>30 zile</span>
					<b><RtGain value={keyword.delta30} /></b>
					<em>față de acum ~30 de zile</em>
				</div>
				<div class="rt-mini">
					<span>Cea mai bună</span>
					<b>{keyword.best == null ? '—' : '#' + keyword.best}</b>
					<em>în ultimele 30 de zile</em>
				</div>
			</div>

			<div class="cl-section">
				<div class="cl-section-head">
					<h3><TrendingUpIcon size={15} /> Istoric poziții · 30 de zile</h3>
					<p class="cl-section-sub" style="margin-left: auto">o rulare pe zi, {checkHour}</p>
				</div>
				<RtRankChart days={rtd} height={240} {series} />
			</div>

			{#if keyword.cannibalization.flagged}
				<div class="rt-note">
					<TriangleAlertIcon size={16} />
					<div>
						<div class="rt-note-t">Posibilă canibalizare</div>
						<div class="rt-note-s">
							Google a alternat între
							{#each keyword.cannibalization.urls as u, i (u)}{i > 0 ? ' și ' : ''}<code>{u}</code>{/each}
							în ultimele 30 de zile. Consolidează conținutul sau pune un canonical către pagina principală.
						</div>
					</div>
				</div>
			{/if}

			<!-- SERP-ul și competitorii stau unul sub altul: ambele liste au 10 rânduri,
			     iar pe două coloane se înghesuiau și se tăiau titlurile -->
			<div class="rt-stack">
				<div class="cl-section">
					<div class="cl-section-head">
						<h3><LayersIcon size={15} /> SERP azi</h3>
						{#if hasTopResults}
							<p class="cl-section-sub">prima pagină, așa cum a returnat-o Google</p>
						{/if}
						<a
							class="cl-btn-mini"
							style="margin-left: auto"
							href={rtSerpLink(keyword.keyword, locale)}
							target="_blank"
							rel="noreferrer"><ExternalLinkIcon size={11} /> Vezi în Google</a
						>
					</div>
					<div class="rt-serp">
						{#if keyword.features.includes('ads')}
							<div class="rt-serp-row feature">
								<span class="rt-serp-n">–</span>
								<div><div class="rt-serp-t">Anunțuri Google Ads (top)</div><div class="rt-serp-u">rezultate plătite deasupra organicului</div></div>
							</div>
						{/if}
						{#if keyword.aiOverview !== 'absent'}
							<div class="rt-serp-row feature">
								<span class="rt-serp-n">–</span>
								<div>
									<div class="rt-serp-t">AI Overview {keyword.aiOverview === 'cited' ? '· ne citează' : '· fără link către noi'}</div>
									<div class="rt-serp-u">
										{keyword.aiOverview === 'cited' ? (url ?? domain) : 'surse: ' + (comps.slice(0, 2).map(([d]) => d).join(', ') || '—')}
									</div>
								</div>
							</div>
						{/if}
						{#if keyword.features.includes('local')}
							<div class="rt-serp-row feature">
								<span class="rt-serp-n">–</span>
								<div><div class="rt-serp-t">Local pack</div><div class="rt-serp-u">{keyword.location || '—'}</div></div>
							</div>
						{/if}
						{#each serp as r (`${r.pos}:${r.dom}`)}
							<div class="rt-serp-row" class:self={r.self}>
								<span class="rt-serp-n">{r.pos}</span>
								<div style="min-width: 0">
									<div class="rt-serp-t">{r.title}</div>
									<div class="rt-serp-u">{r.url}</div>
								</div>
								{#if r.self}
									<span class="psi-tag info" style="margin-left: auto">noi</span>
								{:else if r.tracked}
									<span class="psi-tag" style="margin-left: auto">urmărit</span>
								{/if}
							</div>
						{/each}
						{#if keyword.features.includes('paa')}
							<div class="rt-serp-row feature">
								<span class="rt-serp-n">–</span>
								<div><div class="rt-serp-t">People also ask</div><div class="rt-serp-u">întrebări extinse</div></div>
							</div>
						{/if}
						{#if serp.length === 0 && keyword.features.length === 0 && keyword.aiOverview === 'absent'}
							<div class="rt-serp-row feature">
								<span class="rt-serp-n">–</span>
								<div><div class="rt-serp-t">Fără date SERP</div><div class="rt-serp-u">apar după prima rulare</div></div>
							</div>
						{/if}
					</div>
					<div style="display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap">
						{#each keyword.features as f (f)}
							{#if RT_FEATURES[f]}
								<span class="rt-tag" style="display: inline-flex; align-items: center; gap: 6px">
									<em style="width: 8px; height: 8px; border-radius: 2px; display: inline-block" style:background={RT_FEATURES[f].color}></em>
									{RT_FEATURES[f].label}
								</span>
							{/if}
						{/each}
					</div>
				</div>

				<div class="cl-section">
					<div class="cl-section-head">
						<h3><UsersIcon size={15} /> Competitori pe acest cuvânt</h3>
						<p class="cl-section-sub">
							{hasTopResults
								? 'toate domeniile din prima pagină, nu doar cele urmărite'
								: 'doar domeniile urmărite — SERP-ul complet apare după următoarea rulare'}
						</p>
					</div>
					<RtCompRow
						{domain}
						self
						pos={keyword.position}
						vis={Math.round(ctrForPosition(keyword.position) * 10) / 10}
						max={maxVis}
					/>
					{#each compRows as r (`${r.pos}:${r.dom}`)}
						<RtCompRow
							domain={r.dom}
							pos={r.pos}
							tracked={r.tracked}
							vis={Math.round(ctrForPosition(r.pos) * 10) / 10}
							max={maxVis}
						/>
					{/each}
					{#if compsAbsent.length}
						<p class="cl-hint">
							Urmăriți, dar în afara primei pagini azi: {compsAbsent.join(', ')}
						</p>
					{/if}
					{#if compRows.length === 0 && compsAbsent.length === 0}
						<p class="cl-hint">Niciun alt domeniu în SERP-ul de azi.</p>
					{/if}
				</div>

				<div class="cl-section">
					<div class="cl-section-head">
						<h3><TrendingUpIcon size={15} /> Search Console</h3>
						<p class="cl-section-sub">date raportate de Google, nu scrapate</p>
					</div>
					{#if keyword.gsc}
						<p class="cl-hint">
							{keyword.gsc.date}: {keyword.gsc.impressions} afișări · {keyword.gsc.clicks} clicuri ·
							CTR {keyword.gsc.ctr}% · poziție medie {keyword.gsc.position}
						</p>
						{#if keyword.gsc.trust === 'scrape-missing'}
							<p class="cl-hint">
								Google raportează afișări pentru acest cuvânt, dar rularea noastră nu a găsit
								site-ul. Verifică istoricul rulărilor — probabil au fost blocate.
							</p>
						{/if}
					{:else}
						<p class="cl-hint">
							Fără date — proiectul nu are proprietate Search Console legată, sau cuvântul nu a
							avut afișări în ultimele zile.
						</p>
					{/if}
				</div>
			</div>

			<div class="cl-section" style="padding: 0">
				<div class="cl-section-head" style="padding: 16px 20px 12px; margin-bottom: 0">
					<h3><CalendarDaysIcon size={15} /> Rulări zilnice</h3>
					<p class="cl-section-sub" style="margin-left: auto">ultimele 12 zile</p>
					<div class="cl-section-actions">
						<button class="cl-btn-mini" onclick={() => ondelete(keyword.id)}>
							<Trash2Icon size={11} /> Șterge cuvântul
						</button>
					</div>
				</div>
				<table class="cl-list-table">
					<thead>
						<tr><th>Ziua</th><th class="num">Desktop</th><th class="num">Δ</th><th class="num">Mobil</th><th class="num">Δ</th></tr>
					</thead>
					<tbody>
						{#each rows as r (r.key)}
							<tr style="cursor: default">
								<td>{r.full}</td>
								<td class="num">
									{#if !hasDesktop}<span class="iv-muted">neurmărit</span>{:else if !r.dRan}<span class="iv-muted">—</span>{:else}<RtPos pos={r.d} sm depth={searchDepth} />{/if}
								</td>
								<td class="num">{#if hasDesktop}<RtGain value={r.dDelta} />{:else}<span class="iv-muted">—</span>{/if}</td>
								<td class="num">
									{#if !hasMobile}<span class="iv-muted">neurmărit</span>{:else if !r.mRan}<span class="iv-muted">—</span>{:else}<RtPos pos={r.m} sm depth={searchDepth} />{/if}
								</td>
								<td class="num">{#if hasMobile}<RtGain value={r.mDelta} />{:else}<span class="iv-muted">—</span>{/if}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</div>
