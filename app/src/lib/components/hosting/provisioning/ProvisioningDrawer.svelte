<script lang="ts">
	import { onMount } from 'svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import ServerIcon from '@lucide/svelte/icons/server';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import MailIcon from '@lucide/svelte/icons/mail';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import LockIcon from '@lucide/svelte/icons/lock';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import UsersIcon from '@lucide/svelte/icons/users';
	import DatabaseIcon from '@lucide/svelte/icons/database';

	import { toast } from 'svelte-sonner';
	import StatusBadge from './StatusBadge.svelte';
	import TriggerChip from './TriggerChip.svelte';
	import type { ProvisioningRow, AuditLogRow } from './types';
	import { ACTION_LABELS } from './types';
	import { fmtDuration, fmtRelativeFull } from './format';
	import {
		getAccountCredentials,
		resetAccountPassword,
		resendWelcomeEmail,
		retryFailedProvisioning,
		suspendProvisionedAccount,
		unsuspendProvisionedAccount,
		getAccountAuditLog,
		verifyAccountOnDA
	} from '$lib/remotes/hosting-provisioning.remote';

	type Tab = 'credentials' | 'audit' | 'da';

	let {
		row,
		onClose,
		onUpdated
	}: {
		row: ProvisioningRow;
		onClose: () => void;
		onUpdated: () => void;
	} = $props();

	let tab = $state<Tab>('credentials');
	let showPw = $state(false);
	let pwTimer = $state(30);
	let credentials = $state<{ username: string; password: string } | null>(null);
	let credLoading = $state(false);
	let auditRows = $state<AuditLogRow[]>([]);
	let auditLoading = $state(false);
	let daVerification = $state<{
		loading: boolean;
		data: Awaited<ReturnType<typeof verifyAccountOnDA>> | null;
	}>({ loading: false, data: null });

	// === Reset state când row se schimbă ===
	$effect(() => {
		// citește id-ul ca dependență
		row.id;
		tab = 'credentials';
		showPw = false;
		pwTimer = 30;
		credentials = null;
		auditRows = [];
		daVerification = { loading: false, data: null };
	});

	// === Auto-hide parolă după 30s ===
	$effect(() => {
		if (!showPw) return;
		pwTimer = 30;
		const interval = setInterval(() => {
			pwTimer -= 1;
			if (pwTimer <= 0) {
				showPw = false;
				// clipboard clear din safety
				navigator.clipboard?.writeText('').catch(() => {});
				pwTimer = 30;
				clearInterval(interval);
			}
		}, 1000);
		return () => clearInterval(interval);
	});

	// === Lazy load audit la deschiderea tab-ului ===
	$effect(() => {
		if (tab !== 'audit') return;
		if (auditRows.length > 0 || auditLoading) return;
		auditLoading = true;
		getAccountAuditLog({ id: row.id })
			.then((rows) => {
				auditRows = rows;
			})
			.catch((err) => {
				toast.error('Audit log eșuat: ' + (err instanceof Error ? err.message : String(err)));
			})
			.finally(() => {
				auditLoading = false;
			});
	});

	// === Lazy load DA verification ===
	$effect(() => {
		if (tab !== 'da') return;
		if (daVerification.data || daVerification.loading) return;
		daVerification = { loading: true, data: null };
		verifyAccountOnDA({ id: row.id })
			.then((data) => {
				daVerification = { loading: false, data };
			})
			.catch((err) => {
				daVerification = { loading: false, data: null };
				toast.error('Verificare DA eșuată: ' + (err instanceof Error ? err.message : String(err)));
			});
	});

	// === Esc key să închidă drawer-ul ===
	onMount(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	});

	async function toggleShowPassword() {
		if (showPw) {
			showPw = false;
			return;
		}
		if (credentials) {
			showPw = true;
			return;
		}
		credLoading = true;
		try {
			const creds = await getAccountCredentials({ id: row.id });
			credentials = { username: creds.username, password: creds.password };
			showPw = true;
			toast.success('Audit · vizualizare credențiale', {
				description: `${row.daUsername} · acțiunea a fost logată`
			});
		} catch (err) {
			toast.error('Credențiale indisponibile', {
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			credLoading = false;
		}
	}

	async function copy(value: string, label: string) {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(`${label} copiat`);
		} catch {
			toast.error('Clipboard indisponibil');
		}
	}

	async function doResetPassword() {
		if (!confirm(`Resetează parola pentru ${row.daUsername}?\nVechea parolă se invalidează imediat. Clientul va primi un email cu noua parolă.`)) return;
		const toastId = toast.loading('Se resetează parola...');
		try {
			await resetAccountPassword({ id: row.id });
			toast.success('Parolă resetată', {
				id: toastId,
				description: `${row.daUsername} · email trimis pe ${row.clientEmail ?? 'clientul'}`
			});
			// reload credentials
			credentials = null;
			showPw = false;
			onUpdated();
		} catch (err) {
			toast.error('Reset eșuat', {
				id: toastId,
				description: err instanceof Error ? err.message : String(err)
			});
		}
	}

	async function doResendWelcome() {
		const toastId = toast.loading('Se retrimite welcome...');
		try {
			await resendWelcomeEmail({ id: row.id });
			toast.success('Email welcome retrimis', {
				id: toastId,
				description: `${row.clientEmail ?? row.daUsername}`
			});
			onUpdated();
		} catch (err) {
			toast.error('Retrimitere eșuată', {
				id: toastId,
				description: err instanceof Error ? err.message : String(err)
			});
		}
	}

	async function doLoginAs() {
		toast.info('Autologin DA', {
			description: `Funcție în pregătire — folosește butonul "Deschide" pentru panoul DA`
		});
		// TODO: integrare DA /api/sessions/login-as când e disponibil
	}

	async function doSuspend() {
		if (!confirm(`Suspendă ${row.domain}?`)) return;
		const toastId = toast.loading('Se suspendă...');
		try {
			await suspendProvisionedAccount({ id: row.id });
			toast.success('Cont suspendat', { id: toastId, description: row.domain });
			onUpdated();
			onClose();
		} catch (err) {
			toast.error('Suspendare eșuată', {
				id: toastId,
				description: err instanceof Error ? err.message : String(err)
			});
		}
	}

	async function doUnsuspend() {
		const toastId = toast.loading('Se reactivează...');
		try {
			await unsuspendProvisionedAccount({ id: row.id });
			toast.success('Cont reactivat', { id: toastId, description: row.domain });
			onUpdated();
		} catch (err) {
			toast.error('Reactivare eșuată', {
				id: toastId,
				description: err instanceof Error ? err.message : String(err)
			});
		}
	}

	async function doRetry() {
		if (!confirm(`Retry provisioning pentru ${row.domain}?`)) return;
		const toastId = toast.loading('Se re-încearcă...');
		try {
			await retryFailedProvisioning({ id: row.id });
			toast.success('Retry reușit', { id: toastId, description: `${row.domain} · cont creat` });
			onUpdated();
			onClose();
		} catch (err) {
			toast.error('Retry eșuat', {
				id: toastId,
				description: err instanceof Error ? err.message : String(err)
			});
		}
	}

	// URL panou DA — prioritar pe domeniul clientului (DNS-ul lui trebuie să
	// indice către serverul DA, dar uzual e deja configurat după provisioning).
	// Fallback pe hostname server doar dacă domeniul e placeholder
	// `*.hosting-temp.ots` (creat înainte de fix-ul provision-da.ts) sau gol.
	const isPlaceholderDomain = $derived(/\.hosting-temp\.ots$/i.test(row.domain ?? ''));

	const daPanelUrl = $derived.by(() => {
		if (row.domain && !isPlaceholderDomain) return `https://${row.domain}:2222`;
		if (row.daServerHostname) return `https://${row.daServerHostname}:2222`;
		return null;
	});

	const daPanelUrlSource = $derived(
		row.domain && !isPlaceholderDomain ? 'domain' : 'server-host'
	);

	// API endpoint = serverul real DA (nu domeniul clientului). Folosit doar
	// în tab "Cont DA" pentru afișarea sursei tehnice a verificării live.
	const daApiEndpoint = $derived(
		row.daServerHostname ? `https://${row.daServerHostname}:2222` : null
	);

	function openDaPanel() {
		if (!daPanelUrl) {
			toast.error('Nu pot construi URL-ul panoului (domeniu și hostname server lipsă)');
			return;
		}
		window.open(daPanelUrl, '_blank');
	}

	const packageColor = $derived(row.productColor ?? '#1877F2');
</script>

<!-- Backdrop -->
<div
	class="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm dark:bg-slate-950/60"
	role="button"
	tabindex="-1"
	aria-label="Close drawer"
	onclick={onClose}
	onkeydown={(e) => e.key === 'Enter' && onClose()}
></div>

<!-- Drawer -->
<div
	class="fixed right-0 top-0 z-50 flex h-full w-full max-w-[640px] flex-col border-l border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950"
>
	<!-- Header -->
	<div class="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
		<div
			class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white"
			style="background-color: {packageColor}"
		>
			<ActivityIcon class="h-4 w-4" />
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex items-baseline gap-2">
				<span class="truncate font-mono text-[14px] font-bold text-slate-900 dark:text-slate-100"
					>{row.daUsername}</span
				>
				<span class="text-slate-400">·</span>
				<span class="truncate text-[14px] text-slate-700 dark:text-slate-200">{row.domain}</span>
			</div>
			<div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500 dark:text-slate-400">
				<StatusBadge status={row.status} />
				<span>·</span>
				<span>{row.daServerName ?? '—'}</span>
				<span>·</span>
				<span>{row.daPackageName ?? row.productName ?? '—'}</span>
				<span>·</span>
				<span class="text-slate-400">{fmtRelativeFull(row.createdAt)}</span>
			</div>
		</div>
		<button
			type="button"
			class="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
			onclick={onClose}
			aria-label="Închide"
		>
			<XIcon class="h-3.5 w-3.5" />
		</button>
	</div>

	<!-- Tabs -->
	<div class="flex gap-1 border-b border-slate-200 px-3 dark:border-slate-800">
		<button
			type="button"
			class="flex items-center gap-1.5 px-3 py-2.5 text-[12.5px] font-medium {tab === 'credentials'
				? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
				: 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}"
			onclick={() => (tab = 'credentials')}
		>
			<KeyIcon class="h-3 w-3" /> Credențiale
		</button>
		<button
			type="button"
			class="flex items-center gap-1.5 px-3 py-2.5 text-[12.5px] font-medium {tab === 'audit'
				? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
				: 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}"
			onclick={() => (tab = 'audit')}
		>
			<ClockIcon class="h-3 w-3" /> Audit log
			{#if auditRows.length > 0}
				<span
					class="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
					>{auditRows.length}</span
				>
			{/if}
		</button>
		<button
			type="button"
			class="flex items-center gap-1.5 px-3 py-2.5 text-[12.5px] font-medium {tab === 'da'
				? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
				: 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}"
			onclick={() => (tab = 'da')}
		>
			<ServerIcon class="h-3 w-3" /> Cont DA
		</button>
	</div>

	<!-- Body -->
	<div class="flex-1 overflow-y-auto p-5">
		{#if tab === 'credentials'}
			{#if row.status === 'failed'}
				<div
					class="mb-4 flex gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/40 dark:bg-rose-950/30"
				>
					<AlertTriangleIcon class="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" />
					<div class="min-w-0">
						<strong class="block text-[13px] text-rose-900 dark:text-rose-200"
							>Contul nu a fost creat</strong
						>
						<div class="mt-0.5 text-[12px] text-rose-700 dark:text-rose-400">
							{row.errorMessage ?? 'Eroare necunoscută'}
						</div>
					</div>
				</div>
			{:else if row.status === 'pending'}
				<div
					class="mb-4 flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/30"
				>
					<ClockIcon class="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
					<div class="min-w-0">
						<strong class="block text-[13px] text-amber-900 dark:text-amber-200"
							>Provisioning în curs</strong
						>
						<div class="mt-0.5 text-[12px] text-amber-700 dark:text-amber-400">
							Pending de {row.pendingSinceMin ?? 0} min · {row.actor}
						</div>
					</div>
				</div>
			{:else if !row.hasCredentials}
				<div
					class="mb-4 flex gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40"
				>
					<LockIcon class="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" />
					<div class="min-w-0">
						<strong class="block text-[13px] text-slate-800 dark:text-slate-100"
							>Credențiale nestocate</strong
						>
						<div class="mt-0.5 text-[12px] text-slate-600 dark:text-slate-300">
							Contul a fost creat înainte de stocarea credențialelor în CRM. Parola originală nu
							mai poate fi afișată — folosește <strong>Resetează parola</strong> pentru a genera una
							nouă (clientul va primi email).
						</div>
					</div>
				</div>
			{/if}

			<div
				class="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40"
			>
				<!-- Username -->
				<div
					class="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800"
				>
					<span class="w-24 flex-shrink-0 text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
						Username
					</span>
					<div class="flex flex-1 items-center gap-2">
						<span class="flex-1 font-mono text-[13px] text-slate-900 dark:text-slate-100"
							>{row.daUsername}</span
						>
						<button
							type="button"
							class="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11.5px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
							onclick={() => copy(row.daUsername, 'Username')}
							title="Copiază"
							aria-label="Copiază username"
						>
							<CopyIcon class="h-3 w-3" />
						</button>
					</div>
				</div>

				<!-- Parolă -->
				<div
					class="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800"
				>
					<span class="w-24 flex-shrink-0 text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
						Parolă
						{#if showPw}
							<span class="mt-0.5 block normal-case text-[10px] font-normal text-amber-600 dark:text-amber-400">
								Auto-hide în {pwTimer}s
							</span>
						{/if}
					</span>
					<div class="flex flex-1 items-center gap-2">
						<span class="flex-1 font-mono text-[13px] text-slate-900 dark:text-slate-100">
							{#if showPw && credentials}
								{credentials.password}
							{:else}
								•••••••••••••••••
							{/if}
						</span>
						<button
							type="button"
							class="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11.5px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
							onclick={toggleShowPassword}
							disabled={credLoading ||
								row.status === 'failed' ||
								row.status === 'pending' ||
								!row.hasCredentials}
							title={!row.hasCredentials
								? 'Credențiale nestocate — folosește Resetează parola'
								: undefined}
						>
							{#if credLoading}
								<RefreshCwIcon class="h-3 w-3 animate-spin" />
							{:else if showPw}
								<EyeOffIcon class="h-3 w-3" /> Ascunde
							{:else}
								<EyeIcon class="h-3 w-3" /> Afișează
							{/if}
						</button>
						{#if showPw && credentials}
							<button
								type="button"
								class="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11.5px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
								onclick={() => credentials && copy(credentials.password, 'Parola')}
								title="Copiază"
								aria-label="Copiază parola"
							>
								<CopyIcon class="h-3 w-3" />
							</button>
						{/if}
					</div>
				</div>

				<!-- URL panou DA -->
				<div class="flex items-center gap-3 px-4 py-3">
					<span class="w-24 flex-shrink-0 text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
						URL panou
						{#if daPanelUrlSource === 'server-host'}
							<span
								class="mt-0.5 block normal-case text-[10px] font-normal text-amber-600 dark:text-amber-400"
								title="Domeniul clientului lipsește sau e placeholder — folosim hostname-ul serverului"
								>fallback server</span
							>
						{/if}
					</span>
					<div class="flex flex-1 items-center gap-2">
						<span class="flex-1 truncate font-mono text-[11.5px] text-slate-700 dark:text-slate-300">
							{daPanelUrl ?? '—'}
						</span>
						{#if daPanelUrl}
							<button
								type="button"
								class="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11.5px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
								onclick={openDaPanel}
							>
								<ExternalLinkIcon class="h-3 w-3" /> Deschide
							</button>
						{/if}
					</div>
				</div>
			</div>

			<!-- Acțiuni -->
			<div class="mt-4 flex flex-wrap gap-2">
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
					disabled={row.status === 'failed' || row.status === 'pending'}
					onclick={doResetPassword}
				>
					<RefreshCwIcon class="h-3 w-3" /> Resetează parola
				</button>
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
					disabled={row.status !== 'active'}
					onclick={doResendWelcome}
				>
					<MailIcon class="h-3 w-3" /> Re-trimite email welcome
				</button>
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					disabled={row.status !== 'active'}
					onclick={doLoginAs}
				>
					<LogInIcon class="h-3 w-3" /> Autologin DA
				</button>
			</div>

			<!-- Securitate warning -->
			<div
				class="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/30"
			>
				<LockIcon class="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
				<div class="text-[11.5px] text-amber-900 dark:text-amber-200">
					<strong>Securitate.</strong> Parola se ascunde automat după 30s și se șterge din clipboard. Vizualizarea
					este logată în audit log cu user-ul tău și timestamp.
				</div>
			</div>
		{:else if tab === 'audit'}
			{#if auditLoading}
				<div class="flex items-center justify-center gap-2 py-8 text-[12.5px] text-slate-500">
					<RefreshCwIcon class="h-4 w-4 animate-spin" />
					<span>Încarc audit log...</span>
				</div>
			{:else if auditRows.length === 0}
				<div
					class="rounded-lg border border-dashed border-slate-300 bg-slate-50/40 p-6 text-center text-[12.5px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/40"
				>
					Niciun audit pentru acest cont
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					{#each auditRows as a (a.id)}
						<div
							class="flex gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
						>
							<div
								class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-white {a.success
									? 'bg-emerald-500'
									: 'bg-rose-500'}"
							>
								{#if a.success}
									<CheckIcon class="h-2.5 w-2.5" />
								{:else}
									<XIcon class="h-2.5 w-2.5" />
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-1.5">
									<strong class="text-[12.5px] text-slate-900 dark:text-slate-100">
										{ACTION_LABELS[a.action] ?? a.action}
									</strong>
									<TriggerChip trigger={a.trigger} />
									<span class="ml-auto text-[10.5px] text-slate-400">{fmtRelativeFull(a.createdAt)}</span>
								</div>
								{#if a.errorMessage}
									<div class="mt-1 break-words text-[11.5px] text-rose-700 dark:text-rose-400">
										{a.errorMessage}
									</div>
								{/if}
								<div class="mt-1 flex flex-wrap items-center gap-3 text-[10.5px] text-slate-500 dark:text-slate-400">
									<span class="inline-flex items-center gap-1">
										<ClockIcon class="h-2.5 w-2.5" />
										{fmtDuration(a.durationMs)}
									</span>
									<span class="inline-flex items-center gap-1">
										<UsersIcon class="h-2.5 w-2.5" />
										{a.actor}
									</span>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else if tab === 'da'}
			{#if daVerification.loading}
				<div class="flex items-center justify-center gap-2 py-8 text-[12.5px] text-slate-500">
					<RefreshCwIcon class="h-4 w-4 animate-spin" />
					<span>Verificare live pe {row.daServerName ?? row.daServerHostname}...</span>
				</div>
			{:else if daVerification.data && !daVerification.data.existsOnDA}
				{@const errMsg =
					'errorMessage' in daVerification.data ? daVerification.data.errorMessage : null}
				{#if row.status === 'terminated'}
					<!-- Cont terminat + DA gol = stare CORECTĂ, ambele părți coerente. -->
					<div
						class="flex gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40"
					>
						<CheckCircleIcon class="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" />
						<div class="min-w-0">
							<strong class="block text-[13px] text-slate-700 dark:text-slate-200"
								>Cont terminat — sincronizat</strong
							>
							<div class="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
								CRM-ul îl listează ca <em>terminat</em> și nu mai există pe DA. Stare așteptată
								— niciun audit out-of-sync.
							</div>
						</div>
					</div>
				{:else if row.status === 'failed'}
					<!-- Cont eșuat la creare = NU a existat niciodată pe DA. Așteptat. -->
					<div
						class="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/30"
					>
						<AlertTriangleIcon class="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
						<div class="min-w-0">
							<strong class="block text-[13px] text-amber-900 dark:text-amber-200"
								>Cont nu a fost creat pe DA</strong
							>
							<div class="mt-0.5 text-[11.5px] text-amber-700 dark:text-amber-300">
								Provisioning-ul a eșuat — DA n-a primit niciodată comanda de creare cont.
								Folosește <strong>Retry provisioning</strong> din meniul de acțiuni pentru a re-încerca.
							</div>
						</div>
					</div>
				{:else if row.status === 'pending'}
					<!-- Cont în coadă, încă neexistent pe DA = așteptat dacă recent. -->
					<div
						class="flex gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-950/30"
					>
						<ClockIcon class="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
						<div class="min-w-0">
							<strong class="block text-[13px] text-blue-900 dark:text-blue-200"
								>Cont în provisioning, încă neexistent pe DA</strong
							>
							<div class="mt-0.5 text-[11.5px] text-blue-700 dark:text-blue-300">
								Comanda e în coadă — DA va răspunde după ce request-ul de creare se finalizează.
								{#if row.pendingSinceMin != null}
									Pending de <strong>{row.pendingSinceMin} min</strong>{row.pendingSinceMin > 5
										? ' — verifică audit log dacă e blocat.'
										: '.'}
								{/if}
							</div>
						</div>
					</div>
				{:else}
					<!-- Cont activ/suspendat dar DA spune 404 = REAL out-of-sync, intervenție necesară. -->
					<div
						class="flex gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/40 dark:bg-rose-950/30"
					>
						<AlertTriangleIcon class="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" />
						<div class="min-w-0">
							<strong class="block text-[13px] text-rose-900 dark:text-rose-200"
								>Out of sync — contul lipsește pe DA</strong
							>
							<div class="mt-0.5 text-[11.5px] text-rose-700 dark:text-rose-400">
								CRM-ul îl listează ca <em>{row.status}</em> dar DA returnează 404. Posibil
								șters manual din panou. Intervenție necesară: re-creează contul sau marchează-l
								terminat în CRM.
								{#if errMsg}
									<div class="mt-1 font-mono text-[10.5px]">{errMsg}</div>
								{/if}
							</div>
						</div>
					</div>
				{/if}
			{:else if daVerification.data && daVerification.data.existsOnDA}
				{@const data = daVerification.data}
				<div
					class="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60"
				>
					<span
						class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold {data.outOfSync
							? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
							: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'}"
					>
						{#if data.outOfSync}
							<AlertTriangleIcon class="h-3 w-3" /> Out of sync
						{:else}
							<CheckCircleIcon class="h-3 w-3" /> În sincronizare cu DA
						{/if}
					</span>
					<span class="text-[11px] text-slate-500 dark:text-slate-400">
						Răspuns DA: <strong class="text-slate-700 dark:text-slate-200">{data.daStatus}</strong> ·
						CRM: <strong class="text-slate-700 dark:text-slate-200">{row.status}</strong>
					</span>
				</div>

				{#if data.usage}
					<div class="grid grid-cols-2 gap-3">
						<div
							class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
						>
							<span class="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
								>Disk</span
							>
							<div class="mt-1 flex items-baseline gap-1">
								<strong class="text-[16px] font-bold text-slate-900 dark:text-slate-100"
									>{data.usage.disk}</strong
								>
								<span class="text-[11px] text-slate-500">/ {data.usage.diskOf} MB</span>
							</div>
							{#if data.usage.diskOf > 0}
								<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
									<div
										class="h-full rounded-full bg-blue-500"
										style="width: {Math.min(100, (data.usage.disk / data.usage.diskOf) * 100)}%"
									></div>
								</div>
							{/if}
						</div>

						<div
							class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
						>
							<span class="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
								>Bandwidth</span
							>
							<div class="mt-1 flex items-baseline gap-1">
								<strong class="text-[16px] font-bold text-slate-900 dark:text-slate-100"
									>{data.usage.bw}</strong
								>
								<span class="text-[11px] text-slate-500">/ {data.usage.bwOf} MB</span>
							</div>
							{#if data.usage.bwOf > 0}
								<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
									<div
										class="h-full rounded-full bg-emerald-500"
										style="width: {Math.min(100, (data.usage.bw / data.usage.bwOf) * 100)}%"
									></div>
								</div>
							{/if}
						</div>

						<div
							class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
						>
							<span class="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
								>Email accounts</span
							>
							<div class="mt-1 flex items-baseline gap-1">
								<strong class="text-[16px] font-bold text-slate-900 dark:text-slate-100"
									>{data.usage.emails}</strong
								>
								<span class="text-[11px] text-slate-500"
									>/ {data.usage.emailsOf || '∞'} create</span
								>
							</div>
						</div>

						<div
							class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
						>
							<span class="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
								>Baze de date</span
							>
							<div class="mt-1 flex items-baseline gap-1">
								<strong class="text-[16px] font-bold text-slate-900 dark:text-slate-100"
									>{data.usage.dbs}</strong
								>
								<span class="text-[11px] text-slate-500">/ {data.usage.dbsOf || '∞'} MySQL</span>
							</div>
						</div>
					</div>
				{/if}

				<div
					class="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60 text-[11.5px] dark:border-slate-800 dark:bg-slate-900/40"
				>
					<div class="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
						<span class="text-slate-500">API endpoint</span>
						<code class="font-mono text-slate-700 dark:text-slate-300"
							>{daApiEndpoint ?? '—'}</code
						>
					</div>
					<div class="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
						<span class="text-slate-500">Pachet DA</span>
						<strong class="text-slate-700 dark:text-slate-200">{data.package ?? '—'}</strong>
					</div>
					<div class="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
						<span class="text-slate-500">IP server</span>
						<strong class="font-mono text-slate-700 dark:text-slate-200">{data.ip ?? '—'}</strong>
					</div>
					<div class="flex items-center justify-between px-3 py-2">
						<span class="text-slate-500">Last sync</span>
						<strong class="text-slate-700 dark:text-slate-200">acum</strong>
					</div>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Footer -->
	<div
		class="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50/40 px-5 py-3 dark:border-slate-800 dark:bg-slate-900/40"
	>
		<a
			href="/{row.clientId ? '' : ''}hosting/accounts/{row.accountId}"
			class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
		>
			<DatabaseIcon class="h-3 w-3" /> Vezi cont (CRM)
		</a>
		{#if row.status === 'failed' || row.status === 'pending'}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-700"
				onclick={doRetry}
			>
				<RefreshCwIcon class="h-3 w-3" /> Retry provisioning
			</button>
		{/if}
		<div class="flex-1"></div>
		{#if row.status === 'active'}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-3 py-1.5 text-[12px] font-medium text-orange-700 hover:bg-orange-100 dark:border-orange-900/40 dark:bg-orange-950/30 dark:text-orange-300"
				onclick={doSuspend}
			>
				Suspendă
			</button>
		{:else if row.status === 'suspended'}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-700"
				onclick={doUnsuspend}
			>
				Reactivează
			</button>
		{/if}
	</div>
</div>
