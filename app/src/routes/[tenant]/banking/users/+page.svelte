<script lang="ts">
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { getUserSpending } from '$lib/remotes/banking.remote';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { ArrowLeft, TrendingDown } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);

	let fromDate = $state<string>('');
	let toDate = $state<string>('');

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);

	// Get spending for each user
	const userSpendingQueries = $derived(
		users.map((user) =>
			getUserSpending({
				userId: user.id,
				fromDate: fromDate || undefined,
				toDate: toDate || undefined
			})
		)
	);

	const userSpendingData = $derived(
		users.map((user, index) => ({
			user,
			spending: userSpendingQueries[index]?.current || { totalSpending: 0, transactionCount: 0, byCurrency: {} }
		}))
	);
</script>

<svelte:head>
	<title>User Spending - Banking</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex items-center justify-between">
		<div class="flex items-center gap-4">
			<Button variant="ghost" size="icon" onclick={() => goto(`/${tenantSlug}/banking`)}>
				<ArrowLeft class="h-4 w-4" />
			</Button>
			<div>
				<h1 class="text-3xl font-bold">User Spending</h1>
				<p class="text-muted-foreground">Track spending per user in the firm</p>
			</div>
		</div>
	</div>

	<Card>
		<CardHeader>
			<CardTitle>Filters</CardTitle>
		</CardHeader>
		<CardContent>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="fromDate">From Date</Label>
					<Input id="fromDate" type="date" bind:value={fromDate} />
				</div>
				<div class="space-y-2">
					<Label for="toDate">To Date</Label>
					<Input id="toDate" type="date" bind:value={toDate} />
				</div>
			</div>
		</CardContent>
	</Card>

	<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
		{#each userSpendingData as { user, spending }}
			<Card class="p-6">
				<div class="flex items-start justify-between mb-4">
					<div>
						<h3 class="font-semibold text-lg">
							{user.firstName} {user.lastName}
						</h3>
						<p class="text-sm text-muted-foreground">{user.email}</p>
					</div>
					<TrendingDown class="h-5 w-5 text-red-600" />
				</div>

				<div class="space-y-3">
					<div>
						<p class="text-sm text-muted-foreground">Total Spending</p>
						<p class="text-2xl font-bold text-red-600">
							-{formatAmount(spending.totalSpending, 'RON')}
						</p>
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Transactions</p>
						<p class="text-lg font-semibold">{spending.transactionCount}</p>
					</div>
					{#if Object.keys(spending.byCurrency).length > 0}
						<div class="pt-3 border-t">
							<p class="text-xs text-muted-foreground mb-2">By Currency:</p>
							<div class="space-y-1">
								{#each Object.entries(spending.byCurrency) as [currency, data]}
									<div class="flex justify-between text-sm">
										<span>{currency}:</span>
										<span class="font-medium">-{formatAmount(data.total, currency as Currency)}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}
					<Button
						variant="outline"
						class="w-full mt-4"
						onclick={() => goto(`/${tenantSlug}/banking/users/${user.id}`)}
					>
						View Details
					</Button>
				</div>
			</Card>
		{/each}
	</div>
</div>
