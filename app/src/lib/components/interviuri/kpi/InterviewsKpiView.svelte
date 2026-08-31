<script lang="ts">
	import '../interviuri.css';
	import './interviuri-kpi.css';
	import { toast } from 'svelte-sonner';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import TargetIcon from '@lucide/svelte/icons/target';
	import CheckCheckIcon from '@lucide/svelte/icons/check-check';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import UsersIcon from '@lucide/svelte/icons/users';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import InfoIcon from '@lucide/svelte/icons/info';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	import {
		getInterviewKpiData,
		getMarketingFixedCosts,
		createMarketingFixedCost,
		updateMarketingFixedCost,
		deleteMarketingFixedCost,
		resetMarketingFixedCosts,
		syncInterviewAdsBudgets
	} from '$lib/remotes/interviuri-kpi.remote';
	import { getInterviewChannels } from '$lib/remotes/interviuri.remote';
	import type { InterviewKpiData } from '$lib/server/interviuri/kpi-data';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import {
		computeKpi,
		computeDelta,
		buildKpiCsv,
		fmtLei,
		fmtLeiFine,
		fmtInt,
		pct,
		FIXED_COLOR,
		PLATFORMS,
		type FixedCostRow,
		type FixedMode,
		type MonthFilter
	} from '$lib/logic/interviuri-kpi';
	import { IV_MONTHS, type ChannelMeta } from '../lib';
	import type { FixedPatch, SourcePlatform } from './types';
	import SourcesPanel from './SourcesPanel.svelte';
	import FixedCostsPanel from './FixedCostsPanel.svelte';
	import FixedCostsModal from './FixedCostsModal.svelte';
	import CostTrend from './CostTrend.svelte';
	import ChannelCostTable from './ChannelCostTable.svelte';
	import MonthlyDetailTable from './MonthlyDetailTable.svelte';

	// isClient = view-ul rulează în portalul clientului: serverul scopează datele pe
	// clientul din sesiune; sync-ul și editarea cheltuielilor sunt doar pentru staff.
	let {
		homeHref,
		interviewsHref,
		isClient = false
	}: { homeHref: string; interviewsHref: string; isClient?: boolean } = $props();

	const uid = $props.id();
	const LS_KEY = 'ots_iv_kpi_v1';

	// ---- stare pagină ----
	// anul NU se persistă: serverul alege oricum cel mai recent an cu date, iar un an salvat
	// ar declanșa al doilea query complet la fiecare încărcare (review H2)
	let selectedYear = $state<number | null>(null);
	let month = $state<MonthFilter>('all');
	let mode = $state<FixedMode>('toate');
	let prefsLoaded = $state(false);

	$effect(() => {
		// rulează doar în browser, o singură dată: preia modul de alocare salvat
		try {
			const p = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
			if (p.mode === 'platite' || p.mode === 'toate') mode = p.mode;
		} catch {
			/* localStorage indisponibil — pornim cu implicitele */
		}
		prefsLoaded = true;
	});
	$effect(() => {
		if (!prefsLoaded) return;
		const payload = JSON.stringify({ mode });
		try {
			localStorage.setItem(LS_KEY, payload);
		} catch {
			/* ignorat */
		}
	});

	// ---- date ----
	const kpiQuery = $derived(getInterviewKpiData(selectedYear ? { year: selectedYear } : undefined));
	const fixedQuery = getMarketingFixedCosts();
	const channelsQuery = getInterviewChannels();

	// păstrăm ultimul răspuns ca schimbarea anului să nu golească pagina cât se încarcă
	// (cache nereactiv: e scris doar din derived, nu declanșează nimic)
	let lastData: InterviewKpiData | null = null;
	const data = $derived.by(() => {
		const d = kpiQuery.current;
		if (d) lastData = d;
		return d ?? lastData;
	});
	const loading = $derived(kpiQuery.loading);
	const loadError = $derived(kpiQuery.error);

	const channels = $derived((channelsQuery.current ?? []) as ChannelMeta[]);
	const channelOrder = $derived(channels.map((c) => c.name));
	const channelMeta = $derived(
		Object.fromEntries(channels.map((c) => [c.name, c])) as Record<string, ChannelMeta>
	);

	// ---- cheltuieli fixe: overlay optimist + salvare cu debounce 400 ms ----
	const serverRows = $derived((fixedQuery.current?.rows ?? []) as FixedCostRow[]);
	const canEdit = $derived(fixedQuery.current?.canEdit ?? false);
	let edits = $state<Record<string, FixedPatch>>({});
	let fixedModalOpen = $state(false);
	const fixedRows = $derived(serverRows.map((r) => (edits[r.id] ? { ...r, ...edits[r.id] } : r)));
	// nereactive, intenționat: mecanică de salvare, nu stare de afișat
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const pending = new Map<string, FixedPatch>();
	const inFlight = new Map<string, number>();

	function clearEdit(id: string) {
		if (!(id in edits)) return;
		const next = { ...edits };
		delete next[id];
		edits = next;
	}
	/** Uită tot ce e local pentru un rând (după ștergere/reset): timer, patch în așteptare, overlay. */
	function dropLocal(id: string) {
		clearTimeout(timers.get(id));
		timers.delete(id);
		pending.delete(id);
		clearEdit(id);
	}
	function changeFixed(id: string, patch: FixedPatch, immediate = false) {
		if (!canEdit) return;
		edits = { ...edits, [id]: { ...(edits[id] ?? {}), ...patch } };
		pending.set(id, { ...(pending.get(id) ?? {}), ...patch });
		clearTimeout(timers.get(id));
		timers.delete(id);
		if (immediate) void flushFixed(id);
		else timers.set(id, setTimeout(() => void flushFixed(id), 400));
	}
	async function flushFixed(id: string) {
		timers.delete(id);
		const patch = pending.get(id);
		pending.delete(id);
		if (!patch) return;
		inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
		try {
			await updateMarketingFixedCost({ id, ...patch }).updates(fixedQuery);
		} catch (e) {
			toast.error('Modificarea nu s-a salvat', {
				description: remoteErrorMessage(e, 'Încearcă din nou.')
			});
		} finally {
			// overlay-ul se scoate DOAR când nu mai e nimic în zbor sau în așteptare pe rând —
			// altfel o cerere mai veche care se termină târziu ar șterge tastele de după ea
			const n = (inFlight.get(id) ?? 1) - 1;
			inFlight.set(id, n);
			if (n <= 0 && !pending.has(id) && !timers.has(id)) clearEdit(id);
		}
	}
	async function addFixed() {
		try {
			await createMarketingFixedCost(undefined).updates(fixedQuery);
		} catch (e) {
			toast.error('Nu s-a putut adăuga rândul', {
				description: remoteErrorMessage(e, 'Încearcă din nou.')
			});
		}
	}
	async function deleteFixed(id: string) {
		dropLocal(id);
		try {
			await deleteMarketingFixedCost(id).updates(fixedQuery);
		} catch (e) {
			toast.error('Nu s-a putut șterge rândul', {
				description: remoteErrorMessage(e, 'Încearcă din nou.')
			});
		}
	}
	async function resetFixed() {
		for (const id of new Set([...timers.keys(), ...pending.keys(), ...Object.keys(edits)])) dropLocal(id);
		try {
			await resetMarketingFixedCosts().updates(fixedQuery);
			toast.success('Cheltuielile fixe au fost resetate la implicit');
		} catch (e) {
			toast.error('Resetarea a eșuat', { description: remoteErrorMessage(e, 'Încearcă din nou.') });
		}
	}

	// ---- calcule (același modul ca serverul) ----
	const kpi = $derived(
		data ? computeKpi({ data: data.current, fixedRows, month, mode, channelOrder }) : null
	);
	const delta = $derived(
		data && kpi
			? computeDelta({ current: kpi, month, previous: data.previous, fixedRows, mode, channelOrder })
			: null
	);
	const platforms = $derived<SourcePlatform[]>(
		PLATFORMS.map((p) => {
			const info = data?.platforms.find((x) => x.id === p.id);
			return {
				id: p.id,
				label: p.label,
				color: p.color,
				soft: p.soft,
				account: info?.account ?? null,
				syncedAt: info?.syncedAt ?? null,
				amount: kpi?.adsByPlatform[p.id] ?? 0
			};
		})
	);
	const years = $derived(
		data?.years.length ? data.years : [selectedYear ?? new Date().getFullYear()]
	);
	// anul ales de user se reflectă imediat în pastile (feedback cât se încarcă), serverul îl confirmă
	const year = $derived(
		selectedYear !== null && years.includes(selectedYear)
			? selectedYear
			: (data?.current.year ?? years[years.length - 1])
	);
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const periodLabel = $derived(
		month === 'all' ? `tot anul ${year}` : `${IV_MONTHS[month - 1] ?? month} ${year}`
	);
	const monthsCount = $derived(kpi?.scopeMonths.length ?? 0);
	const monthsLabel = $derived(monthsCount === 1 ? 'lună' : 'luni');
	const lastSync = $derived(fmtDateTime(data?.lastSyncedAt ?? null));

	/** „USD: 2026-01, 2026-02 (+9 luni din 2025)" — lunile anului curent explicit, anul precedent numărat */
	function fxSummary(warnings: Array<{ currency: string; month: string }>): string {
		const byCur = new Map<string, { cur: string[]; prev: number }>();
		for (const w of warnings) {
			const g = byCur.get(w.currency) ?? { cur: [], prev: 0 };
			if (w.month.startsWith(`${year}-`)) g.cur.push(w.month);
			else g.prev++;
			byCur.set(w.currency, g);
		}
		return [...byCur]
			.map(([c, g]) => {
				const months = [...new Set(g.cur)].sort().join(', ');
				const prev = g.prev ? `${months ? ' ' : ''}(+${plural(g.prev, 'lună', 'luni')} din ${year - 1})` : '';
				return `${c}: ${months}${prev}`;
			})
			.join('; ');
	}

	function pickYear(y: number) {
		selectedYear = y;
		month = 'all';
	}
	function pickMonth(m: MonthFilter) {
		month = m;
	}
	function onMonthSelect(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value;
		month = v === 'all' ? 'all' : Number(v);
	}
	function fmtDateTime(iso: string | null): string {
		if (!iso) return 'niciodată';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return 'niciodată';
		const p = (x: number) => String(x).padStart(2, '0');
		return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
	}

	// ---- sincronizare bugete ----
	let syncing = $state(false);
	async function sync() {
		if (syncing) return;
		syncing = true;
		try {
			const res = await syncInterviewAdsBudgets().updates(kpiQuery);
			const failed = res.results.filter((r) => !r.ok);
			const detail = failed.map((f) => `${f.label}: ${f.error ?? 'eroare'}`).join(' · ');
			if (failed.length === res.results.length) {
				toast.error('Sincronizarea a eșuat', { description: detail });
			} else if (failed.length) {
				toast.warning('Sincronizare parțială', { description: detail });
			} else {
				toast.success('Bugetele au fost sincronizate');
			}
		} catch (e) {
			toast.error('Sincronizarea a eșuat', {
				description: remoteErrorMessage(e, 'Încearcă din nou.')
			});
		} finally {
			syncing = false;
		}
	}

	// ---- export CSV (exact rândurile lunare afișate) ----
	function exportCsv() {
		if (!kpi) return;
		const blob = new Blob([buildKpiCsv(kpi.monthRows)], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		const url = URL.createObjectURL(blob);
		a.href = url;
		a.download = `kpi-interviuri-${year}.csv`;
		a.click();
		// Firefox poate anula descărcarea dacă URL-ul e revocat imediat
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<div class="cl-wrap">
	<div class="cl-crumbs">
		<a href={homeHref} aria-label="Dashboard"><FolderIcon size={12} /></a>
		<span class="sep">›</span>
		{#if !isClient}
			<span>Marketing &amp; Ads</span>
			<span class="sep">›</span>
		{/if}
		<a href={interviewsHref}>Interviuri</a>
		<span class="sep">›</span>
		<strong>KPI Performanță</strong>
	</div>

	<div class="cl-hero ivk-hero">
		<div class="ivk-hero-title">
			<h1>KPI performanță interviuri</h1>
			<p>
				Cât costă un interviu, din bugetul de ads (Meta, TikTok, Google) plus cheltuielile fixe de
				marketing · <strong>{loading && !data ? 'se încarcă…' : periodLabel}</strong>
			</p>
		</div>
		<div class="cl-hero-actions">
			<div class="iv-year-pills" role="group" aria-label="Anul">
				{#each years as y (y)}
					<button
						type="button"
						class="iv-year-pill {year === y ? 'active' : ''}"
						aria-pressed={year === y}
						onclick={() => pickYear(y)}
					>
						{y}
					</button>
				{/each}
			</div>
			<div class="cl-select-wrap">
				<label class="cl-select-lbl" for="{uid}-month">Luna:</label>
				<select
					id="{uid}-month"
					class="cl-select"
					value={month === 'all' ? 'all' : String(month)}
					onchange={onMonthSelect}
				>
					<option value="all">Tot anul</option>
					{#each kpi?.monthRows ?? [] as r (r.monthNum)}
						<option value={String(r.monthNum)}>{r.month}</option>
					{/each}
				</select>
			</div>
			<button type="button" class="cl-btn-secondary" onclick={exportCsv} disabled={!kpi}>
				<DownloadIcon size={13} /> Export
			</button>
			<a class="cl-btn-secondary" href={interviewsHref}>
				<UserPlusIcon size={13} /> Evidența interviurilor
			</a>
		</div>
	</div>

	{#if loadError || (data && (data.linkedClients === 0 || !data.hasAdsData || data.fxWarnings.length))}
		<div class="ivk-pad ivk-banners" style="padding-bottom:14px">
			{#if loadError}
				<div class="ivk-note danger" role="alert">
					<TriangleAlertIcon size={14} />
					<div>
						Nu am putut încărca datele: {remoteErrorMessage(loadError, 'eroare necunoscută')}
						<button
							type="button"
							class="cl-btn-secondary cl-btn-sm"
							style="margin-left:8px"
							onclick={() => kpiQuery.refresh()}
						>
							Reîncearcă
						</button>
					</div>
				</div>
			{/if}
			{#if data && data.linkedClients === 0}
				<div class="ivk-note warn">
					<TriangleAlertIcon size={14} />
					<div>
						Interviurile nu sunt asociate niciunui client, deci bugetele de ads nu pot fi citite.
						Asociază-le cu clientul studioului din <a href={interviewsHref}>pagina Interviuri</a>.
					</div>
				</div>
			{:else if data && !data.hasAdsData}
				<div class="ivk-note warn">
					<InfoIcon size={14} />
					<div>
						Pentru <b>{year}</b> nu există cheltuieli de ads sincronizate — se afișează doar
						cheltuielile fixe de marketing.
					</div>
				</div>
			{/if}
			{#if data && data.fxWarnings.some((w) => w.approx)}
				<div class="ivk-note">
					<InfoIcon size={14} />
					<div>
						Fără istoric BNR pentru {fxSummary(data.fxWarnings.filter((w) => w.approx))} — sumele
						sunt convertite la cel mai recent curs disponibil.
					</div>
				</div>
			{/if}
			{#if data && data.fxWarnings.some((w) => !w.approx)}
				<div class="ivk-note warn">
					<TriangleAlertIcon size={14} />
					<div>
						Sume excluse din lipsă de curs BNR: {fxSummary(data.fxWarnings.filter((w) => !w.approx))}.
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- KPI -->
	<div class="cl-hero {loading ? 'ivk-loading' : ''}" style="padding-top:0; padding-bottom:0" aria-busy={loading}>
		<div class="cl-kpis ivk-kpis">
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background:var(--cl-accent-50); color:var(--cl-accent)"><TargetIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Cost / interviu</div>
					<div class="cl-kpi-val">{fmtLeiFine(kpi?.cpi)}</div>
					<div class="cl-kpi-sub">{kpi ? plural(kpi.n, 'interviu', 'interviuri') : '—'} în perioadă</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background:rgba(16,185,129,.08); color:#047857"><CheckCheckIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Cost / model admisă</div>
					<div class="cl-kpi-val cl-text-ok">{fmtLeiFine(kpi?.cpiOk)}</div>
					<div class="cl-kpi-sub">{kpi ? `${plural(kpi.nOk, 'admisă', 'admise')} · ${pct(kpi.nOk, kpi.n)}% rată` : '—'}</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background:rgba(100,116,139,.1); color:{FIXED_COLOR}"><DollarSignIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Buget total</div>
					<div class="cl-kpi-val">{kpi ? fmtLei(kpi.total) : '—'}</div>
					<div class="cl-kpi-sub">{kpi ? `${monthsCount} ${monthsLabel}` : '—'}</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background:rgba(139,92,246,.08); color:#8b5cf6"><ZapIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Buget ads (live)</div>
					<div class="cl-kpi-val">{kpi ? fmtLei(kpi.adsTotal) : '—'}</div>
					<div class="cl-kpi-sub">{kpi ? `${pct(kpi.adsTotal, kpi.total)}% din buget` : '—'}</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background:rgba(245,158,11,.08); color:#f59e0b"><UsersIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Cheltuieli fixe</div>
					<div class="cl-kpi-val">{kpi ? fmtLei(kpi.fixedTotal) : '—'}</div>
					<div class="cl-kpi-sub">{kpi ? `${fmtLei(kpi.fixedMonthly)}/lună · ${plural(kpi.activeFixedRows, 'rând', 'rânduri')}` : '—'}</div>
				</div>
			</div>
			<div class="cl-kpi">
				<div class="cl-kpi-ic" style="background:rgba(17,24,39,.07); color:var(--cl-text)"><MegaphoneIcon size={16} /></div>
				<div>
					<div class="cl-kpi-lbl">Cost / interviu plătit</div>
					<div class="cl-kpi-val">{fmtLeiFine(kpi?.cpiAds)}</div>
					<div class="cl-kpi-sub">{kpi ? `${kpi.nPaid} din surse plătite, doar ads` : '—'}</div>
				</div>
			</div>
		</div>
	</div>

	{#if kpi && data}
		<!-- rezumat -->
		<div class="ivk-pad {loading ? 'ivk-loading' : ''}" style="padding-top:18px" aria-busy={loading}>
			<div class="cl-section">
				<div class="ivk-hero-cost">
					<div>
						<div class="cl-kpi-lbl">Cost pe interviu · {periodLabel}</div>
						<div class="ivk-big" style="margin-top:6px">
							{kpi.cpi != null ? fmtInt(kpi.cpi) : '—'}<span>lei / interviu</span>
						</div>
					</div>
					{#if delta}
						<div style="padding-bottom:4px">
							<span class="ivk-delta {delta.pct > 0 ? 'up' : delta.pct < 0 ? 'down' : 'flat'}">
								<span aria-hidden="true">{delta.pct > 0 ? '▲' : delta.pct < 0 ? '▼' : '='}</span>
								<span class="sr-only">{delta.pct > 0 ? 'creștere' : delta.pct < 0 ? 'scădere' : 'neschimbat'}</span>
								{delta.pct > 0 ? '+' : ''}{delta.pct}%
							</span>
							<div class="cl-kpi-sub" style="margin-top:4px">față de {delta.label} ({fmtLeiFine(delta.prev)})</div>
						</div>
					{/if}
					<div class="ivk-note" style="margin-left:auto; max-width:560px">
						<InfoIcon size={14} />
						<div>
							<b>{fmtLei(kpi.adsTotal)}</b> buget ads (sincronizat din Meta, TikTok și Google)
							<b>+ {fmtLei(kpi.fixedTotal)}</b> cheltuieli fixe = <b>{fmtLei(kpi.total)}</b>, împărțit la
							<b>{kpi.n}</b> interviuri înregistrate în perioadă.
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- cheltuieli fixe: card full-width, pe rândul lui, imediat sub rezumat -->
		<div class="ivk-pad" style="padding-top:14px">
			<FixedCostsPanel
				rows={fixedRows}
				{canEdit}
				months={monthsCount}
				fixedTotal={kpi.fixedTotal}
				fixedMonthly={kpi.fixedMonthly}
				{mode}
				onOpenEditor={() => (fixedModalOpen = true)}
				onModeChange={(m) => (mode = m)}
			/>
		</div>

		<!-- compunerea bugetului -->
		<div class="ivk-pad" style="padding-top:14px">
			<SourcesPanel
				{platforms}
				adsTotal={kpi.adsTotal}
				fixedTotal={kpi.fixedTotal}
				months={monthsCount}
				{syncing}
				onSync={sync}
				canSync={!isClient}
				{lastSync}
			/>
		</div>

		<!-- cost pe canal — fix sub „Compunerea bugetului": comutatorul de alocare îi schimbă cifrele -->
		<div class="ivk-pad" style="padding-top:14px">
			<ChannelCostTable
				rows={kpi.channelRows}
				{channelMeta}
				{mode}
				unallocatedAds={kpi.unallocatedAds}
				unallocatedFixed={kpi.unallocatedFixed}
			/>
		</div>

		<!-- trend -->
		<div class="ivk-pad" style="padding-top:14px">
			<CostTrend rows={kpi.monthRows} {year} selMonth={month} onPick={pickMonth} {platforms} />
		</div>

		<!-- detaliu lunar -->
		<div class="ivk-pad" style="padding:14px 28px 60px">
			<MonthlyDetailTable rows={kpi.monthRows} {year} selMonth={month} onPick={pickMonth} {platforms} />
		</div>
	{:else if !loadError}
		<div class="ivk-pad" style="padding:18px 28px 60px" aria-live="polite">
			<div class="cl-section"><div class="cl-budget-empty">Se încarcă datele…</div></div>
		</div>
	{/if}

	{#if fixedModalOpen}
		<FixedCostsModal
			rows={fixedRows}
			{canEdit}
			onClose={() => (fixedModalOpen = false)}
			onChange={changeFixed}
			onDelete={deleteFixed}
			onAdd={addFixed}
			onReset={resetFixed}
		/>
	{/if}
</div>
