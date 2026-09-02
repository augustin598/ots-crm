<script lang="ts">
	// Rank Tracker — hub-ul de proiecte (SEO Links → Rank Tracker).
	// Port 1:1 din designul Claude Design (rank.jsx, partea HUB).
	import '../pagespeed/pagespeed.css';
	import './rank-tracker.css';
	import { page } from '$app/state';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import MailIcon from '@lucide/svelte/icons/mail';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import TargetIcon from '@lucide/svelte/icons/target';
	import StarIcon from '@lucide/svelte/icons/star';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import BarChart3Icon from '@lucide/svelte/icons/chart-bar';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CheckIcon from '@lucide/svelte/icons/check';

	import PsiFav from '../pagespeed/PsiFav.svelte';
	import RtPos from './RtPos.svelte';
	import RtGain from './RtGain.svelte';
	import RtDist from './RtDist.svelte';
	import RtRankChart from './RtRankChart.svelte';
	import ProjectModal from './ProjectModal.svelte';
	import RankSettingsModal from './RankSettingsModal.svelte';
	import ReportPreviewModal from './ReportPreviewModal.svelte';

	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import { isoWeekInterval, type RankBucket } from '$lib/logic/rank-tracker';
	import { rtDays, rtNextRunLabel } from './lib';
	import { psiFmtDateTime } from '../pagespeed/lib';
	import {
		getRankProjects,
		getRankReports,
		getRankAlerts,
		getRankSettings,
		getRankClients,
		saveRankProject,
		deleteRankProject,
		saveRankSettings,
		saveSerpIntegration,
		startRankCheck,
		sendRankReportNow
	} from '$lib/remotes/rank-tracker.remote';
	import type { RankProjectListRow } from '$lib/server/rank-tracker/projects-data';

	const projectsQuery = $derived(getRankProjects());
	const reportsQuery = $derived(getRankReports());
	const alertsQuery = $derived(getRankAlerts());
	const settingsQuery = $derived(getRankSettings());
	const clientsQuery = $derived(getRankClients());

	const projects = $derived<RankProjectListRow[]>(projectsQuery.current?.projects ?? []);
	const totals = $derived(
		projectsQuery.current?.totals ?? { projectCount: 0, keywordCount: 0, avgVisibility: 0, alertsLast7d: 0 }
	);
	const trend = $derived(projectsQuery.current?.trend ?? null);
	const reports = $derived(reportsQuery.current ?? []);
	const alerts = $derived(alertsQuery.current ?? []);
	const clients = $derived(clientsQuery.current ?? []);
	const settings = $derived(settingsQuery.current ?? null);

	const base = $derived(`/${page.params.tenant}/seo-links/rank-tracker`);

	let q = $state('');
	let editing = $state<'new' | RankProjectListRow | null>(null);
	let showSched = $state(false);
	let preview = $state(false);
	let checking = $state(false);
	let toast = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	function showToast(message: string) {
		toast = message;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	const activeProjects = $derived(projects.filter((p) => p.active && !p.paused));
	const list = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return projects;
		return projects.filter((p) => `${p.domain} ${p.name} ${p.clientName ?? ''}`.toLowerCase().includes(needle));
	});

	// ---- agregate de portofoliu (proiectele active) ----
	const portfolio = $derived.by(() => {
		const dist: Record<RankBucket, number> = { '1-3': 0, '4-10': 0, '11-20': 0, '21-50': 0, '51-100': 0, '100+': 0 };
		let keywords = 0;
		let weightedAvg = 0;
		let weightedKw = 0;
		let up = 0;
		let down = 0;
		for (const p of activeProjects) {
			for (const k of Object.keys(dist) as RankBucket[]) dist[k] += p.distribution[k] ?? 0;
			keywords += p.keywordCount;
			if (p.avgPosition != null) {
				weightedAvg += p.avgPosition * p.keywordCount;
				weightedKw += p.keywordCount;
			}
			up += p.lastRunUp ?? 0;
			down += p.lastRunDown ?? 0;
		}
		return {
			dist,
			keywords,
			avg: weightedKw ? Math.round((weightedAvg / weightedKw) * 10) / 10 : null,
			up,
			down
		};
	});

	const lastRunAt = $derived.by(() => {
		const stamps = projects.map((p) => p.lastRunAt).filter((s): s is string => !!s);
		return stamps.length ? stamps.sort().at(-1)! : null;
	});

	const days = $derived(rtDays(trend?.days ?? []));
	const avgSeries = $derived([
		{ label: 'Poziție medie portofoliu', color: '#1877F2', values: trend?.avgPosition ?? [] }
	]);

	const alertRows = $derived(alerts.slice(0, 5));

	// ---- acțiuni ----
	async function runCheck() {
		if (checking || activeProjects.length === 0) return;
		checking = true;
		try {
			const results = await Promise.allSettled(activeProjects.map((p) => startRankCheck(p.id)));
			const started = results.filter((r) => r.status === 'fulfilled').length;
			showToast(
				started > 0
					? `Verificare pornită pentru ${started} ${started === 1 ? 'proiect' : 'proiecte'}.`
					: 'Nicio verificare pornită — s-a rulat deja manual în ultima oră.'
			);
		} finally {
			checking = false;
		}
	}

	async function onSaveProject(payload: Parameters<typeof saveRankProject>[0]) {
		try {
			await saveRankProject(payload).updates(projectsQuery);
			editing = null;
			showToast(`${payload.domain} salvat`);
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Proiectul nu a putut fi salvat'));
		}
	}
	async function onDeleteProject(id: string) {
		const p = projects.find((x) => x.id === id);
		try {
			await deleteRankProject(id).updates(projectsQuery);
			editing = null;
			showToast(`${p ? p.domain : 'Proiect'} scos din monitorizare`);
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Proiectul nu a putut fi șters'));
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
			const r = await sendRankReportNow(undefined).updates(reportsQuery);
			preview = false;
			showToast(r.sent > 0 ? `Raport trimis către ${r.sent} destinatari` : 'Niciun destinatar configurat.');
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Raportul nu a putut fi trimis'));
		}
	}

	function alertLabel(type: string): string {
		return type === 'drop' ? 'scădere' : type === 'out_of_top10' ? 'ieșit din top 10' : 'dispărut';
	}
