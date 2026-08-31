<script lang="ts">
	// PageSpeed Insights — pagina principală (SEO Links → PageSpeed).
	// Port 1:1 din design (pagespeed.jsx), cu date reale din remote functions.
	import './pagespeed.css';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import MailIcon from '@lucide/svelte/icons/mail';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import CheckCheckIcon from '@lucide/svelte/icons/check-check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import SendIcon from '@lucide/svelte/icons/send';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import CheckIcon from '@lucide/svelte/icons/check';

	import {
		getPagespeedSites,
		getPagespeedSettings,
		getPagespeedReports,
		getPagespeedClients,
		getPagespeedScanStatus,
		savePagespeedSite,
		deletePagespeedSite,
		savePagespeedSettings,
		startPagespeedScan,
		sendPagespeedReportNow
	} from '$lib/remotes/pagespeed.remote';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import { confirmDialog } from '$lib/components/ui/confirm-dialog';
	import { PSI_DAYS, isoWeekKey, isoWeekLabel, nextRunDate, psiScoreLevel, type PsiStrategy } from '$lib/logic/pagespeed';
	import { psiFmtDate, psiFmtDateTime } from './lib';
	import PsiFav from './PsiFav.svelte';
	import PsiDonut from './PsiDonut.svelte';
	import PsiSpark from './PsiSpark.svelte';
	import PsiDelta from './PsiDelta.svelte';
	import PsiMetric from './PsiMetric.svelte';
	import PsiCwv from './PsiCwv.svelte';
	import PsiLine from './PsiLine.svelte';
	import PsiStratIcon from './PsiStratIcon.svelte';
	import SiteModal from './SiteModal.svelte';
	import ScheduleModal from './ScheduleModal.svelte';
	import SiteDrawer from './SiteDrawer.svelte';
	import MailPreviewModal from './MailPreviewModal.svelte';
	import type { PsiSettings, PsiSitePayload, PsiSiteRow } from './types';

	// ---- date din remote ----
	const sitesQuery = $derived(getPagespeedSites());
	const settingsQuery = $derived(getPagespeedSettings());
	const reportsQuery = $derived(getPagespeedReports());
	const clientsQuery = $derived(getPagespeedClients());
	const scanQuery = $derived(getPagespeedScanStatus());

	const sites = $derived<PsiSiteRow[]>((sitesQuery.current?.sites ?? []) as PsiSiteRow[]);
	const lastScanAt = $derived(sitesQuery.current?.lastScanAt ?? null);
	const trend = $derived(sitesQuery.current?.trend ?? null);
	const settings = $derived<PsiSettings>(
		(settingsQuery.current as PsiSettings) ?? {
			dayOfWeek: 1, hour: '07:00', strategies: ['mobile', 'desktop'], recipients: [],
			alertThreshold: 5, onlyOnDrop: false, includeOpportunities: true,
			attachPdf: false, sendToClient: false, isEnabled: true
		}
	);
	const reports = $derived(reportsQuery.current ?? []);
	const clients = $derived(clientsQuery.current ?? []);

	// ---- scanare: polling DOAR cât timp e activă (fără auto-polling permanent) ----
	const scan = $derived(scanQuery.current ?? null);
	const scanRunning = $derived(!!scan && !scan.finishedAt);
	let sawRunning = $state(false);
	$effect(() => {
		if (scanRunning) {
			sawRunning = true;
			const timer = setInterval(() => scanQuery.refresh(), 2500);
			return () => clearInterval(timer);
		}
		if (sawRunning) {
			// scanarea tocmai s-a terminat: reîmprospătăm datele fără reload de pagină
			sawRunning = false;
			sitesQuery.refresh();
			reportsQuery.refresh();
			showToast(`Scanare finalizată · ${scan?.total ?? 0} ${scan?.total === 1 ? 'site măsurat' : 'site-uri măsurate'}`);
		}
	});

	// ---- stare UI ----
	let strategy = $state<PsiStrategy>('mobile');
	let tab = $state<'all' | 'attention' | 'cwv' | 'paused'>('all');
	let q = $state('');
	let clientF = $state('all');
	let sort = $state<'worst' | 'best' | 'delta' | 'domain' | 'client'>('worst');
	let openId = $state<string | null>(null);
	let editing = $state<'new' | PsiSiteRow | null>(null);
	let preview = $state(false);
	let showSched = $state(false);
	let savingSite = $state(false);
	let savingSched = $state(false);
	let sendingNow = $state(false);
	let toast = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	function showToast(message: string) {
		toast = message;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	// ---- rânduri derivate (aceleași formule ca în design) ----
	interface Row {
		site: PsiSiteRow;
		perf: number | null;
		delta: number | null;
		perfM: number | null;
		perfD: number | null;
		deltaM: number | null;
		spark: number[];
		cwv: boolean | null;
		failed: boolean;
		pending: boolean;
	}
	const rows = $derived<Row[]>(
		sites.map((site) => {
			const d = site.data[strategy];
			const m = site.data.mobile;
			const lastOk = d.last?.status === 'ok' ? d.last : d.prev;
			return {
				site,
				perf: lastOk?.performance ?? null,
				delta: d.delta,
				perfM: (m.last?.status === 'ok' ? m.last : m.prev)?.performance ?? null,
				perfD: (site.data.desktop.last?.status === 'ok' ? site.data.desktop.last : site.data.desktop.prev)?.performance ?? null,
				deltaM: m.delta,
				spark: d.spark,
				cwv: site.cwv,
				failed: d.last?.status === 'failed',
				pending: !d.last && !d.prev
			};
		})
	);

	const withData = $derived(rows.filter((r) => r.site.active && r.perf != null));
	const alerts = $derived(
		rows.filter((r) => r.site.active && r.deltaM != null && r.deltaM <= -(r.site.alertThreshold || 5))
	);
	const needsAttention = $derived(
		rows.filter(
			(r) =>
				r.site.active &&
				((r.delta != null && r.delta <= -(r.site.alertThreshold || 5)) ||
					(r.perf != null && r.perf < 50) ||
					r.cwv === false ||
					r.failed)
		)
	);
	function avgOf(get: (r: Row) => number | null): number | null {
		const values = withData.map(get).filter((v): v is number => v != null);
		return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
	}
	const avgM = $derived(avgOf((r) => r.perfM));
	const avgD = $derived(avgOf((r) => r.perfD));
	const avgMPrev = $derived.by(() => {
		const values = rows
			.filter((r) => r.site.active)
			.map((r) => r.site.data.mobile.prev?.performance ?? null)
			.filter((v): v is number => v != null);
		return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
	});
	const cwvPassCount = $derived(withData.filter((r) => r.cwv === true).length);
	const cwvKnownCount = $derived(withData.filter((r) => r.cwv != null).length);
	const clientOptions = $derived([
		'all',
		...[...new Set(sites.map((s) => s.clientName).filter((c): c is string => !!c))]
	]);

	const filtered = $derived.by(() => {
		const out = rows.filter((r) => {
			const s = r.site;
			if (
				tab === 'attention' &&
				!(
					(r.delta != null && r.delta <= -(s.alertThreshold || 5)) ||
					(r.perf != null && r.perf < 50) ||
					r.cwv === false ||
					r.failed
				)
			)
				return false;
			if (tab === 'cwv' && r.cwv !== true) return false;
			if (tab === 'paused' && s.active) return false;
			if (tab !== 'paused' && !s.active) return false;
			if (clientF !== 'all' && s.clientName !== clientF) return false;
			if (q) {
				const text = `${s.domain} ${s.name} ${s.clientName ?? ''}`.toLowerCase();
				if (!text.includes(q.toLowerCase())) return false;
			}
			return true;
		});
		const comparators: Record<typeof sort, (a: Row, b: Row) => number> = {
			worst: (a, b) => (a.perf ?? 999) - (b.perf ?? 999),
			best: (a, b) => (b.perf ?? -1) - (a.perf ?? -1),
			delta: (a, b) => (a.delta ?? 99) - (b.delta ?? 99),
			domain: (a, b) => a.site.domain.localeCompare(b.site.domain),
			client: (a, b) => (a.site.clientName ?? '').localeCompare(b.site.clientName ?? '')
		};
		return out.sort(comparators[sort]);
	});

	const dayName = $derived(PSI_DAYS[settings.dayOfWeek - 1] ?? 'Luni');
	const nextRun = $derived(nextRunDate(settings.dayOfWeek, settings.hour));
	const nextRunDays = $derived(Math.max(0, Math.ceil((nextRun.getTime() - Date.now()) / 86400000)));
	// eticheta săptămânii curente (fallback local când nu există încă măsurători)
	const currentWeekLabel = $derived(
		isoWeekLabel(trend?.weeks[trend.weeks.length - 1]?.id ?? isoWeekKey(new Date()))
	);
	const stratLabel = $derived(
		settings.strategies.length === 2
			? 'mobil + desktop'
			: settings.strategies[0] === 'mobile'
				? 'doar mobil'
				: 'doar desktop'
	);

	const openSite = $derived(sites.find((s) => s.id === openId) ?? null);

	function psiLink(url: string): string {
		return `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}&form_factor=${strategy}`;
	}

	// ---- acțiuni ----
	async function runScan(siteIds?: string[]) {
		try {
			await startPagespeedScan(siteIds);
			await scanQuery.refresh();
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Scanarea nu a putut porni'));
		}
	}

	async function saveSite(payload: PsiSitePayload) {
		savingSite = true;
		try {
			const isEdit = !!payload.id;
			await savePagespeedSite(payload).updates(sitesQuery);
			editing = null;
			showToast(`${payload.pages[0] ? new URL(payload.pages[0].url).hostname.replace(/^www\./, '') : 'Site'} ${isEdit ? 'actualizat' : 'adăugat în monitorizare'}`);
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Site-ul nu a putut fi salvat'));
		} finally {
			savingSite = false;
		}
	}

	async function removeSite(id: string) {
		const domain = sites.find((s) => s.id === id)?.domain ?? 'Site';
		const ok = await confirmDialog({
			title: 'Scoate din monitorizare',
			description: `Scoți ${domain} din monitorizare? Istoricul măsurătorilor se șterge definitiv.`
		});
		if (!ok) return;
		try {
			await deletePagespeedSite(id).updates(sitesQuery);
			editing = null;
			openId = null;
			showToast(`${domain} scos din monitorizare`);
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Site-ul nu a putut fi șters'));
		}
	}

	async function saveSchedule(next: PsiSettings) {
		savingSched = true;
		try {
			await savePagespeedSettings({
				dayOfWeek: next.dayOfWeek,
				hour: next.hour,
				strategies: next.strategies,
				recipients: next.recipients,
				alertThreshold: next.alertThreshold,
				onlyOnDrop: next.onlyOnDrop,
				includeOpportunities: next.includeOpportunities,
				attachPdf: next.attachPdf,
				sendToClient: next.sendToClient,
				isEnabled: next.isEnabled
			}).updates(settingsQuery);
			showSched = false;
			showToast('Programarea raportului a fost salvată');
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Setările nu au putut fi salvate'));
		} finally {
			savingSched = false;
		}
	}

	async function sendNow() {
		sendingNow = true;
		try {
			const result = await sendPagespeedReportNow(undefined).updates(reportsQuery);
			preview = false;
			showToast(`Raport ${currentWeekLabel} trimis către ${result.sent} destinatari`);
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Raportul nu a putut fi trimis'));
		} finally {
			sendingNow = false;
		}
	}
</script>

<!-- fără breadcrumb propriu: layout-ul [tenant] afișează deja breadcrumb-ul paginii -->
<div class="cl-wrap" data-screen-label="PageSpeed Insights">
	<div class="cl-hero">
		<div>
			<h1>PageSpeed Insights</h1>
			<p>
				<strong>{sites.filter((s) => s.active).length}</strong> site-uri monitorizate · scanare automată
				<strong>{dayName.toLowerCase()}, {settings.hour}</strong> · ultima rulare
				<strong>{lastScanAt ? psiFmtDateTime(lastScanAt) : '—'}</strong>{#if alerts.length > 0}&nbsp;·
					<strong class="danger">{alerts.length} {alerts.length === 1 ? 'alertă' : 'alerte'}</strong> în {currentWeekLabel}{/if}
			</p>
		</div>
		<div class="cl-hero-actions">
			<div class="cl-search">
				<SearchIcon size={14} />
				<input placeholder="Caută domeniu sau client..." aria-label="Caută domeniu sau client" bind:value={q} />
				{#if q}
					<button class="cl-search-clear" onclick={() => (q = '')} aria-label="Șterge căutarea"><XIcon size={12} /></button>
				{/if}
			</div>
			<button class="cl-btn-secondary" onclick={() => (showSched = true)}><SettingsIcon size={13} /> Setări raport</button>
			<button class="cl-btn-secondary" onclick={() => (preview = true)}><MailIcon size={13} /> Previzualizează raportul</button>
			<button class="cl-btn-secondary" onclick={() => runScan()} disabled={scanRunning}>
				<RefreshCwIcon size={13} />
				{scanRunning ? 'Se scanează…' : 'Rulează scanare acum'}
			</button>
			<button class="cl-btn-primary" onclick={() => (editing = 'new')}><PlusIcon size={13} /> Adaugă site</button>
		</div>
	</div>

	{#if sitesQuery.error}
		<div class="psi-load-error">
			<TriangleAlertIcon size={15} />
			Datele nu au putut fi încărcate.
			<button class="cl-btn-secondary cl-btn-sm" onclick={() => sitesQuery.refresh()}>
				<RefreshCwIcon size={12} /> Reîncearcă
			</button>
		</div>
	{/if}

	<div class="cl-hero" style="padding-top: 0; padding-bottom: 0">
		<div class="cl-kpis" style="width: 100%; grid-template-columns: repeat(6, 1fr)">
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: var(--cl-accent-50); color: var(--cl-accent)"><SmartphoneIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Scor mediu mobil</div>
					<div class="cl-kpi-val psi-{psiScoreLevel(avgM)}">{avgM ?? '—'}</div>
					<div class="cl-kpi-sub">
						{#if avgMPrev != null && avgM != null}<PsiDelta value={avgM - avgMPrev} suffix=" pct" />{:else}—{/if}
						vs săpt. trecută
					</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(139,92,246,.08); color: #8b5cf6"><PsiStratIcon strategy="desktop" size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Scor mediu desktop</div>
					<div class="cl-kpi-val psi-{psiScoreLevel(avgD)}">{avgD ?? '—'}</div>
					<div class="cl-kpi-sub">pe {withData.length} site-uri active</div>
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
				<div class="cl-kpi-ic" style="background: rgba(239,68,68,.08); color: #ef4444"><TriangleAlertIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Scăderi peste prag</div>
					<div class="cl-kpi-val {alerts.length ? 'cl-text-danger' : ''}">{alerts.length}</div>
					<div class="cl-kpi-sub">
						{alerts.length ? alerts.map((a) => a.site.domain).join(', ') : `nicio scădere în ${currentWeekLabel}`}
					</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(100,116,139,.1); color: #64748b"><GlobeIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Site-uri în monitorizare</div>
					<div class="cl-kpi-val">{sites.filter((s) => s.active).length}</div>
					<div class="cl-kpi-sub">
						{sites.reduce((n, s) => n + s.pages.length, 0)} URL-uri · {sites.filter((s) => !s.active).length} în pauză
					</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(245,158,11,.08); color: #f59e0b"><CalendarIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Următorul raport</div>
					<div class="cl-kpi-val" style="font-size: 19px">{dayName}, {settings.hour}</div>
					<div class="cl-kpi-sub">
						{psiFmtDate(nextRun)} · {nextRunDays === 0 ? 'azi' : nextRunDays === 1 ? 'mâine' : `în ${nextRunDays} zile`}
					</div>
				</div>
			</div>
		</div>
	</div>

	{#if scan && scanRunning}
		<div class="psi-pad" style="padding-top: 16px">
			<div class="psi-banner">
				<span class="psi-spin"></span>
				<span class="psi-banner-txt">
					Se interoghează PageSpeed Insights API · {scan.done}/{scan.total}{scan.current ? ` · ${scan.current}` : ''}
				</span>
				<span class="psi-banner-track"><i style:width="{scan.total ? (scan.done / scan.total) * 100 : 0}%"></i></span>
			</div>
		</div>
	{/if}

	<div class="cl-toolbar" style="padding-top: 14px">
		<div class="cl-tabs">
			{#each [
				['all', 'Toate', rows.filter((r) => r.site.active).length],
				['attention', 'Necesită atenție', needsAttention.length],
				['cwv', 'Trec CWV', rows.filter((r) => r.site.active && r.cwv === true).length],
				['paused', 'În pauză', rows.filter((r) => !r.site.active).length]
			] as const as [id, lbl, n] (id)}
				<button class={['cl-tab', tab === id && 'active']} onclick={() => (tab = id)}>
					{lbl}<span class={['cl-tab-count', id === 'attention' && n > 0 && 'cl-tab-count-danger']}>{n}</span>
				</button>
			{/each}
		</div>
		<div class="cl-toolbar-spacer"></div>
		<div class="psi-seg">
			{#each ['mobile', 'desktop'] as const as s (s)}
				<button class={strategy === s ? 'active' : ''} onclick={() => (strategy = s)}>
					<PsiStratIcon strategy={s} />
					{s === 'mobile' ? 'Mobil' : 'Desktop'}
				</button>
			{/each}
		</div>
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
				<option value="worst">Cele mai slabe scoruri</option>
				<option value="best">Cele mai bune scoruri</option>
				<option value="delta">Cea mai mare scădere</option>
				<option value="domain">Domeniu A–Z</option>
				<option value="client">Client A–Z</option>
			</select>
		</div>
	</div>

	<div class="psi-pad">
		<div class="cl-section" style="padding: 0">
			<div class="cl-section-head" style="padding: 16px 20px 12px; margin-bottom: 0">
				<h3>
					<ActivityIcon size={15} /> Măsurători {strategy === 'mobile' ? 'mobil' : 'desktop'} · săptămâna {currentWeekLabel}
				</h3>
				<p class="cl-section-sub" style="margin-left: auto">click pe un rând pentru raportul complet Lighthouse</p>
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
							<th class="num">Acțiuni</th>
						</tr>
					</thead>
					<tbody>
						{#if sitesQuery.loading && sites.length === 0}
							<tr style="cursor: default"><td colspan="10"><div class="cl-budget-empty" style="text-align: center; padding: 40px 0">Se încarcă site-urile…</div></td></tr>
						{/if}
						{#each filtered as r (r.site.id)}
							{@const st = scan?.perSite?.[r.site.id]}
							{@const lastOk = r.site.data[strategy].last?.status === 'ok' ? r.site.data[strategy].last : r.site.data[strategy].prev}
							<tr
								tabindex="0"
								aria-label="Deschide raportul pentru {r.site.domain}"
								onclick={() => (openId = r.site.id)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										openId = r.site.id;
									}
								}}
							>
								<td>
									<div class="psi-site">
										<PsiFav id={r.site.id} domain={r.site.domain} url={r.site.pages[0]?.url} />
										<div style="min-width: 0">
											<div class="psi-site-l1">
												{r.site.domain}
												{#if r.failed}<span class="psi-tag danger" title={r.site.data[strategy].last?.errorMessage ?? 'măsurătoare eșuată'}>eșuat</span>{/if}
												{#if !r.site.active}<span class="psi-tag">pauză</span>{/if}
											</div>
											<div class="psi-site-l2">
												{r.site.clientName ?? 'fără client'} · {r.site.cms} · {r.site.pages.length} URL
											</div>
										</div>
									</div>
								</td>
								<td class="num">
									{#if st === 'running'}
										<span class="psi-row-scan"><span class="psi-spin"></span> rulează</span>
									{:else}
										<div style="display: flex; justify-content: flex-end"><PsiDonut value={r.perf} size={38} /></div>
									{/if}
								</td>
								<td class="num">
									{#if r.pending}<span class="iv-muted-cell">prima scanare</span>{:else}<PsiDelta value={r.delta} suffix=" pct" />{/if}
								</td>
								<td class="num"><div style="display: flex; justify-content: flex-end"><PsiSpark values={r.spark} /></div></td>
								<td class="num">{#if lastOk}<PsiMetric k="lcp" v={lastOk.lcpMs} />{:else}<span class="iv-muted-cell">—</span>{/if}</td>
								<td class="num">{#if lastOk}<PsiMetric k="inp" v={lastOk.inpMs} />{:else}<span class="iv-muted-cell">—</span>{/if}</td>
								<td class="num">{#if lastOk}<PsiMetric k="cls" v={lastOk.cls} />{:else}<span class="iv-muted-cell">—</span>{/if}</td>
								<td class="num">{#if lastOk}<PsiMetric k="tbt" v={lastOk.tbtMs} />{:else}<span class="iv-muted-cell">—</span>{/if}</td>
								<td><PsiCwv pass={r.cwv} /></td>
								<td
									class="num"
									onclick={(e) => e.stopPropagation()}
									onkeydown={(e) => e.stopPropagation()}
								>
									<div style="display: flex; gap: 6px; justify-content: flex-end">
										<button class="cl-icon-btn" title="Rescanează acum" disabled={scanRunning} onclick={() => runScan([r.site.id])}>
											<RefreshCwIcon size={13} />
										</button>
										<button class="cl-icon-btn" title="Editează site-ul" onclick={() => (editing = r.site)}>
											<PencilIcon size={13} />
										</button>
										<a
											class="cl-icon-btn"
											title="Deschide în PageSpeed Insights"
											href={psiLink(r.site.pages[0]?.url ?? `https://${r.site.domain}/`)}
											target="_blank"
											rel="noreferrer"
										>
											<ExternalLinkIcon size={13} />
										</a>
									</div>
								</td>
							</tr>
						{/each}
						{#if !sitesQuery.loading && filtered.length === 0}
							<tr style="cursor: default">
								<td colspan="10">
									<div class="cl-empty" style="padding: 40px 0; border: 0; background: transparent">
										<SearchIcon size={20} />
										<h3>Niciun site</h3>
										<p>
											{sites.length === 0
												? 'Adaugă primul site în monitorizare cu butonul „Adaugă site".'
												: 'Schimbă filtrele sau adaugă un site nou în monitorizare.'}
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

	<div class="psi-pad" style="padding-top: 14px">
		<div class="cl-section">
			<div class="cl-section-head">
				<h3><TrendingUpIcon size={15} /> Evoluția scorului mediu</h3>
				<p class="cl-section-sub" style="margin-left: auto">medie pe site-urile active, o măsurătoare pe săptămână</p>
				<div class="cl-section-actions">
					<div class="psi-next" style="padding: 8px 12px; gap: 10px">
						<span class="psi-next-ic" style="width: 30px; height: 30px; border-radius: 9px"><SendIcon size={14} /></span>
						<div>
							<div class="psi-next-l1" style="font-size: 12.5px">{dayName} {psiFmtDate(nextRun)}, {settings.hour}</div>
							<div class="psi-next-l2">{settings.recipients.length} destinatari · {stratLabel}</div>
						</div>
						<button class="cl-btn-mini" style="margin-left: 4px" onclick={() => (showSched = true)}>
							<SettingsIcon size={11} /> Setări
						</button>
					</div>
				</div>
			</div>
			{#if trend && trend.weeks.length > 1}
				<PsiLine
					weeks={trend.weeks}
					height={210}
					series={[
						{ label: 'Medie mobil', color: '#1877F2', values: trend.mobile },
						{ label: 'Medie desktop', color: '#8b5cf6', values: trend.desktop }
					]}
				/>
			{:else}
				<div class="cl-budget-empty" style="padding: 30px 0; text-align: center">
					Graficul apare după primele măsurători săptămânale.
				</div>
			{/if}
		</div>
	</div>

	<div class="psi-pad" style="padding: 14px 28px 60px">
		<div class="cl-section" style="padding: 0">
			<div class="cl-section-head" style="padding: 16px 20px 12px; margin-bottom: 0">
				<h3><FileTextIcon size={15} /> Rapoarte trimise</h3>
				<p class="cl-section-sub" style="margin-left: auto">istoricul rulărilor automate</p>
			</div>
			<table class="cl-list-table">
				<thead>
					<tr>
						<th>Săptămâna</th><th>Trimis</th><th class="num">Site-uri</th><th class="num">Scor mediu mobil</th>
						<th class="num">Δ</th><th class="num">Scor mediu desktop</th><th class="num">Alerte</th><th>Status</th>
						<th class="num">Acțiuni</th>
					</tr>
				</thead>
				<tbody>
					{#each reports as rp (rp.id)}
						<tr style="cursor: default">
							<td style="font-weight: 700">{isoWeekLabel(rp.weekKey)}</td>
							<td>
								{rp.sentAt ? psiFmtDateTime(rp.sentAt) : '—'}
								{#if rp.note}<div class="psi-site-l2">{rp.note}</div>{/if}
							</td>
							<td class="num">{rp.siteCount}</td>
							<td class="num psi-{psiScoreLevel(rp.avgMobile)}" style="font-weight: 800">{rp.avgMobile ?? '—'}</td>
							<td class="num"><PsiDelta value={rp.deltaMobile} /></td>
							<td class="num psi-{psiScoreLevel(rp.avgDesktop)}" style="font-weight: 700">{rp.avgDesktop ?? '—'}</td>
							<td class="num">
								{#if rp.alertCount}<span class="psi-tag danger">{rp.alertCount}</span>{:else}<span class="iv-muted-cell">0</span>{/if}
							</td>
							<td>
								{#if rp.status === 'sent'}<span class="psi-tag ok">trimis</span>
								{:else if rp.status === 'partial'}<span class="psi-tag warn">parțial</span>
								{:else if rp.status === 'skipped'}<span class="psi-tag">sărit</span>
								{:else}<span class="psi-tag danger">eșuat</span>{/if}
							</td>
							<td class="num">
								<div style="display: flex; gap: 6px; justify-content: flex-end">
									<button class="cl-icon-btn" title="Vezi raportul" onclick={() => (preview = true)}><EyeIcon size={13} /></button>
								</div>
							</td>
						</tr>
					{:else}
						<tr style="cursor: default">
							<td colspan="9">
								<div class="cl-budget-empty" style="text-align: center; padding: 24px 0">
									Niciun raport trimis încă — primul pleacă {dayName.toLowerCase()} la {settings.hour}.
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	{#if showSched}
		<ScheduleModal {settings} saving={savingSched} onclose={() => (showSched = false)} onsave={saveSchedule} />
	{/if}
	{#if openSite}
		<SiteDrawer site={openSite} {strategy} scanning={scanRunning} onclose={() => (openId = null)} onrescan={(id) => runScan([id])} />
	{/if}
	{#if editing}
		<SiteModal
			site={editing === 'new' ? null : editing}
			{clients}
			saving={savingSite}
			onclose={() => (editing = null)}
			onsave={saveSite}
			ondelete={removeSite}
		/>
	{/if}
	{#if preview}
		<MailPreviewModal {settings} sending={sendingNow} onclose={() => (preview = false)} onsend={sendNow} />
	{/if}
	{#if toast}
		<div class="psi-toast" role="status" aria-live="polite"><CheckIcon size={14} /> {toast}</div>
	{/if}
</div>

<style>
	.iv-muted-cell {
		color: var(--cl-text-3);
	}
</style>
