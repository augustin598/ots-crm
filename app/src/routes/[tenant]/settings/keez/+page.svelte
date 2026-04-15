<script lang="ts">
	import {
		getKeezStatus,
		connectKeez,
		disconnectKeez,
		syncInvoicesFromKeez,
		importClientsFromKeez,
		getKeezSyncHistory
	} from '$lib/remotes/keez.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Badge } from '$lib/components/ui/badge';
	import { CheckCircle2, XCircle, Link as LinkIcon, Download, Upload, AlertTriangle } from '@lucide/svelte';
	import { page } from '$app/state';

	const tenantSlug = $derived(page.params.tenant);

	const statusQuery = getKeezStatus();
	const status = $derived(statusQuery.current);
	const loading = $derived(statusQuery.loading);

	const syncHistoryQuery = getKeezSyncHistory();
	const syncHistory = $derived(syncHistoryQuery.current ?? []);

	let clientEid = $state('');
	let applicationId = $state('');
	let secret = $state('');
	let connecting = $state(false);
	let disconnecting = $state(false);
	let error = $state<string | null>(null);
	let success = $state(false);

	const credentialsCorrupt = $derived(
		status?.connected && status?.credentialsValid === false
	);

	// Pre-fill fields when credentials are corrupt so user only needs to re-enter secret
	$effect(() => {
		if (credentialsCorrupt && status) {
			clientEid = status.clientEid || '';
			applicationId = status.applicationId || '';
		}
	});

	// Import states
	let importingClients = $state(false);
	let syncingInvoices = $state(false);
	let importResult = $state<{ imported: number; updated?: number; skipped: number } | null>(null);
	let importError = $state<string | null>(null);

	async function handleConnect() {
		if (!clientEid || !applicationId || !secret) {
			error = 'Client EID, Application ID, and Secret are required';
			return;
		}

		connecting = true;
		error = null;
		success = false;

		try {
			await connectKeez({ clientEid, applicationId, secret }).updates(statusQuery);
			clientEid = '';
			applicationId = '';
			secret = '';
			success = true;
			setTimeout(() => {
				success = false;
			}, 3000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to connect to Keez';
		} finally {
			connecting = false;
		}
	}

	async function handleDisconnect() {
		if (!confirm('Are you sure you want to disconnect Keez? This will stop automatic syncing.')) {
			return;
		}

		disconnecting = true;
		error = null;

		try {
			await disconnectKeez().updates(statusQuery);
			success = true;
			setTimeout(() => {
				success = false;
			}, 3000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to disconnect Keez';
		} finally {
			disconnecting = false;
		}
	}

	function formatDate(date: Date | string | null) {
		if (!date) return 'Never';
		return new Date(date).toLocaleString();
	}

	async function handleImportClients() {
		importingClients = true;
		importError = null;
		importResult = null;

		try {
			const result = await importClientsFromKeez({}).updates(getClients());

			if (result.success) {
				importResult = { imported: result.imported, updated: (result as any).updated || 0, skipped: result.skipped };
				success = true;
				setTimeout(() => {
					success = false;
					importResult = null;
				}, 5000);
			}
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Failed to import clients from Keez';
		} finally {
			importingClients = false;
		}
	}

	async function handleSyncInvoices() {
		syncingInvoices = true;
		importError = null;
		importResult = null;

		try {
			const invoicesQuery = getInvoices({});
			const result = await syncInvoicesFromKeez({}).updates(invoicesQuery);

			if (result.success) {
				importResult = { imported: result.imported, skipped: result.skipped };
				await invoicesQuery.refresh();
				success = true;
				setTimeout(() => {
					success = false;
					importResult = null;
				}, 5000);
			}
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Failed to sync invoices from Keez';
		} finally {
			syncingInvoices = false;
		}
	}
</script>

<p class="text-muted-foreground mb-6">
	Manage your Keez integration. Connect your account for automatic invoice syncing, or import clients and invoices from Keez.
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
{:else if credentialsCorrupt}
	<Card>
		<CardHeader>
			<div class="flex items-center gap-2">
				<CardTitle>Keez Connection</CardTitle>
				<Badge variant="destructive" class="gap-1">
					<AlertTriangle class="h-3 w-3" />
					Credentials Error
				</Badge>
			</div>
			<CardDescription>
				Your Keez credentials are corrupted and need to be re-saved. Please re-enter your secret below.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<div class="rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-4 mb-6">
				<div class="flex items-start gap-3">
					<AlertTriangle class="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
					<div>
						<p class="text-sm font-medium text-yellow-800 dark:text-yellow-200">
							Keez credentials need to be re-saved
						</p>
						<p class="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
							Your stored credentials could not be decrypted. This can happen after a server configuration change.
							Re-enter your Keez API secret to restore the connection. Your Client EID and Application ID have been pre-filled.
						</p>
					</div>
				</div>
			</div>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleConnect();
				}}
				class="space-y-6"
			>
				<div class="space-y-4">
					<div class="space-y-2">
						<Label for="clientEid">Client EID</Label>
						<Input
							id="clientEid"
							type="text"
							bind:value={clientEid}
							placeholder="Enter your Client EID"
							required
						/>
					</div>

					<div class="space-y-2">
						<Label for="applicationId">Application ID</Label>
						<Input
							id="applicationId"
							type="text"
							bind:value={applicationId}
							placeholder="Enter your Application ID"
							required
						/>
					</div>

					<div class="space-y-2">
						<Label for="secret">Secret</Label>
						<Input
							id="secret"
							type="password"
							bind:value={secret}
							placeholder="Re-enter your Keez API secret"
							required
						/>
						<p class="text-xs text-muted-foreground">
							Re-enter your Keez API secret to restore the connection
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
						<p class="text-sm text-green-800 dark:text-green-200">Credentials re-saved successfully!</p>
					</div>
				{/if}

				<div class="flex gap-2">
					<Button type="submit" disabled={connecting || !clientEid || !applicationId || !secret}>
						{connecting ? 'Reconnecting...' : 'Re-save Credentials'}
					</Button>
					<Button variant="outline" onclick={handleDisconnect} disabled={disconnecting}>
						{disconnecting ? 'Disconnecting...' : 'Disconnect'}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
{:else if status?.connected && status?.isActive}
	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<CardTitle>Keez Connection</CardTitle>
					<Badge variant="default" class="gap-1">
						<CheckCircle2 class="h-3 w-3" />
						Connected
					</Badge>
				</div>
			</div>
			<CardDescription>Your Keez account is connected and active</CardDescription>
		</CardHeader>
		<CardContent class="space-y-6">
			<div class="space-y-2">
				<Label>Client EID</Label>
				<Input type="text" value={status.clientEid || ''} disabled class="bg-muted" />
			</div>

			<div class="space-y-2">
				<Label>Application ID</Label>
				<Input type="text" value={status.applicationId || ''} disabled class="bg-muted" />
			</div>

			<div class="space-y-2">
				<Label>Last Sync</Label>
				<Input
					type="text"
					value={formatDate(status.lastSyncAt ?? null)}
					disabled
					class="bg-muted"
				/>
			</div>

			<Separator />

			<div class="space-y-6">
				<div class="space-y-4">
					<h3 class="text-lg font-semibold">Import from Keez</h3>
					<p class="text-sm text-muted-foreground">
						Import clients and invoices directly from your Keez account.
					</p>

					<div class="space-y-4">
						<div class="space-y-2">
							<Label>Import Clients</Label>
							<div class="space-y-2">
								<Button
									type="button"
									variant="default"
									onclick={handleImportClients}
									disabled={importingClients || syncingInvoices}
								>
									<Download class="h-4 w-4 mr-2" />
									{importingClients ? 'Importing...' : 'Import Clients from Keez'}
								</Button>
								<p class="text-xs text-muted-foreground">
									Import all clients/partners from your Keez account
								</p>
							</div>
						</div>

						<div class="space-y-2">
							<Label>Sync Invoices</Label>
							<div class="space-y-2">
								<Button
									type="button"
									variant="default"
									onclick={handleSyncInvoices}
									disabled={importingClients || syncingInvoices}
								>
									<Download class="h-4 w-4 mr-2" />
									{syncingInvoices ? 'Syncing...' : 'Sync Invoices from Keez'}
								</Button>
								<p class="text-xs text-muted-foreground">
									Import invoices from your Keez account. Existing invoices will be skipped.
								</p>
							</div>
						</div>
					</div>
				</div>

				<Separator />

				{#if syncHistory.length > 0}
					<div class="space-y-3">
						<h3 class="text-sm font-semibold">Sync History (last 20)</h3>
						<div class="rounded-md border overflow-hidden">
							<table class="w-full text-xs">
								<thead class="bg-muted">
									<tr>
										<th class="text-left p-2 font-medium">Invoice</th>
										<th class="text-left p-2 font-medium">Direction</th>
										<th class="text-left p-2 font-medium">Status</th>
										<th class="text-left p-2 font-medium">Last Synced</th>
									</tr>
								</thead>
								<tbody>
									{#each syncHistory as record}
										<tr class="border-t">
											<td class="p-2">{record.invoiceNumber || record.invoiceId}</td>
											<td class="p-2">
												{#if record.syncDirection === 'push'}↑ Push{:else if record.syncDirection === 'pull'}↓ Pull{:else}↕ Both{/if}
											</td>
											<td class="p-2">
												{#if record.syncStatus === 'synced'}
													<span class="text-green-600 dark:text-green-400">✓ Synced</span>
												{:else if record.syncStatus === 'error'}
													<span class="text-red-600 dark:text-red-400" title={record.errorMessage || ''}>✗ Error</span>
												{:else}
													<span class="text-yellow-600">⏳ Pending</span>
												{/if}
											</td>
											<td class="p-2 text-muted-foreground">
												{record.lastSyncedAt ? new Date(record.lastSyncedAt).toLocaleString() : '—'}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>

					<Separator />
				{/if}

				<div class="flex gap-2">
					<Button variant="outline" onclick={handleDisconnect} disabled={disconnecting}>
						{disconnecting ? 'Disconnecting...' : 'Disconnect'}
					</Button>
					<Button variant="outline" href="/{tenantSlug}/settings/invoices">
						<LinkIcon class="h-4 w-4 mr-2" />
						Invoice Settings
					</Button>
				</div>
			</div>

			{#if error || importError}
				<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
					<p class="text-sm text-red-800 dark:text-red-200">{error || importError}</p>
				</div>
			{/if}

			{#if success && importResult}
				<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
					<p class="text-sm text-green-800 dark:text-green-200">
						Successfully imported {importResult.imported} item{importResult.imported === 1 ? '' : 's'}{importResult.updated && importResult.updated > 0 ? `, ${importResult.updated} updated` : ''}{importResult.skipped > 0 ? `, ${importResult.skipped} skipped` : ''}!
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
				<CardTitle>Connect Keez</CardTitle>
				<Badge variant="outline" class="gap-1">
					<XCircle class="h-3 w-3" />
					Not Connected
				</Badge>
			</div>
			<CardDescription>
				Enter your Keez API credentials to connect your account. You can find these in your Keez account settings.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleConnect();
				}}
				class="space-y-6"
			>
				<div class="space-y-4">
					<div class="space-y-2">
						<Label for="clientEid">Client EID</Label>
						<Input
							id="clientEid"
							type="text"
							bind:value={clientEid}
							placeholder="Enter your Client EID"
							required
						/>
						<p class="text-xs text-muted-foreground">
							The unique identifier for your company in Keez
						</p>
					</div>

					<div class="space-y-2">
						<Label for="applicationId">Application ID</Label>
						<Input
							id="applicationId"
							type="text"
							bind:value={applicationId}
							placeholder="Enter your Application ID"
							required
						/>
						<p class="text-xs text-muted-foreground">
							The identifier for your application in Keez
						</p>
					</div>

					<div class="space-y-2">
						<Label for="secret">Secret</Label>
						<Input
							id="secret"
							type="password"
							bind:value={secret}
							placeholder="Enter your Keez API secret"
							required
						/>
						<p class="text-xs text-muted-foreground">
							Your Keez API secret (password) provided by Keez
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

				<Button type="submit" disabled={connecting || !clientEid || !applicationId || !secret}>
					{connecting ? 'Connecting...' : 'Connect Keez'}
				</Button>
			</form>
		</CardContent>
	</Card>
{/if}
