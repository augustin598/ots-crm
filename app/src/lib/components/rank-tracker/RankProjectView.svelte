<script lang="ts">
	// Rank Tracker — detaliul unui proiect. Port 1:1 din designul Claude Design
	// (rank.jsx, partea DETALIU), cu date reale din remote functions.
	import '../pagespeed/pagespeed.css';
	import './rank-tracker.css';
	import { page } from '$app/state';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import MailIcon from '@lucide/svelte/icons/mail';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import TargetIcon from '@lucide/svelte/icons/target';
	import StarIcon from '@lucide/svelte/icons/star';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import UsersIcon from '@lucide/svelte/icons/users';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import CheckSquareIcon from '@lucide/svelte/icons/square-check';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import TrophyIcon from '@lucide/svelte/icons/trophy';

	import PsiStratIcon from '../pagespeed/PsiStratIcon.svelte';
	import RtPos from './RtPos.svelte';
	import RtGain from './RtGain.svelte';
	import RtSpark from './RtSpark.svelte';
	import Rt7 from './Rt7.svelte';
	import RtFeats from './RtFeats.svelte';
	import RtAi from './RtAi.svelte';
	import RtVis from './RtVis.svelte';
	import RtDist from './RtDist.svelte';
	import RtRankChart from './RtRankChart.svelte';
	import RtCompRow from './RtCompRow.svelte';
	import KeywordDrawer from './KeywordDrawer.svelte';
	import KeywordsModal from './KeywordsModal.svelte';
	import RankSettingsModal from './RankSettingsModal.svelte';
	import ReportPreviewModal from './ReportPreviewModal.svelte';

	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import { distribution, rankDayKey, visibility } from '$lib/logic/rank-tracker';
	import { rtDays, rtDevicesLabel, rtLocaleLabel, rtNextRunLabel, rtNum, rtSerpLink } from './lib';
	import {
		getRankProjectDetail,
		getRankRunStatus,
		getRankSettings,
		addRankKeywords,
		deleteRankKeyword,
		startRankCheck,
		saveRankSettings,
		saveSerpIntegration,
		sendRankReportNow
	} from '$lib/remotes/rank-tracker.remote';
	import type { RankKeywordDetail } from '$lib/server/rank-tracker/projects-data';

	const projectId = $derived(page.params.projectId ?? '');
	const base = $derived(`/${page.params.tenant}/seo-links/rank-tracker`);

	const detailQuery = $derived(getRankProjectDetail(projectId));
	const runQuery = $derived(getRankRunStatus(projectId));
	const settingsQuery = $derived(getRankSettings());

	const detail = $derived(detailQuery.current ?? null);
	const settings = $derived(settingsQuery.current ?? null);
	const run = $derived(runQuery.current ?? null);
	const running = $derived(!!run && !run.finishedAt);

	// Poll doar cât rulează o verificare (fără auto-polling permanent).
	let sawRunning = $state(false);
	$effect(() => {
		if (running) {
			sawRunning = true;
			const timer = setInterval(() => runQuery.refresh(), 2500);
			return () => clearInterval(timer);
		}
		if (sawRunning) {
			sawRunning = false;
			detailQuery.refresh();
			// `run` poate fi deja null (cheia de progres din Redis expiră la 20 s, iar taburile
			// din fundal sunt încetinite de browser) — atunci nu inventăm „0 cuvinte verificate".
			const total = run?.total;
			showToast(
				total == null
					? 'Rulare finalizată.'
					: `Rulare finalizată · ${total} ${total === 1 ? 'cuvânt verificat' : 'cuvinte verificate'}`
			);
		}
	});

	// ---- stare UI ----
	let deviceSel = $state<'desktop' | 'mobile' | null>(null);
	let tab = $state<'all' | 'top10' | 'up' | 'down' | 'ai' | 'canib'>('all');
	let q = $state('');
	let locF = $state('all');
	let tagF = $state<string[]>([]);
	let sort = $state<'pos' | 'gain' | 'loss' | 'vol' | 'kw'>('pos');
	let sel = $state<string[]>([]);
	let openKw = $state<string | null>(null);
	let adding = $state(false);
	let showSched = $state(false);
	let preview = $state(false);
	let starting = $state(false);
	let toast = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	function showToast(message: string) {
		toast = message;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	const trackedDevices = $derived<('desktop' | 'mobile')[]>(detail?.devices ?? ['desktop']);
	const primaryDevice = $derived<'desktop' | 'mobile'>(trackedDevices.includes('desktop') ? 'desktop' : 'mobile');
	const device = $derived<'desktop' | 'mobile'>(
		deviceSel && trackedDevices.includes(deviceSel) ? deviceSel : primaryDevice
	);

	// ---- rânduri pentru dispozitivul selectat ----
	const pRows = $derived((detail?.keywords ?? []).filter((k) => k.device === device));
	const days = $derived(rtDays(detail?.trend.days ?? []));

	const st = $derived.by(() => {
		const positions = pRows.map((r) => r.position);
		const nums = positions.filter((p): p is number => p != null);
		const dist = distribution(positions);
		const lastRun = detail?.runs?.[0] ?? null;
		return {
			vis: visibility(positions),
			avg: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null,
			dist,
			up: lastRun?.up ?? 0,
			down: lastRun?.down ?? 0,
			// `positionDelta` întoarce `delta: null` când un cuvânt IESE din adâncimea căutată
			// („lost"). E cel mai rău rezultat posibil, iar serverul chiar ridică alertă pentru
			// el — dar filtrul pe `delta1 != null` îl excludea, deci KPI-ul putea arăta 0 într-o
			// zi în care mai multe cuvinte dispăruseră complet.
			alerts: pRows.filter(
				(r) =>
					(r.delta1 != null && r.delta1 <= -(detail?.alertThreshold ?? 5)) ||
					(r.position == null && r.spark30.some((v) => v != null))
			).length
		};
	});

	// Contoarele se calculează pe rândurile care trec deja de căutare/locație/etichete,
	// altfel tabul zicea „Toate 3" în timp ce tabelul afișa 1 rând (pe hub filtrarea
	// era deja corectă — era o inconsecvență în interiorul aceleiași funcționalități).
	const scopedRows = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		return pRows.filter((k) => {
			if (locF !== 'all' && k.location !== locF) return false;
			if (tagF.length && (!k.tag || !tagF.includes(k.tag))) return false;
			if (needle && !`${k.keyword} ${k.rankingUrl ?? k.targetUrl ?? ''}`.toLowerCase().includes(needle))
				return false;
			return true;
		});
	});

	const tabs = $derived([
		['all', 'Toate', scopedRows.length],
		['top10', 'Top 10', scopedRows.filter((r) => r.position != null && r.position <= 10).length],
		['up', 'Au urcat', scopedRows.filter((r) => (r.delta7 ?? 0) > 0).length],
		[
			'down',
			'Au scăzut',
			scopedRows.filter(
				(r) => (r.delta7 ?? 0) < 0 || (r.position == null && r.spark30.some((v) => v != null))
			).length
		],
		['ai', 'AI Overview', scopedRows.filter((r) => r.aiOverview !== 'absent').length],
		['canib', 'Canibalizare', scopedRows.filter((r) => r.cannibalization.flagged).length]
	] as const);

	// Locațiile proiectului sunt sursa de adevăr (aceleași cu subtitlul și cu modalul de
	// editare). Derivarea din `pRows` dădea listă goală, fiindcă `location` e adesea '' pe
	// keyword — deci selectul rămânea inert.
	const locations = $derived([
		...new Set([...(detail?.locations ?? []), ...pRows.map((r) => r.location)].filter(Boolean))
	]);
	const tags = $derived([...new Set(pRows.map((r) => r.tag).filter((t): t is string => !!t))]);
	// Locația se repetă identic pe fiecare rând când proiectul urmărește una singură — atunci
	// e doar zgomot: apare deja în subtitlul paginii și în filtrul din toolbar.
	const showRowLocation = $derived(new Set(pRows.map((r) => r.location)).size > 1);

	const detailRows = $derived.by(() => {
		const out = scopedRows.filter((k) => {
			if (tab === 'top10' && !(k.position != null && k.position <= 10)) return false;
			if (tab === 'up' && !((k.delta7 ?? 0) > 0)) return false;
			if (
				tab === 'down' &&
				!((k.delta7 ?? 0) < 0 || (k.position == null && k.spark30.some((v) => v != null)))
			)
				return false;
			if (tab === 'ai' && k.aiOverview === 'absent') return false;
			if (tab === 'canib' && !k.cannibalization.flagged) return false;
			return true;
		});
		const cmp: Record<string, (a: RankKeywordDetail, b: RankKeywordDetail) => number> = {
			pos: (a, b) => (a.position ?? 999) - (b.position ?? 999),
			gain: (a, b) => (b.delta7 ?? -999) - (a.delta7 ?? -999),
			loss: (a, b) => (a.delta7 ?? 999) - (b.delta7 ?? 999),
			vol: (a, b) => (b.volume ?? 0) - (a.volume ?? 0),
			kw: (a, b) => a.keyword.localeCompare(b.keyword, 'ro')
		};
		return [...out].sort(cmp[sort] ?? cmp.pos);
	});

	const allSelected = $derived(detailRows.length > 0 && detailRows.every((r) => sel.includes(r.id)));
	const openRow = $derived(openKw ? (pRows.find((r) => r.id === openKw) ?? null) : null);
	const openSibling = $derived(
		openKw ? ((detail?.keywords ?? []).find((k) => k.id === openKw && k.device !== device) ?? null) : null
	);

	// „cele mai importante cuvinte" — după volumul de căutare
	const SERIES_COLORS = ['#1877F2', '#8b5cf6', '#10b981', '#f59e0b'];
	// Eticheta include locația când același cuvânt e urmărit în mai multe locații: altfel
	// `{#each series as s (s.label)}` primea două chei identice (eroare în dev, randare
	// greșită în build-ul de producție).
	const topSeries = $derived.by(() => {
		const top = [...pRows].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 4);
		const dupes = new Set(
			top.map((r) => r.keyword).filter((k, i, arr) => arr.indexOf(k) !== i)
		);
		return top.map((r, i) => ({
			label: dupes.has(r.keyword) && r.location ? `${r.keyword} · ${r.location}` : r.keyword,
			color: SERIES_COLORS[i],
			values: r.spark30
		}));
	});

	const compVis = $derived(
		Object.entries(detail?.shareOfVoice ?? {})
			.map(([dom, vis]) => ({ dom, vis }))
			.sort((a, b) => b.vis - a.vis)
	);
	const maxVis = $derived(Math.max(st.vis, ...compVis.map((c) => c.vis), 1));

	// vizibilitate / poziție medie pe ziua rulării, pentru istoricul de rulări
	const trendByDay = $derived.by(() => {
		const map = new Map<string, { vis: number | null; avg: number | null }>();
		(detail?.trend.days ?? []).forEach((d, i) => {
			map.set(d, {
				vis: detail?.trend.visibility[i] ?? null,
				avg: detail?.trend.avgPosition[i] ?? null
			});
		});
		return map;
	});

	const fmtTime = (iso: string) =>
		new Date(iso).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });

	// ---- acțiuni ----
	async function runCheck() {
		if (starting || running) return;
		starting = true;
		try {
			await startRankCheck({ projectId });
			showToast('Verificare pornită — pozițiile se actualizează în câteva minute.');
			void watchRun(projectId);
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Verificarea nu a putut porni'));
		} finally {
			starting = false;
		}
	}

	// Jobul intră în coadă asincron, iar progresul apare în Redis abia când îl ia workerul:
	// un singur refresh după pornire ratează rulările scurte (blocare Google) și bannerul
	// n-ar apărea niciodată. Urmărim până se termină, apoi reîmprospătăm datele.
	async function watchRun(watchedId: string) {
		for (let i = 0; i < 60; i++) {
			await new Promise((r) => setTimeout(r, 1500));
			// Ruta e [projectId]: navigarea între proiecte NU remontează componenta, doar
			// schimbă `projectId`. Fără garda asta, bucla continua să interogheze proiectul
			// NOU timp de 90 s și îi reîmprospăta datele; la ieșirea din modul, `projectId`
			// devine '' și `refresh()` respingea cu o rejecție neprinsă.
			if (projectId !== watchedId) return;
			try {
				await runQuery.refresh();
			} catch {
				return;
			}
			if (run?.finishedAt) break;
		}
		if (projectId !== watchedId) return;
		await detailQuery.refresh().catch(() => {});
	}

	/** Verifică doar cuvintele date (un rând sau selecția), nu tot proiectul. */
	async function runCheckFor(ids: string[]) {
		if (starting || running || ids.length === 0) return;
		starting = true;
		try {
			await startRankCheck({ projectId, keywordIds: ids });
			showToast(
				ids.length === 1
					? 'Verific cuvântul acum — poziția se actualizează în câteva momente.'
					: `Verific ${ids.length} cuvinte acum.`
			);
			void watchRun(projectId);
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Verificarea nu a putut porni'));
		} finally {
			starting = false;
		}
	}

	async function onAdd(keywords: string[], tag: string | null, location: string) {
		try {
			const r = await addRankKeywords({ projectId, keywords, tag, location }).updates(detailQuery);
			adding = false;
			const skipped = r.duplicates?.length ?? 0;
			const skippedNote = skipped ? ` · ${skipped} deja urmărite, sărite` : '';
			showToast(
				r.added === 0
					? 'Toate cuvintele erau deja urmărite pentru acest site.'
					: `${r.added} ${r.added === 1 ? 'cuvânt cheie adăugat' : 'cuvinte cheie adăugate'}${skippedNote} · prima verificare la ${settings?.checkHour ?? '06:00'}`
			);
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Nu am putut adăuga cuvintele cheie'));
		}
	}

	async function delKws(ids: string[]) {
		try {
			for (const id of ids) await deleteRankKeyword(id);
			await detailQuery.refresh();
			sel = sel.filter((x) => !ids.includes(x));
			if (openKw && ids.includes(openKw)) openKw = null;
			showToast(`${ids.length} ${ids.length === 1 ? 'cuvânt șters' : 'cuvinte șterse'}`);
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Nu am putut șterge cuvintele cheie'));
		}
	}

	async function onSaveSettings(
		payload: Parameters<typeof saveRankSettings>[0],
		creds: { login: string; password: string } | null
	) {
		try {
			await saveRankSettings(payload).updates(settingsQuery);
			if (creds) await saveSerpIntegration(creds).updates(settingsQuery);
			showSched = false;
			showToast('Programarea și alertele au fost salvate');
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Setările nu au putut fi salvate'));
		}
	}

	async function onSendReport() {
		try {
			const r = await sendRankReportNow(undefined);
			preview = false;
			showToast(r.sent > 0 ? `Raport trimis către ${r.sent} destinatari` : 'Niciun destinatar configurat.');
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Raportul nu a putut fi trimis'));
		}
	}

	function toggleTag(t: string) {
		tagF = tagF.includes(t) ? tagF.filter((x) => x !== t) : [...tagF, t];
	}
