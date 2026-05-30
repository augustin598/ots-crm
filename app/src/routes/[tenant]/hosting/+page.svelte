<script lang="ts">
	import { page } from '$app/state';
	import { getHostingDashboard } from '$lib/remotes/hosting-dashboard.remote';
	import { syncAllHostingAccounts } from '$lib/remotes/hosting-accounts.remote';
	import { getDAServersWithStats } from '$lib/remotes/da-servers.remote';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import UsersIcon from '@lucide/svelte/icons/users';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ServerIcon from '@lucide/svelte/icons/server';
	import PackageIcon from '@lucide/svelte/icons/package';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import LockIcon from '@lucide/svelte/icons/lock';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import CheckIcon from '@lucide/svelte/icons/check';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import KeyIcon from '@lucide/svelte/icons/key';
	import MailIcon from '@lucide/svelte/icons/mail';
	import BellIcon from '@lucide/svelte/icons/bell';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import InfoIcon from '@lucide/svelte/icons/info';

	const tenantSlug = $derived(page.params.tenant);
	const dashboard = $derived(await getHostingDashboard());
	const servers = $derived(await getDAServersWithStats());

	let syncing = $state(false);

	function formatRON(cents: number): string {
		return new Intl.NumberFormat('ro-RO').format(Math.round(cents / 100));
	}

	function formatRONShort(cents: number): string {
		const ron = cents / 100;
		if (ron >= 1000) return `${(ron / 1000).toFixed(1)}k RON`;
		return `${Math.round(ron)} RON`;
	}

	function formatRONShortInt(cents: number): string {
		const ron = cents / 100;
		if (ron >= 1000) return `${Math.round(ron / 1000)}k RON`;
		return `${Math.round(ron)} RON`;
	}

	function getInitials(name: string): string {
		return name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0])
			.join('')
			.toUpperCase();
	}

	function clientColor(name: string): string {
		// Deterministic per-name color from a small CRM palette.
		const palette = [
			'#1877F2',
			'#10b981',
			'#f59e0b',
			'#ef4444',
			'#6366f1',
			'#7c3aed',
			'#ec4899',
			'#14b8a6'
		];
		let h = 0;
		for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
		return palette[h % palette.length];
	}

	function expireDaysLabel(days: number): string {
		if (days === 0) return 'azi';
		if (days === 1) return 'mâine';
		return `${days} zile`;
	}

	function meterClass(v: number): 'good' | 'warn' | 'danger' {
		if (v >= 80) return 'danger';
		if (v >= 60) return 'warn';
		return 'good';
	}

	function meterColor(v: number): string {
		const c = meterClass(v);
		return c === 'good' ? '#10b981' : c === 'warn' ? '#f59e0b' : '#ef4444';
	}

	const monthLabels = [
		'ianuarie',
		'februarie',
		'martie',
		'aprilie',
		'mai',
		'iunie',
		'iulie',
		'august',
		'septembrie',
		'octombrie',
		'noiembrie',
		'decembrie'
	];
	const currentPeriod = $derived.by(() => {
		const d = new Date();
		return `${monthLabels[d.getMonth()]} ${d.getFullYear()}`;
	});

	// ---------- MRR chart geometry ----------
	type MrrPoint = { m: string; v: number };
	function buildChart(data: MrrPoint[]) {
		// Wide aspect ratio (~5:1) so the chart fills typical bento cards
		// without giant side whitespace, while `preserveAspectRatio="xMidYMid
		// meet"` keeps text proportions intact (no stretched "iun"/"iul").
		const W = 1100;
		const H = 220;
		const pad = { l: 60, r: 16, t: 14, b: 28 };
		if (!data.length) return null;
		const values = data.map((d) => d.v);
		const rawMax = Math.max(...values);
		const rawMin = Math.min(...values);

		// Build a clean 4-step Y-axis. Pick a nice step (1/2/5 × 10^n) sized
		// against the data band, then round min/max outward so every label
		// rounds to a distinct number (no "2k 2k 2k 2k 2k" duplicates).
		const niceStep = (raw: number, divisions: number) => {
			if (raw <= 0) return 1;
			const exp = Math.pow(10, Math.floor(Math.log10(raw / divisions)));
			const frac = raw / divisions / exp;
			const m = frac >= 5 ? 5 : frac >= 2 ? 2 : 1;
			return m * exp;
		};

		let rawSpan = rawMax - rawMin;
		// Flat or near-flat series → synthesize a visible band.
		if (rawSpan < rawMax * 0.05) rawSpan = Math.max(rawMax * 0.3, 100);
		const step = niceStep(rawSpan, 4);
		const minBase = Math.max(0, rawMin - step / 2);
		const maxBase = rawMax + step / 2;
		const min = Math.floor(minBase / step) * step;
		const max = Math.ceil(maxBase / step) * step;

		const x = (i: number) =>
			pad.l + (data.length === 1 ? 0 : (i / (data.length - 1)) * (W - pad.l - pad.r));
		const y = (v: number) =>
			max === min ? H / 2 : H - pad.b - ((v - min) / (max - min)) * (H - pad.t - pad.b);
		const pts = data.map((d, i) => `${x(i)},${y(d.v)}`).join(' ');
		const area = `M ${x(0)},${H - pad.b} L ${pts} L ${x(data.length - 1)},${H - pad.b} Z`;

		const gridY: number[] = [];
		for (let v = min; v <= max + step / 2; v += step) gridY.push(v);

		return {
			W,
			H,
			pad,
			pts,
			area,
			gridY,
			step,
			points: data.map((d, i) => ({ x: x(i), y: y(d.v), m: d.m, v: d.v })),
			labelY: (v: number) => y(v)
		};
	}

	function chartLabel(v: number, step: number): string {
		const ron = v / 100;
		const stepRon = step / 100;
		// Step ≥ 1k RON → "20k" style. Below that, keep absolute RON to avoid
		// duplicate labels from rounding (e.g. 1900, 2000, 2100 all → "2k").
		if (stepRon >= 1000) return `${Math.round(ron / 1000)}k`;
		if (stepRon >= 100) {
			// Use compact "k" with one decimal when value is in thousands.
			if (ron >= 1000) return `${(ron / 1000).toFixed(1)}k`;
			return `${Math.round(ron)}`;
		}
		return `${Math.round(ron)}`;
	}

	// ---------- Donut geometry ----------
	type DonutSlice = { id: string; name: string; color: string; accounts: number; mrrCents: number };
	function buildDonut(data: DonutSlice[], size = 150, thickness = 24) {
		const r = (size - thickness) / 2;
		const c = 2 * Math.PI * r;
		const total = data.reduce((s, d) => s + d.accounts, 0);
		const segments: { color: string; dash: string; offset: number }[] = [];
		let offset = 0;
		for (const d of data) {
			if (!total) break;
			const len = (d.accounts / total) * c;
			segments.push({ color: d.color, dash: `${len} ${c - len}`, offset });
			offset += len;
		}
		return { size, thickness, r, c, total, segments };
	}

	const chart = $derived(buildChart(dashboard.mrrHistory));
	const donut = $derived(buildDonut(dashboard.productDistribution));

	// ---------- Spark for KPI ----------
	function buildSpark(values: number[], w = 60, h = 20) {
		if (!values.length) return null;
		const max = Math.max(...values);
		const min = Math.min(...values);
		const range = max - min || 1;
		const pts = values
			.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`)
			.join(' ');
		return { w, h, pts };
	}

	const mrrSpark = $derived(buildSpark(dashboard.mrrHistory.map((d) => d.v)));
	const accountsSpark = $derived(
		buildSpark(
			Array.from({ length: 7 }, (_, i) =>
				Math.max(0, dashboard.kpis.activeAccounts - (6 - i) * Math.max(1, Math.round(dashboard.kpis.activeDelta30d / 7)))
			)
		)
	);

	function ago(date: Date | string): string {
		const d = typeof date === 'string' ? new Date(date) : date;
		const diffMs = Date.now() - d.getTime();
		const m = Math.round(diffMs / 60000);
		if (m < 1) return 'acum';
		if (m < 60) return `acum ${m} min`;
		const h = Math.round(m / 60);
		if (h < 24) return `acum ${h} h`;
		const days = Math.round(h / 24);
		return `acum ${days} z`;
	}

	const activityIcons = {
		pause: PauseIcon,
		play: PlayIcon,
		plus: PlusIcon,
		trash: Trash2Icon,
		refresh: RefreshCwIcon,
		check: CheckIcon,
		package: PackageIcon,
		eye: EyeIcon,
		key: KeyIcon,
		mail: MailIcon,
		bell: BellIcon,
		'log-in': LogInIcon,
		lock: LockIcon,
		info: InfoIcon
	} as const;

	async function handleSyncAll() {
		if (syncing) return;
		syncing = true;
		try {
			const result = await syncAllHostingAccounts({});
			toast.success(
				`Sync finalizat: ${result.synced} / ${result.total}${result.failed ? ` · ${result.failed} eșuat${result.failed === 1 ? '' : 'e'}` : ''}`
			);
			void getHostingDashboard().refresh();
		} catch (e) {
			toast.error(`Sync eșuat: ${e instanceof Error ? e.message : 'eroare necunoscută'}`);
		} finally {
			syncing = false;
		}
	}
</script>

<div class="hst-page">
	<header class="hst-hero">
		<div>
			<h1>Hosting</h1>
			<p>Privire de ansamblu peste infrastructura și conturile de hosting · perioadă {currentPeriod}</p>
		</div>
		<div class="hst-hero-actions">
			<button class="btn-secondary" type="button" onclick={handleSyncAll} disabled={syncing}>
				<RefreshCwIcon size={13} class={syncing ? 'spin' : ''} />
				{syncing ? 'Sync în curs…' : 'Sync toate serverele'}
			</button>
			<button class="btn-secondary" type="button" disabled>
				<DownloadIcon size={13} /> Export raport
			</button>
			<a class="btn-primary" href="/{tenantSlug}/hosting/accounts/new">
				<PlusIcon size={14} /> Cont hosting nou
			</a>
		</div>
	</header>

	<section class="hst-kpis">
		<div class="dash-kpi primary">
			<div class="dash-kpi-head">
				<div class="dash-kpi-icon" style:--ic-bg="rgba(24,119,242,.12)" style:--ic-fg="#1877F2">
					<DatabaseIcon size={13} />
				</div>
				<span class="dash-kpi-label">Conturi active</span>
			</div>
			<div class="dash-kpi-value">{dashboard.kpis.activeAccounts}</div>
			<div class="dash-kpi-foot">
				{#if dashboard.kpis.activeDelta30d > 0}
					<span class="dash-delta up">
						<ArrowUpIcon size={10} />
						+{dashboard.kpis.activeDelta30d}
					</span>
				{/if}
				<span class="dash-kpi-sub">din {dashboard.kpis.totalAccounts} total</span>
				{#if accountsSpark}
					<svg class="dash-spark" width={accountsSpark.w} height={accountsSpark.h}>
						<polyline
							points={accountsSpark.pts}
							fill="none"
							stroke="#1877F2"
							stroke-width="1.6"
							stroke-linejoin="round"
							stroke-linecap="round"
						/>
					</svg>
				{/if}
			</div>
		</div>

		<div class="dash-kpi info">
			<div class="dash-kpi-head">
				<div class="dash-kpi-icon" style:--ic-bg="rgba(99,102,241,.12)" style:--ic-fg="#6366f1">
					<UsersIcon size={13} />
				</div>
				<span class="dash-kpi-label">Clienți hosting</span>
			</div>
			<div class="dash-kpi-value">{dashboard.kpis.distinctClients}</div>
			<div class="dash-kpi-foot">
				<span class="dash-kpi-sub">cu cont activ</span>
			</div>
		</div>

		<div class="dash-kpi success">
			<div class="dash-kpi-head">
				<div class="dash-kpi-icon" style:--ic-bg="rgba(16,185,129,.12)" style:--ic-fg="#10b981">
					<DollarSignIcon size={13} />
				</div>
				<span class="dash-kpi-label">MRR</span>
			</div>
			<div class="dash-kpi-value">{formatRONShort(dashboard.kpis.mrrCents)}</div>
			<div class="dash-kpi-foot">
				{#if dashboard.kpis.mrrDeltaPct !== 0}
					<span class={`dash-delta ${dashboard.kpis.mrrDeltaPct >= 0 ? 'up' : 'down'}`}>
						{#if dashboard.kpis.mrrDeltaPct >= 0}
							<ArrowUpIcon size={10} />
						{:else}
							<ArrowDownIcon size={10} />
						{/if}
						{dashboard.kpis.mrrDeltaPct >= 0 ? '+' : ''}{dashboard.kpis.mrrDeltaPct}%
					</span>
				{/if}
				<span class="dash-kpi-sub">
					anul trecut: {formatRONShort(dashboard.kpis.mrrYearAgoCents)}
				</span>
				{#if mrrSpark}
					<svg class="dash-spark" width={mrrSpark.w} height={mrrSpark.h}>
						<polyline
							points={mrrSpark.pts}
							fill="none"
							stroke="#10b981"
							stroke-width="1.6"
							stroke-linejoin="round"
							stroke-linecap="round"
						/>
					</svg>
				{/if}
			</div>
		</div>

		<div class="dash-kpi success">
			<div class="dash-kpi-head">
				<div class="dash-kpi-icon" style:--ic-bg="rgba(16,185,129,.12)" style:--ic-fg="#10b981">
					<TrendingUpIcon size={13} />
				</div>
				<span class="dash-kpi-label">ARR proiectat</span>
			</div>
			<div class="dash-kpi-value">{formatRONShortInt(dashboard.kpis.arrCents)}</div>
			<div class="dash-kpi-foot">
				<span class="dash-kpi-sub">MRR × 12</span>
			</div>
		</div>

		<div class="dash-kpi warn">
			<div class="dash-kpi-head">
				<div class="dash-kpi-icon" style:--ic-bg="rgba(245,158,11,.12)" style:--ic-fg="#f59e0b">
					<ClockIcon size={13} />
				</div>
				<span class="dash-kpi-label">Expiră în 30 zile</span>
			</div>
			<div class="dash-kpi-value">{dashboard.kpis.expiringIn30}</div>
			<div class="dash-kpi-foot">
				<span class="dash-kpi-sub">necesită follow-up</span>
			</div>
		</div>

		<div class="dash-kpi danger">
			<div class="dash-kpi-head">
				<div class="dash-kpi-icon" style:--ic-bg="rgba(239,68,68,.12)" style:--ic-fg="#ef4444">
					<AlertTriangleIcon size={13} />
				</div>
				<span class="dash-kpi-label">Suspendate</span>
			</div>
			<div class="dash-kpi-value">{dashboard.kpis.suspended}</div>
			<div class="dash-kpi-foot">
				<span class="dash-kpi-sub">neplată sau abuz</span>
			</div>
		</div>
	</section>

	<section class="hst-bento">
		<!-- MRR chart -->
		<div class="hst-card hst-w-mrr">
			<div class="hst-card-head">
				<div>
					<div class="hst-card-title">Evoluție MRR Hosting</div>
					<div class="hst-card-sub">Ultimele 12 luni · venit recurent lunar</div>
				</div>
				<a class="hst-card-link" href="/{tenantSlug}/banking">
					Detalii financiare <ChevronRightIcon size={11} />
				</a>
			</div>
			{#if chart}
				<svg
					viewBox="0 0 {chart.W} {chart.H}"
					class="hst-chart-svg"
					preserveAspectRatio="xMidYMid meet"
				>
					<defs>
						<linearGradient id="mrr-grad" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="#1877F2" stop-opacity="0.22" />
							<stop offset="100%" stop-color="#1877F2" stop-opacity="0" />
						</linearGradient>
					</defs>
					{#each chart.gridY as v, gi (gi)}
						<g>
							<line
								x1={chart.pad.l}
								x2={chart.W - chart.pad.r}
								y1={chart.labelY(v)}
								y2={chart.labelY(v)}
								stroke="#f1f5f9"
								stroke-width="1"
							/>
							<text
								x={chart.pad.l - 8}
								y={chart.labelY(v) + 3}
								font-size="10"
								fill="#94a3b8"
								text-anchor="end"
								font-family="Inter"
							>
								{chartLabel(v, chart.step)}
							</text>
						</g>
					{/each}
					<path d={chart.area} fill="url(#mrr-grad)" />
					<polyline
						points={chart.pts}
						fill="none"
						stroke="#1877F2"
						stroke-width="2.2"
						stroke-linejoin="round"
						stroke-linecap="round"
					/>
					{#each chart.points as p (p.m + p.x)}
						<g>
							<circle cx={p.x} cy={p.y} r="3" fill="white" stroke="#1877F2" stroke-width="1.6" />
							<text
								x={p.x}
								y={chart.H - 10}
								font-size="10.5"
								fill="#94a3b8"
								text-anchor="middle"
								font-family="Inter"
							>
								{p.m}
							</text>
						</g>
					{/each}
				</svg>
			{/if}
			<div class="hst-mrr-stats">
				<div class="hst-mrr-stat">
					<span>MRR {dashboard.mrrHistory[dashboard.mrrHistory.length - 1]?.m ?? ''}</span>
					<strong>{formatRON(dashboard.mrrStats.currentCents)} RON</strong>
					<div class="delta" class:negative={dashboard.mrrStats.deltaPct < 0}>
						{dashboard.mrrStats.deltaPct >= 0 ? '+' : ''}{dashboard.mrrStats.deltaPct}% vs luna anterioară
					</div>
				</div>
				<div class="hst-mrr-stat">
					<span>Conturi noi (12L)</span>
					<strong>{dashboard.mrrStats.newAccounts12mo}</strong>
					<div class="delta">cumulativ</div>
				</div>
				<div class="hst-mrr-stat">
					<span>ARR proiectat</span>
					<strong>{formatRONShortInt(dashboard.kpis.arrCents)}</strong>
					<div class="delta">MRR × 12</div>
				</div>
				<div class="hst-mrr-stat">
					<span>ARPU</span>
					<strong>
						{dashboard.kpis.activeAccounts > 0
							? (dashboard.kpis.mrrCents / dashboard.kpis.activeAccounts / 100).toFixed(1)
							: '0'}
						RON
					</strong>
					<div class="delta">mediu / cont</div>
				</div>
			</div>
		</div>

		<!-- Servers -->
		<div class="hst-card hst-w-servers">
			<div class="hst-card-head">
				<div>
					<div class="hst-card-title">Servere DirectAdmin</div>
					<div class="hst-card-sub">acces direct la infrastructură</div>
				</div>
				<a class="hst-card-link" href="/{tenantSlug}/hosting/servers">
					Toate <ChevronRightIcon size={11} />
				</a>
			</div>
			<div class="hst-servers-list">
				{#each servers.slice(0, 6) as s (s.id)}
					<a
						class="hst-server-mini {s.lastError ? 'warning' : ''}"
						href="/{tenantSlug}/hosting/servers/{s.id}"
					>
						<div class="hst-server-status {s.lastError ? 'warning' : 'online'}"></div>
						<div class="hst-server-info">
							<div class="hst-server-host">{s.name}</div>
							<div class="hst-server-meta">
								<span>{s.hostname}</span>
								<span>·</span>
								<span>{s.accountsCount} conturi</span>
								{#if s.metrics}
									<span>·</span>
									<span>load {s.metrics.load1.toFixed(1)}</span>
								{/if}
							</div>
						</div>
						{#if s.metrics}
							<div
								class="hst-server-bars"
								title="CPU {s.metrics.cpu}% · RAM {s.metrics.memory}% · Disk {s.metrics.disk}%"
							>
								<div class="hst-mini-bar">
									<div
										class="hst-mini-bar-fill"
										style:width="{s.metrics.cpu}%"
										style:background={meterColor(s.metrics.cpu)}
									></div>
								</div>
								<div class="hst-mini-bar">
									<div
										class="hst-mini-bar-fill"
										style:width="{s.metrics.memory}%"
										style:background={meterColor(s.metrics.memory)}
									></div>
								</div>
								<div class="hst-mini-bar">
									<div
										class="hst-mini-bar-fill"
										style:width="{s.metrics.disk}%"
										style:background={meterColor(s.metrics.disk)}
									></div>
								</div>
							</div>
						{/if}
					</a>
				{:else}
					<div class="hst-empty-sm">Niciun server activ</div>
				{/each}
			</div>
		</div>

		<!-- Expiring soon -->
		<div class="hst-card hst-w-expire">
			<div class="hst-card-head">
				<div>
					<div class="hst-card-title">Conturi care expiră curând</div>
					<div class="hst-card-sub">Următoarele 30 de zile · sortate după zile rămase</div>
				</div>
				<a class="hst-card-link" href="/{tenantSlug}/hosting/accounts">
					Vezi toate ({dashboard.kpis.expiringIn30}) <ChevronRightIcon size={11} />
				</a>
			</div>
			<div class="hst-expire-list">
				{#each dashboard.expiring as a (a.id)}
					<a
						class="hst-expire-row {a.expiresInDays <= 7 ? 'danger' : ''}"
						href="/{tenantSlug}/hosting/accounts/{a.id}"
					>
						<div>
							<div class="hst-expire-domain">{a.domain}</div>
							<div class="hst-expire-sub">
								{a.client} · {a.product} · {formatRON(a.mrrCents)} RON/lună
							</div>
						</div>
						<span class="hst-expire-days {a.expiresInDays <= 7 ? 'danger' : ''}">
							{expireDaysLabel(a.expiresInDays)}
						</span>
						<span class="hst-expire-renew">Reînnoiește</span>
					</a>
				{:else}
					<div class="hst-empty-sm">Niciun cont nu expiră în 30 de zile</div>
				{/each}
			</div>
		</div>

		<!-- Package distribution -->
		<div class="hst-card hst-w-pkgdist">
			<div class="hst-card-head">
				<div>
					<div class="hst-card-title">Distribuție pe pachete</div>
					<div class="hst-card-sub">
						{dashboard.kpis.activeAccounts} conturi active · MRR pe tier
					</div>
				</div>
			</div>
			<div class="hst-pkg-donut-wrap">
				<svg width={donut.size} height={donut.size} viewBox="0 0 {donut.size} {donut.size}">
					<circle
						cx={donut.size / 2}
						cy={donut.size / 2}
						r={donut.r}
						fill="none"
						stroke="#f1f5f9"
						stroke-width={donut.thickness}
					/>
					{#each donut.segments as seg, i (i)}
						<circle
							cx={donut.size / 2}
							cy={donut.size / 2}
							r={donut.r}
							fill="none"
							stroke={seg.color}
							stroke-width={donut.thickness}
							stroke-dasharray={seg.dash}
							stroke-dashoffset={-seg.offset}
							transform="rotate(-90 {donut.size / 2} {donut.size / 2})"
						/>
					{/each}
					<text
						x={donut.size / 2}
						y={donut.size / 2 - 4}
						text-anchor="middle"
						font-size="22"
						font-weight="700"
						fill="#0f172a"
						font-family="Inter"
					>
						{donut.total}
					</text>
					<text
						x={donut.size / 2}
						y={donut.size / 2 + 14}
						text-anchor="middle"
						font-size="11"
						fill="#94a3b8"
						font-family="Inter"
					>
						conturi
					</text>
				</svg>
				<div class="hst-pkg-legend">
					{#each dashboard.productDistribution as p (p.id)}
						<div class="hst-pkg-legend-row">
							<span class="hst-pkg-dot" style:background={p.color}></span>
							<span class="hst-pkg-name">{p.name}</span>
							<span class="hst-pkg-count">{p.accounts}</span>
							<span class="hst-pkg-mrr">{formatRON(p.mrrCents)} RON</span>
						</div>
					{:else}
						<div class="hst-empty-sm">Niciun pachet configurat</div>
					{/each}
				</div>
			</div>
		</div>

		<!-- Top clients -->
		<div class="hst-card hst-w-topc">
			<div class="hst-card-head">
				<div>
					<div class="hst-card-title">Top clienți după MRR</div>
					<div class="hst-card-sub">Clienții cu cele mai mari venituri lunare din hosting</div>
				</div>
				<a class="hst-card-link" href="/{tenantSlug}/clients">
					CRM clienți <ChevronRightIcon size={11} />
				</a>
			</div>
			<div class="hst-topc-list">
				{#each dashboard.topClients as c, i (c.id)}
					<a class="hst-topc-row" href="/{tenantSlug}/clients/{c.id}">
						<div class="hst-topc-avatar" style:background={clientColor(c.name)}>
							{getInitials(c.name)}
						</div>
						<div class="hst-topc-info">
							<div class="hst-topc-name">{c.name}</div>
							<div class="hst-topc-meta">
								{c.accounts} {c.accounts === 1 ? 'cont' : 'conturi'} · #{i + 1}
							</div>
						</div>
						<div class="hst-topc-mrr">{formatRON(c.mrrCents)} RON/lună</div>
					</a>
				{:else}
					<div class="hst-empty-sm">Niciun client activ</div>
				{/each}
			</div>
		</div>

		<!-- Activity -->
		<div class="hst-card hst-w-activity">
			<div class="hst-card-head">
				<div>
					<div class="hst-card-title">Activitate recentă</div>
					<div class="hst-card-sub">Sync-uri DirectAdmin, renewals, alertele sistemului</div>
				</div>
				<a class="hst-card-link" href="/{tenantSlug}/hosting/accounts">
					Jurnal complet <ChevronRightIcon size={11} />
				</a>
			</div>
			<div class="hst-activity-list">
				{#each dashboard.activity as a (a.id)}
					{@const Ic = activityIcons[a.icon as keyof typeof activityIcons] ?? InfoIcon}
					<div class="hst-activity-row">
						<div
							class="hst-activity-icon"
							style:--ic-bg="{a.color}18"
							style:--ic-fg={a.color}
						>
							<Ic size={13} />
						</div>
						<div class="hst-activity-text">
							<div class="hst-activity-action">{a.label}</div>
							<div class="hst-activity-detail">{a.detail}</div>
						</div>
						<div class="hst-activity-meta">
							<div class="hst-activity-ago">{ago(a.createdAt)}</div>
							<div class="hst-activity-user">{a.actor}</div>
						</div>
					</div>
				{:else}
					<div class="hst-empty-sm">Nicio activitate recentă</div>
				{/each}
			</div>
		</div>

		<!-- Suspended -->
		<div class="hst-card hst-w-suspend">
			<div class="hst-card-head">
				<div>
					<div class="hst-card-title">Conturi suspendate / cu probleme</div>
					<div class="hst-card-sub">
						Necesită intervenție · {dashboard.kpis.suspended} conturi
					</div>
				</div>
			</div>
			<div class="hst-suspend-block">
				{#each dashboard.suspended as a (a.id)}
					<a class="hst-suspend-row" href="/{tenantSlug}/hosting/accounts/{a.id}">
						<div>
							<div class="hst-suspend-domain">{a.domain}</div>
							<div class="hst-suspend-detail">
								{a.client} · {a.reason}{#if a.overdueDays} · {a.overdueDays} zile întârziere{/if}
							</div>
						</div>
						<span class="hst-suspend-action">Contactează</span>
					</a>
				{:else}
					<div class="hst-empty-sm">Niciun cont suspendat</div>
				{/each}
			</div>
		</div>

		<!-- Quick actions -->
		<div class="hst-card hst-w-quick">
			<div class="hst-card-head">
				<div>
					<div class="hst-card-title">Acțiuni rapide</div>
					<div class="hst-card-sub">Operațiunile cele mai folosite</div>
				</div>
			</div>
			<div class="hst-quick">
				<a class="hst-quick-btn" href="/{tenantSlug}/hosting/accounts/new">
					<div class="hst-quick-icon" style:--qa-bg="rgba(24,119,242,.12)" style:--qa-fg="#1877F2">
						<PlusIcon size={14} />
					</div>
					<div class="hst-quick-text">
						<div class="hst-quick-title">Cont nou</div>
						<div class="hst-quick-sub">Creează cont DA</div>
					</div>
				</a>
				<button class="hst-quick-btn" type="button" onclick={handleSyncAll} disabled={syncing}>
					<div class="hst-quick-icon" style:--qa-bg="rgba(99,102,241,.12)" style:--qa-fg="#6366f1">
						<RefreshCwIcon size={14} class={syncing ? 'spin' : ''} />
					</div>
					<div class="hst-quick-text">
						<div class="hst-quick-title">Sync DirectAdmin</div>
						<div class="hst-quick-sub">Toate serverele</div>
					</div>
				</button>
				<a class="hst-quick-btn" href="/{tenantSlug}/hosting/products">
					<div class="hst-quick-icon" style:--qa-bg="rgba(16,185,129,.12)" style:--qa-fg="#10b981">
						<PackageIcon size={14} />
					</div>
					<div class="hst-quick-text">
						<div class="hst-quick-title">Produse</div>
						<div class="hst-quick-sub">Pachete hosting</div>
					</div>
				</a>
				<a class="hst-quick-btn" href="/{tenantSlug}/hosting/servers">
					<div class="hst-quick-icon" style:--qa-bg="rgba(245,158,11,.12)" style:--qa-fg="#f59e0b">
						<ServerIcon size={14} />
					</div>
					<div class="hst-quick-text">
						<div class="hst-quick-title">Server nou</div>
						<div class="hst-quick-sub">Adaugă DA</div>
					</div>
				</a>
				<a class="hst-quick-btn" href="/{tenantSlug}/hosting/provisioning">
					<div class="hst-quick-icon" style:--qa-bg="rgba(124,58,237,.12)" style:--qa-fg="#7c3aed">
						<LockIcon size={14} />
					</div>
					<div class="hst-quick-text">
						<div class="hst-quick-title">Provisioning</div>
						<div class="hst-quick-sub">Status DA</div>
					</div>
				</a>
				<a class="hst-quick-btn" href="/pachete-hosting" target="_blank" rel="noopener">
					<div class="hst-quick-icon" style:--qa-bg="rgba(236,72,153,.12)" style:--qa-fg="#ec4899">
						<GlobeIcon size={14} />
					</div>
					<div class="hst-quick-text">
						<div class="hst-quick-title">Pagină publică</div>
						<div class="hst-quick-sub">/pachete-hosting</div>
					</div>
				</a>
			</div>
		</div>
	</section>
</div>

<style>
	/*
	 * The parent layout `<main>` already provides p-6 (24px) of inset on all
	 * sides, so this page does NOT add outer padding — only inter-section gap.
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
		color: #0f172a;
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

	.btn-primary,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 7px;
		font-size: 12.5px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		text-decoration: none;
		line-height: 1;
	}
	.btn-primary {
		background: #1877f2;
		color: white;
		border: 1px solid #1877f2;
	}
	.btn-primary:hover {
		background: #0d5cc7;
		border-color: #0d5cc7;
	}
	.btn-secondary {
		background: white;
		color: #475569;
		border: 1px solid #d5dbe5;
	}
	.btn-secondary:hover:not(:disabled) {
		border-color: #1877f2;
		color: #1877f2;
	}
	.btn-secondary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	:global(.spin) {
		animation: hst-spin 1s linear infinite;
	}
	@keyframes hst-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ===== KPI grid ===== */
	.hst-kpis {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 10px;
	}
	.dash-kpi {
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 10px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		position: relative;
		overflow: hidden;
		transition:
			border-color 0.15s,
			transform 0.15s,
			box-shadow 0.15s;
	}
	.dash-kpi:hover {
		border-color: #1877f2;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
	}
	/* Colored left accent strip — 3px tall band matching the KPI kind. */
	.dash-kpi::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 3px;
	}
	.dash-kpi.primary::before {
		background: #1877f2;
	}
	.dash-kpi.info::before {
		background: #6366f1;
	}
	.dash-kpi.success::before {
		background: #10b981;
	}
	.dash-kpi.warn::before {
		background: #f59e0b;
	}
	.dash-kpi.danger::before {
		background: #ef4444;
	}
	.dash-kpi-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dash-kpi-icon {
		width: 24px;
		height: 24px;
		border-radius: 6px;
		display: grid;
		place-items: center;
		background: var(--ic-bg);
		color: var(--ic-fg);
		flex-shrink: 0;
	}
	.dash-kpi-label {
		font-size: 10.5px;
		font-weight: 700;
		color: #475569;
		text-transform: uppercase;
		letter-spacing: 0.04em;
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
		flex-wrap: wrap;
		row-gap: 2px;
	}
	.dash-delta {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-size: 11px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.dash-delta.up {
		color: #10b981;
	}
	.dash-delta.down {
		color: #ef4444;
	}
	.dash-kpi-sub {
		font-size: 11px;
		color: #94a3b8;
		font-weight: 500;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dash-spark {
		flex-shrink: 0;
		margin-left: auto;
	}

	/* ===== Bento grid ===== */
	.hst-bento {
		display: grid;
		grid-template-columns: repeat(12, 1fr);
		grid-auto-rows: minmax(120px, auto);
		gap: 12px;
	}
	.hst-card {
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
	}
	.hst-card-head {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.hst-card-title {
		font-size: 14px;
		font-weight: 700;
		color: #0f172a;
		letter-spacing: -0.01em;
	}
	.hst-card-sub {
		font-size: 11.5px;
		color: #94a3b8;
		margin-top: 2px;
	}
	.hst-card-link {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-size: 12px;
		color: #1877f2;
		font-weight: 600;
		background: transparent;
		border: none;
		cursor: pointer;
		font-family: inherit;
		text-decoration: none;
	}
	.hst-card-link:hover {
		text-decoration: underline;
	}
	.hst-w-mrr {
		grid-column: span 8;
	}
	.hst-w-servers {
		grid-column: span 4;
	}
	.hst-w-expire {
		grid-column: span 6;
	}
	.hst-w-pkgdist {
		grid-column: span 6;
	}
	.hst-w-topc {
		grid-column: span 5;
	}
	.hst-w-activity {
		grid-column: span 7;
	}
	.hst-w-suspend {
		grid-column: span 6;
	}
	.hst-w-quick {
		grid-column: span 6;
	}

	.hst-empty-sm {
		padding: 18px 8px;
		text-align: center;
		font-size: 12px;
		color: #94a3b8;
	}

	/* MRR chart — wide aspect ratio (1100×220 ≈ 5:1) keeps text readable
	 * while filling the card horizontally. `meet` preserves typography. */
	.hst-chart-svg {
		width: 100%;
		height: auto;
		max-height: 240px;
		display: block;
	}
	.hst-mrr-stats {
		display: flex;
		gap: 22px;
		padding-top: 8px;
		border-top: 1px solid #f1f5f9;
		flex-wrap: wrap;
	}
	.hst-mrr-stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.hst-mrr-stat span {
		font-size: 10px;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 700;
	}
	.hst-mrr-stat strong {
		font-size: 16px;
		font-weight: 700;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
	}
	.hst-mrr-stat .delta {
		font-size: 11px;
		font-weight: 700;
		color: #10b981;
	}
	.hst-mrr-stat .delta.negative {
		color: #ef4444;
	}

	/* Servers */
	.hst-servers-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-height: 0;
	}
	.hst-server-mini {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 10px;
		border-radius: 8px;
		border: 1px solid #e5e9f0;
		text-decoration: none;
		color: inherit;
		transition: border-color 0.12s;
	}
	.hst-server-mini:hover {
		border-color: #1877f2;
	}
	.hst-server-mini.warning {
		background: #fffbeb;
		border-color: #fde68a;
	}
	.hst-server-status {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.hst-server-status.online {
		background: #10b981;
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
	}
	.hst-server-status.warning {
		background: #f59e0b;
		box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);
	}
	.hst-server-info {
		flex: 1;
		min-width: 0;
	}
	.hst-server-host {
		font-size: 12.5px;
		font-weight: 600;
		color: #0f172a;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}
	.hst-server-meta {
		font-size: 10.5px;
		color: #94a3b8;
		margin-top: 1px;
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.hst-server-bars {
		display: flex;
		gap: 4px;
		align-items: center;
		flex-shrink: 0;
	}
	.hst-mini-bar {
		width: 36px;
		height: 4px;
		background: #f1f5f9;
		border-radius: 2px;
		overflow: hidden;
	}
	.hst-mini-bar-fill {
		height: 100%;
		border-radius: 2px;
	}

	/* Expire rows */
	.hst-expire-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.hst-expire-row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 12px;
		align-items: center;
		padding: 10px 12px;
		border: 1px solid #e5e9f0;
		border-left: 3px solid #f59e0b;
		border-radius: 8px;
		font-size: 12.5px;
		text-decoration: none;
		color: inherit;
		transition: border-color 0.12s;
	}
	.hst-expire-row:hover {
		border-color: #1877f2;
		border-left-color: #1877f2;
	}
	.hst-expire-row.danger {
		border-left-color: #ef4444;
		background: #fef2f2;
	}
	.hst-expire-domain {
		font-weight: 600;
		color: #0f172a;
	}
	.hst-expire-sub {
		font-size: 11px;
		color: #94a3b8;
		margin-top: 1px;
	}
	.hst-expire-days {
		background: rgba(245, 158, 11, 0.12);
		color: #b45309;
		font-size: 11px;
		font-weight: 700;
		padding: 3px 9px;
		border-radius: 999px;
		white-space: nowrap;
	}
	.hst-expire-days.danger {
		background: #fee2e2;
		color: #b91c1c;
	}
	.hst-expire-renew {
		font-size: 11px;
		font-weight: 600;
		color: #1877f2;
		background: transparent;
		border: 1px solid #d5dbe5;
		padding: 4px 10px;
		border-radius: 6px;
		font-family: inherit;
	}
	.hst-expire-row:hover .hst-expire-renew {
		background: #1877f2;
		color: white;
		border-color: #1877f2;
	}

	/* Donut */
	.hst-pkg-donut-wrap {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.hst-pkg-legend {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.hst-pkg-legend-row {
		display: grid;
		grid-template-columns: 12px 1fr auto auto;
		gap: 8px;
		align-items: center;
		padding: 6px 0;
		font-size: 12.5px;
	}
	.hst-pkg-legend-row + .hst-pkg-legend-row {
		border-top: 1px solid #f1f5f9;
	}
	.hst-pkg-dot {
		width: 12px;
		height: 12px;
		border-radius: 4px;
		display: inline-block;
	}
	.hst-pkg-name {
		font-weight: 600;
		color: #0f172a;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hst-pkg-count {
		color: #475569;
		font-variant-numeric: tabular-nums;
		font-size: 11.5px;
	}
	.hst-pkg-mrr {
		font-weight: 700;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
	}

	/* Top clients */
	.hst-topc-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.hst-topc-row {
		display: flex;
		align-items: center;
		gap: 10px;
		text-decoration: none;
		color: inherit;
		padding: 4px 0;
	}
	.hst-topc-row:hover .hst-topc-name {
		color: #1877f2;
	}
	.hst-topc-avatar {
		width: 32px;
		height: 32px;
		border-radius: 7px;
		color: white;
		font-weight: 700;
		font-size: 11px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.hst-topc-info {
		flex: 1;
		min-width: 0;
	}
	.hst-topc-name {
		font-weight: 600;
		font-size: 12.5px;
		color: #0f172a;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hst-topc-meta {
		font-size: 11px;
		color: #94a3b8;
	}
	.hst-topc-mrr {
		font-weight: 700;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}

	/* Activity list */
	.hst-activity-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 320px;
		overflow-y: auto;
		margin: -4px;
		padding: 4px;
	}
	.hst-activity-row {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 8px;
		border-radius: 7px;
	}
	.hst-activity-row:hover {
		background: #f7f8fa;
	}
	.hst-activity-icon {
		width: 26px;
		height: 26px;
		border-radius: 6px;
		display: grid;
		place-items: center;
		flex-shrink: 0;
		background: var(--ic-bg);
		color: var(--ic-fg);
	}
	.hst-activity-text {
		flex: 1;
		min-width: 0;
	}
	.hst-activity-action {
		font-size: 12.5px;
		font-weight: 600;
		color: #0f172a;
	}
	.hst-activity-detail {
		font-size: 11.5px;
		color: #475569;
		margin-top: 1px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hst-activity-meta {
		text-align: right;
		flex-shrink: 0;
	}
	.hst-activity-ago {
		font-size: 11px;
		color: #94a3b8;
	}
	.hst-activity-user {
		font-size: 10px;
		color: #cbd5e1;
		margin-top: 1px;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Suspended */
	.hst-suspend-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.hst-suspend-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 12px;
		align-items: center;
		padding: 10px 12px;
		border: 1px solid #fecaca;
		background: #fef2f2;
		border-radius: 8px;
		text-decoration: none;
		color: inherit;
	}
	.hst-suspend-row:hover {
		border-color: #ef4444;
	}
	.hst-suspend-domain {
		font-size: 12.5px;
		font-weight: 600;
		color: #0f172a;
	}
	.hst-suspend-detail {
		font-size: 11px;
		color: #b91c1c;
		margin-top: 1px;
	}
	.hst-suspend-action {
		background: #1877f2;
		color: white;
		border: none;
		font-size: 11px;
		font-weight: 600;
		padding: 5px 10px;
		border-radius: 6px;
		font-family: inherit;
	}

	/* Quick actions */
	.hst-quick {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.hst-quick-btn {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		border: 1px solid #e5e9f0;
		border-radius: 9px;
		background: white;
		cursor: pointer;
		font-family: inherit;
		text-align: left;
		text-decoration: none;
		color: inherit;
		transition:
			border-color 0.12s,
			transform 0.12s;
	}
	.hst-quick-btn:hover:not(:disabled) {
		border-color: #1877f2;
		transform: translateY(-1px);
	}
	.hst-quick-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.hst-quick-icon {
		width: 32px;
		height: 32px;
		border-radius: 7px;
		display: grid;
		place-items: center;
		background: var(--qa-bg);
		color: var(--qa-fg);
		flex-shrink: 0;
	}
	.hst-quick-text {
		flex: 1;
		min-width: 0;
	}
	.hst-quick-title {
		font-size: 12.5px;
		font-weight: 600;
		color: #0f172a;
	}
	.hst-quick-sub {
		font-size: 11px;
		color: #94a3b8;
		margin-top: 1px;
	}

	/* Responsive */
	@media (max-width: 1400px) {
		.hst-kpis {
			grid-template-columns: repeat(3, 1fr);
		}
		.hst-w-mrr,
		.hst-w-servers,
		.hst-w-expire,
		.hst-w-pkgdist,
		.hst-w-topc,
		.hst-w-activity,
		.hst-w-suspend,
		.hst-w-quick {
			grid-column: span 12;
		}
	}
</style>
