<script lang="ts">
	import {
		getAnafSpvStatus,
		saveAnafSpvCredentials,
		getAnafSpvAuthUrl,
		connectAnafSpvWithOAuth,
		disconnectAnafSpv,
		syncInvoicesFromSpv,
		syncSentInvoicesFromSpv
	} from '$lib/remotes/anaf-spv.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Badge } from '$lib/components/ui/badge';
	import { CheckCircle2, XCircle, Download, ExternalLink } from '@lucide/svelte';
	import { page } from '$app/state';
	import { untrack } from 'svelte';

	const tenantSlug = $derived(page.params.tenant);

	const statusQuery = $derived(getAnafSpvStatus());
	const status = $derived(statusQuery.current);
	const loading = $derived(statusQuery.loading);

	$inspect('status', status);

	let connecting = $state(false);
	let disconnecting = $state(false);
	let error = $state<string | null>(null);
	let success = $state(false);

	// Client credentials (for first-time setup)
	let clientId = $state('');
	let clientSecret = $state('');
	let showingCredentials = $state(false);
	const hasCredentials = $derived(status?.hasCredentials ?? false);

	// Sync states
	let syncing = $state(false);
	let syncFilter = $state<'P' | 'T' | 'both'>('P');
	let syncDays = $state(60);
	let syncResult = $state<{ imported: number; updated: number; skipped: number; errors: number } | null>(null);

	// Handle OAuth callback from URL parameters
	$effect(() => {
		const urlParams = new URLSearchParams(window.location.search);
		const code = urlParams.get('code');
		const state = urlParams.get('state');
		const errorParam = urlParams.get('error');
		if (errorParam) {
			error = decodeURIComponent(errorParam);
			// Clear error from URL
			window.history.replaceState({}, '', window.location.pathname);
		}

		if (code && state) {
			untrack(() => {
				handleOAuthCallback(code, state);
			});
		}
	});

	async function handleOAuthCallback(code: string, state: string) {
		connecting = true;
		error = null;
		success = false;

		try {
			// Connect using stored credentials (no need to pass them)
			const result = await connectAnafSpvWithOAuth({
				code,
				state
			}).updates(statusQuery);
			console.log('result', result);
			success = true;
			// Clear code from URL
			window.history.replaceState({}, '', window.location.pathname);
			setTimeout(() => {
				success = false;
			}, 3000);
		} catch (e) {
			console.error('error', e);
			error = e instanceof Error ? e.message : 'Failed to connect to ANAF SPV';
		} finally {
			connecting = false;
		}
	}

	async function handleConnect() {
		// If credentials are not already saved, we need them in the form
		if (!hasCredentials) {
			if (!clientId || !clientSecret) {
				error = 'Client ID and Secret are required';
				showingCredentials = true;
				return;
			}
		}

		connecting = true;
		error = null;
		success = false;

		try {
			// Only save credentials if they're not already saved
			if (!hasCredentials) {
				await saveAnafSpvCredentials({
					clientId,
					clientSecret
				});
				// Clear credentials from form (they're now stored)
				clientId = '';
				clientSecret = '';
				showingCredentials = false;
			}

			// Get authorization URL (uses stored credentials)
			const authUrlQuery = await getAnafSpvAuthUrl();
			const result = authUrlQuery;
			console.log('result', result);
			if (result?.authUrl) {
				// Redirect to ANAF authorization page
				window.open(result.authUrl, '_blank');
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to connect to ANAF SPV';
			connecting = false;
		}
	}

	async function handleDisconnect() {
		if (!confirm('Are you sure you want to disconnect ANAF SPV? This will stop automatic syncing.')) {
			return;
		}

		disconnecting = true;
		error = null;

		try {
			await disconnectAnafSpv().updates(statusQuery);
			success = true;
			setTimeout(() => {
				success = false;
			}, 3000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to disconnect ANAF SPV';
		} finally {
			disconnecting = false;
		}
	}

	async function handleSync() {
		syncing = true;
		error = null;
		syncResult = null;

		try {
			if (syncFilter === 'both') {
				// Sync both received and sent invoices
				const [receivedResult, sentResult] = await Promise.all([
					syncInvoicesFromSpv({
						filter: 'P',
						days: syncDays
					}),
					syncSentInvoicesFromSpv({
						days: syncDays
					})
				]);
				
				syncResult = {
					imported: receivedResult.imported + sentResult.imported,
					updated: receivedResult.updated + sentResult.updated,
					skipped: receivedResult.skipped + sentResult.skipped,
					errors: receivedResult.errors + sentResult.errors
				};
			} else if (syncFilter === 'T') {
				// Sync only sent invoices
				const result = await syncSentInvoicesFromSpv({
					days: syncDays
				});
				syncResult = {
					imported: result.imported,
					updated: result.updated,
					skipped: result.skipped,
					errors: result.errors
				};
			} else {
				// Sync only received invoices (default 'P')
				const result = await syncInvoicesFromSpv({
					filter: 'P',
					days: syncDays
				});
				syncResult = {
					imported: result.imported,
					updated: result.updated || 0,
					skipped: result.skipped,
					errors: result.errors
				};
			}
			
			success = true;
			setTimeout(() => {
				success = false;
				syncResult = null;
			}, 5000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to sync invoices';
		} finally {
			syncing = false;
		}
	}

	function formatDate(date: Date | string | null) {
		if (!date) return 'Never';
		return new Date(date).toLocaleString();
	}
</script>

<p class="text-muted-foreground mb-6">
	Manage your ANAF SPV (Sistemul Privat Virtual) integration for Romanian e-factura. Connect your account to
	sync invoices from suppliers and upload invoices to SPV.
</p>

{#if loading}
	<Card>
		<CardContent class="p-6">
			<div class="animate-pulse space-y-4">
				<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
				<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
			</div>
		</CardContent>
	</Card>
{:else if status?.connected && status?.isActive}
	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<CardTitle>ANAF SPV Connection</CardTitle>
					<Badge variant="default" class="gap-1">
						<CheckCircle2 class="h-3 w-3" />
						Connected
					</Badge>
				</div>
			</div>
			<CardDescription>Your ANAF SPV account is connected and active</CardDescription>
		</CardHeader>
		<CardContent class="space-y-6">
			<div class="space-y-2">
				<Label>Last Sync</Label>
				<Input
					type="text"
					value={formatDate(status.lastSyncAt ?? null)}
					disabled
					class="bg-muted"
				/>
			</div>

			{#if status.expiresAt}
				<div class="space-y-2">
					<Label>Token Expires</Label>
					<Input
						type="text"
						value={formatDate(status.expiresAt ?? null)}
						disabled
						class="bg-muted"
					/>
				</div>
			{/if}

			<Separator />

			<div class="space-y-6">
				<div class="space-y-4">
					<h3 class="text-lg font-semibold">Sync Invoices from SPV</h3>
					<p class="text-sm text-muted-foreground">
						Download invoices from ANAF SPV. Choose to sync received invoices (creates expenses & suppliers),
						sent invoices (creates invoices & clients), or both. Client and supplier data is automatically
						updated with latest information from each invoice.
					</p>

					<div class="space-y-4">
						<div class="space-y-2">
							<Label for="syncFilter">Invoice Type</Label>
							<select
								id="syncFilter"
								bind:value={syncFilter}
								disabled={syncing}
								class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<option value="P">From Suppliers (Received) - Creates Expenses</option>
								<option value="T">Sent Invoices - Creates Invoices & Clients</option>
								<option value="both">Both (Received & Sent)</option>
							</select>
						</div>

						<div class="space-y-2">
							<Label for="syncDays">Days to Look Back</Label>
							<Input
								id="syncDays"
								type="number"
								bind:value={syncDays}
								min="1"
								max="365"
								disabled={syncing}
							/>
							<p class="text-xs text-muted-foreground">
								Number of days to look back when syncing invoices (default: 60)
							</p>
						</div>

						<Button
							type="button"
							variant="default"
							onclick={handleSync}
							disabled={syncing || !status?.connected}
						>
							<Download class="h-4 w-4 mr-2" />
							{syncing ? 'Syncing...' : 'Sync Invoices'}
						</Button>
					</div>
				</div>

				<Separator />

				<div class="flex gap-2">
					<Button variant="outline" onclick={handleDisconnect} disabled={disconnecting}>
						{disconnecting ? 'Disconnecting...' : 'Disconnect'}
					</Button>
				</div>
			</div>

			{#if error}
				<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
					<p class="text-sm text-red-800 dark:text-red-200">{error}</p>
				</div>
			{/if}

			{#if success && syncResult}
				<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
					<p class="text-sm text-green-800 dark:text-green-200">
						Successfully synced: {syncResult.imported} new, {syncResult.updated} updated
						{syncResult.skipped > 0 ? `, ${syncResult.skipped} skipped` : ''}
						{syncResult.errors > 0 ? `, ${syncResult.errors} error${syncResult.errors === 1 ? '' : 's'}` : ''}!
					</p>
				</div>
			{:else if success}
				<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
					<p class="text-sm text-green-800 dark:text-green-200">Disconnected successfully!</p>
				</div>
			{/if}
		</CardContent>
	</Card>
{:else}
	<Card>
		<CardHeader>
			<div class="flex items-center gap-2">
				<CardTitle>Connect ANAF SPV</CardTitle>
				<Badge variant="outline" class="gap-1">
					<XCircle class="h-3 w-3" />
					Not Connected
				</Badge>
			</div>
			<CardDescription>
				Connect your ANAF SPV account using OAuth. You'll need to register an OAuth application with ANAF
				and provide your Client ID and Secret.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<div class="space-y-6">
				{#if !hasCredentials && !showingCredentials}
					<div class="space-y-4">
						<p class="text-sm text-muted-foreground">
							To connect ANAF SPV, you need to register an OAuth application with ANAF and obtain
							your Client ID and Secret. Once you have these credentials, click the button below to
							enter them and start the OAuth flow.
						</p>
						<Button type="button" variant="outline" onclick={() => (showingCredentials = true)}>
							Enter Client Credentials
						</Button>
					</div>
				{:else if hasCredentials && !showingCredentials}
					<div class="space-y-4">
						<p class="text-sm text-muted-foreground">
							Client credentials are already configured. Click the button below to connect with ANAF.
						</p>
						<Button type="button" variant="default" onclick={handleConnect} disabled={connecting}>
							{connecting ? 'Connecting...' : 'Connect with ANAF'}
							{#if !connecting}
								<ExternalLink class="h-4 w-4 ml-2" />
							{/if}
						</Button>
						<Button
							type="button"
							variant="outline"
							onclick={() => (showingCredentials = true)}
							class="ml-2"
						>
							Update Credentials
						</Button>
					</div>
				{:else}
					<form
						onsubmit={(e) => {
							e.preventDefault();
							handleConnect();
						}}
						class="space-y-6"
					>
						<div class="space-y-4">
							<div class="space-y-2">
								<Label for="clientId">Client ID</Label>
								<Input
									id="clientId"
									type="text"
									bind:value={clientId}
									placeholder="Enter your ANAF OAuth Client ID"
									required
								/>
								<p class="text-xs text-muted-foreground">
									Your OAuth Client ID from ANAF application registration
								</p>
							</div>

							<div class="space-y-2">
								<Label for="clientSecret">Client Secret</Label>
								<Input
									id="clientSecret"
									type="password"
									bind:value={clientSecret}
									placeholder="Enter your ANAF OAuth Client Secret"
									required
								/>
								<p class="text-xs text-muted-foreground">
									Your OAuth Client Secret from ANAF application registration
								</p>
							</div>
						</div>

						{#if error}
							<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
								<p class="text-sm text-red-800 dark:text-red-200">{error}</p>
							</div>
						{/if}

						{#if success}
							<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
								<p class="text-sm text-green-800 dark:text-green-200">Connected successfully!</p>
							</div>
						{/if}

						<div class="flex gap-2">
							<Button type="submit" disabled={connecting || !clientId || !clientSecret}>
								{connecting ? 'Connecting...' : 'Connect with ANAF'}
								{#if !connecting}
									<ExternalLink class="h-4 w-4 ml-2" />
								{/if}
							</Button>
							<Button
								type="button"
								variant="outline"
								onclick={() => {
									showingCredentials = false;
									clientId = '';
									clientSecret = '';
									error = null;
								}}
							>
								Cancel
							</Button>
						</div>
					</form>
				{/if}
			</div>
		</CardContent>
	</Card>
{/if}
