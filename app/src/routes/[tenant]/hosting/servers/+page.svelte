<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import {
		getDAServersWithStats,
		testDAServer,
		syncDAPackages,
		deleteDAServer
	} from '$lib/remotes/da-servers.remote';
	import ServerIcon from '@lucide/svelte/icons/server';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import SearchIcon from '@lucide/svelte/icons/search';
	import Columns3Icon from '@lucide/svelte/icons/columns-3';
	import ListIcon from '@lucide/svelte/icons/list';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import MoreHorizontalIcon from '@lucide/svelte/icons/ellipsis';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import WifiIcon from '@lucide/svelte/icons/wifi';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import NewServerModal from './_new-server-modal.svelte';
	import { focusTrap } from '$lib/actions/focus-trap';

	type Status = 'online' | 'warning' | 'maintenance' | 'offline';

	type ServerRow = {
		id: string;
		name: string;
		hostname: string;
		port: number;
		useHttps: boolean;
		isActive: boolean;
		lastCheckedAt: string | null;
		lastError: string | null;
		daVersion: string | null;
		lastSyncResult: {
			ranAt: string;
			packageCount: number;
			synced: number;
			updated: number;
			deactivated: number;
			failures: { pkg: string; error: string }[];
		} | null;
		createdAt: Date;
		accountsCount: number;
		packagesCount: number;
		metrics: {
			cpu: number;
			cpuModel: string | null;
			coresCount: number;
			load1: number;
			load5: number;
			load15: number;
			memory: number;
			ramUsedBytes: number;
			ramTotalBytes: number;
			disk: number;
			diskUsedBytes: number;
			diskTotalBytes: number;
			diskMount: string;
			bandwidthBytes: number | null;
		} | null;
	};

	const tenantSlug = $derived(page.params.tenant);

	let serversPromise = $state(getDAServersWithStats());

	async function refresh() {
		serversPromise = getDAServersWithStats();
	}

	function statusOf(s: ServerRow): Status {
		if (s.lastError) return 'warning';
		return 'online';
	}

	function fmtRelative(iso: string | null | undefined): string {
		if (!iso) return '—';
		const t = new Date(iso).getTime();
		if (Number.isNaN(t)) return '—';
		const diff = Date.now() - t;
		const min = Math.floor(diff / 60_000);
		if (min < 1) return 'acum câteva secunde';
		if (min < 60) return `acum ${min} min`;
		const h = Math.floor(min / 60);
		if (h < 24) return `acum ${h} ${h === 1 ? 'oră' : 'ore'}`;
		const d = Math.floor(h / 24);
		return `acum ${d} ${d === 1 ? 'zi' : 'zile'}`;
	}

	function uptimeDays(createdAt: Date | string): number {
		const t = typeof createdAt === 'string' ? new Date(createdAt).getTime() : createdAt.getTime();
		const diff = Date.now() - t;
		return Math.max(0, Math.floor(diff / 86_400_000));
	}

	function externalUrl(s: ServerRow): string {
		const proto = s.useHttps ? 'https' : 'http';
		return `${proto}://${s.hostname}:${s.port}`;
	}

	// ----- view state -----
	let view = $state<'grid' | 'table'>('grid');
	let filter = $state<'all' | 'online' | 'warning' | 'maintenance'>('all');
	let search = $state('');
	let openServer = $state<ServerRow | null>(null);
	let showNewServer = $state(false);
	let flash = $state<string | null>(null);
	let syncingAll = $state(false);
	let syncingId = $state<string | null>(null);

	// ----- actions -----
	async function handleSync(id: string) {
		syncingId = id;
		try {
			const r = await syncDAPackages(id);
			toast.success(
				`${r.synced} adăugate · ${r.updated} actualizate · ${r.deactivated} dezactivate (din ${r.total})`
			);
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare sync');
		} finally {
			syncingId = null;
		}
	}

	async function handleSyncAll(list: ServerRow[]) {
		if (syncingAll) return;
		syncingAll = true;
		try {
			const results = await Promise.allSettled(list.map((s) => syncDAPackages(s.id)));
			const ok = results.filter((r) => r.status === 'fulfilled').length;
			const failed = results.length - ok;
			if (failed === 0) toast.success(`Sync OK pe toate ${ok} serverele`);
			else toast.warning(`Sync: ${ok} OK, ${failed} eșecuri`);
			await refresh();
		} finally {
			syncingAll = false;
		}
	}

	async function handleTest(id: string) {
		try {
			const r = await testDAServer(id);
			if (r.online) toast.success(`Online (${r.responseMs}ms)`);
			else toast.error(r.error ?? 'Offline');
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare test');
		}
	}

	// Typed-confirmation pattern (GitHub-style): user must type the server
	// name exactly to enable the confirm button. Prevents accidental
	// dezactivare and forces the user to read which server they're acting on.
	let deleteCandidate = $state<ServerRow | null>(null);
	let deleteInput = $state('');
	let deleting = $state(false);

	function openDeleteDialog(s: ServerRow) {
		deleteCandidate = s;
		deleteInput = '';
	}

	async function confirmDelete() {
		if (!deleteCandidate) return;
		if (deleteInput.trim() !== deleteCandidate.name) return;
		deleting = true;
		try {
			const id = deleteCandidate.id;
			await deleteDAServer(id);
			toast.success(`Server „${deleteCandidate.name}" dezactivat`);
			if (openServer?.id === id) openServer = null;
			deleteCandidate = null;
			deleteInput = '';
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare ștergere');
		} finally {
			deleting = false;
		}
	}

	function exportCsv(list: ServerRow[]) {
		const header = [
			'Nume',
			'Hostname',
			'Port',
			'Protocol',
			'Status',
			'Conturi',
			'Pachete',
			'Ultim check',
			'DA Version'
		];
		const rows = list.map((s) => [
			s.name,
			s.hostname,
			String(s.port),
			s.useHttps ? 'https' : 'http',
			statusOf(s),
			String(s.accountsCount),
			String(s.packagesCount),
			s.lastCheckedAt ?? '',
			s.daVersion ?? ''
		]);
		const csv = [header, ...rows]
			.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
			.join('\n');
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `servere-directadmin-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// ----- counts + filtering -----
	function counts(list: ServerRow[]) {
		return {
			all: list.length,
			online: list.filter((s) => statusOf(s) === 'online').length,
			warning: list.filter((s) => statusOf(s) === 'warning').length,
			maintenance: 0
		};
	}

	function applyFilters(list: ServerRow[]): ServerRow[] {
		return list.filter((s) => {
			if (filter !== 'all' && statusOf(s) !== filter) return false;
			if (search) {
				const q = search.toLowerCase();
				if (!s.name.toLowerCase().includes(q) && !s.hostname.toLowerCase().includes(q))
					return false;
			}
			return true;
		});
	}

	function meterClass(v: number | null | undefined): 'good' | 'warn' | 'danger' | 'empty' {
		if (v === null || v === undefined) return 'empty';
		if (v >= 80) return 'danger';
		if (v >= 60) return 'warn';
		return 'good';
	}

	function fmtPct(v: number | null | undefined): string {
		if (v === null || v === undefined) return '—';
		return `${Math.round(v)}%`;
	}

	function fmtBytes(bytes: number | null | undefined, fractionDigits = 1): string {
		if (bytes === null || bytes === undefined) return '—';
		const mb = bytes / 1_048_576;
		if (mb < 1024) return `${mb.toFixed(0)} MB`;
		const gb = mb / 1024;
		if (gb < 1024) return `${gb.toFixed(fractionDigits)} GB`;
		return `${(gb / 1024).toFixed(2)} TB`;
	}

	function statusLabel(s: Status): string {
		return { online: 'Online', warning: 'Atenție', maintenance: 'Mentenanță', offline: 'Offline' }[
			s
		];
	}
</script>

<div class="hst-page">
	{#await serversPromise}
		<div class="hst-loading">Se încarcă…</div>
	{:then servers}
		{@const c = counts(servers)}
		{@const filtered = applyFilters(servers)}
		{@const totalAccounts = servers.reduce((a, s) => a + s.accountsCount, 0)}
		{@const totalPackages = servers.reduce((a, s) => a + s.packagesCount, 0)}
		{@const alerts = servers.filter((s) => s.lastError).length}
		{@const withMetrics = servers.filter((s) => s.metrics)}
		{@const avgCpu =
			withMetrics.length > 0
				? Math.round(withMetrics.reduce((a, s) => a + (s.metrics?.cpu ?? 0), 0) / withMetrics.length)
				: null}
		{@const totalBandwidthBytes = servers.reduce(
			(a, s) => a + (s.metrics?.bandwidthBytes ?? 0),
			0
		)}

		<div class="hst-hero">
			<div>
				<h1>Servere DirectAdmin</h1>
				<p>
					{c.online} online · {c.warning} cu atenție · {c.maintenance} mentenanță · găzduiesc {totalAccounts}
					conturi
				</p>
			</div>
			<div class="hst-hero-actions">
				<button
					class="btn-secondary"
					onclick={() => handleSyncAll(servers)}
					disabled={syncingAll || servers.length === 0}
				>
					<RefreshCwIcon class={syncingAll ? 'hst-spin' : ''} size={13} />
					{syncingAll ? 'Se sincronizează…' : 'Sync toate'}
				</button>
				<button class="btn-primary" onclick={() => (showNewServer = true)}>
					<PlusIcon size={14} /> Server nou
				</button>
			</div>
		</div>

		<div class="hst-kpis">
			<div class="dash-kpi primary">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(24,119,242,.12); color:#1877F2;">
						<ServerIcon size={13} />
					</div>
					<span class="dash-kpi-label">Servere</span>
				</div>
				<div class="dash-kpi-value">{c.all}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub"
						>{c.online} online · {c.warning + c.maintenance} probleme</span
					>
				</div>
			</div>

			<div class="dash-kpi info">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(99,102,241,.12); color:#6366f1;">
						<CpuIcon size={13} />
					</div>
					<span class="dash-kpi-label">CPU mediu</span>
				</div>
				<div class="dash-kpi-value">{avgCpu !== null ? `${avgCpu}%` : '—'}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">
						{withMetrics.length > 0
							? `pe ${withMetrics.length} ${withMetrics.length === 1 ? 'server' : 'servere'} cu metrici live`
							: 'metrici live indisponibile'}
					</span>
				</div>
			</div>

			<div class="dash-kpi success">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(16,185,129,.12); color:#10b981;">
						<HardDriveIcon size={13} />
					</div>
					<span class="dash-kpi-label">Pachete sincronizate</span>
				</div>
				<div class="dash-kpi-value">{totalPackages}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">pe toate serverele</span>
				</div>
			</div>

			<div class="dash-kpi success">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(16,185,129,.12); color:#10b981;">
						<DatabaseIcon size={13} />
					</div>
					<span class="dash-kpi-label">Conturi găzduite</span>
				</div>
				<div class="dash-kpi-value">{totalAccounts}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">distribuite pe servere</span>
				</div>
			</div>

			<div class="dash-kpi info">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(99,102,241,.12); color:#6366f1;">
						<WifiIcon size={13} />
					</div>
					<span class="dash-kpi-label">Trafic total folosit</span>
				</div>
				<div class="dash-kpi-value">
					{withMetrics.length > 0 ? fmtBytes(totalBandwidthBytes) : '—'}
				</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub">
						{withMetrics.length > 0
							? `agregat din ${withMetrics.length} ${withMetrics.length === 1 ? 'server' : 'servere'}`
							: 'metrici live indisponibile'}
					</span>
				</div>
			</div>

			<div class="dash-kpi warn">
				<div class="dash-kpi-head">
					<div class="dash-kpi-icon" style="background:rgba(245,158,11,.12); color:#f59e0b;">
						<AlertTriangleIcon size={13} />
					</div>
					<span class="dash-kpi-label">Alerte active</span>
				</div>
				<div class="dash-kpi-value">{alerts}</div>
				<div class="dash-kpi-foot">
					<span class="dash-kpi-sub"
						>{alerts === 0 ? 'toate serverele OK' : 'servere cu erori la ultim check'}</span
					>
				</div>
			</div>
		</div>

		<div class="hst-toolbar">
			<div class="hst-search">
				<SearchIcon size={13} />
				<input placeholder="Caută hostname, nume server…" bind:value={search} />
			</div>
			<button
				class="hst-filter-chip"
				class:active={filter === 'all'}
				onclick={() => (filter = 'all')}
				aria-pressed={filter === 'all'}
			>
				Toate <span style="opacity:.7">{c.all}</span>
			</button>
			<button
				class="hst-filter-chip"
				class:active={filter === 'online'}
				onclick={() => (filter = 'online')}
				aria-pressed={filter === 'online'}
			>
				Online <span style="opacity:.7">{c.online}</span>
			</button>
			<button
				class="hst-filter-chip"
				class:active={filter === 'warning'}
				onclick={() => (filter = 'warning')}
				aria-pressed={filter === 'warning'}
			>
				Atenție <span style="opacity:.7">{c.warning}</span>
			</button>
			<button
				class="hst-filter-chip"
				class:active={filter === 'maintenance'}
				onclick={() => (filter = 'maintenance')}
				aria-pressed={filter === 'maintenance'}
			>
				Mentenanță <span style="opacity:.7">{c.maintenance}</span>
			</button>
			<div class="hst-toolbar-spacer"></div>
			<div class="hst-view-toggle">
				<button
					class:active={view === 'grid'}
					onclick={() => (view = 'grid')}
					aria-pressed={view === 'grid'}
				>
					<Columns3Icon size={11} /> Carduri
				</button>
				<button
					class:active={view === 'table'}
					onclick={() => (view = 'table')}
					aria-pressed={view === 'table'}
				>
					<ListIcon size={11} /> Tabel
				</button>
			</div>
			<button class="btn-secondary" onclick={() => exportCsv(filtered)}>
				<DownloadIcon size={13} /> Export
			</button>
		</div>

		{#if filtered.length === 0}
			<div class="hst-empty">
				<ServerIcon size={40} />
				<p>{servers.length === 0 ? 'Niciun server configurat' : 'Niciun rezultat'}</p>
				{#if servers.length === 0}
					<button class="btn-primary" onclick={() => (showNewServer = true)}>
						<PlusIcon size={14} /> Adaugă primul server
					</button>
				{/if}
			</div>
		{:else if view === 'grid'}
			<div class="hst-server-grid">
				{#each filtered as s (s.id)}
					{@const st = statusOf(s)}
					{@const m = s.metrics}
					<div class="hst-server-card" class:warning={st === 'warning'}>
						<div class="hst-server-card-head">
							<div class="hst-server-card-icon"><ServerIcon size={18} /></div>
							<div class="hst-server-card-text">
								<div class="hst-server-card-name">{s.name}</div>
								<div class="hst-server-card-meta">
									<span>{s.hostname}:{s.port}</span>
									<span>·</span>
									<span>{s.useHttps ? 'HTTPS' : 'HTTP'}</span>
									{#if s.daVersion}
										<span>·</span>
										<span>{s.daVersion}</span>
									{/if}
								</div>
							</div>
							<span class="hst-status-pill {st}">
								<span class="dot"></span>
								{statusLabel(st)}
							</span>
						</div>

						<div class="hst-server-metrics">
							<div class="hst-metric">
								<div class="hst-metric-head">
									<span>CPU</span><strong>{fmtPct(m?.cpu)}</strong>
								</div>
								<div class="hst-metric-bar">
									<div
										class="hst-metric-bar-fill {meterClass(m?.cpu)}"
										style="width:{m?.cpu ?? 0}%"
									></div>
								</div>
							</div>
							<div class="hst-metric">
								<div class="hst-metric-head">
									<span>RAM</span><strong>{fmtPct(m?.memory)}</strong>
								</div>
								<div class="hst-metric-bar">
									<div
										class="hst-metric-bar-fill {meterClass(m?.memory)}"
										style="width:{m?.memory ?? 0}%"
									></div>
								</div>
							</div>
							<div class="hst-metric">
								<div class="hst-metric-head">
									<span>Disk</span><strong>{fmtPct(m?.disk)}</strong>
								</div>
								<div class="hst-metric-bar">
									<div
										class="hst-metric-bar-fill {meterClass(m?.disk)}"
										style="width:{m?.disk ?? 0}%"
									></div>
								</div>
							</div>
							<div class="hst-metric">
								<div class="hst-metric-head">
									<span>Trafic</span><strong>{fmtBytes(m?.bandwidthBytes)}</strong>
								</div>
								<div class="hst-metric-bar">
									<div class="hst-metric-bar-fill empty" style="width:0%"></div>
								</div>
							</div>
						</div>

						<div class="hst-server-foot">
							<div class="hst-server-foot-info">
								<strong>{s.accountsCount}</strong> conturi · <strong>{s.packagesCount}</strong> pachete
								· uptime {uptimeDays(s.createdAt)}d · {fmtRelative(s.lastCheckedAt)}
							</div>
							<div class="hst-server-actions">
								<button
									class="hst-icon-btn"
									title="Sync DirectAdmin"
									aria-label="Sync DirectAdmin"
									onclick={() => handleSync(s.id)}
									disabled={syncingId === s.id}
								>
									<RefreshCwIcon class={syncingId === s.id ? 'hst-spin' : ''} size={13} />
								</button>
								<a
									class="hst-icon-btn"
									href={externalUrl(s)}
									target="_blank"
									rel="noopener noreferrer"
									title="Deschide DA"
									aria-label="Deschide DA"
								>
									<ExternalLinkIcon size={13} />
								</a>
								<button
									class="hst-icon-btn"
									title="Detalii"
									aria-label="Detalii server"
									onclick={() => (openServer = s)}
								>
									<MoreHorizontalIcon size={13} />
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="hst-table-wrap">
				<table class="hst-table">
					<thead>
						<tr>
							<th>Server</th>
							<th>Adresă</th>
							<th class="num">Conturi</th>
							<th class="num">Pachete</th>
							<th>Ultim check</th>
							<th>Status</th>
							<th style="width:140px">Acțiuni</th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as s (s.id)}
							{@const st = statusOf(s)}
							<tr onclick={() => (openServer = s)}>
								<td>
									<div class="hst-host-cell">{s.name}</div>
									<div class="hst-host-sub">{s.hostname}:{s.port}</div>
								</td>
								<td>
									<span class="hst-mono">{s.useHttps ? 'https' : 'http'}://{s.hostname}</span>
								</td>
								<td class="num"><strong>{s.accountsCount}</strong></td>
								<td class="num"><strong>{s.packagesCount}</strong></td>
								<td>{fmtRelative(s.lastCheckedAt)}</td>
								<td>
									<span class="hst-status-pill {st}">
										<span class="dot"></span>
										{statusLabel(st)}
									</span>
								</td>
								<td onclick={(e) => e.stopPropagation()}>
									<div class="hst-row-actions">
										<button
											class="hst-icon-btn"
											title="Test conexiune"
											aria-label="Test conexiune"
											onclick={() => handleTest(s.id)}
										>
											<CheckIcon size={12} />
										</button>
										<button
											class="hst-icon-btn"
											title="Sync"
											aria-label="Sync"
											onclick={() => handleSync(s.id)}
											disabled={syncingId === s.id}
										>
											<RefreshCwIcon class={syncingId === s.id ? 'hst-spin' : ''} size={12} />
										</button>
										<a
											class="hst-icon-btn"
											href={externalUrl(s)}
											target="_blank"
											rel="noopener noreferrer"
											title="Open DA"
											aria-label="Open DA"
										>
											<ExternalLinkIcon size={12} />
										</a>
										<button
											class="hst-icon-btn"
											title="Detalii"
											aria-label="Detalii"
											onclick={() => (openServer = s)}
										>
											<MoreHorizontalIcon size={12} />
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if openServer}
			{@const s = openServer}
			{@const st = statusOf(s)}
			{@const dm = s.metrics}
			<div
				class="hst-drawer-back"
				role="dialog"
				aria-modal="true"
				aria-label="Detalii server"
				tabindex={-1}
				onclick={() => (openServer = null)}
				onkeydown={() => {
					/* focusTrap handles Escape */
				}}
				use:focusTrap={{
					active: true,
					onEscape: () => (openServer = null),
					initialFocus: '.hst-drawer-close'
				}}
			>
			<div
				class="hst-drawer"
				role="none"
				onclick={(e) => e.stopPropagation()}
				onkeydown={() => {}}
			>
				<div class="hst-drawer-head">
					<div class="hst-server-card-icon"><ServerIcon size={18} /></div>
					<div style="flex:1; min-width:0">
						<div class="hst-drawer-title">{s.name}</div>
						<div class="hst-drawer-sub">{s.hostname}:{s.port}</div>
					</div>
					<span class="hst-status-pill {st}"><span class="dot"></span>{statusLabel(st)}</span>
					<button
						class="hst-drawer-close"
						onclick={() => (openServer = null)}
						aria-label="Închide"
					>
						<XIcon size={14} />
					</button>
				</div>

				<div class="hst-drawer-body">
					<section class="hst-drawer-section">
						<h4>Resurse curente</h4>
						<div class="hst-server-metrics">
							<div class="hst-metric">
								<div class="hst-metric-head">
									<span>CPU{dm?.cpuModel ? ` · ${dm.cpuModel}` : ''}</span>
									<strong>{fmtPct(dm?.cpu)}</strong>
								</div>
								<div class="hst-metric-bar">
									<div
										class="hst-metric-bar-fill {meterClass(dm?.cpu)}"
										style="width:{dm?.cpu ?? 0}%"
									></div>
								</div>
							</div>
							<div class="hst-metric">
								<div class="hst-metric-head">
									<span>RAM</span>
									<strong>
										{#if dm}{fmtBytes(dm.ramUsedBytes)} / {fmtBytes(dm.ramTotalBytes)}{:else}—{/if}
									</strong>
								</div>
								<div class="hst-metric-bar">
									<div
										class="hst-metric-bar-fill {meterClass(dm?.memory)}"
										style="width:{dm?.memory ?? 0}%"
									></div>
								</div>
							</div>
							<div class="hst-metric">
								<div class="hst-metric-head">
									<span>Disk{dm?.diskMount ? ` · ${dm.diskMount}` : ''}</span>
									<strong>
										{#if dm}{fmtBytes(dm.diskUsedBytes)} / {fmtBytes(dm.diskTotalBytes)}{:else}—{/if}
									</strong>
								</div>
								<div class="hst-metric-bar">
									<div
										class="hst-metric-bar-fill {meterClass(dm?.disk)}"
										style="width:{dm?.disk ?? 0}%"
									></div>
								</div>
							</div>
							<div class="hst-metric">
								<div class="hst-metric-head">
									<span>Trafic folosit (lunar)</span>
									<strong>{fmtBytes(dm?.bandwidthBytes)}</strong>
								</div>
								<div class="hst-metric-bar">
									<div class="hst-metric-bar-fill empty" style="width:0%"></div>
								</div>
							</div>
						</div>
						{#if dm}
							<div class="hst-loadline">
								Load {dm.load1.toFixed(2)} / {dm.load5.toFixed(2)} / {dm.load15.toFixed(2)}
								· {dm.coresCount} {dm.coresCount === 1 ? 'core' : 'cores'}
							</div>
						{/if}
						<p class="hst-note">
							{#if dm}
								Date live preluate prin DirectAdmin API (resource-usage + admin-usage). Refresh la
								60 s — reîncarcă pagina pentru o citire imediată.
							{:else}
								Metricile live nu au putut fi preluate (server offline, endpoint indisponibil, sau
								timeout). Folosește <strong>Deschide DA</strong> pentru status în timp real.
							{/if}
						</p>
					</section>

					<section class="hst-drawer-section">
						<h4>Network & Identitate</h4>
						<div class="hst-kv-grid">
							<div class="hst-kv">
								<div class="hst-kv-l">Nume intern</div>
								<div class="hst-kv-v">{s.name}</div>
							</div>
							<div class="hst-kv">
								<div class="hst-kv-l">Hostname</div>
								<div class="hst-kv-v mono">{s.hostname}</div>
							</div>
							<div class="hst-kv">
								<div class="hst-kv-l">Port</div>
								<div class="hst-kv-v mono">{s.port}</div>
							</div>
							<div class="hst-kv">
								<div class="hst-kv-l">Protocol</div>
								<div class="hst-kv-v">{s.useHttps ? 'HTTPS' : 'HTTP'}</div>
							</div>
							<div class="hst-kv">
								<div class="hst-kv-l">Panel</div>
								<div class="hst-kv-v">{s.daVersion ?? 'DirectAdmin (versiune necunoscută)'}</div>
							</div>
							<div class="hst-kv">
								<div class="hst-kv-l">URL efectiv</div>
								<div class="hst-kv-v mono">{externalUrl(s)}</div>
							</div>
						</div>
					</section>

					<section class="hst-drawer-section">
						<h4>Credențiale DirectAdmin API</h4>
						<div class="hst-cred-note">
							Credențialele (utilizator + parolă / login key) sunt criptate
							<strong>AES-256-GCM</strong> per tenant și nu sunt vizibile în listare. Le poți schimba din ecranul de
							<a href="/{tenantSlug}/hosting/servers/{s.id}">detalii server</a>.
						</div>
					</section>

					<section class="hst-drawer-section">
						<h4>Health</h4>
						<div class="hst-kv-grid">
							<div class="hst-kv">
								<div class="hst-kv-l">Uptime curent</div>
								<div class="hst-kv-v">{uptimeDays(s.createdAt)} zile</div>
							</div>
							<div class="hst-kv">
								<div class="hst-kv-l">Ultim check</div>
								<div class="hst-kv-v">{fmtRelative(s.lastCheckedAt)}</div>
							</div>
							<div class="hst-kv">
								<div class="hst-kv-l">Stare</div>
								<div class="hst-kv-v">
									{#if s.lastError}
										<span style="color:#b45309">⚠ {s.lastError}</span>
									{:else}
										<span style="color:#047857">OK</span>
									{/if}
								</div>
							</div>
							<div class="hst-kv">
								<div class="hst-kv-l">Adăugat</div>
								<div class="hst-kv-v">
									{new Date(s.createdAt).toLocaleDateString('ro-RO')}
								</div>
							</div>
						</div>
					</section>

					<section class="hst-drawer-section">
						<h4>Conținut găzduit</h4>
						<div class="hst-kv-grid">
							<div class="hst-kv">
								<div class="hst-kv-l">Conturi totale</div>
								<div class="hst-kv-v">{s.accountsCount}</div>
							</div>
							<div class="hst-kv">
								<div class="hst-kv-l">Pachete configurate</div>
								<div class="hst-kv-v">{s.packagesCount}</div>
							</div>
							<div class="hst-kv">
								<div class="hst-kv-l">Ultimul sync</div>
								<div class="hst-kv-v">
									{s.lastSyncResult?.ranAt
										? fmtRelative(s.lastSyncResult.ranAt)
										: 'niciodată'}
								</div>
							</div>
							<div class="hst-kv">
								<div class="hst-kv-l">Sync recent</div>
								<div class="hst-kv-v">
									{#if s.lastSyncResult}
										{s.lastSyncResult.synced + s.lastSyncResult.updated}/{s.lastSyncResult.packageCount}
										{#if s.lastSyncResult.failures.length > 0}
											· <span style="color:#b91c1c"
												>{s.lastSyncResult.failures.length} eșecuri</span
											>
										{/if}
									{:else}
										—
									{/if}
								</div>
							</div>
						</div>
					</section>
				</div>

				<div class="hst-drawer-foot">
					<div class="hst-foot-group">
						<button
							class="btn-secondary"
							onclick={() => handleSync(s.id)}
							disabled={syncingId === s.id}
						>
							<RefreshCwIcon class={syncingId === s.id ? 'hst-spin' : ''} size={13} />
							{syncingId === s.id ? 'Se sincronizează…' : 'Sync acum'}
						</button>
						<a
							class="btn-secondary"
							href={externalUrl(s)}
							target="_blank"
							rel="noopener noreferrer"
						>
							<ExternalLinkIcon size={13} /> Deschide DA
						</a>
					</div>
					<div class="hst-foot-group">
						<button
							class="btn-ghost danger"
							onclick={() => openDeleteDialog(s)}
							aria-label="Dezactivează server"
							title="Dezactivează server"
						>
							<Trash2Icon size={13} /> Dezactivează
						</button>
						<button
							class="btn-primary"
							onclick={() => goto(`/${tenantSlug}/hosting/servers/${s.id}`)}
						>
							<PencilIcon size={13} /> Editează & pachete
						</button>
					</div>
				</div>
			</div>
			</div>
		{/if}

		{#if showNewServer}
			<NewServerModal
				onClose={() => (showNewServer = false)}
				onAdded={async (name, online) => {
					showNewServer = false;
					flash = online
						? `Server „${name}" adăugat — conexiune validă.`
						: `Server „${name}" adăugat, dar conexiunea nu a răspuns.`;
					setTimeout(() => (flash = null), 4000);
					await refresh();
				}}
			/>
		{/if}

		{#if deleteCandidate}
			{@const cand = deleteCandidate}
			{@const matches = deleteInput.trim() === cand.name}
			<div
				class="hst-confirm-back"
				role="dialog"
				aria-modal="true"
				aria-labelledby="confirm-del-title"
				tabindex={-1}
				onclick={() => {
					if (!deleting) deleteCandidate = null;
				}}
				onkeydown={() => {
					/* focusTrap handles Escape */
				}}
				use:focusTrap={{
					active: true,
					onEscape: () => {
						if (!deleting) deleteCandidate = null;
					},
					initialFocus: '#confirm-del-input'
				}}
			>
				<div
					class="hst-confirm"
					role="none"
					onclick={(e) => e.stopPropagation()}
					onkeydown={() => {}}
				>
					<div class="hst-confirm-head">
						<div class="hst-confirm-icon"><Trash2Icon size={18} /></div>
						<div style="flex:1; min-width:0">
							<div class="hst-confirm-title" id="confirm-del-title">Dezactivează server</div>
							<div class="hst-confirm-sub">Acțiune cu impact — citește înainte de confirmare.</div>
						</div>
					</div>

					<div class="hst-confirm-body">
						<p class="hst-confirm-text">
							Vei dezactiva serverul <strong>{cand.name}</strong>
							(<span class="mono">{cand.hostname}:{cand.port}</span>). Acesta:
						</p>
						<ul class="hst-confirm-list">
							<li>dispare din listă și din selectoarele de pachete / conturi noi;</li>
							<li>
								<strong>{cand.accountsCount}</strong> conturi hosting și
								<strong>{cand.packagesCount}</strong> pachete sincronizate <strong>rămân</strong> în DB
								(soft-delete — fără pierdere de date);
							</li>
							<li>auditul ulterior funcționează normal — nu pierzi istoric.</li>
						</ul>
						<p class="hst-confirm-text">
							Ca să confirmi, scrie exact numele serverului: <code>{cand.name}</code>
						</p>
						<input
							id="confirm-del-input"
							class="hst-confirm-input"
							placeholder={cand.name}
							autocomplete="off"
							spellcheck="false"
							bind:value={deleteInput}
							onkeydown={(e) => {
								if (e.key === 'Enter' && matches && !deleting) confirmDelete();
							}}
						/>
					</div>

					<div class="hst-confirm-foot">
						<button
							type="button"
							class="btn-secondary"
							onclick={() => (deleteCandidate = null)}
							disabled={deleting}
						>
							Anulează
						</button>
						<button
							type="button"
							class="btn-danger"
							disabled={!matches || deleting}
							onclick={confirmDelete}
						>
							{#if deleting}
								<RefreshCwIcon class="hst-spin" size={13} /> Se dezactivează…
							{:else}
								<Trash2Icon size={13} /> Dezactivează definitiv
							{/if}
						</button>
					</div>
				</div>
			</div>
		{/if}

		{#if flash}
			<div class="hst-flash">
				<CheckIcon size={14} />
				{flash}
			</div>
		{/if}
	{/await}
</div>

<style>
	/* ===== Reset for this page ===== */
	/*
	 * The parent layout `<main>` already provides p-6 (24px) of inset on all
	 * sides, so this page does NOT add outer padding — only inter-section gap.
	 * Matches the visual rhythm of the rest of the CRM and keeps the hero
	 * tight against the OtsTopbar (design pack expects ~22px top, layout p-6
	 * gives 24px which is close enough).
	 */
	.hst-page {
		font-family:
			'Inter',
			system-ui,
			-apple-system,
			sans-serif;
		color: #0f172a;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.hst-loading,
	.hst-empty {
		padding: 48px 24px;
		text-align: center;
		color: #94a3b8;
		font-size: 13px;
	}
	.hst-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}
	.hst-empty :global(svg) {
		color: #cbd5e1;
	}

	/* ===== Hero ===== */
	.hst-hero {
		display: flex;
		align-items: flex-end;
		gap: 18px;
	}
	.hst-hero h1 {
		font-size: 24px;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin: 0;
	}
	.hst-hero p {
		color: #475569;
		font-size: 13px;
		margin: 4px 0 0;
	}
	.hst-hero-actions {
		margin-left: auto;
		display: flex;
		gap: 8px;
		align-items: center;
	}

	/* ===== Buttons ===== */
	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 7px;
		background: #1877f2;
		color: white;
		border: none;
		font-size: 12.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-primary:hover {
		background: #0d5cc7;
	}
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 7px;
		background: white;
		color: #475569;
		border: 1px solid #d5dbe5;
		font-size: 12.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		text-decoration: none;
		white-space: nowrap;
	}
	.btn-secondary:hover {
		border-color: #1877f2;
		color: #1877f2;
	}
	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-secondary.danger {
		color: #b91c1c;
	}
	.btn-secondary.danger:hover {
		border-color: #ef4444;
		color: #ef4444;
	}
	.btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		border-radius: 7px;
		background: transparent;
		color: #475569;
		border: none;
		font-size: 12.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-ghost:hover {
		background: #f4f6fa;
		color: #0f172a;
	}
	.btn-ghost.danger {
		color: #b91c1c;
	}
	.btn-ghost.danger:hover {
		background: #fef2f2;
		color: #b91c1c;
	}

	:global(.hst-spin) {
		animation: hst-spin-rotate 0.8s linear infinite;
	}
	@keyframes hst-spin-rotate {
		to {
			transform: rotate(360deg);
		}
	}

	/* ===== KPIs ===== */
	.hst-kpis {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 10px;
	}
	.dash-kpi {
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.dash-kpi-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dash-kpi-icon {
		width: 26px;
		height: 26px;
		border-radius: 7px;
		display: grid;
		place-items: center;
	}
	.dash-kpi-label {
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #94a3b8;
	}
	.dash-kpi-value {
		font-size: 26px;
		font-weight: 800;
		color: #0f172a;
		letter-spacing: -0.02em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.dash-kpi-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		color: #94a3b8;
	}

	/* ===== Toolbar ===== */
	.hst-toolbar {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	.hst-search {
		flex: 0 0 320px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: white;
		border: 1px solid #d5dbe5;
		border-radius: 8px;
		color: #94a3b8;
	}
	.hst-search :global(svg) {
		flex-shrink: 0;
	}
	.hst-search input {
		border: none;
		background: transparent;
		outline: none;
		flex: 1;
		font-size: 12.5px;
		font-family: inherit;
		color: #0f172a;
		min-width: 0;
	}
	.hst-filter-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		border-radius: 7px;
		background: white;
		color: #475569;
		border: 1px solid #d5dbe5;
		font-size: 12px;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
	}
	.hst-filter-chip:hover {
		border-color: #1877f2;
		color: #1877f2;
	}
	.hst-filter-chip.active {
		background: #1877f2;
		color: white;
		border-color: #1877f2;
	}
	.hst-toolbar-spacer {
		flex: 1;
	}
	.hst-view-toggle {
		display: flex;
		gap: 2px;
		background: white;
		border: 1px solid #d5dbe5;
		border-radius: 8px;
		padding: 3px;
	}
	.hst-view-toggle button {
		padding: 5px 10px;
		border-radius: 5px;
		border: none;
		background: transparent;
		font-size: 11.5px;
		font-weight: 600;
		color: #475569;
		font-family: inherit;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.hst-view-toggle button.active {
		background: #1877f2;
		color: white;
	}

	/* ===== Server grid (cards) ===== */
	.hst-server-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
		gap: 12px;
	}
	.hst-server-card {
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.hst-server-card.warning {
		border-color: #fde68a;
		box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.06);
	}
	.hst-server-card-head {
		display: flex;
		align-items: flex-start;
		gap: 10px;
	}
	.hst-server-card-icon {
		width: 38px;
		height: 38px;
		border-radius: 9px;
		background: linear-gradient(135deg, #1877f2, #0d5cc7);
		color: white;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.hst-server-card.warning .hst-server-card-icon {
		background: linear-gradient(135deg, #f59e0b, #d97706);
	}
	.hst-server-card-text {
		flex: 1;
		min-width: 0;
	}
	.hst-server-card-name {
		font-weight: 700;
		font-size: 14px;
		color: #0f172a;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hst-server-card-meta {
		font-size: 11.5px;
		color: #94a3b8;
		margin-top: 2px;
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		align-items: center;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}

	.hst-status-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 10.5px;
		font-weight: 700;
		background: rgba(16, 185, 129, 0.12);
		color: #047857;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		flex-shrink: 0;
	}
	.hst-status-pill.warning {
		background: rgba(245, 158, 11, 0.14);
		color: #b45309;
	}
	.hst-status-pill.maintenance {
		background: #f1f5f9;
		color: #475569;
	}
	.hst-status-pill.offline {
		background: #fee2e2;
		color: #b91c1c;
	}
	.hst-status-pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}

	.hst-server-metrics {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.hst-metric {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.hst-metric-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 10.5px;
		color: #94a3b8;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.hst-metric-head strong {
		color: #0f172a;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}
	.hst-metric-bar {
		height: 6px;
		background: #f1f5f9;
		border-radius: 3px;
		overflow: hidden;
	}
	.hst-metric-bar-fill {
		height: 100%;
		border-radius: 3px;
	}
	.hst-metric-bar-fill.good {
		background: #10b981;
	}
	.hst-metric-bar-fill.warn {
		background: #f59e0b;
	}
	.hst-metric-bar-fill.danger {
		background: #ef4444;
	}
	.hst-metric-bar-fill.empty {
		background: transparent;
	}

	.hst-server-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-top: 10px;
		border-top: 1px solid #f1f5f9;
		font-size: 11px;
		color: #94a3b8;
	}
	.hst-server-foot-info {
		flex: 1;
		min-width: 0;
	}
	.hst-server-foot-info strong {
		color: #0f172a;
		font-weight: 600;
	}
	.hst-server-actions {
		display: flex;
		gap: 4px;
	}
	.hst-icon-btn {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: 1px solid #e5e9f0;
		background: white;
		display: grid;
		place-items: center;
		color: #475569;
		cursor: pointer;
		text-decoration: none;
	}
	.hst-icon-btn:hover {
		background: #1877f2;
		color: white;
		border-color: #1877f2;
	}
	.hst-icon-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ===== Table view ===== */
	.hst-table-wrap {
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		overflow: hidden;
	}
	.hst-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
	}
	.hst-table thead th {
		background: #fafbfd;
		text-align: left;
		padding: 11px 14px;
		font-size: 10.5px;
		font-weight: 700;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-bottom: 1px solid #e5e9f0;
	}
	.hst-table tbody td {
		padding: 12px 14px;
		border-bottom: 1px solid #f1f5f9;
		color: #475569;
		vertical-align: middle;
	}
	.hst-table tbody tr {
		cursor: pointer;
	}
	.hst-table tbody tr:hover {
		background: #fafbfd;
	}
	.hst-table tbody tr:last-child td {
		border-bottom: none;
	}
	.hst-table .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.hst-host-cell {
		font-weight: 700;
		color: #0f172a;
	}
	.hst-host-sub {
		font-size: 11px;
		color: #94a3b8;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		margin-top: 2px;
	}
	.hst-mono {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 12px;
	}
	.hst-row-actions {
		display: flex;
		gap: 4px;
	}

	/* ===== Drawer ===== */
	.hst-drawer-back {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.4);
		z-index: 79;
		backdrop-filter: blur(2px);
		border: none;
		padding: 0;
		cursor: default;
	}
	.hst-drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 640px;
		max-width: 100vw;
		background: white;
		z-index: 80;
		display: flex;
		flex-direction: column;
		box-shadow: -12px 0 32px rgba(15, 23, 42, 0.15);
		animation: slideIn 0.2s cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	@keyframes slideIn {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}
	.hst-drawer-head {
		padding: 18px 22px;
		border-bottom: 1px solid #e5e9f0;
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.hst-drawer-title {
		font-weight: 700;
		font-size: 15px;
		color: #0f172a;
	}
	.hst-drawer-sub {
		font-size: 12px;
		color: #94a3b8;
		margin-top: 2px;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}
	.hst-drawer-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px 22px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.hst-drawer-foot {
		padding: 14px 22px;
		border-top: 1px solid #e5e9f0;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	.hst-foot-group {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.hst-drawer-close {
		width: 32px;
		height: 32px;
		border-radius: 7px;
		background: transparent;
		border: 1px solid #e5e9f0;
		display: grid;
		place-items: center;
		color: #475569;
		cursor: pointer;
	}
	.hst-drawer-section h4 {
		font-size: 10.5px;
		font-weight: 700;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0 0 8px;
	}
	.hst-kv-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.hst-kv {
		background: #fafbfd;
		border: 1px solid #e5e9f0;
		border-radius: 8px;
		padding: 9px 11px;
	}
	.hst-kv-l {
		font-size: 10.5px;
		color: #94a3b8;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.hst-kv-v {
		font-size: 13px;
		font-weight: 600;
		color: #0f172a;
		margin-top: 2px;
		word-break: break-word;
	}
	.hst-kv-v.mono {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 12.5px;
	}
	.hst-note {
		margin: 10px 0 0;
		font-size: 11.5px;
		color: #94a3b8;
		font-style: italic;
		line-height: 1.5;
	}
	.hst-loadline {
		margin-top: 10px;
		font-size: 11.5px;
		color: #475569;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		padding: 6px 10px;
		background: #fafbfd;
		border: 1px solid #e5e9f0;
		border-radius: 6px;
		display: inline-block;
	}
	.hst-note strong {
		color: #475569;
	}
	.hst-cred-note {
		font-size: 12.5px;
		color: #475569;
		background: #fafbfd;
		border: 1px solid #e5e9f0;
		border-radius: 8px;
		padding: 12px 14px;
		line-height: 1.5;
	}
	.hst-cred-note a {
		color: #1877f2;
		font-weight: 600;
		text-decoration: none;
	}
	.hst-cred-note a:hover {
		text-decoration: underline;
	}

	/* ===== Typed-confirmation delete dialog ===== */
	.hst-confirm-back {
		position: fixed;
		inset: 0;
		z-index: 99;
		background: rgba(15, 23, 42, 0.45);
		backdrop-filter: blur(3px);
		display: grid;
		place-items: center;
		padding: 16px;
		border: none;
		cursor: default;
	}
	.hst-confirm {
		width: 520px;
		max-width: calc(100vw - 32px);
		background: white;
		border-radius: 14px;
		box-shadow:
			0 28px 64px rgba(15, 23, 42, 0.25),
			0 8px 20px rgba(15, 23, 42, 0.1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		font-family:
			'Inter',
			system-ui,
			-apple-system,
			sans-serif;
		animation: popIn 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.2);
	}
	@keyframes popIn {
		from {
			opacity: 0;
			transform: scale(0.96);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
	.hst-confirm-head {
		padding: 18px 22px;
		border-bottom: 1px solid #e5e9f0;
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.hst-confirm-icon {
		width: 36px;
		height: 36px;
		border-radius: 9px;
		background: linear-gradient(135deg, #ef4444, #b91c1c);
		color: white;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.hst-confirm-title {
		font-size: 16px;
		font-weight: 700;
		color: #0f172a;
		letter-spacing: -0.01em;
	}
	.hst-confirm-sub {
		font-size: 12px;
		color: #94a3b8;
		margin-top: 2px;
	}
	.hst-confirm-body {
		padding: 18px 22px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.hst-confirm-text {
		margin: 0;
		font-size: 13px;
		color: #475569;
		line-height: 1.55;
	}
	.hst-confirm-text strong {
		color: #0f172a;
	}
	.hst-confirm-text .mono,
	.hst-confirm-text code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 12px;
		background: #f1f5f9;
		padding: 1px 6px;
		border-radius: 4px;
		color: #0f172a;
	}
	.hst-confirm-list {
		margin: 0;
		padding-left: 22px;
		font-size: 12.5px;
		color: #475569;
		line-height: 1.6;
	}
	.hst-confirm-list strong {
		color: #0f172a;
	}
	.hst-confirm-input {
		width: 100%;
		padding: 10px 12px;
		background: white;
		border: 1px solid #d5dbe5;
		border-radius: 8px;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 13px;
		color: #0f172a;
		outline: none;
		box-sizing: border-box;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	.hst-confirm-input:focus {
		border-color: #ef4444;
		box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.12);
	}
	.hst-confirm-input::placeholder {
		color: #cbd5e1;
	}
	.hst-confirm-foot {
		padding: 14px 22px;
		border-top: 1px solid #e5e9f0;
		background: #fafbfd;
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.btn-danger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 7px;
		background: #ef4444;
		color: white;
		border: none;
		font-size: 12.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-danger:hover:not(:disabled) {
		background: #dc2626;
	}
	.btn-danger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ===== Flash toast ===== */
	.hst-flash {
		position: fixed;
		bottom: 24px;
		right: 24px;
		background: #0f172a;
		color: white;
		padding: 12px 16px;
		border-radius: 10px;
		font-size: 13px;
		font-weight: 500;
		box-shadow: 0 10px 25px rgba(15, 23, 42, 0.25);
		display: flex;
		align-items: center;
		gap: 10px;
		z-index: 200;
	}
	.hst-flash :global(svg) {
		color: #34d399;
	}

	/* ===== Responsive ===== */
	@media (max-width: 1400px) {
		.hst-kpis {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	@media (max-width: 760px) {
		.hst-kpis {
			grid-template-columns: repeat(2, 1fr);
		}
		.hst-search {
			flex: 1 1 100%;
		}
	}
</style>
