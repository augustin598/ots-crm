<script lang="ts">
	import { getTasks } from '$lib/remotes/tasks.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { getContracts } from '$lib/remotes/contracts.remote';
	import { getClientAccountBudgets } from '$lib/remotes/budget.remote';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { CheckSquare, FileText, Receipt } from '@lucide/svelte';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import { goto } from '$app/navigation';
	import { Badge } from '$lib/components/ui/badge';
	import { formatStatus, getStatusBadgeVariant } from '$lib/components/task-kanban-utils';
	import DashboardChecklist from '$lib/components/onboarding/dashboard-checklist.svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';

	const tenantSlug = $derived(page.params.tenant as string);
	const isPrimary = $derived((page.data as any)?.isClientUserPrimary ?? true);
	const clientId = $derived((page.data as any)?.client?.id as string);

	function getInvoiceStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
		switch (status) {
			case 'paid':
				return 'success';
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
		return status.charAt(0).toUpperCase() + status.slice(1);
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

	<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
		<Card class="cursor-pointer hover:border-primary/50 transition-colors" onclick={() => goto(`/client/${tenantSlug}/tasks`)}>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Pending Tasks</CardTitle>
				<CheckSquare class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{pendingTasks}</div>
				<p class="text-xs text-muted-foreground">Awaiting approval</p>
			</CardContent>
		</Card>

		<Card class="cursor-pointer hover:border-primary/50 transition-colors" onclick={() => goto(`/client/${tenantSlug}/tasks`)}>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Active Tasks</CardTitle>
				<CheckSquare class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{activeTasks}</div>
				<p class="text-xs text-muted-foreground">In progress</p>
			</CardContent>
		</Card>

		<Card class="cursor-pointer hover:border-primary/50 transition-colors" onclick={() => goto(`/client/${tenantSlug}/contracts`)}>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Contracts</CardTitle>
				<FileText class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{totalContracts}</div>
				<p class="text-xs text-muted-foreground">Total contracts</p>
			</CardContent>
		</Card>

		<Card class="cursor-pointer hover:border-primary/50 transition-colors" onclick={() => goto(`/client/${tenantSlug}/invoices`)}>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Pending Invoices</CardTitle>
				<Receipt class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{pendingInvoices}</div>
				<p class="text-xs text-muted-foreground">Awaiting payment</p>
			</CardContent>
		</Card>
	</div>

	<!-- Budget Overview -->
	{#if budgetData && allBudgetAccounts.length > 0}
		{@const totalColors = budgetColor(totalPct)}
		<Card class="cursor-pointer hover:border-primary/50 transition-colors overflow-hidden" onclick={() => goto(`/client/${tenantSlug}/budgets`)}>
			<CardHeader>
				<CardTitle class="flex items-center justify-between">
					<span class="flex items-center gap-2">
						<WalletIcon class="h-5 w-5" />
						Buget Publicitate — Luna Curentă
					</span>
					<span class="text-sm font-normal text-muted-foreground">Vezi detalii →</span>
				</CardTitle>
			</CardHeader>
			<CardContent class="space-y-4">
				{#if totalBudget > 0}
					<div class="space-y-2">
						<div class="flex justify-between text-sm">
							<span class={totalColors.text}>
								Consumat: {totalSpend.toLocaleString('ro-RO')} / {totalBudget.toLocaleString('ro-RO')} RON
							</span>
							<span class={totalColors.text}>{totalPct}%</span>
						</div>
						<div class="relative h-3 rounded-full overflow-hidden bg-muted {totalColors.bar}">
							<div
								class="absolute inset-y-0 left-0 rounded-full budget-bar-glow"
								style="width: {Math.min(totalPct, 100)}%"
							></div>
						</div>
					</div>
				{/if}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each accountsWithBudget as account (account.id)}
						{@const pct = account.monthlyBudget && account.monthlyBudget > 0 ? Math.round((account.spendAmount / account.monthlyBudget) * 100) : 0}
						{@const colors = budgetColor(pct)}
						<div class="rounded-lg border p-3 space-y-2">
							<div class="flex items-center gap-2">
								{#if account.platform === 'meta'}
									<IconFacebook class="h-4 w-4 text-blue-600 shrink-0" />
								{:else if account.platform === 'tiktok'}
									<IconTiktok class="h-4 w-4 shrink-0" />
								{:else}
									<IconGoogleAds class="h-4 w-4 text-yellow-600 shrink-0" />
								{/if}
								<span class="text-sm font-medium truncate">{account.accountName}</span>
							</div>
							<div class="flex justify-between text-xs text-muted-foreground">
								<span class={colors.text}>{account.spendAmount.toLocaleString('ro-RO')} / {account.monthlyBudget?.toLocaleString('ro-RO')} RON</span>
								<span class={colors.text}>{pct}%</span>
							</div>
							<div class="relative h-1.5 rounded-full overflow-hidden bg-muted {colors.bar}">
								<div
									class="absolute inset-y-0 left-0 rounded-full budget-bar-glow"
									style="width: {Math.min(pct, 100)}%"
								></div>
							</div>
						</div>
					{/each}
				</div>
			</CardContent>
		</Card>
	{/if}

	<div class="grid gap-4 md:grid-cols-2">
		<Card>
			<CardHeader>
				<CardTitle>Recent Tasks</CardTitle>
				<CardDescription>Your latest tasks</CardDescription>
			</CardHeader>
			<CardContent>
				{#if tasksLoading}
					<p class="text-sm text-muted-foreground">Loading...</p>
				{:else if tasks.length === 0}
					<p class="text-sm text-muted-foreground">No tasks yet</p>
				{:else}
					<div class="space-y-2">
						{#each tasks.slice(0, 5) as task}
							<div class="flex items-center justify-between p-2 rounded-lg hover:bg-accent">
								<div class="flex-1 min-w-0">
									<p class="text-sm font-medium">{task.title}</p>
								</div>
								<Badge variant={getStatusBadgeVariant(task.status)} class="text-xs shrink-0 ml-2">
									{formatStatus(task.status)}
								</Badge>
							</div>
						{/each}
					</div>
					{#if tasks.length > 5}
						<div class="mt-4">
							<button
								onclick={() => goto(`/client/${tenantSlug}/tasks`)}
								class="text-sm text-primary hover:underline"
							>
								View all tasks →
							</button>
						</div>
					{/if}
				{/if}
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>Recent Invoices</CardTitle>
				<CardDescription>Your latest invoices</CardDescription>
			</CardHeader>
			<CardContent>
				{#if invoicesLoading}
					<p class="text-sm text-muted-foreground">Loading...</p>
				{:else if invoices.length === 0}
					<p class="text-sm text-muted-foreground">No invoices yet</p>
				{:else}
					<div class="space-y-2">
						{#each invoices.slice(0, 5) as invoice}
							<div class="flex items-center justify-between p-2 rounded-lg hover:bg-accent">
								<div class="flex-1 min-w-0">
									<p class="text-sm font-medium">{invoice.invoiceNumber}</p>
								</div>
								<Badge variant={getInvoiceStatusVariant(invoice.status)} class="text-xs shrink-0 ml-2">
									{formatInvoiceStatus(invoice.status)}
								</Badge>
							</div>
						{/each}
					</div>
					{#if invoices.length > 5}
						<div class="mt-4">
							<button
								onclick={() => goto(`/client/${tenantSlug}/invoices`)}
								class="text-sm text-primary hover:underline"
							>
								View all invoices →
							</button>
						</div>
					{/if}
				{/if}
			</CardContent>
		</Card>
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
