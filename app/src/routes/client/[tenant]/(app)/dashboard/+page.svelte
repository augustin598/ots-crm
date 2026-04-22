<script lang="ts">
	import { getTasks } from '$lib/remotes/tasks.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { getContracts } from '$lib/remotes/contracts.remote';
	import { getClientAccountBudgets } from '$lib/remotes/budget.remote';
	import { page } from '$app/state';
	import { CheckSquare, FileText, Receipt } from '@lucide/svelte';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import { goto } from '$app/navigation';
	import { Badge } from '$lib/components/ui/badge';
	import { formatStatus, getStatusBadgeVariant } from '$lib/components/task-kanban-utils';
	import DashboardChecklist from '$lib/components/onboarding/dashboard-checklist.svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import AdsHealthAlert from '$lib/components/client/ads-health-alert.svelte';

	const tenantSlug = $derived(page.params.tenant as string);
	const isPrimary = $derived((page.data as any)?.isClientUserPrimary ?? true);
	const clientId = $derived((page.data as any)?.client?.id as string);

	function getInvoiceStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
		switch (status) {
			case 'paid':
				return 'success';
			case 'partially_paid':
				return 'warning';
			case 'sent':
				return 'default';
			case 'overdue':
				return 'destructive';
			case 'cancelled':
				return 'destructive';
			case 'draft':
			default:
				return 'outline';
		}
	}

	function formatInvoiceStatus(status: string): string {
		switch (status) {
			case 'paid': return 'Achitată';
			case 'partially_paid': return 'Achitată parțial';
			case 'sent': return 'Trimisă';
			case 'overdue': return 'Restantă';
			case 'draft': return 'Ciornă';
			case 'cancelled': return 'Anulată';
			default: return status;
		}
	}

	const tasksQuery = getTasks({});
	const tasks = $derived(tasksQuery.current || []);
	const tasksLoading = $derived(tasksQuery.loading);

	const invoicesQuery = getInvoices({});
	const invoices = $derived(invoicesQuery.current || []);
	const invoicesLoading = $derived(invoicesQuery.loading);

	const contractsQuery = getContracts({});
	const contracts = $derived(contractsQuery.current?.contracts || []);

	// Lazy budget query — only when clientId available
	let budgetQuery = $state<ReturnType<typeof getClientAccountBudgets> | null>(null);
	$effect(() => {
		if (clientId) {
			budgetQuery = getClientAccountBudgets({ clientId });
		}
	});
	const budgetData = $derived(budgetQuery?.current);

	// Budget totals — computed once as derived values, not functions
	const allBudgetAccounts = $derived.by(() => {
		if (!budgetData) return [];
		return [
			...budgetData.meta.map(a => ({ ...a, platform: 'meta' as const })),
			...budgetData.tiktok.map(a => ({ ...a, platform: 'tiktok' as const })),
			...budgetData.google.map(a => ({ ...a, platform: 'google' as const }))
		];
	});
	const totalBudget = $derived(allBudgetAccounts.reduce((sum, a) => sum + (a.monthlyBudget || 0), 0));
	const totalSpend = $derived(allBudgetAccounts.reduce((sum, a) => sum + a.spendAmount, 0));
	const totalPct = $derived(totalBudget > 0 ? Math.round((totalSpend / totalBudget) * 100) : 0);
	const accountsWithBudget = $derived(allBudgetAccounts.filter(a => a.monthlyBudget && a.monthlyBudget > 0));

	function budgetColor(pct: number) {
		if (pct >= 100) return { bar: 'budget-bar-red', text: 'text-destructive font-bold' };
		if (pct >= 75) return { bar: 'budget-bar-yellow', text: 'text-yellow-600 dark:text-yellow-400 font-semibold' };
		return { bar: '', text: '' };
	}

	const pendingTasks = $derived(tasks.filter((t: any) => t.status === 'pending-approval').length);
	const activeTasks = $derived(tasks.filter((t: any) => t.status !== 'done' && t.status !== 'cancelled').length);
	const totalContracts = $derived(contracts.length);
	const pendingInvoices = $derived(invoices.filter((i) => i.status === 'sent' || i.status === 'overdue').length);
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-3xl font-bold">Client Dashboard</h1>
		<p class="text-muted-foreground">Welcome to your client portal</p>
	</div>

	{#if clientId}
		<AdsHealthAlert {clientId} />
	{/if}

	<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
		<button
			type="button"
			onclick={() => goto(`/client/${tenantSlug}/tasks`)}
			class="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition-all hover:border-zinc-300 hover:shadow-md"
		>
			<div>
				<p class="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Pending Tasks</p>
				<p class="mt-2 text-3xl font-bold tabular-nums text-zinc-900">{pendingTasks}</p>
				<p class="mt-1 text-xs text-zinc-500">Awaiting approval</p>
			</div>
			<div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-50">
				<CheckSquare class="size-4 text-zinc-500" />
			</div>
		</button>

		<button
			type="button"
			onclick={() => goto(`/client/${tenantSlug}/tasks`)}
			class="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition-all hover:border-zinc-300 hover:shadow-md"
		>
			<div>
				<p class="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Active Tasks</p>
				<p class="mt-2 text-3xl font-bold tabular-nums text-zinc-900">{activeTasks}</p>
				<p class="mt-1 text-xs text-zinc-500">In progress</p>
			</div>
			<div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-50">
				<CheckSquare class="size-4 text-zinc-500" />
			</div>
		</button>

		<button
			type="button"
			onclick={() => goto(`/client/${tenantSlug}/contracts`)}
			class="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition-all hover:border-zinc-300 hover:shadow-md"
		>
			<div>
				<p class="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Contracts</p>
				<p class="mt-2 text-3xl font-bold tabular-nums text-zinc-900">{totalContracts}</p>
				<p class="mt-1 text-xs text-zinc-500">Total contracts</p>
			</div>
			<div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-50">
				<FileText class="size-4 text-zinc-500" />
			</div>
		</button>

		<button
			type="button"
			onclick={() => goto(`/client/${tenantSlug}/invoices`)}
			class="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition-all hover:border-zinc-300 hover:shadow-md"
		>
			<div>
				<p class="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Pending Invoices</p>
				<p class="mt-2 text-3xl font-bold tabular-nums text-zinc-900">{pendingInvoices}</p>
				<p class="mt-1 text-xs text-zinc-500">Awaiting payment</p>
			</div>
			<div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-50">
				<Receipt class="size-4 text-zinc-500" />
			</div>
		</button>
	</div>

	<!-- Budget Overview -->
	{#if budgetData && allBudgetAccounts.length > 0}
		{@const totalColors = budgetColor(totalPct)}
		<div class="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
			<button
				type="button"
				onclick={() => goto(`/client/${tenantSlug}/budgets`)}
				class="flex w-full items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 text-left transition-colors hover:bg-zinc-50/60"
			>
				<div class="flex items-center gap-2.5">
					<WalletIcon class="size-4 text-zinc-500" />
					<h3 class="text-sm font-semibold text-zinc-900">Buget Publicitate · Luna Curentă</h3>
				</div>
				<span class="text-xs font-medium text-zinc-500">Vezi detalii →</span>
			</button>
			<div class="space-y-4 p-5">
				{#if totalBudget > 0}
					<div class="space-y-2">
						<div class="flex justify-between text-sm">
							<span class="font-medium text-zinc-700 {totalColors.text}">
								Consumat: <span class="tabular-nums">{totalSpend.toLocaleString('ro-RO')}</span> / <span class="tabular-nums">{totalBudget.toLocaleString('ro-RO')}</span> RON
							</span>
							<span class="font-semibold tabular-nums text-zinc-700 {totalColors.text}">{totalPct}%</span>
						</div>
						<div class="relative h-2 overflow-hidden rounded-full bg-zinc-100 {totalColors.bar}">
							<div
								class="budget-bar-glow absolute inset-y-0 left-0 rounded-full"
								style="width: {Math.min(totalPct, 100)}%"
							></div>
						</div>
					</div>
				{/if}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each accountsWithBudget as account (account.id)}
						{@const pct = account.monthlyBudget && account.monthlyBudget > 0 ? Math.round((account.spendAmount / account.monthlyBudget) * 100) : 0}
						{@const colors = budgetColor(pct)}
						<div class="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
							<div class="flex items-center gap-2">
								{#if account.platform === 'meta'}
									<IconFacebook class="size-4 shrink-0 text-blue-600" />
								{:else if account.platform === 'tiktok'}
									<IconTiktok class="size-4 shrink-0" />
								{:else}
									<IconGoogleAds class="size-4 shrink-0 text-yellow-600" />
								{/if}
								<span class="truncate text-sm font-medium text-zinc-900">{account.accountName}</span>
							</div>
							<div class="flex justify-between text-xs">
								<span class="tabular-nums text-zinc-500 {colors.text}">{account.spendAmount.toLocaleString('ro-RO')} / {account.monthlyBudget?.toLocaleString('ro-RO')} RON</span>
								<span class="font-semibold tabular-nums text-zinc-500 {colors.text}">{pct}%</span>
							</div>
							<div class="relative h-1.5 overflow-hidden rounded-full bg-zinc-100 {colors.bar}">
								<div
									class="budget-bar-glow absolute inset-y-0 left-0 rounded-full"
									style="width: {Math.min(pct, 100)}%"
								></div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<div class="grid gap-4 md:grid-cols-2">
		<div class="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
			<div class="border-b border-zinc-100 px-5 py-4">
				<h3 class="text-sm font-semibold text-zinc-900">Recent Tasks</h3>
				<p class="mt-0.5 text-xs text-zinc-500">Your latest tasks</p>
			</div>
			<div class="p-2">
				{#if tasksLoading}
					<p class="p-3 text-sm text-zinc-500">Loading...</p>
				{:else if tasks.length === 0}
					<p class="p-3 text-sm text-zinc-500">No tasks yet</p>
				{:else}
					<div>
						{#each tasks.slice(0, 5) as task}
							<div class="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-zinc-50">
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium text-zinc-900">{task.title}</p>
								</div>
								<Badge variant={getStatusBadgeVariant(task.status)} class="ml-2 shrink-0 text-xs">
									{formatStatus(task.status)}
								</Badge>
							</div>
						{/each}
					</div>
					{#if tasks.length > 5}
						<div class="border-t border-zinc-100 px-3 pt-3 mt-2">
							<button
								onclick={() => goto(`/client/${tenantSlug}/tasks`)}
								class="text-xs font-medium text-zinc-600 hover:text-zinc-900"
							>
								View all tasks →
							</button>
						</div>
					{/if}
				{/if}
			</div>
		</div>

		<div class="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
			<div class="border-b border-zinc-100 px-5 py-4">
				<h3 class="text-sm font-semibold text-zinc-900">Recent Invoices</h3>
				<p class="mt-0.5 text-xs text-zinc-500">Your latest invoices</p>
			</div>
			<div class="p-2">
				{#if invoicesLoading}
					<p class="p-3 text-sm text-zinc-500">Loading...</p>
				{:else if invoices.length === 0}
					<p class="p-3 text-sm text-zinc-500">No invoices yet</p>
				{:else}
					<div>
						{#each invoices.slice(0, 5) as invoice}
							<div class="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-zinc-50">
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium text-zinc-900">{invoice.invoiceNumber}</p>
								</div>
								<Badge variant={getInvoiceStatusVariant(invoice.status)} class="ml-2 shrink-0 text-xs">
									{formatInvoiceStatus(invoice.status)}
								</Badge>
							</div>
						{/each}
					</div>
					{#if invoices.length > 5}
						<div class="border-t border-zinc-100 px-3 pt-3 mt-2">
							<button
								onclick={() => goto(`/client/${tenantSlug}/invoices`)}
								class="text-xs font-medium text-zinc-600 hover:text-zinc-900"
							>
								View all invoices →
							</button>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</div>

	<DashboardChecklist {isPrimary} {tenantSlug} />
</div>

<style>
	@keyframes budget-flow {
		0% { background-position: 200% center; }
		100% { background-position: -200% center; }
	}
	:global(.budget-bar-glow) {
		background: linear-gradient(
			90deg,
			var(--primary) 0%,
			color-mix(in oklch, var(--primary) 60%, white) 50%,
			var(--primary) 100%
		);
		background-size: 200% 100%;
		animation: budget-flow 3s ease-in-out infinite;
	}
	:global(.budget-bar-yellow .budget-bar-glow) {
		background: linear-gradient(90deg, #eab308 0%, #fde047 50%, #eab308 100%);
		background-size: 200% 100%;
		animation: budget-flow 3s ease-in-out infinite;
	}
	:global(.budget-bar-red .budget-bar-glow) {
		background: linear-gradient(
			90deg,
			var(--destructive) 0%,
			color-mix(in oklch, var(--destructive) 60%, white) 50%,
			var(--destructive) 100%
		);
		background-size: 200% 100%;
		animation: budget-flow 3s ease-in-out infinite;
	}
</style>
