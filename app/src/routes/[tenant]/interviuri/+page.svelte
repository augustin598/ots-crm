<script lang="ts">
	import './interviuri.css';
	import { page } from '$app/state';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import CheckCheckIcon from '@lucide/svelte/icons/check-check';
	import TargetIcon from '@lucide/svelte/icons/target';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import InfoIcon from '@lucide/svelte/icons/info';
	import PencilIcon from '@lucide/svelte/icons/pencil';

	import {
		getInterviews,
		getInterviewChannels,
		createInterview,
		updateInterview,
		deleteInterview,
		createInterviewChannel
	} from '$lib/remotes/interviuri.remote';
	import {
		enrich,
		isoToRo,
		dnum,
		daysBetween,
		dash,
		IV_MONTHS,
		STATUS_LABEL,
		type IvRow,
		type ChannelMeta,
		type StatusSlug
	} from './lib';
	import ChannelChip from './ChannelChip.svelte';
	import ChannelIcon from './ChannelIcon.svelte';
	import StatusPill from './StatusPill.svelte';
	import AttributionPanel from './AttributionPanel.svelte';
	import TrendPanel from './TrendPanel.svelte';
	import InterviewModal from './InterviewModal.svelte';
	import ComparisonModal from './ComparisonModal.svelte';

	const interviewsQuery = getInterviews();
	const channelsQuery = getInterviewChannels();

	const rows = $derived((interviewsQuery.current ?? []).map(enrich));
	const channels = $derived((channelsQuery.current ?? []) as ChannelMeta[]);
	const channelMeta = $derived(
		Object.fromEntries(channels.map((c) => [c.name, c])) as Record<string, ChannelMeta>
	);
	const channelOrder = $derived(channels.map((c) => c.name));

	const years = $derived.by(() => {
		const s = [...new Set(rows.map((r) => r.year).filter(Boolean))].sort((a, b) => a - b);
		return s.length ? s : [new Date().getFullYear()];
	});

	// selectedYear = alegerea utilizatorului; year = valoarea efectivă (clamp la anii disponibili).
	let selectedYear = $state<number | null>(null);
	const year = $derived(
		selectedYear !== null && years.includes(selectedYear) ? selectedYear : years[years.length - 1]
	);

	let monthFilter = $state('all');
	let channelFilter = $state('all');
	let statusFilter = $state('all');
	let studioFilter = $state('all');
	let from = $state('');
	let to = $state('');
	let search = $state('');
	let sortKey = $state('data');
	let sortDir = $state<'asc' | 'desc'>('desc');

	let showModal = $state(false);
	let showCompare = $state(false);
	let editRec = $state<IvRow | null>(null);

	const studios = $derived([...new Set(rows.map((r) => r.studio).filter(Boolean))]);
	const yearCounts = $derived.by(() => {
		const m: Record<number, number> = {};
		for (const r of rows) m[r.year] = (m[r.year] || 0) + 1;
		return m;
	});
	const yearRecords = $derived(rows.filter((r) => r.year === year));
	const prevYear = $derived(year - 1);
	const prevYearRecords = $derived(rows.filter((r) => r.year === prevYear));

	const scoped = $derived.by(() => {
		let arr = monthFilter === 'all' ? yearRecords : yearRecords.filter((r) => r.month === monthFilter);
		if (studioFilter !== 'all') arr = arr.filter((r) => r.studio === studioFilter);
		return arr;
	});
	const hasExtraFilters = $derived(
		channelFilter !== 'all' ||
			statusFilter !== 'all' ||
			studioFilter !== 'all' ||
			!!from ||
			!!to ||
			!!search ||
			monthFilter !== 'all'
	);

	const tableRows = $derived.by(() => {
		let arr = scoped.slice();
		if (channelFilter !== 'all') arr = arr.filter((r) => r.channel === channelFilter);
		if (statusFilter !== 'all') arr = arr.filter((r) => r.status === statusFilter);
		if (from) arr = arr.filter((r) => dnum(r.dataInterviu) >= dnum(from));
		if (to) arr = arr.filter((r) => dnum(r.dataInterviu) <= dnum(to));
		if (search) {
			const q = search.toLowerCase();
			arr = arr.filter(
				(r) =>
					r.nume.toLowerCase().includes(q) ||
					(r.sursa || '').toLowerCase().includes(q) ||
					(r.observatii || '').toLowerCase().includes(q) ||
					(r.studio || '').toLowerCase().includes(q)
			);
		}
		const dir = sortDir === 'asc' ? 1 : -1;
		return arr.sort((a, b) => {
			if (sortKey === 'data') return (dnum(a.dataInterviu) - dnum(b.dataInterviu)) * dir;
			if (sortKey === 'start') return (dnum(a.dataInceput) - dnum(b.dataInceput)) * dir;
			if (sortKey === 'nume') return a.nume.localeCompare(b.nume) * dir;
			if (sortKey === 'channel') return a.channel.localeCompare(b.channel) * dir;
			if (sortKey === 'status') return a.status.localeCompare(b.status) * dir;
			if (sortKey === 'studio') return (a.studio || '').localeCompare(b.studio || '') * dir;
			return 0;
		});
	});

	const kpi = $derived.by(() => {
		const total = scoped.length;
		const ok = scoped.filter((r) => r.status === 'admisa').length;
		const no = scoped.filter((r) => r.status === 'respinsa').length;
		const wait = total - ok - no;
		const conv = total ? Math.round((ok / total) * 100) : 0;
		const chCount: Record<string, number> = {};
		for (const r of scoped) chCount[r.channel] = (chCount[r.channel] || 0) + 1;
		let topCh = '—',
			topN = 0;
		for (const [c, n] of Object.entries(chCount))
			if (n > topN && c !== 'Nespecificat') {
				topN = n;
				topCh = c;
			}
		const spans = scoped
			.map((r) => daysBetween(r.dataInterviu, r.dataInceput))
			.filter((d): d is number => d != null && d >= 0);
		const avgStart = spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : null;
		return { total, ok, no, wait, conv, topCh, topN, avgStart, started: spans.length };
	});

	const chCounts = $derived.by(() => {
		const m: Record<string, number> = {};
		for (const r of scoped) m[r.channel] = (m[r.channel] || 0) + 1;
		return m;
	});
	const topChMeta = $derived(
		channelMeta[kpi.topCh] ?? { name: '—', color: '#94a3b8', icon: 'circle-help' }
	);
	const activeChannels = $derived(
		Object.keys(chCounts).filter((c) => c !== 'Nespecificat').length
	);
	const showNoSourceBanner = $derived(
		yearRecords.length > 0 && yearRecords.every((r) => r.channel === 'Nespecificat')
	);

	const dashboardHref = $derived(`/${page.params.tenant}`);

	function toggleSort(k: string) {
		if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = k;
			sortDir = k === 'data' ? 'desc' : 'asc';
		}
	}
	function clearAll() {
		monthFilter = 'all';
		channelFilter = 'all';
		statusFilter = 'all';
		studioFilter = 'all';
		from = '';
		to = '';
		search = '';
	}
	function changeYear(y: number) {
		selectedYear = y;
		monthFilter = 'all';
		channelFilter = 'all';
		from = '';
		to = '';
	}

	function exportCsv() {
		const cols = [
			'Nume',
			'Data interviu',
			'Canal',
			'Sursa',
			'Studio',
			'Status',
			'Inceput colaborare',
			'Sfarsit colaborare',
			'Observatii'
		];
		const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
		const lines = [cols.join(',')].concat(
			tableRows.map((r) =>
				[
					r.nume,
					isoToRo(r.dataInterviu),
					r.channel,
					r.sursa,
					r.studio,
					STATUS_LABEL[r.status],
					isoToRo(r.dataInceput),
					isoToRo(r.dataSfarsit),
					r.observatii
				]
					.map(esc)
					.join(',')
			)
		);
		const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `interviuri-${year}${monthFilter !== 'all' ? '-' + monthFilter : ''}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	type SavePayload = {
		nume: string;
		dataInterviu: string;
		dataInceput?: string;
		dataSfarsit?: string;
		studio: string;
		sursa?: string;
		channelId: string;
		status: StatusSlug;
		observatii?: string;
	};

	async function saveNew(p: SavePayload) {
		try {
			await createInterview(p).updates(interviewsQuery);
			selectedYear = +p.dataInterviu.slice(0, 4) || year;
			showModal = false;
		} catch (e) {
			alert('Eroare la salvare: ' + (e instanceof Error ? e.message : String(e)));
		}
	}
	async function saveEdit(p: SavePayload) {
		if (!editRec) return;
		try {
			await updateInterview({ ...p, id: editRec.id }).updates(interviewsQuery);
			selectedYear = +p.dataInterviu.slice(0, 4) || year;
			editRec = null;
		} catch (e) {
			alert('Eroare la salvare: ' + (e instanceof Error ? e.message : String(e)));
		}
	}
	async function del(id: string) {
		try {
			await deleteInterview(id).updates(interviewsQuery);
			editRec = null;
		} catch (e) {
			alert('Eroare la ștergere: ' + (e instanceof Error ? e.message : String(e)));
		}
	}
	async function addChannel(name: string): Promise<ChannelMeta | null> {
		try {
			const res = await createInterviewChannel({ name }).updates(channelsQuery);
			return (
				channels.find((c) => c.id === res.id) ?? {
					id: res.id,
					name: res.name,
					color: (res as { color?: string }).color ?? '#94a3b8',
					icon: 'megaphone',
					isSystem: false,
					sortOrder: 500
				}
			);
		} catch (e) {
			alert('Eroare la adăugarea canalului: ' + (e instanceof Error ? e.message : String(e)));
			return null;
		}
	}
</script>

{#snippet th(k: string, label: string)}
	<th class="iv-th" onclick={() => toggleSort(k)}>
		<span class="iv-th-inner">
			{label}
			{#if sortKey === k}
				<ChevronDownIcon
					size={11}
					style="transform:{sortDir === 'asc' ? 'rotate(180deg)' : 'none'};opacity:.8"
				/>
			{/if}
		</span>
	</th>
{/snippet}

<div class="cl-wrap">
	<div class="cl-crumbs">
		<a href={dashboardHref} aria-label="Dashboard"><FolderIcon size={12} /></a>
		<span class="sep">›</span>
		<span>Marketing &amp; Ads</span>
		<span class="sep">›</span>
		<strong>Interviuri</strong>
	</div>

	<div class="cl-hero">
		<div>
			<h1>Interviuri</h1>
			<p>
				Evidența candidatelor pe canale de marketing · <strong>{rows.length}</strong> interviuri
				{#if years.length}({years[0]}–{years[years.length - 1]}){/if} ·
				<strong>{yearRecords.length}</strong> în {year}
			</p>
		</div>
		<div class="cl-hero-actions">
			<div class="cl-search">
				<SearchIcon size={13} />
				<input placeholder="Caută nume, sursă, observații…" bind:value={search} />
				{#if search}
					<button class="cl-search-clear" onclick={() => (search = '')} aria-label="Șterge căutarea">
						<XIcon size={11} />
					</button>
				{/if}
			</div>
			<button class="cl-btn-secondary" onclick={() => (showCompare = true)}>
				<BarChart3Icon size={13} /> Compară perioade
			</button>
			<button class="cl-btn-secondary" onclick={exportCsv}>
				<DownloadIcon size={13} /> Export
			</button>
			<button class="cl-btn-primary" onclick={() => (showModal = true)}>
				<PlusIcon size={13} /> Interviu nou
			</button>
		</div>
	</div>

	<!-- Year + filter bar -->
	<div class="iv-filterbar">
		<div class="iv-year-pills">
			{#each years as y (y)}
				<button class="iv-year-pill {year === y ? 'active' : ''}" onclick={() => changeYear(y)}>
					{y}<span class="yc">{yearCounts[y] || 0}</span>
				</button>
			{/each}
		</div>
		<div class="divider"></div>
		<div class="cl-select-wrap">
			<span class="cl-select-lbl">Status:</span>
			<select class="cl-select" bind:value={statusFilter}>
				<option value="all">Toate</option>
				<option value="admisa">Admise</option>
				<option value="respinsa">Respinse</option>
				<option value="in_evaluare">În evaluare</option>
			</select>
		</div>
		{#if studios.length > 1}
			<div class="cl-select-wrap">
				<span class="cl-select-lbl">Studio:</span>
				<select class="cl-select" bind:value={studioFilter}>
					<option value="all">Toate</option>
					{#each studios as s (s)}<option value={s}>{s}</option>{/each}
				</select>
			</div>
		{/if}
		<div class="divider"></div>
		<div class="iv-daterange">
			<span class="cl-select-lbl">Interval:</span>
			<input type="date" class="iv-date-input" bind:value={from} title="De la" />
			<span class="cl-select-lbl">→</span>
			<input type="date" class="iv-date-input" bind:value={to} title="Până la" />
		</div>
		{#if hasExtraFilters}
			<button class="iv-clear-filters" onclick={clearAll}>
				<XIcon size={12} /> Resetează filtrele
			</button>
		{/if}
		<span class="iv-result-count"><b>{tableRows.length}</b> din {yearRecords.length} interviuri</span>
	</div>

	<!-- KPIs -->
	<div class="cl-hero" style="padding-top:0; padding-bottom:0">
		<div class="cl-kpis" style="width:100%; grid-template-columns:repeat(6, 1fr)">
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background:rgba(24,119,242,.08); color:#1877F2">
					<UserPlusIcon size={16} />
				</div>
				<div>
					<div class="cl-kpi-lbl">Total interviuri</div>
					<div class="cl-kpi-val">{kpi.total}</div>
					<div class="cl-kpi-sub">
						{monthFilter === 'all' ? 'tot anul ' + year : monthFilter + ' ' + year}
					</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background:rgba(16,185,129,.08); color:#10b981">
					<CheckCheckIcon size={16} />
				</div>
				<div>
					<div class="cl-kpi-lbl">Admise</div>
					<div class="cl-kpi-val cl-text-ok">{kpi.ok}</div>
					<div class="cl-kpi-sub">{kpi.conv}% rată de admitere</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background:rgba(239,68,68,.08); color:#ef4444">
					<XIcon size={16} />
				</div>
				<div>
					<div class="cl-kpi-lbl">Respinse</div>
					<div class="cl-kpi-val cl-text-danger">{kpi.no}</div>
					<div class="cl-kpi-sub">{kpi.wait} în evaluare</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background:{topChMeta.color}14; color:{topChMeta.color}">
					<ChannelIcon icon={topChMeta.icon} size={16} />
				</div>
				<div>
					<div class="cl-kpi-lbl">Canal principal</div>
					<div class="cl-kpi-val">{topChMeta.name}</div>
					<div class="cl-kpi-sub">{kpi.topN} interviuri</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background:rgba(139,92,246,.08); color:#8b5cf6">
					<TargetIcon size={16} />
				</div>
				<div>
					<div class="cl-kpi-lbl">Canale active</div>
					<div class="cl-kpi-val">{activeChannels}</div>
					<div class="cl-kpi-sub">surse de recrutare</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background:rgba(245,158,11,.08); color:#f59e0b">
					<ClockIcon size={16} />
				</div>
				<div>
					<div class="cl-kpi-lbl">Timp până la start</div>
					<div class="cl-kpi-val">{kpi.avgStart != null ? kpi.avgStart + ' zile' : '—'}</div>
					<div class="cl-kpi-sub">{kpi.started} au început colaborarea</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Analytics -->
	<div style="padding:18px 28px 0">
		<div class="iv-analytics">
			<AttributionPanel records={scoped} {channelMeta} {channelOrder} />
			<TrendPanel
				records={yearRecords}
				prevRecords={prevYearRecords}
				{prevYear}
				{year}
				{channelMeta}
				{channelOrder}
			/>
		</div>
	</div>

	<!-- Month tabs -->
	<div class="cl-toolbar" style="padding-top:18px">
		<div class="cl-tabs">
			<button class="cl-tab {monthFilter === 'all' ? 'active' : ''}" onclick={() => (monthFilter = 'all')}>
				Toate lunile <span class="cl-tab-count">{yearRecords.length}</span>
			</button>
			{#each IV_MONTHS as m (m)}
				{@const n = yearRecords.filter((r) => r.month === m).length}
				{#if n}
					<button class="cl-tab {monthFilter === m ? 'active' : ''}" onclick={() => (monthFilter = m)}>
						{m.slice(0, 3)} <span class="cl-tab-count">{n}</span>
					</button>
				{/if}
			{/each}
		</div>
	</div>

	<!-- Channel chip filters -->
	<div class="cl-toolbar" style="padding-top:0">
		<div class="iv-chip-filters">
			<button
				class="iv-chip-btn {channelFilter === 'all' ? 'active' : ''}"
				style={channelFilter === 'all' ? 'background:#0f172a' : ''}
				onclick={() => (channelFilter = 'all')}
			>
				Toate canalele <span class="cnt">{scoped.length}</span>
			</button>
			{#each channelOrder.filter((ch) => chCounts[ch]) as ch (ch)}
				{@const c = channelMeta[ch]}
				{@const active = channelFilter === ch}
				<button
					class="iv-chip-btn {active ? 'active' : ''}"
					style={active ? `background:${c.color}` : ''}
					onclick={() => (channelFilter = active ? 'all' : ch)}
				>
					<span class="iv-ch-dot" style="background:{active ? '#fff' : c.color}"></span>
					{c.name} <span class="cnt">{chCounts[ch]}</span>
				</button>
			{/each}
		</div>
	</div>

	<!-- Table -->
	<div class="iv-table-wrap">
		{#if showNoSourceBanner}
			<div
				class="cl-projection"
				style="margin-bottom:12px; background:var(--cl-warn-50); color:#b45309; border:1px solid #fde68a"
			>
				<InfoIcon size={14} />
				<div>
					În {year} sursa candidatelor nu era înregistrată, deci toate apar ca
					<strong>Nespecificat</strong>. Atribuirea pe canale devine disponibilă din anii cu sursă
					înregistrată.
				</div>
			</div>
		{/if}
		<div class="cl-list-wrap" style="margin:0">
			<table class="cl-list-table">
				<thead>
					<tr>
						{@render th('nume', 'Candidată')}
						{@render th('data', 'Data interviu')}
						{@render th('channel', 'Canal / sursă')}
						{@render th('studio', 'Studio')}
						{@render th('status', 'Status')}
						{@render th('start', 'Început')}
						<th>Sfârșit</th>
						<th>Observații</th>
						<th style="width:44px"></th>
					</tr>
				</thead>
				<tbody>
					{#each tableRows as r (r.id)}
						<tr onclick={() => (editRec = r)}>
							<td>
								<div class="iv-name">{r.nume}</div>
								{#if r.sursa}<div class="iv-src" title={r.sursa}>{r.sursa}</div>{/if}
							</td>
							<td class="iv-date">{dash(isoToRo(r.dataInterviu))}</td>
							<td><ChannelChip name={r.channel} color={r.channelColor} icon={r.channelIcon} /></td>
							<td class="iv-studio">{dash(r.studio)}</td>
							<td><StatusPill status={r.status} /></td>
							<td class="iv-date">
								{#if r.dataInceput}{isoToRo(r.dataInceput)}{:else}<span class="iv-muted">—</span>{/if}
							</td>
							<td class="iv-date">
								{#if r.dataSfarsit}{isoToRo(r.dataSfarsit)}{:else}<span class="iv-muted">—</span>{/if}
							</td>
							<td class="iv-obs">
								{#if r.observatii}{r.observatii}{:else}<span class="iv-muted">—</span>{/if}
							</td>
							<td onclick={(e) => e.stopPropagation()}>
								<button class="cl-icon-btn" title="Editează" onclick={() => (editRec = r)}>
									<PencilIcon size={14} />
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if tableRows.length === 0}
				<div class="cl-empty" style="border:0; border-radius:0">
					<SearchIcon size={32} />
					<h3>Niciun interviu găsit</h3>
					<p>Modifică filtrele sau caută alt termen.</p>
				</div>
			{/if}
		</div>
	</div>

	{#if showModal}
		<InterviewModal
			{channels}
			onClose={() => (showModal = false)}
			onSave={saveNew}
			onDelete={del}
			onAddChannel={addChannel}
		/>
	{/if}
	{#if editRec}
		<InterviewModal
			record={editRec}
			{channels}
			onClose={() => (editRec = null)}
			onSave={saveEdit}
			onDelete={del}
			onAddChannel={addChannel}
		/>
	{/if}
	{#if showCompare}
		<ComparisonModal
			all={rows}
			{channelMeta}
			{channelOrder}
			{years}
			onClose={() => (showCompare = false)}
		/>
	{/if}
</div>