</script>

<div class="cl-wrap" data-screen-label="Rank Tracker · {detail?.domain ?? ''}">
	<a class="cl-back" href={base}><ArrowLeftIcon size={13} /> Toate proiectele</a>

	<div class="cl-hero">
		<div>
			<h1>{detail?.domain ?? 'Se încarcă…'}</h1>
			<p>
				{#if detail}
					<strong>{pRows.length}</strong> cuvinte cheie · {rtLocaleLabel(detail.locale)} ·
					{detail.locations.join(', ')}
					{#if detail.clientName}· client <strong>{detail.clientName}</strong>{/if}
					{#if st.alerts > 0}
						· <strong class="danger">{st.alerts} {st.alerts === 1 ? 'alertă' : 'alerte'}</strong> azi
					{/if}
				{:else}
					Se încarcă pozițiile proiectului…
				{/if}
			</p>
		</div>
		<div class="cl-hero-actions">
			<div class="cl-search">
				<SearchIcon size={14} />
				<input placeholder="Caută cuvânt cheie sau URL..." bind:value={q} aria-label="Caută cuvânt cheie sau URL" />
				{#if q}
					<button class="cl-search-clear" onclick={() => (q = '')} aria-label="Golește căutarea"><XIcon size={12} /></button>
				{/if}
			</div>
			<button class="cl-btn-secondary" onclick={() => (showSched = true)}><ClockIcon size={13} /> Rulare și alerte</button>
			<button class="cl-btn-secondary" onclick={() => (preview = true)}><MailIcon size={13} /> Raport</button>
			<button class="cl-btn-secondary" onclick={runCheck} disabled={running || starting}>
				<RefreshCwIcon size={13} class={running ? 'cl-spin' : ''} />
				{running ? 'Se verifică…' : 'Verifică acum'}
			</button>
			<button class="cl-btn-primary" onclick={() => (adding = true)} disabled={!detail}>
				<PlusIcon size={13} /> Adaugă cuvinte cheie
			</button>
		</div>
	</div>

	{#if detailQuery.error}
		<div class="psi-load-error">
			<TriangleAlertIcon size={15} />
			Proiectul nu a putut fi încărcat.
			<button class="cl-btn-secondary cl-btn-sm" onclick={() => detailQuery.refresh()}>
				<RefreshCwIcon size={12} /> Reîncearcă
			</button>
		</div>
	{/if}

	<div class="cl-hero" style="padding-top: 0; padding-bottom: 0">
		<div class="cl-kpis" style="width: 100%; grid-template-columns: repeat(6, minmax(0, 1fr))">
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: var(--cl-accent-50); color: var(--cl-accent)"><EyeIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Vizibilitate</div>
					<div class="cl-kpi-val">{st.vis}%</div>
					<div class="cl-kpi-sub">estimare din CTR pe poziție</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(139,92,246,.08); color: #8b5cf6"><TargetIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Poziție medie</div>
					<div class="cl-kpi-val">{st.avg ?? '—'}</div>
					<div class="cl-kpi-sub">
						{device === 'mobile' ? 'mobil' : 'desktop'} · pe {pRows.filter((r) => r.position != null).length}
						din {pRows.length} cuvinte clasate
					</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(16,185,129,.08); color: #10b981"><StarIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">În top 3</div>
					<div class="cl-kpi-val">
						{st.dist['1-3']}<span style="font-size: 15px; color: var(--cl-text-3); font-weight: 700"> / {pRows.length}</span>
					</div>
					<div class="cl-kpi-sub">{st.dist['1-3'] + st.dist['4-10']} în primele 10</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(16,185,129,.08); color: #10b981"><TrendingUpIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Mișcări azi</div>
					<div class="cl-kpi-val">
						{st.up}<span style="font-size: 15px; color: var(--cl-text-3); font-weight: 700"> ↑ / {st.down} ↓</span>
					</div>
					<div class="cl-kpi-sub">
						față de rularea de ieri{trackedDevices.length > 1 ? ' · ambele dispozitive' : ''}
					</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(239,68,68,.08); color: #ef4444"><TriangleAlertIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Scăderi peste prag</div>
					<div class="cl-kpi-val {st.alerts ? 'cl-text-danger' : ''}">{st.alerts}</div>
					<div class="cl-kpi-sub">prag {detail?.alertThreshold ?? 5} poziții</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(245,158,11,.08); color: #f59e0b"><ClockIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Următoarea rulare</div>
					<div class="cl-kpi-val" style="font-size: 19px">{rtNextRunLabel(settings?.checkHour ?? '06:00')}</div>
					<div class="cl-kpi-sub">{rtDevicesLabel(trackedDevices)}</div>
				</div>
			</div>
		</div>
	</div>

	{#if run && running}
		<div class="rt-pad" style="padding-top: 16px">
			<div class="psi-banner" role="status" aria-live="polite">
				<span class="psi-spin"></span>
				<span class="psi-banner-txt">
					Se interoghează SERP-urile Google · {run.done}/{run.total} cuvinte{run.currentKeyword ? ` · ${run.currentKeyword}` : ''}
				</span>
				<span class="psi-banner-track"><i style:width="{run.total ? (run.done / run.total) * 100 : 0}%"></i></span>
			</div>
		</div>
	{/if}

	<div class="cl-toolbar" style="padding-top: 14px">
		<div class="cl-tabs">
			{#each tabs as [id, lbl, n] (id)}
				<button class={['cl-tab', tab === id && 'active']} aria-pressed={tab === id} onclick={() => (tab = id)}>
					{lbl}<span class={['cl-tab-count', id === 'down' && n > 0 && 'cl-tab-count-danger']}>{n}</span>
				</button>
			{/each}
		</div>
		<div class="cl-toolbar-spacer"></div>
		{#if trackedDevices.length > 1}
			<div class="psi-seg">
				{#each trackedDevices as d (d)}
					<button class={device === d ? 'active' : ''} aria-pressed={device === d} onclick={() => (deviceSel = d)}>
						<PsiStratIcon strategy={d} />
						{d === 'mobile' ? 'Mobil' : 'Desktop'}
					</button>
				{/each}
			</div>
		{/if}
		<div class="cl-select-wrap">
			<span class="cl-select-lbl">Locație</span>
			<select class="cl-select" bind:value={locF} aria-label="Filtru locație">
				<option value="all">Toate locațiile</option>
				{#each locations as l (l)}<option value={l}>{l}</option>{/each}
			</select>
		</div>
		<div class="cl-select-wrap">
			<span class="cl-select-lbl">Sortare</span>
			<select class="cl-select" bind:value={sort} aria-label="Sortare">
				<option value="pos">Poziție (cele mai bune)</option>
				<option value="gain">Cea mai mare urcare</option>
				<option value="loss">Cea mai mare scădere</option>
				<option value="vol">Volum căutări</option>
				<option value="kw">Alfabetic</option>
			</select>
		</div>
	</div>

	{#if tags.length}
		<div class="rt-pad" style="padding-bottom: 12px">
			<div class="rt-tagbar">
				<span style="font-size: 11.5px; color: var(--cl-text-3); font-weight: 700; margin-right: 2px">GRUPURI</span>
				{#each tags as t (t)}
					<button class={['rt-tag', tagF.includes(t) && 'on']} aria-pressed={tagF.includes(t)} onclick={() => toggleTag(t)}>
						{t} <b>{pRows.filter((r) => r.tag === t).length}</b>
					</button>
				{/each}
				{#if tagF.length > 0}
					<button class="rt-tag" onclick={() => (tagF = [])}>× resetează</button>
				{/if}
			</div>
		</div>
	{/if}

	{#if sel.length > 0}
		<div class="rt-pad" style="padding-bottom: 12px">
			<div class="rt-bulk">
				<CheckSquareIcon size={15} />
				{sel.length}
				{sel.length === 1 ? 'cuvânt selectat' : 'cuvinte selectate'}
				<div class="rt-bulk-actions">
					<button
						class="cl-btn-mini"
						disabled={running || starting}
						onclick={() => {
							const ids = [...sel];
							sel = [];
							runCheckFor(ids);
						}}
					>
						<RefreshCwIcon size={11} /> Verifică
					</button>
					<button class="cl-btn-mini" onclick={() => (sel = [])}>Anulează</button>
					<button class="cl-btn-mini" onclick={() => delKws(sel)}><Trash2Icon size={11} /> Șterge</button>
				</div>
			</div>
		</div>
	{/if}

	<div class="rt-pad">
		<div class="cl-section" style="padding: 0">
			<div class="cl-section-head" style="padding: 16px 20px 12px; margin-bottom: 0">
				<h3>
					<TargetIcon size={15} /> Cuvinte cheie · {device === 'mobile' ? 'mobil' : 'desktop'}
					{#if days.length}· {days[days.length - 1].full}{/if}
				</h3>
				<p class="cl-section-sub" style="margin-left: auto">click pe un rând pentru istoricul complet</p>
			</div>
			<div class="rt-table-scroll">
				<table class="cl-list-table">
					<thead>
						<tr>
							<th style="width: 34px">
								<input
									type="checkbox"
									class="rt-check"
									checked={allSelected}
									aria-label="Selectează toate cuvintele"
									onchange={(e) => (sel = e.currentTarget.checked ? detailRows.map((r) => r.id) : [])}
								/>
							</th>
							<th>Cuvânt cheie</th>
							<th class="num">Volum</th>
							<th class="num">KD</th>
							<th class="num">Poziție</th>
							<th class="num">Pagina</th>
							<th class="num"><span class="rt-th"><ArrowUpDownIcon size={11} /> 1 zi</span></th>
							<th class="num"><span class="rt-th"><ArrowUpDownIcon size={11} /> 7 zile</span></th>
							<th class="num"><span class="rt-th"><TrophyIcon size={11} /> Best</span></th>
							<th class="num">Ultimele 7 zile</th>
							<th class="num">30 zile</th>
							<th>SERP</th>
							<th>AI Overview</th>
							<th class="num">Acțiuni</th>
						</tr>
					</thead>
					<tbody>
						{#each detailRows as r (r.id)}
							<tr
								tabindex="0"
								aria-label="Deschide istoricul pentru {r.keyword}"
								onclick={() => (openKw = r.id)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										openKw = r.id;
									}
								}}
							>
								<td onclick={(e) => e.stopPropagation()}>
									<input
										type="checkbox"
										class="rt-check"
										checked={sel.includes(r.id)}
										aria-label="Selectează {r.keyword}"
										onchange={(e) => (sel = e.currentTarget.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))}
									/>
								</td>
								<td>
									<div class="rt-kw">
										<div class="rt-kw-l1">
											{r.keyword}
											{#if r.cannibalization.flagged}<span class="psi-tag warn">canibalizare</span>{/if}
										</div>
										<div class="rt-kw-l2">
											{#if r.tag}<span class="rt-tag">{r.tag}</span>{/if}
											{#if r.location && showRowLocation}
												<span><MapPinIcon size={10} /> {r.location}</span>
											{/if}
											{#if r.rankingUrl ?? r.targetUrl}
												<span class="rt-url">{r.rankingUrl ?? r.targetUrl}</span>
											{/if}
										</div>
									</div>
								</td>
								<td class="num">{#if r.volume}{rtNum(r.volume)}{:else}<span class="iv-muted">—</span>{/if}</td>
								<td class="num"><span class="iv-muted">—</span></td>
								<td class="num"><RtPos pos={r.position} depth={detail?.searchDepth ?? 100} /></td>
								<td class="num">
									{#if r.page == null}
										<span class="iv-muted">—</span>
									{:else}
										<span style="font-weight: 700" style:color={r.position != null && r.position <= 10 ? 'var(--cl-text)' : 'var(--cl-text-3)'}>{r.page}</span>
									{/if}
								</td>
								<td class="num"><RtGain value={r.delta1} /></td>
								<td class="num"><RtGain value={r.delta7} /></td>
								<td class="num" style="font-weight: 700">
									{#if r.best == null}<span class="iv-muted">—</span>{:else}#{r.best}{/if}
								</td>
								<td class="num">
									<div style="display: flex; justify-content: flex-end">
										<Rt7 values={r.spark30.slice(-7)} checked={r.checked30.slice(-7)} days={detail?.trend.days.slice(-7) ?? []} />
									</div>
								</td>
								<td class="num">
									<div style="display: flex; justify-content: flex-end">
										<RtSpark values={r.spark30} checked={r.checked30} />
									</div>
								</td>
								<td><RtFeats list={r.features} /></td>
								<td><RtAi state={r.aiOverview} /></td>
								<td class="num" onclick={(e) => e.stopPropagation()}>
									<div style="display: flex; gap: 6px; justify-content: flex-end">
										<button
											class="cl-icon-btn"
											title="Verifică acum acest cuvânt"
											aria-label="Verifică acum {r.keyword}"
											disabled={running || starting}
											onclick={() => runCheckFor([r.id])}
										>
											<RefreshCwIcon size={13} />
										</button>
										<a
											class="cl-icon-btn"
											title="Vezi SERP în Google"
											href={rtSerpLink(r.keyword, detail?.locale ?? 'google.ro|ro')}
											target="_blank"
											rel="noreferrer">
											<ExternalLinkIcon size={13} />
										</a>
										<button class="cl-icon-btn" title="Șterge cuvântul" onclick={() => delKws([r.id])}>
											<Trash2Icon size={13} />
										</button>
									</div>
								</td>
							</tr>
						{:else}
							<tr style="cursor: default">
								<td colspan="14">
									<div class="cl-empty" style="padding: 40px 0">
										<SearchIcon size={20} />
										<h3>Niciun cuvânt cheie</h3>
										<p>
											{detailQuery.loading
												? 'Se încarcă cuvintele cheie…'
												: 'Schimbă filtrele sau adaugă cuvinte cheie noi în proiect.'}
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

	<div class="rt-pad" style="padding-top: 14px">
		<div class="psi-two">
			<div class="cl-section">
				<div class="cl-section-head">
					<h3><TrendingUpIcon size={15} /> Cele mai importante cuvinte · 30 de zile</h3>
					<p class="cl-section-sub" style="margin-left: auto">după volum de căutare</p>
				</div>
				{#if topSeries.length && days.length}
					<RtRankChart {days} height={230} series={topSeries} />
				{:else}
					<div class="cl-budget-empty" style="padding: 30px 0; text-align: center">
						Graficul apare după prima rulare.
					</div>
				{/if}
			</div>
			<div class="cl-section">
				<div class="cl-section-head">
					<h3><UsersIcon size={15} /> Share of voice</h3>
					<p class="cl-section-sub" style="margin-left: auto">pe cele {pRows.length} cuvinte urmărite</p>
				</div>
				<RtCompRow domain={detail?.domain ?? ''} self vis={st.vis} max={maxVis} />
				{#each compVis as c (c.dom)}
					<RtCompRow domain={c.dom} vis={c.vis} max={maxVis} />
				{/each}
				{#if compVis.length === 0}
					<p class="cl-hint">Niciun competitor detectat încă în SERP-urile urmărite.</p>
				{/if}
				<div style="margin-top: 16px">
					<RtDist buckets={st.dist} total={pRows.length} />
				</div>
			</div>
		</div>
	</div>

	<div class="rt-pad" style="padding: 14px 28px 60px">
		<div class="cl-section" style="padding: 0">
			<div class="cl-section-head" style="padding: 16px 20px 12px; margin-bottom: 0">
				<h3><CalendarDaysIcon size={15} /> Istoric rulări zilnice</h3>
				<p class="cl-section-sub" style="margin-left: auto">fiecare rulare salvează poziția fiecărui cuvânt cheie</p>
			</div>
			<div class="rt-runs-scroll">
			<table class="cl-list-table">
				<thead>
					<tr>
						<th>Ziua</th><th>Ora</th><th class="num">Cuvinte</th><th class="num">Urcări</th>
						<th class="num">Scăderi</th><th class="num">Neschimbate</th><th class="num">Poziție medie</th>
						<th class="num">Vizibilitate</th><th class="num">Eșuate</th><th>Status</th>
					</tr>
				</thead>
				<tbody>
					{#each detail?.runs ?? [] as r (r.id)}
						{@const dayKey = rankDayKey(new Date(r.startedAt))}
						{@const t = trendByDay.get(dayKey)}
						<tr style="cursor: default">
							<td style="font-weight: 700; white-space: nowrap">{rtDays([dayKey])[0].short} {dayKey.slice(0, 4)}</td>
							<td>
								{fmtTime(r.startedAt)}
								{#if r.trigger === 'manual'}<div class="psi-site-l2">rulare manuală</div>{/if}
							</td>
							<td class="num">{r.keywordsChecked}</td>
							<td class="num"><span class="psi-delta up">▲ {r.up}</span></td>
							<td class="num"><span class="psi-delta down">▼ {r.down}</span></td>
							<td class="num"><span class="iv-muted">{r.flat}</span></td>
							<td class="num" style="font-weight: 800">{t?.avg ?? '—'}</td>
							<td class="num">{#if t?.vis != null}<RtVis pct={t.vis} />{:else}<span class="iv-muted">—</span>{/if}</td>
							<td class="num">
								{#if r.failed}<span class="psi-tag danger">{r.failed}</span>{:else}<span class="iv-muted">0</span>{/if}
							</td>
							<td>
								{#if r.status === 'ok'}<span class="psi-tag ok">complet</span>
								{:else if r.status === 'partial'}<span class="psi-tag warn">parțial</span>
								{:else if r.status === 'running'}<span class="psi-tag info">în curs</span>
								{:else}<span class="psi-tag danger">întrerupt</span>{/if}
							</td>
						</tr>
					{:else}
						<tr style="cursor: default">
							<td colspan="10">
								<div class="cl-budget-empty" style="text-align: center; padding: 24px 0">
									Nicio rulare încă — prima pleacă automat la {settings?.checkHour ?? '06:00'}.
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			</div>
		</div>
	</div>

	{#if openRow && detail}
		<KeywordDrawer
			keyword={openRow}
			sibling={openSibling}
			{device}
			domain={detail.domain}
			name={detail.name}
			locale={detail.locale}
			days={detail.trend.days}
			checkHour={settings?.checkHour ?? '06:00'}
			searchDepth={detail.searchDepth}
			onclose={() => (openKw = null)}
			ondelete={(id) => delKws([id])}
		/>
	{/if}

	{#if adding && detail}
		<KeywordsModal
			domain={detail.domain}
			locale={detail.locale}
			locations={detail.locations}
			devices={detail.devices}
			{tags}
			checkHour={settings?.checkHour ?? '06:00'}
			existing={[...new Set((detail.keywords ?? []).map((k) => k.keyword))]}
			onclose={() => (adding = false)}
			onadd={onAdd}
		/>
	{/if}

	{#if showSched}
		<RankSettingsModal {settings} onclose={() => (showSched = false)} onsave={onSaveSettings} />
	{/if}

	{#if preview && detail}
		<ReportPreviewModal
			title="Raport poziții — {detail.domain}"
			hour={settings?.checkHour ?? '06:00'}
			recipients={settings?.recipients ?? []}
			rows={pRows.map((r) => ({ id: r.id, keyword: r.keyword, position: r.position, delta7: r.delta7 }))}
			vis={st.vis}
			avg={st.avg}
			buckets={st.dist}
			total={pRows.length}
			lastDay={days.length ? days[days.length - 1].full : ''}
			onclose={() => (preview = false)}
			onsend={onSendReport}
		/>
	{/if}

	{#if toast}
		<div class="psi-toast" role="status" aria-live="polite"><CheckIcon size={14} /> {toast}</div>
	{/if}
</div>
