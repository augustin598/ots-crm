<script lang="ts">
	import type { PageData } from './$types';
	import { getBankAccounts, getBankConnectionUrl, disconnectBankAccount, syncTransactions, syncBankAccounts } from '$lib/remotes/banking.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Building2, Link2, RefreshCw, Trash2, AlertCircle } from '@lucide/svelte';
	import { page } from '$app/state';

	let { data }: { data: PageData } = $props();

	const tenantSlug = $derived(page.params.tenant);

	const accountsQuery = $derived(getBankAccounts());
	const accounts = $derived(accountsQuery.current || []);
	const loading = $derived(accountsQuery.loading);

	let connectingBank = $state<string | null>(null);
	let disconnectingAccount = $state<string | null>(null);
	let syncingAccount = $state<string | null>(null);
	let syncingBankAccounts = $state<string | null>(null);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);

	// Check URL params for success/error messages from OAuth callback
	$effect(() => {
		const urlParams = new URLSearchParams(window.location.search);
		const errorParam = urlParams.get('error');
		const successParam = urlParams.get('success');

		if (errorParam) {
			error = decodeURIComponent(errorParam);
			// Clear error from URL
			window.history.replaceState({}, '', window.location.pathname);
		}

		if (successParam) {
			success = successParam === 'connected' ? 'Bank account connected successfully!' : null;
			// Clear success from URL
			window.history.replaceState({}, '', window.location.pathname);
			// Refresh accounts to show newly connected account
			accountsQuery.refresh();
		}
	});

	async function handleConnectBank(bankName: string) {
		connectingBank = bankName;
		error = null;

		try {
			const connectionUrlQuery = await getBankConnectionUrl(bankName);
			const result = connectionUrlQuery;
			
			if (result?.authUrl) {
				// Redirect to bank's OAuth page
				window.location.href = result.authUrl;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to get authorization URL';
			connectingBank = null;
		}
	}

	async function handleDisconnect(accountId: string) {
		if (!confirm('Are you sure you want to disconnect this bank account? All associated transactions will be removed.')) {
			return;
		}

		disconnectingAccount = accountId;
		error = null;

		try {
			await disconnectBankAccount(accountId);
			await accountsQuery.refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to disconnect bank account';
		} finally {
			disconnectingAccount = null;
		}
	}

	async function handleSync(accountId: string) {
		syncingAccount = accountId;
		error = null;

		try {
			await syncTransactions({ bankAccountId: accountId });
			// Refresh accounts to get updated lastSyncedAt
			await accountsQuery.refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to sync transactions';
		} finally {
			syncingAccount = null;
		}
	}

	async function handleSyncBankAccounts(bankName: string) {
		syncingBankAccounts = bankName;
		error = null;

		try {
			await syncBankAccounts({ bankName });
			// Refresh accounts to get updated account list
			await accountsQuery.refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to sync accounts';
		} finally {
			syncingBankAccounts = null;
		}
	}

	function getBankDisplayName(bankName: string): string {
		switch (bankName) {
			case 'revolut':
				return 'Revolut';
			case 'transilvania':
				return 'Banca Transilvania';
			case 'bcr':
				return 'BCR';
			default:
				return bankName;
		}
	}

	function getBankIcon(bankName: string) {
		return Building2;
	}
</script>

<svelte:head>
	<title>Banking Connections - Settings</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-6">
		<h2 class="text-2xl font-bold">Banking Connections</h2>
		<p class="text-muted-foreground">Connect your bank accounts to automatically sync transactions and mark invoices as paid</p>
	</div>

	{#if error}
		<Card class="border-red-200 bg-red-50">
			<CardContent class="pt-6">
				<div class="flex items-center gap-2 text-red-800">
					<AlertCircle class="h-5 w-5" />
					<p>{error}</p>
				</div>
			</CardContent>
		</Card>
	{/if}

	{#if success}
		<Card class="border-green-200 bg-green-50">
			<CardContent class="pt-6">
				<div class="flex items-center gap-2 text-green-800">
					<p>{success}</p>
				</div>
			</CardContent>
		</Card>
	{/if}

	<Card>
		<CardHeader>
			<CardTitle>Available Banks</CardTitle>
			<CardDescription>Connect your accounts from supported banks</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{@const banks = ['revolut', 'transilvania', 'bcr']}
			{@const connectedBanks = accounts.map((acc) => acc.bankName)}
			
			{#each banks as bankName}
				{@const isConnected = connectedBanks.includes(bankName)}
				{@const isConnecting = connectingBank === bankName}
				{@const Icon = getBankIcon(bankName)}
				
				<div class="flex items-center justify-between rounded-lg border p-4">
					<div class="flex items-center gap-4">
						<div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
							<Icon class="h-6 w-6" />
						</div>
						<div>
							<h3 class="font-semibold">{getBankDisplayName(bankName)}</h3>
							<p class="text-sm text-muted-foreground">
								{#if isConnected}
									Connected
								{:else}
									Not connected
								{/if}
							</p>
						</div>
					</div>
					<div class="flex items-center gap-2">
						{#if isConnected}
							<Button
								variant="outline"
								size="sm"
								onclick={() => handleSyncBankAccounts(bankName)}
								disabled={syncingBankAccounts === bankName || loading}
							>
								{#if syncingBankAccounts === bankName}
									<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
									Syncing...
								{:else}
									<RefreshCw class="mr-2 h-4 w-4" />
									Sync Accounts
								{/if}
							</Button>
							<Badge variant="default">Connected</Badge>
						{:else}
							<Button
								onclick={() => handleConnectBank(bankName)}
								disabled={isConnecting || loading}
							>
								{#if isConnecting}
									<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
									Connecting...
								{:else}
									<Link2 class="mr-2 h-4 w-4" />
									Connect
								{/if}
							</Button>
						{/if}
					</div>
				</div>
			{/each}
		</CardContent>
	</Card>

	{#if accounts.length > 0}
		<Card>
			<CardHeader>
				<CardTitle>Connected Accounts</CardTitle>
				<CardDescription>Manage your connected bank accounts</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				{#each accounts as account}
					<div class="rounded-lg border p-4">
						<div class="flex items-start justify-between">
							<div class="flex-1">
								<div class="flex items-center gap-3">
									<h3 class="font-semibold">{account.accountName || getBankDisplayName(account.bankName)}</h3>
									<Badge variant={account.isActive ? 'default' : 'secondary'}>
										{account.isActive ? 'Active' : 'Inactive'}
									</Badge>
								</div>
								<p class="text-sm text-muted-foreground mt-1">
									{getBankDisplayName(account.bankName)} • {account.iban}
								</p>
								{#if account.lastSyncedAt}
									<p class="text-xs text-muted-foreground mt-1">
										Last synced: {new Date(account.lastSyncedAt).toLocaleString()}
									</p>
								{:else}
									<p class="text-xs text-muted-foreground mt-1">Never synced</p>
								{/if}
							</div>
							<div class="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onclick={() => handleSync(account.id)}
									disabled={syncingAccount === account.id}
								>
									{#if syncingAccount === account.id}
										<RefreshCw class="h-4 w-4 animate-spin" />
									{:else}
										<RefreshCw class="h-4 w-4" />
									{/if}
								</Button>
								<Button
									variant="destructive"
									size="sm"
									onclick={() => handleDisconnect(account.id)}
									disabled={disconnectingAccount === account.id}
								>
									{#if disconnectingAccount === account.id}
										<RefreshCw class="h-4 w-4 animate-spin" />
									{:else}
										<Trash2 class="h-4 w-4" />
									{/if}
								</Button>
							</div>
						</div>
					</div>
				{/each}
			</CardContent>
		</Card>
	{/if}
</div>
