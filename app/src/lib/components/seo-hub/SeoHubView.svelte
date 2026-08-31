<script lang="ts">
	// Hub „SEO & GEO & AEO" — agregă Linkuri SEO + PageSpeed + Content per website.
	// Refolosește integral vocabularul vizual PageSpeed (cl-*/psi-*) + sh-* minimal.
	import '../pagespeed/pagespeed.css';
	import './seo-hub.css';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import LinkIcon from '@lucide/svelte/icons/link';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import BotIcon from '@lucide/svelte/icons/bot';
	import NewspaperIcon from '@lucide/svelte/icons/newspaper';

	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { psiScoreLevel } from '$lib/logic/pagespeed';
	import { psiFmtDateTime } from '../pagespeed/lib';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import { recalculateContentScores } from '$lib/remotes/content-articles.remote';
	import { createClientWebsite } from '$lib/remotes/client-websites.remote';
	import PsiFav from '../pagespeed/PsiFav.svelte';
	import PsiDonut from '../pagespeed/PsiDonut.svelte';
	import PsiSpark from '../pagespeed/PsiSpark.svelte';
	import PsiDelta from '../pagespeed/PsiDelta.svelte';
	import PsiCwv from '../pagespeed/PsiCwv.svelte';
	import PsiLine from '../pagespeed/PsiLine.svelte';
	import ShGauge from './ShGauge.svelte';
	import ShBars from './ShBars.svelte';
	import ShAddWebsiteModal from './ShAddWebsiteModal.svelte';
	import type { SeoHubData } from './types';

	let { data }: { data: SeoHubData } = $props();

	const base = $derived(`/${page.params.tenant}`);
	const nf = new Intl.NumberFormat('ro-RO');

	// ---- stare UI ----
	let tab = $state<'all' | 'attention' | 'with-articles'>('all');
	let q = $state('');
	let clientF = $state('all');
	let sort = $state<'overall' | 'seo' | 'pagespeed' | 'articles' | 'domain'>('overall');
	let recalculating = $state(false);
	let addingWebsite = $state(false);
	let showAdd = $state(false);
	let toast = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	function showToast(message: string) {
		toast = message;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	// ---- agregate din load ----
	const websites = $derived(data.websites);
	const attention = $derived(websites.filter((w) => w.needsAttention));
	const withArticles = $derived(websites.filter((w) => w.articles.total > 0));

	const avgOf = (get: (w: (typeof websites)[number]) => number | null): number | null => {
		const xs = websites.map(get).filter((v): v is number => v != null);
		return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
	};
	const avgOverall = $derived(avgOf((w) => w.scores.overall));
	const avgSeo = $derived(avgOf((w) => w.scores.seo));
	const avgAeo = $derived(avgOf((w) => w.scores.aeo));
	const avgGeo = $derived(avgOf((w) => w.scores.geo));
	const avgPs = $derived(avgOf((w) => w.pagespeed.mobile));
	const avgPsPrev = $derived.by(() => {
		const xs = websites
			.map((w) => (w.pagespeed.mobile != null && w.pagespeed.delta != null ? w.pagespeed.mobile - w.pagespeed.delta : null))
			.filter((v): v is number => v != null);
		return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
	});

	/** Δ săptămânal dintr-o serie globală (ultima vs penultima valoare non-null). */
	function weekDelta(series: (number | null)[]): number | null {
		const vals = series.map((v, i) => ({ v, i })).filter((x) => x.v != null);
		if (vals.length < 2) return null;
		return vals[vals.length - 1].v! - vals[vals.length - 2].v!;
	}
	const dSeo = $derived(weekDelta(data.weekly.seo));
	const dAeo = $derived(weekDelta(data.weekly.aeo));
	const dGeo = $derived(weekDelta(data.weekly.geo));

	const totalArticles = $derived(websites.reduce((s, w) => s + w.articles.total, 0));
	const readyArticles = $derived(websites.reduce((s, w) => s + w.articles.ready, 0));
	const articleStates = $derived([
		{ key: 'ready', label: 'Gata de publicare', value: readyArticles, color: 'var(--cl-success)' },
		{
			key: 'published',
			label: 'Publicate',
			value: websites.reduce((s, w) => s + w.articles.published, 0),
			color: 'var(--sh-seo)'
		},
		{
			key: 'scheduled',
			label: 'Programate',
			value: websites.reduce((s, w) => s + w.articles.scheduled, 0),
			color: 'var(--sh-geo)'
		},
		{
			key: 'source',
			label: 'Surse neredactate',
			value: websites.reduce((s, w) => s + w.articles.source, 0),
			color: 'var(--cl-text-3)'
		},
		{
			key: 'failed',
			label: 'Publicări eșuate',
			value: websites.reduce((s, w) => s + w.articles.failed, 0),
			color: 'var(--cl-danger)'
		}
	]);
	const maxArticleState = $derived(Math.max(1, ...articleStates.map((s) => s.value)));

	const linkStates = $derived([
		{ key: 'pending', label: 'În așteptare', value: data.linkTotals.pending, color: 'var(--cl-warn)' },
		{ key: 'submitted', label: 'Trimise', value: data.linkTotals.submitted, color: 'var(--sh-aeo)' },
		{ key: 'published', label: 'Publicate', value: data.linkTotals.published, color: 'var(--cl-success)' },
		{ key: 'rejected', label: 'Refuzate', value: data.linkTotals.rejected, color: 'var(--cl-danger)' }
	]);
	const maxLinkState = $derived(Math.max(1, ...linkStates.map((s) => s.value)));

	const highPriority = $derived(data.recommendations.filter((r) => r.priority === 'mare').length);
	const cwvPassCount = $derived(websites.filter((w) => w.pagespeed.cwv === true).length);
	const cwvKnownCount = $derived(websites.filter((w) => w.pagespeed.cwv != null).length);

	const clientOptions = $derived([
		'all',
		...[...new Set(websites.map((w) => w.clientName).filter((c): c is string => !!c))].sort()
	]);

	// ---- filtrare + sortare tabel ----
	const filtered = $derived.by(() => {
		const out = websites.filter((w) => {
			if (tab === 'attention' && !w.needsAttention) return false;
			if (tab === 'with-articles' && w.articles.total === 0) return false;
			if (clientF !== 'all' && w.clientName !== clientF) return false;
			if (q) {
				const text = `${w.domain} ${w.name ?? ''} ${w.clientName ?? ''}`.toLowerCase();
				if (!text.includes(q.toLowerCase())) return false;
			}
			return true;
		});
		const cmp: Record<typeof sort, (a: (typeof out)[number], b: (typeof out)[number]) => number> = {
			overall: (a, b) => (b.scores.overall ?? -1) - (a.scores.overall ?? -1),
			seo: (a, b) => (b.scores.seo ?? -1) - (a.scores.seo ?? -1),
			pagespeed: (a, b) => (a.pagespeed.mobile ?? 999) - (b.pagespeed.mobile ?? 999),
			articles: (a, b) => b.articles.total - a.articles.total,
			domain: (a, b) => a.domain.localeCompare(b.domain)
		};
		return out.sort(cmp[sort]);
	});

	// ---- acțiuni ----
	async function recalculate() {
		recalculating = true;
		try {
			const r = await recalculateContentScores();
			await invalidateAll();
			showToast(`Scoruri recalculate · ${r.updated} articole actualizate din ${r.scanned}`);
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Recalcularea nu a reușit'));
		} finally {
			recalculating = false;
		}
	}

	async function addWebsite(input: { clientId: string; url: string; name: string }) {
		addingWebsite = true;
		try {
			await createClientWebsite({
				clientId: input.clientId,
				url: input.url,
				name: input.name || undefined
			});
			await invalidateAll();
			showAdd = false;
			showToast('Website adăugat — apare acum în tabel');
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Website-ul nu a putut fi adăugat'));
		} finally {
			addingWebsite = false;
		}
	}

	function exportCsv() {
		const head = [
			'Website', 'Client', 'SEO', 'AEO', 'GEO', 'General',
			'PageSpeed mobil', 'Articole', 'Gata', 'Programate', 'Publicate',
			'Linkuri presă', 'Linkuri publicate', 'WordPress', 'Profil brand'
		];
		const rows = filtered.map((w) => [
			w.domain, w.clientName ?? '', w.scores.seo ?? '', w.scores.aeo ?? '', w.scores.geo ?? '',
			w.scores.overall ?? '', w.pagespeed.mobile ?? '', w.articles.total, w.articles.ready,
			w.articles.scheduled, w.articles.published, w.links.total, w.links.published,
			w.wpConnected ? 'da' : 'nu', w.hasProfile ? 'da' : 'nu'
		]);
		const csv = [head, ...rows]
			.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
			.join('\n');
		// BOM ca Excel să deschidă corect diacriticele
		const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `raport-seo-${data.generatedAt.slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
		showToast(`Raport exportat · ${filtered.length} website-uri`);
	}
</script>

<!-- fără breadcrumb propriu: layout-ul [tenant] afișează deja breadcrumb-ul paginii -->
<div class="cl-wrap" data-screen-label="SEO & GEO & AEO">
	<div class="cl-hero">
		<div>
			<h1>SEO &amp; GEO &amp; AEO</h1>
			<p class="sh-hero-sum">
				<strong>{nf.format(websites.length)}</strong> website-uri · scor general mediu
				<strong>{avgOverall ?? '—'}</strong> · <strong>{nf.format(totalArticles)}</strong> articole,
				<strong>{nf.format(readyArticles)}</strong> gata de publicare ·
				<strong class={attention.length ? 'danger' : ''}>{attention.length}</strong>
				{attention.length === 1 ? 'website necesită' : 'website-uri necesită'} atenție
			</p>
		</div>
		<div class="cl-hero-actions">
			<div class="cl-search">
				<SearchIcon size={14} />
				<input placeholder="Caută website sau client…" aria-label="Caută website sau client" bind:value={q} />
				{#if q}
					<button class="cl-search-clear" onclick={() => (q = '')} aria-label="Șterge căutarea"><XIcon size={12} /></button>
				{/if}
			</div>
			<button class="cl-btn-secondary" onclick={exportCsv} disabled={filtered.length === 0}>
				<DownloadIcon size={13} /> Export raport
			</button>
			<button class="cl-btn-secondary" onclick={recalculate} disabled={recalculating}>
				<RefreshCwIcon size={13} />
				{recalculating ? 'Se recalculează…' : 'Recalculează scoruri'}
			</button>
			<button class="cl-btn-primary" onclick={() => (showAdd = true)}><PlusIcon size={13} /> Adaugă website</button>
		</div>
	</div>

	<div class="cl-hero" style="padding-top: 0; padding-bottom: 0">
		<div class="cl-kpis sh-kpis" style="width: 100%; grid-template-columns: repeat(6, 1fr)">
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: var(--cl-accent-50); color: var(--cl-accent)"><SparklesIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Scor general mediu</div>
					<div class="cl-kpi-val psi-{psiScoreLevel(avgOverall)}">{avgOverall ?? '—'}</div>
					<div class="cl-kpi-sub">50% SEO + 25% AEO + 25% GEO</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: var(--cl-accent-50); color: var(--sh-seo)"><SearchIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">SEO mediu</div>
					<div class="cl-kpi-val psi-{psiScoreLevel(avgSeo)}">{avgSeo ?? '—'}</div>
					<div class="cl-kpi-sub">
						{#if dSeo != null}<PsiDelta value={dSeo} suffix=" pct" />{:else}—{/if}
						vs săpt. anterioară
					</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(6,182,212,.08); color: var(--sh-aeo)"><BotIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">AEO mediu</div>
					<div class="cl-kpi-val psi-{psiScoreLevel(avgAeo)}">{avgAeo ?? '—'}</div>
					<div class="cl-kpi-sub">
						{#if dAeo != null}<PsiDelta value={dAeo} suffix=" pct" />{:else}—{/if}
						vs săpt. anterioară
					</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(139,92,246,.08); color: var(--sh-geo)"><SparklesIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">GEO mediu</div>
					<div class="cl-kpi-val psi-{psiScoreLevel(avgGeo)}">{avgGeo ?? '—'}</div>
					<div class="cl-kpi-sub">
						{#if dGeo != null}<PsiDelta value={dGeo} suffix=" pct" />{:else}—{/if}
						vs săpt. anterioară
					</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(16,185,129,.08); color: #10b981"><SmartphoneIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">PageSpeed mediu mobil</div>
					<div class="cl-kpi-val psi-{psiScoreLevel(avgPs)}">{avgPs ?? '—'}</div>
					<div class="cl-kpi-sub">
						{#if avgPs != null && avgPsPrev != null}<PsiDelta value={avgPs - avgPsPrev} suffix=" pct" />{:else}—{/if}
						vs scanarea anterioară
					</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(245,158,11,.08); color: #f59e0b"><ListChecksIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Recomandări deschise</div>
					<div class="cl-kpi-val {highPriority ? 'cl-text-danger' : ''}">{data.recommendations.length}</div>
					<div class="cl-kpi-sub">{highPriority} de prioritate mare</div>
				</div>
			</div>
		</div>
	</div>

	<div class="sh-legend" aria-label="Legendă scoruri">
		<div class="sh-legend-item">
			<i style="background: var(--sh-seo)"></i>
			<span><b>SEO</b> — poziționare în Google: cuvânt-cheie, meta, structură, conținut (12 verificări).</span>
		</div>
		<div class="sh-legend-item">
			<i style="background: var(--sh-aeo)"></i>
			<span><b>AEO</b> — answer engines (AI Overviews): FAQ, liste, răspuns direct la început (3 verificări).</span>
		</div>
		<div class="sh-legend-item">
			<i style="background: var(--sh-geo)"></i>
			<span><b>GEO</b> — motoare generative (ChatGPT, Perplexity): date factuale, subtitluri, text scanabil (3 verificări).</span>
		</div>
	</div>

	<div class="sh-modules">
		<a class="sh-module" href="{base}/seo-links">
			<div class="sh-module-head">
				<span class="sh-module-ic" style="background: var(--cl-accent-50); color: var(--cl-accent)"><NewspaperIcon size={17} /></span>
				<div>
					<div class="sh-module-name">Linkuri SEO</div>
					<div class="sh-module-sub">linkuri de presă și backlink-uri</div>
				</div>
				<span class="sh-module-arrow"><ChevronRightIcon size={16} /></span>
			</div>
			<div class="sh-module-stats">
				<div class="sh-module-stat"><b>{nf.format(data.linkTotals.total)}</b><span>Linkuri</span></div>
				<div class="sh-module-stat"><b class="cl-text-ok">{nf.format(data.linkTotals.published)}</b><span>Publicate</span></div>
				<div class="sh-module-stat"><b>{nf.format(Math.round(data.linkTotals.costCents / 100))}</b><span>Buget RON</span></div>
			</div>
		</a>
		<a class="sh-module" href="{base}/seo-links/pagespeed">
			<div class="sh-module-head">
				<span class="sh-module-ic" style="background: rgba(16,185,129,.08); color: #10b981"><GaugeIcon size={17} /></span>
				<div>
					<div class="sh-module-name">PageSpeed Insights</div>
					<div class="sh-module-sub">scanări săptămânale, Core Web Vitals</div>
				</div>
				<span class="sh-module-arrow"><ChevronRightIcon size={16} /></span>
			</div>
			<div class="sh-module-stats">
				<div class="sh-module-stat"><b class="psi-{psiScoreLevel(avgPs)}">{avgPs ?? '—'}</b><span>Mediu mobil</span></div>
				<div class="sh-module-stat"><b>{cwvPassCount}/{cwvKnownCount}</b><span>Trec CWV</span></div>
				<div class="sh-module-stat"><b>{nf.format(data.lastScans.length)}</b><span>Site-uri</span></div>
			</div>
		</a>
		<a class="sh-module" href="{base}/content">
			<div class="sh-module-head">
				<span class="sh-module-ic" style="background: rgba(139,92,246,.08); color: #8b5cf6"><FileTextIcon size={17} /></span>
				<div>
					<div class="sh-module-name">Content</div>
					<div class="sh-module-sub">articole AI per website</div>
				</div>
				<span class="sh-module-arrow"><ChevronRightIcon size={16} /></span>
			</div>
			<div class="sh-module-stats">
				<div class="sh-module-stat"><b>{nf.format(totalArticles)}</b><span>Articole</span></div>
				<div class="sh-module-stat"><b class="cl-text-ok">{nf.format(readyArticles)}</b><span>Gata</span></div>
				<div class="sh-module-stat"><b>{nf.format(withArticles.length)}</b><span>Website-uri</span></div>
			</div>
		</a>
	</div>

	<div class="cl-toolbar">
		<div class="cl-tabs">
			{#each [
				['all', 'Toate website-urile', websites.length],
				['attention', 'Necesită atenție', attention.length],
				['with-articles', 'Cu articole', withArticles.length]
			] as const as [id, lbl, n] (id)}
				<button class={['cl-tab', tab === id && 'active']} onclick={() => (tab = id)}>
					{lbl}<span class={['cl-tab-count', id === 'attention' && n > 0 && 'cl-tab-count-danger']}>{n}</span>
				</button>
			{/each}
		</div>
		<div class="cl-toolbar-spacer"></div>
		<div class="cl-select-wrap">
			<span class="cl-select-lbl">Client</span>
			<select class="cl-select" bind:value={clientF} aria-label="Filtru client">
				{#each clientOptions as c (c)}
					<option value={c}>{c === 'all' ? 'Toți clienții' : c}</option>
				{/each}
			</select>
		</div>
		<div class="cl-select-wrap">
			<span class="cl-select-lbl">Sortare</span>
			<select class="cl-select" bind:value={sort} aria-label="Sortare">
				<option value="overall">Scor general</option>
				<option value="seo">Scor SEO</option>
				<option value="pagespeed">Cel mai slab PageSpeed</option>
				<option value="articles">Număr articole</option>
				<option value="domain">Domeniu A–Z</option>
			</select>
		</div>
	</div>

	<div class="psi-pad">
		<div class="cl-section" style="padding: 0">
			<div class="cl-section-head" style="padding: 16px 20px 12px; margin-bottom: 0">
				<h3><GlobeIcon size={15} /> Website-uri</h3>
				<p class="cl-section-sub" style="margin-left: auto">
					scorurile sunt media articolelor analizate; „—" = fără articole analizate
				</p>
			</div>
			<div class="psi-table-scroll">
				<table class="cl-list-table">
					<thead>
						<tr>
							<th>Website</th>
							<th>SEO / AEO / GEO</th>
							<th class="num">General</th>
							<th class="num">PageSpeed</th>
							<th class="num">Articole</th>
							<th class="num">Linkuri presă</th>
							<th>Integrări</th>
							<th class="num">Evoluție SEO</th>
							<th class="num">Acțiuni</th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as w (w.id)}
							{@const sparkVals = w.spark.filter((v): v is number => v != null)}
							<tr style="cursor: default">
								<td>
									<div class="psi-site">
										<PsiFav id={w.id} domain={w.domain} url={w.url} />
										<div style="min-width: 0">
											<div class="psi-site-l1">{w.domain}</div>
											<div class="psi-site-l2">{w.clientName ?? 'fără client'}{w.name ? ` · ${w.name}` : ''}</div>
										</div>
									</div>
								</td>
								<td><ShBars seo={w.scores.seo} aeo={w.scores.aeo} geo={w.scores.geo} /></td>
								<td class="num">
									<div style="display: flex; justify-content: flex-end"><ShGauge value={w.scores.overall} /></div>
								</td>
								<td class="num">
									<div style="display: flex; justify-content: flex-end"><PsiDonut value={w.pagespeed.mobile} size={38} /></div>
								</td>
								<td class="num">
									<div style="font-weight: 800; font-size: 14px">{nf.format(w.articles.total)}</div>
									<div class="psi-site-l2" style="max-width: none">
										{w.articles.ready} gata · {w.articles.scheduled} programate
									</div>
								</td>
								<td class="num">
									<div style="font-weight: 800; font-size: 14px">{nf.format(w.links.total)}</div>
									<div class="psi-site-l2" style="max-width: none">{w.links.published} publicate</div>
								</td>
								<td>
									<div style="display: flex; gap: 6px; flex-wrap: wrap">
										<span class="psi-tag {w.wpConnected ? 'ok' : 'danger'}">WP</span>
										<span class="psi-tag {w.hasProfile ? 'ok' : 'danger'}">Profil</span>
									</div>
								</td>
								<td class="num">
									<div style="display: flex; justify-content: flex-end">
										{#if sparkVals.length >= 2}
											<PsiSpark values={sparkVals} />
										{:else}
											<span style="color: var(--cl-text-3)">—</span>
										{/if}
									</div>
								</td>
								<td class="num">
									<div style="display: flex; gap: 6px; justify-content: flex-end">
										<a
											class="cl-icon-btn"
											title="Articolele website-ului (Content)"
											aria-label="Articolele {w.domain} în Content"
											href="{base}/content/{w.id}"
										>
											<FileTextIcon size={13} />
										</a>
										<a
											class="cl-icon-btn"
											title="Linkuri SEO"
											aria-label="Linkuri SEO pentru {w.domain}"
											href="{base}/seo-links"
										>
											<LinkIcon size={13} />
										</a>
										<a
											class="cl-icon-btn"
											title="PageSpeed Insights"
											aria-label="PageSpeed Insights pentru {w.domain}"
											href="{base}/seo-links/pagespeed"
										>
											<GaugeIcon size={13} />
										</a>
									</div>
								</td>
							</tr>
						{/each}
						{#if filtered.length === 0}
							<tr style="cursor: default">
								<td colspan="9">
									<div class="cl-empty" style="padding: 40px 0; border: 0; background: transparent">
										<SearchIcon size={20} />
										<h3>Niciun website</h3>
										<p>
											{websites.length === 0
												? 'Adaugă primul website cu butonul „Adaugă website".'
												: 'Schimbă filtrele sau adaugă un website nou.'}
										</p>
									</div>
								</td>
							</tr>
						{/if}
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<div class="sh-panels" style="padding-top: 14px">
		<div class="cl-section">
			<div class="cl-section-head">
				<h3><TrendingUpIcon size={15} /> Evoluția scorurilor · 6 săptămâni</h3>
				<p class="cl-section-sub" style="margin-left: auto">media articolelor analizate în fiecare săptămână</p>
			</div>
			{#if data.weekly.seo.some((v) => v != null)}
				<PsiLine
					weeks={data.weekly.weeks}
					height={210}
					series={[
						{ label: 'SEO', color: '#1877F2', values: data.weekly.seo },
						{ label: 'AEO', color: '#06b6d4', values: data.weekly.aeo },
						{ label: 'GEO', color: '#8b5cf6', values: data.weekly.geo }
					]}
				/>
			{:else}
				<div class="cl-budget-empty" style="padding: 30px 0; text-align: center">
					{#if totalArticles > 0}
						Nicio analiză în ultimele 6 săptămâni — graficul se umple pe măsură ce se generează articole noi.
					{:else}
						Graficul apare după primele articole analizate — pornește din modulul Content.
					{/if}
				</div>
			{/if}
		</div>
		<div class="cl-section">
			<div class="cl-section-head">
				<h3><FileTextIcon size={15} /> Articole pe stare</h3>
				<p class="cl-section-sub" style="margin-left: auto">{nf.format(totalArticles)} în total</p>
			</div>
			{#if totalArticles > 0}
				<div class="sh-hbars">
					{#each articleStates as s (s.key)}
						<div class="sh-hbar">
							<span class="sh-hbar-lbl">{s.label}</span>
							<span class="sh-hbar-track">
								<i style:width="{(s.value / maxArticleState) * 100}%" style:background={s.color}></i>
							</span>
							<span class="sh-hbar-val">{nf.format(s.value)}</span>
						</div>
					{/each}
				</div>
			{:else}
				<div class="cl-budget-empty" style="padding: 30px 0; text-align: center">
					Niciun articol încă — pornește din modulul Content.
				</div>
			{/if}
		</div>
	</div>

	<div class="sh-panels">
		<div class="cl-section">
			<div class="cl-section-head">
				<h3><ListChecksIcon size={15} /> Recomandări deschise</h3>
				<p class="cl-section-sub" style="margin-left: auto">
					generate din aceleași reguli ca tab-ul „Necesită atenție"
				</p>
			</div>
			{#if data.recommendations.length > 0}
				<div class="sh-recs">
					{#each data.recommendations as r (r.id)}
						<div class="sh-rec">
							<span class="sh-rec-dot {r.priority}" title="prioritate {r.priority}"></span>
							<div class="sh-rec-body">
								<div class="sh-rec-title">
									{r.title}
									<span class="psi-tag info">{r.type}</span>
								</div>
								<div class="sh-rec-meta">
									{r.websiteLabel} · responsabil {r.clientName ?? '—'} · termen {new Date(r.due).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}
								</div>
								<div class="sh-rec-impact">{r.impact}</div>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="cl-budget-empty" style="padding: 30px 0; text-align: center">
					Nicio recomandare deschisă — toate website-urile sunt în regulă. ✓
				</div>
			{/if}
		</div>
		<div class="cl-section">
			<div class="cl-section-head">
				<h3><NewspaperIcon size={15} /> Linkuri de presă pe status</h3>
				<a class="cl-btn-mini" style="margin-left: auto" href="{base}/seo-links">
					Deschide modulul <ChevronRightIcon size={11} />
				</a>
			</div>
			{#if data.linkTotals.total > 0}
				<div class="sh-hbars">
					{#each linkStates as s (s.key)}
						<div class="sh-hbar">
							<span class="sh-hbar-lbl">{s.label}</span>
							<span class="sh-hbar-track">
								<i style:width="{(s.value / maxLinkState) * 100}%" style:background={s.color}></i>
							</span>
							<span class="sh-hbar-val">{nf.format(s.value)}</span>
						</div>
					{/each}
				</div>
				<div class="cl-hint" style="margin-top: 12px">
					Buget total: <b style="color: var(--cl-text)">{nf.format(Math.round(data.linkTotals.costCents / 100))} RON</b>
					{#if data.discovery}
						· ultimul discovery pe {data.discovery.sourceDomain}: {data.discovery.untracked} linkuri neînregistrate
					{/if}
				</div>
			{:else}
				<div class="cl-budget-empty" style="padding: 30px 0; text-align: center">
					Niciun link de presă înregistrat încă.
				</div>
			{/if}
		</div>
	</div>

	<div class="psi-pad" style="padding-bottom: 60px">
		<div class="cl-section" style="padding: 0">
			<div class="cl-section-head" style="padding: 16px 20px 12px; margin-bottom: 0">
				<h3><ActivityIcon size={15} /> Ultimele scanări PageSpeed</h3>
				<p class="cl-section-sub" style="margin-left: auto">scor mobil · date reale CrUX pentru CWV</p>
			</div>
			<div class="psi-table-scroll">
			<table class="cl-list-table" style="min-width: 640px">
				<thead>
					<tr>
						<th>Website</th>
						<th>Scanat</th>
						<th class="num">Scor mobil</th>
						<th class="num">Δ</th>
						<th>Core Web Vitals</th>
					</tr>
				</thead>
				<tbody>
					{#each data.lastScans as s (s.domain)}
						<tr style="cursor: default">
							<td style="font-weight: 700">{s.domain}</td>
							<td>{psiFmtDateTime(s.measuredAt)}</td>
							<td class="num psi-{psiScoreLevel(s.mobile)}" style="font-weight: 800">{s.mobile ?? '—'}</td>
							<td class="num"><PsiDelta value={s.delta} suffix=" pct" /></td>
							<td><PsiCwv pass={s.cwv} /></td>
						</tr>
					{:else}
						<tr style="cursor: default">
							<td colspan="5">
								<div class="cl-budget-empty" style="text-align: center; padding: 24px 0">
									Nicio scanare încă — pornește una din modulul PageSpeed Insights.
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			</div>
		</div>
	</div>

	{#if showAdd}
		<ShAddWebsiteModal
			clients={data.clients}
			saving={addingWebsite}
			onclose={() => (showAdd = false)}
			onsave={addWebsite}
		/>
	{/if}
	{#if toast}
		<div class="psi-toast" role="status" aria-live="polite"><CheckIcon size={14} /> {toast}</div>
	{/if}
</div>
