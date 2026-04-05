<script lang="ts">
	import { getClientAccountBudgets } from '$lib/remotes/budget.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { page } from '$app/state';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import AccountBudgetRow from './AccountBudgetRow.svelte';
	import MetaIcon from '@lucide/svelte/icons/facebook';
	import TikTokIcon from '@lucide/svelte/icons/video';
	import GoogleIcon from '@lucide/svelte/icons/search';

	const clientId = $derived(page.params.clientId as string);

	// Lazy query — re-fetch only budget data on save
	let budgetQuery = $state<ReturnType<typeof getClientAccountBudgets> | null>(null);
	$effect(() => {
		if (clientId) {
			budgetQuery = getClientAccountBudgets({ clientId });
		}
	});
	const data = $derived(budgetQuery?.current);

	function refresh() {
		budgetQuery = getClientAccountBudgets({ clientId });
	}
</script>

<div class="space-y-6">
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<WalletIcon class="h-5 w-5" />
				Configurare Buget Publicitate
			</CardTitle>
			<CardDescription>
				Setează bugetele lunare alocate pentru fiecare cont de publicitate conectat. Consumul este calculat automat pentru luna curentă.
			</CardDescription>
		</CardHeader>
	</Card>

	{#if budgetQuery?.loading && !data}
		<div class="space-y-4">
			{#each Array(3) as _}
				<Card class="animate-pulse">
					<CardHeader><div class="h-6 w-32 bg-muted rounded"></div></CardHeader>
					<CardContent><div class="h-20 bg-muted rounded"></div></CardContent>
				</Card>
			{/each}
		</div>
	{:else if data}
		<!-- Meta Ads -->
		{#if data.meta.length > 0}
			<Card>
				<CardHeader>
					<CardTitle class="flex items-center gap-2 text-blue-600">
						<MetaIcon class="h-5 w-5" />
						Meta Ads (Facebook)
					</CardTitle>
				</CardHeader>
				<CardContent class="space-y-4">
					{#each data.meta as account (account.id)}
						<AccountBudgetRow {account} platform="meta" {clientId} onUpdated={refresh} />
					{/each}
				</CardContent>
			</Card>
		{/if}

		<!-- TikTok Ads -->
		{#if data.tiktok.length > 0}
			<Card>
				<CardHeader>
					<CardTitle class="flex items-center gap-2 text-pink-600">
						<TikTokIcon class="h-5 w-5" />
						TikTok Ads
					</CardTitle>
				</CardHeader>
				<CardContent class="space-y-4">
					{#each data.tiktok as account (account.id)}
						<AccountBudgetRow {account} platform="tiktok" {clientId} onUpdated={refresh} />
					{/each}
				</CardContent>
			</Card>
		{/if}

		<!-- Google Ads -->
		{#if data.google.length > 0}
			<Card>
				<CardHeader>
					<CardTitle class="flex items-center gap-2">
						<GoogleIcon class="h-5 w-5" />
						Google Ads
					</CardTitle>
				</CardHeader>
				<CardContent class="space-y-4">
					{#each data.google as account (account.id)}
						<AccountBudgetRow {account} platform="google" {clientId} onUpdated={refresh} />
					{/each}
				</CardContent>
			</Card>
		{/if}

		{#if data.meta.length === 0 && data.tiktok.length === 0 && data.google.length === 0}
			<Card>
				<CardContent class="py-10 text-center">
					<p class="text-muted-foreground">Niciun cont de publicitate conectat pentru acest client.</p>
				</CardContent>
			</Card>
		{/if}
	{/if}
</div>
