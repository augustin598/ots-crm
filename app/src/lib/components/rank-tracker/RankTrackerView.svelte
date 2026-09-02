<script lang="ts">
	// Rank Tracker — hub-ul de proiecte (SEO Links → Rank Tracker).
	import '../pagespeed/pagespeed.css';
	import './rank-tracker.css';
	import { page } from '$app/state';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PsiFav from '../pagespeed/PsiFav.svelte';
	import PsiDelta from '../pagespeed/PsiDelta.svelte';
	import RkDistBar from './RkDistBar.svelte';
	import ProjectModal from './ProjectModal.svelte';
	import RankSettingsModal from './RankSettingsModal.svelte';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
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
	const reports = $derived(reportsQuery.current ?? []);
	const alerts = $derived(alertsQuery.current ?? []);
	const clients = $derived(clientsQuery.current ?? []);
	const settings = $derived(settingsQuery.current ?? null);

	const base = $derived(`/${page.params.tenant}/seo-links/rank-tracker`);

	let toast = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	function showToast(message: string) {
		toast = message;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 3200);
	}

	let projectModalOpen = $state(false);
	let editing = $state<RankProjectListRow | null>(null);
	let settingsOpen = $state(false);
	let busyId = $state<string | null>(null);

	const nf = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 1 });

	function openNew() {
		editing = null;
		projectModalOpen = true;
	}
	function openEdit(p: RankProjectListRow) {
		editing = p;
		projectModalOpen = true;
	}

	async function verify(id: string) {
		busyId = id;
		try {
			await startRankCheck(id);
			showToast('Verificare pornită — pozițiile apar în câteva minute.');
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Verificarea nu a putut porni'));
		} finally {
			busyId = null;
		}
	}

	async function onSaveProject(payload: Parameters<typeof saveRankProject>[0]) {
		try {
			await saveRankProject(payload).updates(projectsQuery);
			projectModalOpen = false;
			showToast('Proiect salvat.');
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Proiectul nu a putut fi salvat'));
		}
	}
	async function onDeleteProject(id: string) {
		try {
			await deleteRankProject(id).updates(projectsQuery);
			projectModalOpen = false;
			showToast('Proiect șters.');
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Proiectul nu a putut fi șters'));
		}
	}
	async function onSaveSettings(payload: Parameters<typeof saveRankSettings>[0], creds: { login: string; password: string } | null) {
		try {
			await saveRankSettings(payload).updates(settingsQuery);
			if (creds) await saveSerpIntegration(creds).updates(settingsQuery);
			settingsOpen = false;
			showToast('Setări salvate.');
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Setările nu au putut fi salvate'));
		}
	}
	async function onSendNow() {
		try {
			const r = await sendRankReportNow(undefined).updates(reportsQuery);
			showToast(r.sent > 0 ? `Raport trimis către ${r.sent} destinatari.` : 'Niciun destinatar configurat.');
		} catch (error) {
			showToast(remoteErrorMessage(error, 'Raportul nu a putut fi trimis'));
		}
	}

	function statusLabel(status: string | null): { text: string; cls: string } {
		if (status === 'ok') return { text: 'OK', cls: 'ok' };
		if (status === 'partial') return { text: 'Parțial', cls: 'warn' };
		if (status === 'running') return { text: 'În curs', cls: 'warn' };
		if (status === 'interrupted') return { text: 'Întrerupt', cls: 'danger' };
		return { text: '—', cls: 'muted' };
	}
	const fmtDateTime = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
</script>