</script>

<div class="cl-wrap" data-screen-label="Rank Tracker">
	<div class="cl-hero">
		<div>
			<h1>Rank Tracker</h1>
			<p>
				<strong>{totals.keywordCount}</strong> cuvinte cheie pe <strong>{totals.projectCount}</strong>
				{totals.projectCount === 1 ? 'proiect' : 'proiecte'} · rulare zilnică
				<strong>{settings?.checkHour ?? '06:00'}</strong> · ultima rulare
				<strong>{lastRunAt ? psiFmtDateTime(lastRunAt) : '—'}</strong>
				{#if totals.alertsLast7d > 0}
					· <strong class="danger">{totals.alertsLast7d} {totals.alertsLast7d === 1 ? 'alertă' : 'alerte'}</strong>
					în 7 zile
				{/if}
			</p>
		</div>
		<div class="cl-hero-actions">
			<div class="cl-search">
				<SearchIcon size={14} />
				<input placeholder="Caută domeniu sau client..." bind:value={q} aria-label="Caută domeniu sau client" />
				{#if q}
					<button class="cl-search-clear" onclick={() => (q = '')} aria-label="Golește căutarea"><XIcon size={12} /></button>
				{/if}
			</div>
			<button class="cl-btn-secondary" onclick={() => (showSched = true)}><ClockIcon size={13} /> Rulare și alerte</button>
			<button class="cl-btn-secondary" onclick={() => (preview = true)}><MailIcon size={13} /> Raport</button>
			<button class="cl-btn-secondary" onclick={runCheck} disabled={checking || activeProjects.length === 0}>
				<RefreshCwIcon size={13} class={checking ? 'cl-spin' : ''} />
				{checking ? 'Se verifică…' : 'Verifică acum'}
			</button>
			<button class="cl-btn-primary" onclick={() => (editing = 'new')}><PlusIcon size={13} /> Proiect nou</button>
		</div>
	</div>

	{#if projectsQuery.error}
		<div class="psi-load-error">
			<TriangleAlertIcon size={15} />
			Datele nu au putut fi încărcate.
			<button class="cl-btn-secondary cl-btn-sm" onclick={() => projectsQuery.refresh()}>
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
					<div class="cl-kpi-val">{totals.avgVisibility}%</div>
					<div class="cl-kpi-sub">estimare din CTR pe poziție</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(139,92,246,.08); color: #8b5cf6"><TargetIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Poziție medie</div>
					<div class="cl-kpi-val">{portfolio.avg ?? '—'}</div>
					<div class="cl-kpi-sub">pe {portfolio.keywords} cuvinte active</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(16,185,129,.08); color: #10b981"><StarIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">În top 3</div>
					<div class="cl-kpi-val">
						{portfolio.dist['1-3']}<span style="font-size: 15px; color: var(--cl-text-3); font-weight: 700"> / {portfolio.keywords}</span>
					</div>
					<div class="cl-kpi-sub">{portfolio.dist['1-3'] + portfolio.dist['4-10']} în primele 10</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(16,185,129,.08); color: #10b981"><TrendingUpIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Mișcări azi</div>
					<div class="cl-kpi-val">
						{portfolio.up}<span style="font-size: 15px; color: var(--cl-text-3); font-weight: 700"> ↑ / {portfolio.down} ↓</span>
					</div>
					<div class="cl-kpi-sub">față de rularea de ieri</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(239,68,68,.08); color: #ef4444"><TriangleAlertIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Scăderi peste prag</div>
					<div class="cl-kpi-val {totals.alertsLast7d ? 'cl-text-danger' : ''}">{totals.alertsLast7d}</div>
					<div class="cl-kpi-sub">alerte în ultimele 7 zile</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background: rgba(245,158,11,.08); color: #f59e0b"><ClockIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Următoarea rulare</div>
					<div class="cl-kpi-val" style="font-size: 19px">{rtNextRunLabel(settings?.checkHour ?? '06:00')}</div>
					<div class="cl-kpi-sub">{activeProjects.length} proiecte active</div>
				</div>
			</div>
		</div>
	</div>

	<div class="cl-toolbar" style="padding-top: 14px">
		<div class="cl-tabs">
			<button class="cl-tab active" aria-pressed="true">
				Proiecte<span class="cl-tab-count">{list.length}</span>
			</button>
		</div>
	</div>

	<div class="rt-pad" style="padding-top: 4px">
		<div class="rt-projects">
			{#each list as p (p.id)}
				<div class="rt-proj" class:paused={!p.active || p.paused}>
					<div class="rt-proj-head">
						<PsiFav id={p.id} domain={p.domain} url={`https://${p.domain}`} size={34} radius={9} fontSize={13} />
						<div style="min-width: 0">
							<div class="rt-proj-l1">
								<a href="{base}/{p.id}" style="color: inherit; text-decoration: none">{p.domain}</a>
								{#if !p.active || p.paused}<span class="psi-tag">pauză</span>{/if}
								{#if p.alertsLast7d > 0}<span class="psi-tag danger">{p.alertsLast7d}</span>{/if}
							</div>
							<div class="rt-proj-l2">{p.clientName ?? 'fără client'}</div>
						</div>
						<button
							class="cl-icon-btn"
							style="margin-left: auto"
							title="Editează proiectul"
							aria-label="Editează {p.domain}"
							onclick={() => (editing = p)}><PencilIcon size={13} /></button
						>
					</div>
					<div class="rt-proj-nums">
						<div class="rt-proj-num"><b>{p.visibility}%</b><span>vizibilitate</span></div>
						<div class="rt-proj-num"><b>{p.avgPosition ?? '—'}</b><span>poziție medie</span></div>
						<div class="rt-proj-num">
							<b>{p.distribution['1-3'] + p.distribution['4-10']}</b><span>în top 10</span>
						</div>
						<div class="rt-proj-num"><b>{p.keywordCount}</b><span>cuvinte</span></div>
					</div>
					<div style="margin-top: 14px">
						<RtDist buckets={p.distribution} total={p.keywordCount} compact />
					</div>
					<div class="rt-proj-foot">
						<RtGain value={p.deltaVisibility} suffix=" pct" />
						<span>7 zile</span>
						<span style="margin-left: auto">{p.lastRunUp ?? 0} ↑ · {p.lastRunDown ?? 0} ↓ azi</span>
						<a href="{base}/{p.id}" aria-label="Deschide {p.domain}" style="display: inline-flex; color: inherit">
							<ChevronRightIcon size={13} />
						</a>
					</div>
				</div>
			{:else}
				<div class="cl-empty">
					<TrendingUpIcon size={20} />
					<h3>Niciun proiect</h3>
					<p>
						{projectsQuery.loading
							? 'Se încarcă proiectele…'
							: 'Adaugă primul domeniu căruia vrei să-i urmărești pozițiile organice.'}
					</p>
				</div>
			{/each}
		</div>
	</div>

	<div class="rt-pad" style="padding-top: 14px">
		<div class="psi-two">
			<div class="cl-section">
				<div class="cl-section-head">
					<h3><TrendingUpIcon size={15} /> Poziția medie a portofoliului · 30 de zile</h3>
					<p class="cl-section-sub" style="margin-left: auto">
						{portfolio.keywords} cuvinte pe proiectele active
					</p>
				</div>
				{#if days.length && (trend?.avgPosition ?? []).some((v) => v != null)}
					<RtRankChart {days} height={220} series={avgSeries} />
				{:else}
					<div class="cl-budget-empty" style="padding: 30px 0; text-align: center">
						Graficul apare după primele rulări zilnice.
					</div>
				{/if}
			</div>
			<div class="cl-section">
				<div class="cl-section-head"><h3><BarChart3Icon size={15} /> Distribuția pozițiilor</h3></div>
				<RtDist buckets={portfolio.dist} total={portfolio.keywords} />
				<div style="margin-top: 18px">
					<div class="cl-section-head" style="margin-bottom: 8px">
						<h3 style="font-size: 13px"><TriangleAlertIcon size={14} /> Scăderi de urmărit</h3>
					</div>
					{#if alertRows.length === 0}
						<p class="cl-section-sub">nicio scădere peste prag în ultimele rulări</p>
					{/if}
					{#each alertRows as a (a.id)}
						<div class="rt-comp-row" style="grid-template-columns: 1fr 60px 74px">
							<div class="rt-comp-dom">
								<span class="cl-truncate">{a.keyword}</span>
								<span class="rt-tag">{alertLabel(a.type)}</span>
							</div>
							<div style="text-align: right"><RtPos pos={a.toPosition} sm /></div>
							<div style="text-align: right"><RtGain value={a.delta} /></div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>

	<div class="rt-pad" style="padding: 14px 28px 60px">
		<div class="cl-section" style="padding: 0">
			<div class="cl-section-head" style="padding: 16px 20px 12px; margin-bottom: 0">
				<h3><FileTextIcon size={15} /> Rapoarte trimise</h3>
				<p class="cl-section-sub" style="margin-left: auto">istoricul rapoartelor săptămânale</p>
			</div>
			<table class="cl-list-table">
				<thead>
					<tr>
						<th>Săptămâna</th><th>Trimis</th><th class="num">Proiecte</th><th class="num">Vizibilitate</th>
						<th class="num">Alerte</th><th>Status</th>
					</tr>
				</thead>
				<tbody>
					{#each reports as r (r.id)}
						<tr style="cursor: default">
							<td style="font-weight: 700; white-space: nowrap">{isoWeekInterval(r.weekKey)}</td>
							<td>{r.sentAt ? psiFmtDateTime(r.sentAt) : '—'}</td>
							<td class="num">{r.projectCount}</td>
							<td class="num" style="font-weight: 800">{r.visibility != null ? r.visibility + '%' : '—'}</td>
							<td class="num">
								{#if r.alertCount}<span class="psi-tag danger">{r.alertCount}</span>{:else}<span class="iv-muted">0</span>{/if}
							</td>
							<td>
								{#if r.status === 'sent'}<span class="psi-tag ok">trimis</span>
								{:else if r.status === 'partial'}<span class="psi-tag warn">parțial</span>
								{:else if r.status === 'skipped'}<span class="psi-tag">sărit</span>
								{:else}<span class="psi-tag danger">eșuat</span>{/if}
							</td>
						</tr>
					{:else}
						<tr style="cursor: default">
							<td colspan="6">
								<div class="cl-budget-empty" style="text-align: center; padding: 24px 0">
									Niciun raport trimis încă — primul pleacă conform programării.
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	{#if editing}
		<ProjectModal
			project={editing === 'new' ? null : editing}
			{clients}
			onclose={() => (editing = null)}
			onsave={onSaveProject}
			ondelete={onDeleteProject}
		/>
	{/if}

	{#if showSched}
		<RankSettingsModal {settings} onclose={() => (showSched = false)} onsave={onSaveSettings} />
	{/if}

	{#if preview}
		<ReportPreviewModal
			title="Raport poziții — toate proiectele"
			hour={settings?.checkHour ?? '06:00'}
			recipients={settings?.recipients ?? []}
			rows={[]}
			vis={totals.avgVisibility}
			avg={portfolio.avg}
			buckets={portfolio.dist}
			total={portfolio.keywords}
			lastDay={lastRunAt ? psiFmtDateTime(lastRunAt) : ''}
			onclose={() => (preview = false)}
			onsend={onSendReport}
		/>
	{/if}

	{#if toast}
		<div class="psi-toast" role="status" aria-live="polite"><CheckIcon size={14} /> {toast}</div>
	{/if}
</div>
