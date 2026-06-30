<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';

	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import ServerIcon from '@lucide/svelte/icons/server';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import SearchIcon from '@lucide/svelte/icons/search';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import MailIcon from '@lucide/svelte/icons/mail';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import XIcon from '@lucide/svelte/icons/x';

	import StatusBadge from '$lib/components/hosting/provisioning/StatusBadge.svelte';
	import SyncStatusBadge from '$lib/components/hosting/provisioning/SyncStatusBadge.svelte';
	import TriggerChip from '$lib/components/hosting/provisioning/TriggerChip.svelte';
	import KpiCard from '$lib/components/hosting/provisioning/KpiCard.svelte';
	import CriticalAlert from '$lib/components/hosting/provisioning/CriticalAlert.svelte';
	import ProvisioningDrawer from '$lib/components/hosting/provisioning/ProvisioningDrawer.svelte';
	import ReconcileModal from '$lib/components/hosting/provisioning/ReconcileModal.svelte';
	import ManualOrderModal from '$lib/components/hosting/ManualOrderModal.svelte';
	import { fmtDuration, fmtRelative } from '$lib/components/hosting/provisioning/format';
	import type {
		ProvisioningRow,
		CriticalItem,
		ServerOption,
		DaSyncStatus
	} from '$lib/components/hosting/provisioning/types';

	import {
		getProvisioningStats,
		getProvisioningHistory,
		getCriticalProvisionings,
		getDaServersForFilter,
		resetAccountPassword,
		resendWelcomeEmail,
		retryFailedProvisioning,
		suspendProvisionedAccount,
		unsuspendProvisionedAccount,
		checkOrphanForDelete,
		deleteOrphanHostingAccount,
		reconcileHostingWithDA
	} from '$lib/remotes/hosting-provisioning.remote';

	// Tenant slug pentru link-uri absolute (href-uri relative se rezolvă greșit:
	// ex. "hosting/accounts/new" pe /ots/hosting/provisioning → /ots/hosting/hosting/accounts/new → 404).
	const tenantSlug = $derived(page.params.tenant ?? '');

	// === Filtre ===
	const filters = $state({
		status: 'all' as 'all' | 'active' | 'pending' | 'failed' | 'suspended',
		serverId: 'all',
		interval: '30d' as '24h' | '7d' | '30d' | 'all',
		search: ''
	});

	// Args derivate: când filters se schimbă, historyArgs devine un nou obiect
	// și getProvisioningHistory(historyArgs) re-fetch-uiește automat.
	const historyArgs = $derived({
		status: filters.status === 'all' ? undefined : filters.status,
		serverId: filters.serverId === 'all' ? undefined : filters.serverId,
		interval: filters.interval,
		search: filters.search || undefined,
		limit: 100,
		offset: 0
	});

	// === Reads — declarative, no imperative load* ===
	// Boundary-urile per-secțiune controlează skeleton-ul pe primul load.
	// Refetch-urile (filtre / mutations cu .updates()) NU re-arată pending.
	const stats = $derived(await getProvisioningStats());
	const historyData = $derived(await getProvisioningHistory(historyArgs));
	const rows = $derived(historyData.rows as ProvisioningRow[]);
	const totalRows = $derived(historyData.total);
	const criticalItems = $derived((await getCriticalProvisionings()) as CriticalItem[]);
	const servers: ServerOption[] = $derived(await getDaServersForFilter());

	// === UI state ===
	let openRow = $state<ProvisioningRow | null>(null);
	let menuFor = $state<string | null>(null);

	// Modal "Comandă manuală" — deschis din butonul "Cont nou" (ca în design).
	// Refolosește componenta partajată cu pagina Comenzi (/hosting/inquiries).
	let showManualOrder = $state(false);

	// === Delete modal state ===
	// Modal cu auto-verify DA + typed-confirm "STERGE" pentru ștergerea
	// conturilor orfane (CRM listează, DA nu mai are). Vezi
	// checkOrphanForDelete + deleteOrphanHostingAccount în remote.
	const DELETE_CONFIRM_PHRASE = 'STERGE';
	let deleteTarget = $state<ProvisioningRow | null>(null);
	let deleteConfirmText = $state('');
	let deleteBusy = $state(false);
	type DeleteCheck =
		| { kind: 'idle' }
		| { kind: 'verifying' }
		| { kind: 'safe'; daUsername: string; daHostname: string; message: string }
		| { kind: 'unsafe'; reason: string; message: string };
	let deleteCheck = $state<DeleteCheck>({ kind: 'idle' });

	// === Counts pentru pill-uri ===
	const counts = $derived.by(() => {
		const c = { all: 0, active: 0, pending: 0, failed: 0, suspended: 0 };
		for (const r of rows) {
			c.all++;
			if (r.status in c) c[r.status as keyof typeof c]++;
		}
		return c;
	});

	// === Refresh manual (buton) — re-fetch toate query-urile active ===
	// NU verifică DA. Pentru asta există butonul „Verifică pe DA" separat
	// care declanșează reconcileHostingWithDA.
	let isRefreshing = $state(false);
	async function refreshAll() {
		if (isRefreshing) return;
		isRefreshing = true;
		const toastId = toast.loading('Reîncarc datele CRM...');
		try {
			await Promise.all([
				getProvisioningStats().refresh(),
				getProvisioningHistory(historyArgs).refresh(),
				getCriticalProvisionings().refresh(),
				getDaServersForFilter().refresh()
			]);
			toast.success('Date reîncărcate', { id: toastId });
		} catch (err) {
			toast.error('Refresh eșuat', {
				id: toastId,
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			isRefreshing = false;
		}
	}

	// === Reconcile (Verifică pe DA) — chemă reconcileHostingWithDA și deschide modal ===
	type ReconcileState =
		| { kind: 'idle' }
		| { kind: 'running' }
		| {
				kind: 'done';
				result: {
					checked: number;
					ok: number;
					orphans: number;
					suspendedOnDa: number;
					activeOnDa: number;
					packageMismatch: number;
					zombies: number;
					errors: number;
					discrepancies: Array<{
						id: string;
						daUsername: string;
						domain: string;
						crmStatus: string;
						daSyncStatus: string;
						daSyncIssue: string;
					}>;
					startedAt: string;
					finishedAt: string;
				};
		  }
		| { kind: 'error'; message: string };

	let reconcileState = $state<ReconcileState>({ kind: 'idle' });
	let reconcileOpen = $state(false);

	async function runReconcile() {
		if (reconcileState.kind === 'running') return;
		reconcileState = { kind: 'running' };
		reconcileOpen = true;
		const toastId = toast.loading('Reconciliere DA pornită...');
		try {
			// Reconcilierea actualizează daSyncStatus + lastSyncedAt → history se schimbă.
			const result = await reconcileHostingWithDA().updates(
				getProvisioningHistory(historyArgs)
			);
			reconcileState = { kind: 'done', result };
			const disc = result.discrepancies.length;
			if (disc === 0) {
				toast.success(`DA aliniat — ${result.checked} conturi verificate`, { id: toastId });
			} else {
				toast.warning(`${disc} discrepanțe găsite din ${result.checked} verificate`, {
					id: toastId
				});
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			reconcileState = { kind: 'error', message };
			toast.error('Reconciliere eșuată', { id: toastId, description: message });
		}
	}

	function closeReconcile() {
		reconcileOpen = false;
	}

	// === Click outside pentru menu ===
	$effect(() => {
		if (!menuFor) return;
		const handler = () => (menuFor = null);
		const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
		return () => {
			clearTimeout(t);
			document.removeEventListener('mousedown', handler);
		};
	});

	// === Acțiuni rapide din tabel ===
	// Toate folosesc single-flight .updates(...) ca server-ul să refresh-uie
	// query-urile relevante în aceeași rundă HTTP — nu mai apelăm load* manual.

	/**
	 * Detectează un 404-from-DA în mesajul de eroare și întoarce un hint
	 * acționabil pentru admin. Cazul de bază: CRM listează contul ca activ,
	 * dar DA-ul a fost șters manual din panou (per policy) — toate operațiile
	 * pică cu "DirectAdmin API error: 404 Not Found". Trimitem admin-ul direct
	 * la butonul "Șterge din CRM (orphan)" pentru reconciliere.
	 */
	function formatActionError(err: unknown): string {
		const msg = err instanceof Error ? err.message : String(err);
		if (/404|not found|user.*not.*exist/i.test(msg)) {
			return `${msg}\n\nContul nu mai există pe DA. Deschide menu-ul ··· → "Șterge din CRM (orphan)" — DA-check va confirma 404 și poți curăța rândul.`;
		}
		return msg;
	}

	async function rowResetPassword(row: ProvisioningRow) {
		if (
			!confirm(
				`Resetează parola pentru ${row.daUsername}?\nClientul va primi un email cu noua parolă.`
			)
		)
			return;
		const id = toast.loading('Se resetează...');
		try {
			// Parola nu afectează lista — fără .updates()
			await resetAccountPassword({ id: row.id });
			toast.success('Parolă resetată', { id, description: `${row.daUsername}` });
		} catch (err) {
			toast.error('Reset eșuat', {
				id,
				description: formatActionError(err)
			});
		}
	}

	async function rowResendWelcome(row: ProvisioningRow) {
		const id = toast.loading('Se retrimite...');
		try {
			// Email-ul nu afectează lista — fără .updates()
			await resendWelcomeEmail({ id: row.id });
			toast.success('Email welcome retrimis', { id, description: row.clientEmail ?? row.daUsername });
		} catch (err) {
			toast.error('Retrimitere eșuată', {
				id,
				description: formatActionError(err)
			});
		}
	}

	async function rowRetry(row: ProvisioningRow) {
		if (!confirm(`Retry provisioning pentru ${row.domain}?`)) return;
		const id = toast.loading('Se re-încearcă...');
		try {
			// Status passes pending→active → schimbă history + stats (success rate) + critical (failed→active)
			await retryFailedProvisioning({ id: row.id }).updates(
				getProvisioningHistory(historyArgs),
				getProvisioningStats(),
				getCriticalProvisionings()
			);
			toast.success('Retry reușit', { id, description: row.domain });
		} catch (err) {
			toast.error('Retry eșuat', {
				id,
				description: formatActionError(err)
			});
		}
	}

	async function rowSuspend(row: ProvisioningRow) {
		if (!confirm(`Suspendă ${row.domain}?`)) return;
		const id = toast.loading('Se suspendă...');
		try {
			// active → suspended: doar history (stats counts agregate nu se schimbă)
			await suspendProvisionedAccount({ id: row.id }).updates(getProvisioningHistory(historyArgs));
			toast.success('Cont suspendat', { id, description: row.domain });
		} catch (err) {
			toast.error('Suspendare eșuată', {
				id,
				description: formatActionError(err)
			});
		}
	}

	async function rowUnsuspend(row: ProvisioningRow) {
		const id = toast.loading('Se reactivează...');
		try {
			await unsuspendProvisionedAccount({ id: row.id }).updates(getProvisioningHistory(historyArgs));
			toast.success('Cont reactivat', { id, description: row.domain });
		} catch (err) {
			toast.error('Reactivare eșuată', {
				id,
				description: formatActionError(err)
			});
		}
	}

	function rowOpenDaPanel(row: ProvisioningRow) {
		// Folosim domeniul clientului (e.g., voelin.ch) ca host pentru URL — DNS-ul
		// lui pointează către serverul DA, deci link-ul e mai natural pentru client.
		// Fallback la hostname server doar dacă domeniul e placeholder
		// `*.hosting-temp.ots` sau lipsește.
		const isPlaceholder = /\.hosting-temp\.ots$/i.test(row.domain ?? '');
		const host = row.domain && !isPlaceholder ? row.domain : row.daServerHostname;
		if (!host) {
			toast.error('Nu pot construi URL-ul (domeniu și hostname server lipsă)');
			return;
		}
		window.open(`https://${host}:2222/CMD_USER_SHOW?user=${row.daUsername}`, '_blank');
	}

	function openInvoice(row: ProvisioningRow) {
		if (!row.invoiceId) return;
		// Tenant-scoped: /invoices/* nu există la top-level, doar sub /[tenant]/invoices.
		window.open(`/${tenantSlug}/invoices/${row.invoiceId}`, '_blank');
	}

	// === Delete orphan account handlers ===

	async function openDeleteModal(row: ProvisioningRow) {
		deleteTarget = row;
		deleteConfirmText = '';
		deleteCheck = { kind: 'verifying' };
		try {
			const res = await checkOrphanForDelete({ id: row.id });
			if (res.safe) {
				deleteCheck = {
					kind: 'safe',
					daUsername: res.daUsername ?? row.daUsername,
					daHostname: res.daHostname ?? row.daServerHostname ?? '',
					message: res.message
				};
			} else {
				deleteCheck = {
					kind: 'unsafe',
					reason: res.reason,
					message: res.message
				};
			}
		} catch (err) {
			deleteCheck = {
				kind: 'unsafe',
				reason: 'check-failed',
				message:
					'Verificarea DA a eșuat: ' + (err instanceof Error ? err.message : String(err))
			};
		}
	}

	function closeDeleteModal() {
		if (deleteBusy) return;
		deleteTarget = null;
		deleteConfirmText = '';
		deleteCheck = { kind: 'idle' };
	}

	async function submitDelete() {
		if (!deleteTarget) return;
		if (deleteCheck.kind !== 'safe') {
			toast.error('Verificarea DA nu confirmă că e safe pentru delete');
			return;
		}
		if (deleteConfirmText.trim().toUpperCase() !== DELETE_CONFIRM_PHRASE) {
			toast.error(`Tipează exact "${DELETE_CONFIRM_PHRASE}" pentru a confirma.`);
			return;
		}
		const target = deleteTarget;
		deleteBusy = true;
		const toastId = toast.loading('Se șterge contul orfan...');
		try {
			// Delete schimbă history + stats counts + critical alert
			await deleteOrphanHostingAccount({ id: target.id }).updates(
				getProvisioningHistory(historyArgs),
				getProvisioningStats(),
				getCriticalProvisionings()
			);
			toast.success('Cont orfan curățat din CRM', {
				id: toastId,
				description: `${target.daUsername} · ${target.domain}`
			});
			deleteTarget = null;
			deleteConfirmText = '';
			deleteCheck = { kind: 'idle' };
		} catch (err) {
			toast.error('Ștergere eșuată', {
				id: toastId,
				description: formatActionError(err)
			});
		} finally {
			deleteBusy = false;
		}
	}

	// Butonul de delete e vizibil pentru ORICE status. Server-ul (checkOrphanForDelete)
	// verifică DA-ul și refuză dacă contul există acolo — sursa unică de adevăr e
	// răspunsul DA-ului, nu statusul CRM. Asta acoperă cazul când DA a fost șters
	// manual din panou și CRM-ul încă arată "Activ" — toate operațiile DA pică
	// cu 404 și admin-ul are nevoie de o cale să reconcilieze.
	const canShowDeleteButton = (_status: string) => true;

	function exportCsv() {
		// Generează CSV client-side din rândurile filtrate
		const headers = [
			'Data',
			'Client',
			'Domeniu',
			'Username DA',
			'Server',
			'Pachet',
			'Status',
			'Trigger',
			'Durata',
			'Factura'
		];
		const csv = [
			headers.join(','),
			...rows.map((r) =>
				[
					r.createdAt,
					(r.clientName ?? '').replace(/,/g, ' '),
					r.domain,
					r.daUsername,
					r.daServerName ?? '',
					r.daPackageName ?? r.productName ?? '',
					r.status,
					r.trigger,
					fmtDuration(r.durationMs),
					r.invoiceNumber ?? ''
				].join(',')
			)
		].join('\n');

		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `provisioning-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
		toast.success(`Export CSV — ${rows.length} rânduri`);
	}

	// === Status labels pentru pill-uri ===
	const statusPills: Array<{ key: typeof filters.status; label: string }> = [
		{ key: 'all', label: 'Toate' },
		{ key: 'active', label: 'Activ' },
		{ key: 'pending', label: 'Pending' },
		{ key: 'failed', label: 'Eșuat' },
		{ key: 'suspended', label: 'Suspendat' }
	];

	// === Trend dirs ===
	const trendDir = (val: number) =>
		(val > 0.05 ? 'up' : val < -0.05 ? 'down' : 'flat') as 'up' | 'down' | 'flat';
</script>

<div
	class="min-h-screen bg-slate-50 pb-12 dark:bg-slate-950"
	data-screen-label="OTS Hosting Provisioning"
>
	<!-- Hero header (no awaited values — hero shell apare instant) -->
	<div
		class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900"
	>
		<div class="min-w-0">
			<h1 class="text-[20px] font-bold tracking-tight text-slate-900 dark:text-slate-50">
				Provisioning DirectAdmin
			</h1>
			<p class="mt-1 text-[12.5px] text-slate-600 dark:text-slate-400">
				Istoricul provisionărilor recente · credențiale, acțiuni rapide și verificare live pe DA
				<svelte:boundary>
					{#snippet pending()}{/snippet}
					{#snippet failed()}{/snippet}
					·
					<strong class="text-slate-800 dark:text-slate-200">{stats.successCount30d}</strong>
					reușite /
					<strong class="text-slate-800 dark:text-slate-200">{stats.failedCount30d}</strong>
					eșuate în ultimele 30 de zile
				</svelte:boundary>
			</p>
		</div>
		<div class="flex gap-2">
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
				onclick={refreshAll}
				disabled={isRefreshing}
				title="Reîncarcă datele din CRM (fără apel către DA)"
			>
				<RefreshCwIcon class="h-3 w-3 {isRefreshing ? 'animate-spin' : ''}" /> Refresh
			</button>
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-[12.5px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40"
				onclick={runReconcile}
				disabled={reconcileState.kind === 'running'}
				title="Verifică pe DA toate conturile active + suspendate și marchează discrepanțele"
			>
				<ShieldCheckIcon class="h-3 w-3 {reconcileState.kind === 'running' ? 'animate-spin' : ''}" />
				{reconcileState.kind === 'running' ? 'Verific DA...' : 'Verifică pe DA'}
			</button>
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
				onclick={exportCsv}
			>
				<DownloadIcon class="h-3 w-3" /> Export CSV
			</button>
			<button
				type="button"
				onclick={() => (showManualOrder = true)}
				class="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-blue-700"
			>
				<PlusIcon class="h-3 w-3" /> Cont nou
			</button>
		</div>
	</div>

	<!-- KPI bar boundary -->
	<div class="px-6 pt-5">
		<svelte:boundary>
			{#snippet pending()}
				<div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
					{#each Array(5) as _, i (i)}
						<div
							class="h-[110px] animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
						></div>
					{/each}
				</div>
			{/snippet}
			{#snippet failed(error, reset)}
				<div
					class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-[12.5px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300"
				>
					<strong>KPI-uri indisponibile:</strong>
					{error instanceof Error ? error.message : String(error)}
					<button
						class="ml-2 underline"
						type="button"
						onclick={reset}>Reîncearcă</button
					>
				</div>
			{/snippet}
			<div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
				<KpiCard
					icon={TrendingUpIcon}
					tone="success"
					label="Rata succes 30 zile"
					value="{stats.successRate30d.toFixed(1)}%"
					sub="{stats.successCount30d} reușite / {stats.failedCount30d} eșuate"
					trend="{stats.trend > 0 ? '+' : ''}{stats.trend.toFixed(1)}%"
					trendDir={trendDir(stats.trend)}
				/>
				<KpiCard
					icon={PlusIcon}
					tone="primary"
					label="Conturi noi 24h"
					value={stats.newAccounts24h}
					sub="vs {stats.newAccounts24hPrev} ieri"
					trend="{stats.newAccounts24h - stats.newAccounts24hPrev >= 0
						? '+'
						: ''}{stats.newAccounts24h - stats.newAccounts24hPrev}"
					trendDir={stats.newAccounts24h >= stats.newAccounts24hPrev ? 'up' : 'down'}
				/>
				<KpiCard
					icon={ClockIcon}
					tone={stats.pendingCount + stats.failedCount > 0 ? 'warn' : 'info'}
					label="În coadă / Eșuate"
					value="{stats.pendingCount} / {stats.failedCount}"
					sub="pending > 5min · failed"
					trend={stats.pendingCount + stats.failedCount > 2 ? 'necesită atenție' : 'OK'}
					trendDir={stats.pendingCount + stats.failedCount > 2 ? 'down' : 'up'}
				/>
				<KpiCard
					icon={ActivityIcon}
					tone="info"
					label="Durată medie create"
					value="{(stats.avgDurationMs / 1000).toFixed(1)}s"
					sub="vs {(stats.avgDurationMsPrev / 1000).toFixed(1)}s anterior"
					trend="{stats.avgDurationMs < stats.avgDurationMsPrev ? '-' : '+'}{stats.avgDurationMsPrev >
					0
						? Math.abs(
								((stats.avgDurationMs - stats.avgDurationMsPrev) / stats.avgDurationMsPrev) * 100
							).toFixed(0)
						: '0'}%"
					trendDir={stats.avgDurationMs < stats.avgDurationMsPrev ? 'up' : 'down'}
				/>
				<KpiCard
					icon={ServerIcon}
					tone={stats.serversOnline === stats.serversTotal ? 'success' : 'warn'}
					label="Servere online"
					value="{stats.serversOnline}/{stats.serversTotal}"
					sub="DA API responsive"
					trend={stats.serversOnline === stats.serversTotal
						? 'all green'
						: `${stats.serversTotal - stats.serversOnline} offline`}
					trendDir={stats.serversOnline === stats.serversTotal ? 'up' : 'down'}
				/>
			</div>
		</svelte:boundary>
	</div>

	<!-- Critical alert boundary -->
	<svelte:boundary>
		{#snippet pending()}{/snippet}
		{#snippet failed()}{/snippet}
		{#if criticalItems.length > 0}
			<div class="px-6 pt-4">
				<CriticalAlert
					items={criticalItems}
					onRetry={async (item) => {
						const r = rows.find((x) => x.id === item.id);
						if (r) await rowRetry(r);
						else {
							// Item nu e în rândurile filtrate curente — apel direct
							if (!confirm(`Retry provisioning pentru ${item.domain}?`)) return;
							const id = toast.loading('Se re-încearcă...');
							try {
								await retryFailedProvisioning({ id: item.id }).updates(
									getProvisioningHistory(historyArgs),
									getProvisioningStats(),
									getCriticalProvisionings()
								);
								toast.success('Retry reușit', { id, description: item.domain });
							} catch (err) {
								toast.error('Retry eșuat', {
									id,
									description: formatActionError(err)
								});
							}
						}
					}}
					onOpen={(item) => {
						const r = rows.find((x) => x.id === item.id);
						if (r) openRow = r;
					}}
				/>
			</div>
		{/if}
	</svelte:boundary>

	<!-- Filters bar -->
	<div class="flex flex-wrap items-center gap-2 px-6 pt-4">
		<!-- Status pills + counts: boundary separat ca să arate "—" pe primul load -->
		<svelte:boundary>
			{#snippet pending()}
				{#each statusPills as p (p.key)}
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] font-medium {filters.status ===
						p.key
							? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
							: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-slate-100'}"
						onclick={() => (filters.status = p.key)}
					>
						{p.label}
						<span
							class="rounded-full px-1.5 text-[10.5px] tabular-nums {filters.status === p.key
								? 'bg-blue-200/60 text-blue-700 dark:bg-blue-800/40 dark:text-blue-300'
								: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'}"
						>
							—
						</span>
					</button>
				{/each}
			{/snippet}
			{#each statusPills as p (p.key)}
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] font-medium {filters.status ===
					p.key
						? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
						: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-slate-100'}"
					onclick={() => (filters.status = p.key)}
				>
					{p.label}
					<span
						class="rounded-full px-1.5 text-[10.5px] tabular-nums {filters.status === p.key
							? 'bg-blue-200/60 text-blue-700 dark:bg-blue-800/40 dark:text-blue-300'
							: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'}"
					>
						{counts[p.key] ?? 0}
					</span>
				</button>
			{/each}
		</svelte:boundary>

		<span class="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700"></span>

		<!-- Server select — boundary mic cât timp se încarcă lista -->
		<svelte:boundary>
			{#snippet pending()}
				<select
					disabled
					class="rounded-md border border-slate-200 bg-white py-1.5 pl-3 pr-7 text-[12.5px] text-slate-400 dark:border-slate-700 dark:bg-slate-800"
				>
					<option>Se încarcă servere…</option>
				</select>
			{/snippet}
			<select
				bind:value={filters.serverId}
				class="rounded-md border border-slate-200 bg-white py-1.5 pl-3 pr-7 text-[12.5px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
			>
				<option value="all">Toate serverele</option>
				{#each servers as s (s.id)}
					<option value={s.id}>{s.name}</option>
				{/each}
			</select>
		</svelte:boundary>

		<select
			bind:value={filters.interval}
			class="rounded-md border border-slate-200 bg-white py-1.5 pl-3 pr-7 text-[12.5px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
		>
			<option value="24h">Ultimele 24h</option>
			<option value="7d">Ultimele 7 zile</option>
			<option value="30d">Ultimele 30 zile</option>
			<option value="all">Tot intervalul</option>
		</select>

		<div
			class="inline-flex max-w-xs flex-1 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-400 dark:border-slate-700 dark:bg-slate-800"
		>
			<SearchIcon class="h-3 w-3" />
			<input
				bind:value={filters.search}
				placeholder="Caută client, domeniu, username DA..."
				class="flex-1 bg-transparent text-[12.5px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
			/>
		</div>
	</div>

	<!-- Table boundary -->
	<div class="px-6 pt-3">
		<div
			class="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
		>
			<svelte:boundary>
				{#snippet pending()}
					<div class="flex flex-col gap-2 p-4">
						{#each Array(5) as _, i (i)}
							<div class="h-12 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800"></div>
						{/each}
					</div>
				{/snippet}
				{#snippet failed(error, reset)}
					<div
						class="p-6 text-[12.5px] text-rose-700 dark:text-rose-300"
					>
						<strong>Nu pot încărca istoricul:</strong>
						{error instanceof Error ? error.message : String(error)}
						<button class="ml-2 underline" type="button" onclick={reset}>Reîncearcă</button>
					</div>
				{/snippet}

				{#if rows.length === 0}
					<div class="flex flex-col items-center justify-center px-6 py-16 text-center">
						<div
							class="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
						>
							<ActivityIcon class="h-6 w-6" />
						</div>
						<h4 class="text-[14px] font-semibold text-slate-700 dark:text-slate-200">
							Niciun rezultat
						</h4>
						<p class="mt-1 max-w-md text-[12px] text-slate-500 dark:text-slate-400">
							Schimbă filtrele sau resetează căutarea pentru a vedea istoricul complet de
							provisioning.
						</p>
					</div>
				{:else}
					<table class="w-full table-fixed text-[12.5px]">
						<thead>
							<tr class="bg-slate-50 dark:bg-slate-800/50">
								<th
									class="px-3.5 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
									style="width:100px">Data</th
								>
								<th
									class="px-3.5 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
									style="width:260px">Client · Domeniu</th
								>
								<th
									class="px-3.5 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
									style="width:140px">Username DA</th
								>
								<th
									class="px-3.5 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
									style="width:110px">Server</th
								>
								<th
									class="px-3.5 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
									style="width:150px">Pachet</th
								>
								<th
									class="px-3.5 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
									style="width:110px">Status</th
								>
								<th
									class="px-3.5 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
									style="width:100px">Trigger</th
								>
								<th
									class="px-3.5 py-2.5 text-right text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
									style="width:75px">Durată</th
								>
								<th
									class="px-3.5 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
									style="width:110px">Factură</th
								>
								<th style="width:48px"></th>
							</tr>
						</thead>
						<tbody>
							{#each rows as r (r.id)}
								{@const rel = fmtRelative(r.createdAt)}
								<tr
									class="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
									onclick={() => (openRow = r)}
								>
									<td class="px-3.5 py-3 align-middle">
										<div class="font-medium text-slate-900 dark:text-slate-100">{rel.main}</div>
										<div class="text-[10.5px] text-slate-500">{rel.sub}</div>
									</td>
									<td class="px-3.5 py-3 align-middle">
										<div
											class="truncate font-medium text-slate-900 dark:text-slate-100"
											title={r.clientName ?? ''}
										>
											{r.clientName ?? '—'}
										</div>
										<div class="truncate font-mono text-[11px] text-slate-500" title={r.domain}>
											{r.domain}
										</div>
									</td>
									<td class="px-3.5 py-3 align-middle">
										<span
											class="block truncate font-mono text-slate-700 dark:text-slate-300"
											title={r.daUsername}>{r.daUsername}</span
										>
									</td>
									<td class="px-3.5 py-3 align-middle">
										<span
											class="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
											title={r.daServerName ?? ''}
										>
											{r.daServerName ?? '—'}
										</span>
									</td>
									<td class="px-3.5 py-3 align-middle">
										<span
											class="inline-flex max-w-full items-center gap-1.5 text-[12px] text-slate-700 dark:text-slate-200"
											title={r.daPackageName ?? r.productName ?? 'Default'}
										>
											<span
												class="h-2 w-2 flex-shrink-0 rounded-sm"
												style="background-color: {r.productColor ?? '#64748b'}"
											></span>
											<span class="truncate">{r.daPackageName ?? r.productName ?? 'Default'}</span>
										</span>
									</td>
									<td class="px-3.5 py-3 align-middle">
										<div class="flex flex-col items-start gap-1">
											<StatusBadge status={r.status} />
											{#if r.daSyncStatus}
												<SyncStatusBadge
													status={r.daSyncStatus as DaSyncStatus}
													issue={r.daSyncIssue}
												/>
											{/if}
										</div>
									</td>
									<td class="px-3.5 py-3 align-middle">
										<TriggerChip trigger={r.trigger} />
									</td>
									<td
										class="px-3.5 py-3 text-right align-middle tabular-nums"
										style="color: {r.durationMs != null && r.durationMs > 8000
											? '#b45309'
											: '#475569'}"
									>
										{fmtDuration(r.durationMs)}
									</td>
									<td class="px-3.5 py-3 align-middle" onclick={(e) => e.stopPropagation()}>
										{#if r.invoiceId}
											<button
												type="button"
												class="inline-flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
												onclick={() => openInvoice(r)}
											>
												{r.invoiceNumber ?? r.invoiceId.slice(0, 8)}
												<ExternalLinkIcon class="h-2.5 w-2.5" />
											</button>
										{:else}
											<span class="text-slate-400">—</span>
										{/if}
									</td>
									<td class="px-2 py-3 align-middle" onclick={(e) => e.stopPropagation()}>
										<div class="relative">
											<button
												type="button"
												class="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
												onclick={(e) => {
													e.stopPropagation();
													menuFor = menuFor === r.id ? null : r.id;
												}}
												aria-label="Acțiuni"
											>
												<MoreHorizontalIcon class="h-3.5 w-3.5" />
											</button>
											{#if menuFor === r.id}
												<div
													class="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
													role="menu"
													tabindex="-1"
													onmousedown={(e) => e.stopPropagation()}
												>
													<button
														type="button"
														class="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
														onclick={() => {
															openRow = r;
															menuFor = null;
														}}
													>
														<EyeIcon class="h-3 w-3" /> Vezi detalii
													</button>
													{#if r.status !== 'failed' && r.status !== 'pending'}
														<button
															type="button"
															class="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
															onclick={() => {
																openRow = r;
																menuFor = null;
															}}
														>
															<KeyIcon class="h-3 w-3" /> Afișează parola
														</button>
														<button
															type="button"
															class="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
															onclick={() => {
																rowResetPassword(r);
																menuFor = null;
															}}
														>
															<RefreshCwIcon class="h-3 w-3" /> Resetează parola
														</button>
													{/if}
													{#if r.status === 'active'}
														<button
															type="button"
															class="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
															onclick={() => {
																rowResendWelcome(r);
																menuFor = null;
															}}
														>
															<MailIcon class="h-3 w-3" /> Re-trimite email
														</button>
														<button
															type="button"
															class="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
															onclick={() => {
																toast.info('Autologin DA — funcție în pregătire');
																menuFor = null;
															}}
														>
															<LogInIcon class="h-3 w-3" /> Autologin DA
														</button>
													{/if}
													{#if r.status === 'failed' || r.status === 'pending'}
														<button
															type="button"
															class="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
															onclick={() => {
																rowRetry(r);
																menuFor = null;
															}}
														>
															<RefreshCwIcon class="h-3 w-3" /> Retry provisioning
														</button>
													{/if}
													{#if r.status === 'active'}
														<button
															type="button"
															class="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
															onclick={() => {
																rowSuspend(r);
																menuFor = null;
															}}
														>
															<PauseIcon class="h-3 w-3" /> Suspendă
														</button>
													{:else if r.status === 'suspended'}
														<button
															type="button"
															class="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
															onclick={() => {
																rowUnsuspend(r);
																menuFor = null;
															}}
														>
															<PlayIcon class="h-3 w-3" /> Reactivează
														</button>
													{/if}
													<div class="border-t border-slate-100 dark:border-slate-700"></div>
													<button
														type="button"
														class="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
														onclick={() => {
															rowOpenDaPanel(r);
															menuFor = null;
														}}
													>
														<ExternalLinkIcon class="h-3 w-3" /> Vezi în panou DA
													</button>
													{#if canShowDeleteButton(r.status)}
														<div class="border-t border-slate-100 dark:border-slate-700"></div>
														<button
															type="button"
															class="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
															onclick={() => {
																openDeleteModal(r);
																menuFor = null;
															}}
														>
															<Trash2Icon class="h-3 w-3" /> Șterge din CRM (orphan)
														</button>
													{/if}
												</div>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if totalRows > rows.length}
						<div
							class="border-t border-slate-100 px-4 py-2.5 text-center text-[11.5px] text-slate-500 dark:border-slate-800 dark:text-slate-400"
						>
							Afișez primele {rows.length} din {totalRows} rezultate
						</div>
					{/if}
				{/if}
			</svelte:boundary>
		</div>
	</div>
</div>

{#if openRow}
	<ProvisioningDrawer
		row={openRow}
		onClose={() => (openRow = null)}
		onUpdated={() => {
			// Drawer-ul a modificat ceva (suspend/unsuspend/reset password etc.) —
			// refresh single-flight nu se aplică aici fiindcă ProvisioningDrawer
			// face propriile mutații. Re-fetch toate query-urile relevante.
			getProvisioningHistory(historyArgs).refresh();
			getProvisioningStats().refresh();
			getCriticalProvisionings().refresh();
		}}
	/>
{/if}

<!-- ===========================================================================
   MODAL COMANDĂ MANUALĂ — deschis din "Cont nou"; componentă partajată cu /inquiries
   =========================================================================== -->
{#if showManualOrder}
	<ManualOrderModal
		onClose={() => (showManualOrder = false)}
		onCreated={() => {
			// Comanda nouă (dacă e achitată) declanșează provisioning → apare un cont nou.
			// Reîmprospătăm istoricul + KPI-urile + alertele critice.
			getProvisioningHistory(historyArgs).refresh();
			getProvisioningStats().refresh();
			getCriticalProvisionings().refresh();
		}}
	/>
{/if}

<!-- ===========================================================================
   RECONCILE MODAL — sumar discrepanțe DA vs CRM după Verifică pe DA
   =========================================================================== -->
{#if reconcileOpen}
	<ReconcileModal view={reconcileState} onClose={closeReconcile} />
{/if}

<!-- ===========================================================================
   DELETE MODAL — auto-verify DA + typed-confirm pentru cleanup orphan
   =========================================================================== -->
{#if deleteTarget}
	{@const target = deleteTarget}
	{@const isSafe = deleteCheck.kind === 'safe'}
	{@const isValid = isSafe && deleteConfirmText.trim().toUpperCase() === DELETE_CONFIRM_PHRASE}
	<div
		class="fixed inset-0 z-[90] bg-slate-900/60 backdrop-blur-sm"
		role="button"
		tabindex="-1"
		aria-label="Închide modal"
		onclick={closeDeleteModal}
		onkeydown={(e) => e.key === 'Escape' && closeDeleteModal()}
	></div>
	<div
		class="fixed left-1/2 top-1/2 z-[100] flex w-full max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-auto rounded-xl bg-white shadow-2xl dark:bg-slate-900"
		style="max-height:90vh"
		role="dialog"
		aria-modal="true"
		aria-labelledby="prv-del-title"
	>
		<!-- Header -->
		<div class="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
			<div
				class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400"
			>
				<Trash2Icon class="h-4 w-4" />
			</div>
			<div class="min-w-0 flex-1">
				<strong
					id="prv-del-title"
					class="block text-[15px] font-bold text-slate-900 dark:text-slate-100"
				>
					Șterge cont orfan din CRM?
				</strong>
				<span class="text-[12px] text-slate-500 dark:text-slate-400">
					Doar rândul CRM se șterge — DA nu e atins. Permis DOAR dacă DA confirmă 404.
				</span>
			</div>
			<button
				type="button"
				class="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-700"
				onclick={closeDeleteModal}
				disabled={deleteBusy}
				aria-label="Închide"
			>
				<XIcon class="h-3.5 w-3.5" />
			</button>
		</div>

		<!-- Body -->
		<div class="px-5 py-4">
			<!-- Sumar cont -->
			<div
				class="mb-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-[12px] dark:border-slate-700 dark:bg-slate-800/40"
			>
				<div
					class="flex justify-between gap-3 border-b border-slate-200 py-1 dark:border-slate-700"
				>
					<span class="text-slate-500">Username</span>
					<strong class="font-mono text-slate-900 dark:text-slate-100">{target.daUsername}</strong>
				</div>
				<div
					class="flex justify-between gap-3 border-b border-slate-200 py-1 dark:border-slate-700"
				>
					<span class="text-slate-500">Domeniu</span>
					<strong class="font-mono text-slate-900 dark:text-slate-100">{target.domain}</strong>
				</div>
				<div
					class="flex justify-between gap-3 border-b border-slate-200 py-1 dark:border-slate-700"
				>
					<span class="text-slate-500">Server</span>
					<strong class="text-slate-900 dark:text-slate-100">{target.daServerName ?? '—'}</strong>
				</div>
				<div
					class="flex justify-between gap-3 border-b border-slate-200 py-1 dark:border-slate-700"
				>
					<span class="text-slate-500">Client</span>
					<strong class="text-slate-900 dark:text-slate-100">{target.clientName ?? '—'}</strong>
				</div>
				<div class="flex justify-between gap-3 py-1">
					<span class="text-slate-500">Status CRM</span>
					<StatusBadge status={target.status} />
				</div>
			</div>

			<!-- Verify result -->
			{#if deleteCheck.kind === 'verifying'}
				<div
					class="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-[12.5px] text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300"
				>
					<RefreshCwIcon class="h-3.5 w-3.5 animate-spin" />
					<span>Verific dacă contul există pe DA...</span>
				</div>
			{:else if deleteCheck.kind === 'safe'}
				<div
					class="mb-4 flex gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/30"
				>
					<ShieldCheckIcon
						class="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400"
					/>
					<div class="min-w-0">
						<strong class="block text-[12.5px] font-semibold text-emerald-900 dark:text-emerald-200">
							Safe — cont orphan confirmat
						</strong>
						<div class="mt-0.5 text-[11.5px] text-emerald-700 dark:text-emerald-300">
							{deleteCheck.message}
						</div>
					</div>
				</div>
			{:else if deleteCheck.kind === 'unsafe'}
				<div
					class="mb-4 flex gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/40 dark:bg-rose-950/30"
				>
					<ShieldAlertIcon class="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-600 dark:text-rose-400" />
					<div class="min-w-0">
						<strong class="block text-[12.5px] font-semibold text-rose-900 dark:text-rose-200">
							Blocat — nu pot șterge
						</strong>
						<div class="mt-0.5 text-[11.5px] text-rose-700 dark:text-rose-400">
							{deleteCheck.message}
						</div>
					</div>
				</div>
			{/if}

			<!-- Typed confirm input — apare DOAR dacă verify a returnat safe -->
			{#if isSafe}
				<label class="block text-[12.5px] text-slate-600 dark:text-slate-300" for="prv-del-input">
					Pentru a confirma, tipează exact
					<strong class="font-mono text-rose-600 dark:text-rose-400">{DELETE_CONFIRM_PHRASE}</strong
					>:
				</label>
				<input
					id="prv-del-input"
					type="text"
					class="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-[14px] font-semibold uppercase tracking-wider text-slate-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-rose-900/30"
					class:border-emerald-500={isValid}
					class:ring-2={isValid}
					class:ring-emerald-100={isValid}
					bind:value={deleteConfirmText}
					placeholder={DELETE_CONFIRM_PHRASE}
					autocomplete="off"
					spellcheck="false"
					disabled={deleteBusy}
					onkeydown={(e) => {
						if (e.key === 'Enter' && isValid && !deleteBusy) submitDelete();
					}}
				/>
				{#if deleteConfirmText && !isValid}
					<div class="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
						Trebuie să fie exact <strong>{DELETE_CONFIRM_PHRASE}</strong> (case-insensitive).
					</div>
				{/if}
			{/if}
		</div>

		<!-- Footer -->
		<div
			class="flex items-center gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/40"
		>
			<button
				type="button"
				class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
				onclick={closeDeleteModal}
				disabled={deleteBusy}
			>
				Anulează
			</button>
			<div class="flex-1"></div>
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300 dark:disabled:bg-rose-900/40"
				onclick={submitDelete}
				disabled={!isValid || deleteBusy}
			>
				<Trash2Icon class="h-3 w-3" />
				{deleteBusy ? 'Se șterge...' : 'Șterge din CRM'}
			</button>
		</div>
	</div>
{/if}