<div class="cl-wrap" data-screen-label="Rank Tracker">
	<div class="cl-hero">
		<div class="cl-hero-main">
			<h1 class="cl-hero-title">Rank Tracker</h1>
			<p class="cl-hero-sub">Poziții Google organic, urmărite zilnic per cuvânt cheie, dispozitiv și locație.</p>
		</div>
		<div class="cl-hero-actions">
			<button class="cl-btn-secondary" onclick={() => (settingsOpen = true)}>
				<SettingsIcon size={15} /> Setări raport
			</button>
			<button class="cl-btn-primary" onclick={openNew}>
				<PlusIcon size={15} /> Proiect nou
			</button>
		</div>
	</div>

	<div class="cl-kpis">
		<div class="cl-kpi"><div class="cl-kpi-val">{totals.projectCount}</div><div class="cl-kpi-lbl">Proiecte active</div></div>
		<div class="cl-kpi"><div class="cl-kpi-val">{totals.keywordCount}</div><div class="cl-kpi-lbl">Cuvinte cheie</div></div>
		<div class="cl-kpi"><div class="cl-kpi-val">{nf.format(totals.avgVisibility)}%</div><div class="cl-kpi-lbl">Vizibilitate medie</div></div>
		<div class="cl-kpi"><div class="cl-kpi-val">{totals.alertsLast7d}</div><div class="cl-kpi-lbl">Alerte (7 zile)</div></div>
	</div>

	<div class="cl-section">
		<div class="cl-section-head"><h2 class="cl-section-title">Proiecte</h2></div>
		{#if projects.length === 0}
			<div class="cl-empty">
				<TrendingUpIcon size={28} />
				<p>Niciun proiect încă. Adaugă primul domeniu pe care vrei să-i urmărești pozițiile.</p>
				<button class="cl-btn-primary" onclick={openNew}><PlusIcon size={15} /> Proiect nou</button>
			</div>
		{:else}
			<div class="psi-table-scroll">
				<table class="cl-list-table">
					<thead>
						<tr>
							<th>Domeniu</th><th>Client</th><th>Cuvinte</th><th>Vizibilitate</th>
							<th>Poz. medie</th><th>Distribuție</th><th>Ultima rulare</th><th>Alerte</th><th></th>
						</tr>
					</thead>
					<tbody>
						{#each projects as p (p.id)}
							{@const st = statusLabel(p.lastRunStatus)}
							<tr class:cl-row-muted={p.paused}>
								<td>
									<a class="cl-cell-link" href="{base}/{p.id}">
										<PsiFav id={p.id} domain={p.domain} url={`https://${p.domain}`} />
										<span>{p.domain}{#if p.paused}<span class="rk-tag">pauză</span>{/if}</span>
									</a>
								</td>
								<td>{p.clientName ?? '—'}</td>
								<td>{p.keywordCount}</td>
								<td>
									{nf.format(p.visibility)}%
									{#if p.deltaVisibility != null && p.deltaVisibility !== 0}<PsiDelta value={p.deltaVisibility} suffix=" pct" />{/if}
								</td>
								<td>{p.avgPosition != null ? nf.format(p.avgPosition) : '—'}</td>
								<td><RkDistBar distribution={p.distribution} /></td>
								<td>
									<span class="psi-tag {st.cls}">{st.text}</span>
									<div class="rk-pos-page">{fmtDateTime(p.lastRunAt)}</div>
								</td>
								<td class:cl-alert-cell={p.alertsLast7d > 0}>{p.alertsLast7d}</td>
								<td class="cl-row-actions">
									<button class="cl-btn-mini" title="Verifică acum" disabled={busyId === p.id} onclick={() => verify(p.id)}>
										<RefreshCwIcon size={14} class={busyId === p.id ? 'cl-spin' : ''} />
									</button>
									<button class="cl-btn-mini" title="Editează" onclick={() => openEdit(p)}><PencilIcon size={14} /></button>
									<a class="cl-btn-mini" title="Deschide" href="{base}/{p.id}"><ChevronRightIcon size={14} /></a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<div class="cl-section">
		<div class="cl-section-head">
			<h2 class="cl-section-title">Rapoarte trimise</h2>
			<button class="cl-btn-secondary cl-btn-sm" onclick={onSendNow}>Trimite acum</button>
		</div>
		{#if reports.length === 0}
			<p class="cl-muted">Niciun raport trimis încă. Se trimit automat săptămânal, conform setărilor.</p>
		{:else}
			<div class="psi-table-scroll">
				<table class="cl-list-table">
					<thead><tr><th>Săptămâna</th><th>Proiecte</th><th>Vizibilitate</th><th>Alerte</th><th>Status</th><th>Trimis</th></tr></thead>
					<tbody>
						{#each reports as r (r.id)}
							<tr>
								<td>{r.weekKey}</td>
								<td>{r.projectCount}</td>
								<td>{r.visibility != null ? nf.format(r.visibility) : '—'}%</td>
								<td>{r.alertCount}</td>
								<td><span class="psi-tag {r.status === 'sent' ? 'ok' : r.status === 'partial' ? 'warn' : 'muted'}">{r.status}</span></td>
								<td>{fmtDateTime(r.sentAt ? new Date(r.sentAt).toISOString() : null)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	{#if alerts.length > 0}
		<div class="cl-section">
			<div class="cl-section-head"><h2 class="cl-section-title"><TriangleAlertIcon size={16} /> Alerte recente</h2></div>
			<div class="psi-table-scroll">
				<table class="cl-list-table">
					<thead><tr><th>Cuvânt cheie</th><th>Dispozitiv</th><th>Schimbare</th><th>Tip</th><th>Când</th></tr></thead>
					<tbody>
						{#each alerts as a (a.id)}
							<tr>
								<td>{a.keyword}</td>
								<td>{a.device === 'mobile' ? 'mobil' : 'desktop'}</td>
								<td>{a.fromPosition ?? '100+'} → {a.toPosition ?? '100+'}</td>
								<td><span class="psi-tag danger">{a.type === 'drop' ? 'scădere' : a.type === 'out_of_top10' ? 'ieșit din top 10' : 'dispărut'}</span></td>
								<td>{fmtDateTime(a.createdAt ? new Date(a.createdAt).toISOString() : null)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	{#if toast}
		<div class="psi-toast" role="status" aria-live="polite"><CheckIcon size={14} /> {toast}</div>
	{/if}

	{#if projectModalOpen}
		<ProjectModal
			project={editing}
			{clients}
			onclose={() => (projectModalOpen = false)}
			onsave={onSaveProject}
			ondelete={onDeleteProject}
		/>
	{/if}

	{#if settingsOpen}
		<RankSettingsModal {settings} onclose={() => (settingsOpen = false)} onsave={onSaveSettings} />
	{/if}
</div>
