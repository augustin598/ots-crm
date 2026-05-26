<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import {
		getHostingAccount,
		terminateHostingAccount,
		syncAccountStats
	} from '$lib/remotes/hosting-accounts.remote';
	import HostingAccountEditForm, {
		type EditableAccount
	} from '$lib/components/hosting/hosting-account-edit-form.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

	const tenantSlug = $derived(page.params.tenant);
	const accountId = $derived(page.params.accountId as string);
	// svelte-ignore state_referenced_locally
	let accountPromise = $state(getHostingAccount({ id: accountId, withLive: false }));

	function refresh(): void {
		accountPromise = getHostingAccount({ id: accountId, withLive: false });
	}

	async function handleSync() {
		try {
			await syncAccountStats(accountId);
			toast.success('Stats sincronizate');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleTerminate() {
		if (!confirm('SIGUR vrei să termini contul? Va șterge user-ul DA real.')) return;
		try {
			await terminateHostingAccount(accountId);
			toast.success('Cont terminat');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	function toEditable(a: Awaited<typeof accountPromise>): EditableAccount {
		return {
			id: a.id,
			domain: a.domain,
			daUsername: a.daUsername,
			status: a.status,
			clientId: a.clientId,
			daServerId: a.daServerId,
			daPackageId: a.daPackageId,
			daPackageName: a.daPackageName,
			hostingProductId: a.hostingProductId,
			startDate: a.startDate,
			nextDueDate: a.nextDueDate,
			recurringAmount: a.recurringAmount,
			currency: a.currency,
			billingCycle: a.billingCycle,
			additionalDomains: a.additionalDomains ?? null,
			autoRenew: a.autoRenew,
			notes: a.notes,
			tags: (a as { tags?: string[] | null }).tags ?? null
		};
	}

	function statusBadgeClass(s: string): string {
		switch (s) {
			case 'active':
				return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
			case 'suspended':
				return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
			case 'pending':
				return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
			case 'terminated':
			case 'cancelled':
				return 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
			default:
				return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
		}
	}

	function statusLabel(s: string): string {
		switch (s) {
			case 'active':
				return 'Activ';
			case 'suspended':
				return 'Suspendat';
			case 'pending':
				return 'În așteptare';
			case 'terminated':
				return 'Terminat';
			case 'cancelled':
				return 'Anulat';
			default:
				return s;
		}
	}
</script>

<div class="space-y-5">
	<!-- Breadcrumb / back -->
	<nav class="flex items-center gap-2 text-sm text-slate-500" aria-label="breadcrumb">
		<a href={`/${tenantSlug}/hosting`} class="hover:text-slate-700 dark:hover:text-slate-300">Hosting</a>
		<span class="text-slate-300">›</span>
		<a href={`/${tenantSlug}/hosting/accounts`} class="hover:text-slate-700 dark:hover:text-slate-300">Conturi</a>
		<span class="text-slate-300">›</span>
		<span class="text-slate-700 dark:text-slate-200">Editare</span>
	</nav>

	<a
		href={`/${tenantSlug}/hosting/accounts`}
		class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
	>
		<ArrowLeftIcon class="size-4" /> Înapoi la lista de conturi
	</a>

	{#await accountPromise}
		<div class="rounded-xl border bg-white p-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">
			Se încarcă contul…
		</div>
	{:then a}
		<!-- Header -->
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="min-w-0">
				<h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100 break-all font-mono">{a.domain}</h1>
				<p class="mt-1 text-sm text-slate-500">
					DA user <span class="font-mono text-slate-700 dark:text-slate-200">{a.daUsername}</span>
				</p>
				<div class="mt-2 flex flex-wrap items-center gap-2">
					<span class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium {statusBadgeClass(a.status)}">
						<span class="size-1.5 rounded-full bg-current"></span>
						{statusLabel(a.status)}
					</span>
					{#if a.suspendReason}
						<span class="text-[11px] text-amber-700">{a.suspendReason}</span>
					{/if}
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={handleSync}
					class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
				>
					<RefreshCwIcon class="size-4" /> Sync stats
				</button>
				{#if a.status !== 'terminated'}
					<button
						type="button"
						onclick={handleTerminate}
						class="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-950 dark:text-red-300"
					>
						<TrashIcon class="size-4" /> Termină cont
					</button>
				{/if}
			</div>
		</div>

		<!-- Editor card -->
		<div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
			<HostingAccountEditForm account={toEditable(a)} onSaved={refresh} />
		</div>

		<!-- Footer link to deep-link helper -->
		<div class="text-[11px] text-slate-400">
			Deep-link: <span class="font-mono">/{tenantSlug}/hosting/accounts/{accountId}</span>
			<a href={`/${tenantSlug}/hosting/accounts`} class="ml-2 inline-flex items-center gap-1 hover:text-slate-600">
				<ExternalLinkIcon class="size-3" /> deschide lista
			</a>
		</div>
	{:catch err}
		<div class="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
			Eroare la încărcare: {err instanceof Error ? err.message : String(err)}
		</div>
	{/await}
</div>
