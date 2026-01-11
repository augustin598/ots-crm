<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { CreditCard, TrendingUp, ArrowRight } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
</script>

<svelte:head>
	<title>Banking - CRM</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8">
		<h1 class="text-3xl font-bold">Banking</h1>
		<p class="text-muted-foreground">Manage bank transactions, expenses, and invoice payments</p>
	</div>

	<div class="grid gap-6 md:grid-cols-2">
		<Card class="cursor-pointer hover:bg-accent transition-colors" onclick={() => goto(`/${tenantSlug}/banking/transactions`)}>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<CreditCard class="h-5 w-5" />
					Transactions
				</CardTitle>
				<CardDescription>View and manage bank transactions</CardDescription>
			</CardHeader>
			<CardContent>
				<p class="text-sm text-muted-foreground mb-4">
					View all bank transactions, match them to invoices, and track payment status.
				</p>
				<Button variant="outline" class="w-full">
					View Transactions
					<ArrowRight class="ml-2 h-4 w-4" />
				</Button>
			</CardContent>
		</Card>

		<Card class="cursor-pointer hover:bg-accent transition-colors" onclick={() => goto(`/${tenantSlug}/banking/expenses`)}>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<TrendingUp class="h-5 w-5" />
					Expenses
				</CardTitle>
				<CardDescription>Track and manage business expenses</CardDescription>
			</CardHeader>
			<CardContent>
				<p class="text-sm text-muted-foreground mb-4">
					View all expenses, create new expense records, and link them to transactions.
				</p>
				<Button variant="outline" class="w-full">
					View Expenses
					<ArrowRight class="ml-2 h-4 w-4" />
				</Button>
			</CardContent>
		</Card>
	</div>
</div>
