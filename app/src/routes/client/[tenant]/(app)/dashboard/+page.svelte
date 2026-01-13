<script lang="ts">
	import { getTasks } from '$lib/remotes/tasks.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { getDocuments } from '$lib/remotes/documents.remote';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { CheckSquare, FileText, Receipt } from '@lucide/svelte';
	import { goto } from '$app/navigation';

	const tenantSlug = $derived(page.params.tenant as string);

	const tasksQuery = getTasks({});
	const tasks = $derived(tasksQuery.current || []);
	const tasksLoading = $derived(tasksQuery.loading);

	const invoicesQuery = getInvoices({});
	const invoices = $derived(invoicesQuery.current || []);
	const invoicesLoading = $derived(invoicesQuery.loading);

	const documentsQuery = getDocuments({});
	const documents = $derived(documentsQuery.current || []);
	const contracts = $derived(documents.filter((d) => d.type === 'contract'));

	const pendingTasks = $derived(tasks.filter((t) => t.status === 'pending-approval').length);
	const activeTasks = $derived(tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length);
	const totalContracts = $derived(contracts.length);
	const pendingInvoices = $derived(invoices.filter((i) => i.status === 'sent' || i.status === 'overdue').length);
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-3xl font-bold">Client Dashboard</h1>
		<p class="text-muted-foreground">Welcome to your client portal</p>
	</div>

	<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Pending Tasks</CardTitle>
				<CheckSquare class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{pendingTasks}</div>
				<p class="text-xs text-muted-foreground">Awaiting approval</p>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Active Tasks</CardTitle>
				<CheckSquare class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{activeTasks}</div>
				<p class="text-xs text-muted-foreground">In progress</p>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Contracts</CardTitle>
				<FileText class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{totalContracts}</div>
				<p class="text-xs text-muted-foreground">Total contracts</p>
			</CardContent>
		</Card>

		<Card>
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
								<div class="flex-1">
									<p class="text-sm font-medium">{task.title}</p>
									<p class="text-xs text-muted-foreground capitalize">{task.status}</p>
								</div>
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
								<div class="flex-1">
									<p class="text-sm font-medium">{invoice.invoiceNumber}</p>
									<p class="text-xs text-muted-foreground capitalize">{invoice.status}</p>
								</div>
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
</div>
