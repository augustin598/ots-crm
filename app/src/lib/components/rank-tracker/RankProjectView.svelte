<script lang="ts">
	// Rank Tracker — detaliul unui proiect: KPI-uri, grafic de trend, tabel de cuvinte
	// cheie cu delte 1/7/30 zile, drawer per cuvânt, adăugare în masă, verificare manuală.
	import '../pagespeed/pagespeed.css';
	import './rank-tracker.css';
	import { page } from '$app/state';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PsiDelta from '../pagespeed/PsiDelta.svelte';
	import RkPosChart from './RkPosChart.svelte';
	import RkDistBar from './RkDistBar.svelte';
	import KeywordDrawer from './KeywordDrawer.svelte';
	import KeywordsModal from './KeywordsModal.svelte';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import { fmtPosition } from '$lib/logic/rank-tracker';
	import {
		getRankProjectDetail,
		getRankRunStatus,
		addRankKeywords,
		deleteRankKeyword,
		startRankCheck
	} from '$lib/remotes/rank-tracker.remote';
	import type { RankKeywordDetail } from '$lib/server/rank-tracker/projects-data';

	const projectId = $derived(page.params.projectId ?? '');
	const detailQuery = $derived(getRankProjectDetail(projectId));
	const runQuery = $derived(getRankRunStatus(projectId));
	const detail = $derived(detailQuery.current ?? null);
	const run = $derived(runQuery.current ?? null);
	const running = $derived(!!run && !run.finishedAt);

	const base = $derived(`/${page.params.tenant}/seo-links/rank-tracker`);
	const nf = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 1 });

	// Poll doar cât rulează o verificare.
	$effect(() => {
		if (running) {
			const t = setInterval(() => runQuery.refresh(), 2500);
			return () => clearInterval(t);
		}
	});

	let toast = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	function showToast(m: string) {
		toast = m;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	let selected = $state<RankKeywordDetail | null>(null);
	let addOpen = $state(false);
	let deviceFilter = $state<'all' | 'desktop' | 'mobile'>('all');
	let search = $state('');

	const rows = $derived(
		(detail?.keywords ?? [])
			.filter((k) => deviceFilter === 'all' || k.device === deviceFilter)
			.filter((k) => !search || k.keyword.toLowerCase().includes(search.toLowerCase()))
	);

	async function verify() {
		try {
			await startRankCheck(projectId);
			runQuery.refresh();
			showToast('Verificare pornită.');
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Verificarea nu a putut porni'));
		}
	}
	async function onAdd(keywords: string[], tag: string | null, location: string) {
		try {
			const r = await addRankKeywords({ projectId, keywords, tag, location }).updates(detailQuery);
			addOpen = false;
			showToast(`${r.added} cuvinte cheie adăugate.`);
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Nu am putut adăuga cuvintele cheie'));
		}
	}
	async function onDeleteKeyword(id: string) {
		try {
			await deleteRankKeyword(id).updates(detailQuery);
			selected = null;
			showToast('Cuvânt cheie șters.');
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Nu am putut șterge cuvântul cheie'));
		}
	}

	function featureClass(f: string) {
		return f === 'ai' ? 'rk-feat rk-feat-ai' : 'rk-feat';
	}
</script>

<div class="cl-wrap" data-screen-label="Rank Tracker">
	<a class="cl-back" href={base}><ArrowLeftIcon size={14} /> Toate proiectele</a>

	{#if !detail}
		<div class="cl-empty"><p>Se încarcă proiectul…</p></div>
	{:else}
		<div class="cl-hero">
			<div class="cl-hero-main">
				<h1 class="cl-hero-title">{detail.domain}</h1>
				<p class="cl-hero-sub">
					{detail.name} · {detail.locale} · {detail.locations.join(', ')}
					{#if detail.competitors.length}· {detail.competitors.length} competitori{/if}
					· prag alertă {detail.alertThreshold}
				</p>
			</div>
			<div class="cl-hero-actions">
				<button class="cl-btn-secondary" onclick={() => (addOpen = true)}><PlusIcon size={15} /> Cuvinte cheie</button>
				<button class="cl-btn-primary" disabled={running} onclick={verify}>
					<RefreshCwIcon size={15} class={running ? 'cl-spin' : ''} /> {running ? 'Se verifică…' : 'Verifică acum'}
				</button>
			</div>
		</div>

		{#if running && run}
			<div class="psi-scan-banner">
				<RefreshCwIcon size={14} class="cl-spin" />
				Se verifică pozițiile · {run.done}/{run.total}{run.currentKeyword ? ` · ${run.currentKeyword}` : ''}
			</div>
		{/if}

		<div class="cl-kpis">
			<div class="cl-kpi"><div class="cl-kpi-val">{nf.format(detail.visibility)}%</div><div class="cl-kpi-lbl">Vizibilitate</div></div>
			<div class="cl-kpi"><div class="cl-kpi-val">{detail.avgPosition != null ? nf.format(detail.avgPosition) : '—'}</div><div class="cl-kpi-lbl">Poziție medie</div></div>
			<div class="cl-kpi"><div class="cl-kpi-val">{detail.keywords.filter((k) => k.device === 'desktop').length}</div><div class="cl-kpi-lbl">Cuvinte cheie</div></div>
			<div class="cl-kpi"><div class="cl-kpi-val">{detail.aiCited}</div><div class="cl-kpi-lbl">Citat în AI Overview</div></div>
		</div>

		<div class="cl-section">
			<div class="cl-section-head"><h2 class="cl-section-title">Distribuție & trend vizibilitate (30 zile)</h2></div>
			<div style="padding:0 4px 8px"><RkDistBar distribution={detail.distribution} /></div>
			<RkPosChart days={detail.trend.days.map((d) => d.slice(5))} values={detail.trend.visibility} />
		</div>

		<div class="cl-section">
			<div class="cl-section-head">
				<h2 class="cl-section-title">Cuvinte cheie</h2>
				<div style="display:flex;gap:8px;align-items:center">
					<input class="cl-input cl-input-sm" placeholder="Caută…" bind:value={search} />
					<div class="cl-seg">
						<button class="cl-seg-btn" class:active={deviceFilter === 'all'} onclick={() => (deviceFilter = 'all')}>Toate</button>
						<button class="cl-seg-btn" class:active={deviceFilter === 'desktop'} onclick={() => (deviceFilter = 'desktop')}>Desktop</button>
						<button class="cl-seg-btn" class:active={deviceFilter === 'mobile'} onclick={() => (deviceFilter = 'mobile')}>Mobil</button>
					</div>
				</div>
			</div>
			{#if rows.length === 0}
				<div class="cl-empty"><p>Niciun cuvânt cheie. Adaugă-le ca să începi urmărirea pozițiilor.</p></div>
			{:else}
				<div class="psi-table-scroll">
					<table class="cl-list-table">
						<thead>
							<tr><th>Cuvânt cheie</th><th></th><th>Poziție</th><th>Δ 1z</th><th>Δ 7z</th><th>Δ 30z</th><th>Best</th><th>Features</th><th>Volum</th></tr>
						</thead>
						<tbody>
							{#each rows as k (k.id + k.device)}
								<tr class="cl-row-click" onclick={() => (selected = k)}>
									<td>
										{k.keyword}
										{#if k.tag}<span class="rk-tag">{k.tag}</span>{/if}
										{#if k.cannibalization.flagged}<span class="rk-canib" title={k.cannibalization.urls.join('\n')}>canibalizare</span>{/if}
									</td>
									<td>{#if k.device === 'mobile'}<SmartphoneIcon size={14} />{:else}<MonitorIcon size={14} />{/if}</td>
									<td>
										<span class="rk-pos">{fmtPosition(k.position)}</span>
										{#if k.page}<div class="rk-pos-page">Pagina {k.page}</div>{/if}
									</td>
									<td>{#if k.delta1 != null && k.delta1 !== 0}<PsiDelta value={k.delta1} />{:else}—{/if}</td>
									<td>{#if k.delta7 != null && k.delta7 !== 0}<PsiDelta value={k.delta7} />{:else}—{/if}</td>
									<td>{#if k.delta30 != null && k.delta30 !== 0}<PsiDelta value={k.delta30} />{:else}—{/if}</td>
									<td>{fmtPosition(k.best)}</td>
									<td>
										<span class="rk-features">
											{#each k.features as f (f)}<span class={featureClass(f)}>{f}</span>{/each}
											{#if k.aiOverview === 'cited'}<span class="rk-feat rk-feat-cited">AI citat</span>{/if}
										</span>
									</td>
									<td>{k.volume != null ? k.volume.toLocaleString('ro-RO') : '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		{#if toast}
			<div class="psi-toast" role="status" aria-live="polite"><CheckIcon size={14} /> {toast}</div>
		{/if}
	{/if}
</div>

{#if selected}
	<KeywordDrawer
		keyword={selected}
		domain={detail?.domain ?? ''}
		days={detail?.trend.days ?? []}
		shareOfVoice={detail?.shareOfVoice ?? {}}
		onclose={() => (selected = null)}
		ondelete={onDeleteKeyword}
	/>
{/if}

{#if addOpen}
	<KeywordsModal onclose={() => (addOpen = false)} onadd={onAdd} />
{/if}
