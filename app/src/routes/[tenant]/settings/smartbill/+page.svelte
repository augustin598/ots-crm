<script lang="ts">
	import { getSmartBillStatus, connectSmartBill, disconnectSmartBill } from '$lib/remotes/smartbill.remote';
	import { importClientsFromExcel, importInvoicesFromExcel } from '$lib/remotes/smartbill-import.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Badge } from '$lib/components/ui/badge';
	import { CheckCircle2, XCircle, Link as LinkIcon, Upload } from '@lucide/svelte';
	import { page } from '$app/state';

	const tenantSlug = $derived(page.params.tenant);

	const statusQuery = getSmartBillStatus();
	const status = $derived(statusQuery.current);
	const loading = $derived(statusQuery.loading);

	let email = $state('');
	let token = $state('');
	let connecting = $state(false);
	let disconnecting = $state(false);
	let error = $state<string | null>(null);
	let success = $state(false);

	// Import states
	let importingClients = $state(false);
	let importingInvoices = $state(false);
	let clientsFile: File | null = $state(null);
	let invoicesFile: File | null = $state(null);
	let clientsFileInput: HTMLInputElement | null = $state(null);
	let invoicesFileInput: HTMLInputElement | null = $state(null);
	let importResult = $state<{ imported: number; skipped: number } | null>(null);
	let importError = $state<string | null>(null);

	async function handleConnect() {
		if (!email || !token) {
			error = 'Email and token are required';
			return;
		}

		connecting = true;
		error = null;
		success = false;

		try {
			await connectSmartBill({ email, token }).updates(statusQuery);
			email = '';
			token = '';
			success = true;
			setTimeout(() => {
				success = false;
			}, 3000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to connect to SmartBill';
		} finally {
			connecting = false;
		}
	}

	async function handleDisconnect() {
		if (!confirm('Are you sure you want to disconnect SmartBill? This will stop automatic syncing.')) {
			return;
		}

		disconnecting = true;
		error = null;

		try {
			await disconnectSmartBill().updates(statusQuery);
			success = true;
			setTimeout(() => {
				success = false;
			}, 3000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to disconnect SmartBill';
		} finally {
			disconnecting = false;
		}
	}

	function formatDate(date: Date | string | null) {
		if (!date) return 'Never';
		return new Date(date).toLocaleString();
	}

	async function handleFileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				resolve(result);
			};
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
	}

	async function handleImportClients() {
		if (!clientsFile) {
			importError = 'Please select a clients Excel file';
			return;
		}

		if (!clientsFile.name.match(/\.(xls|xlsx)$/i)) {
			importError = 'Please select an Excel file (.xls or .xlsx)';
			return;
		}

		importingClients = true;
		importError = null;
		importResult = null;

		try {
			const fileData = await handleFileToBase64(clientsFile);
			const result = await importClientsFromExcel({
				fileData,
				fileName: clientsFile.name
			}).updates(getClients());

			if (result.success) {
				importResult = { imported: result.imported, skipped: result.skipped };
				success = true;
				clearClientsFile();
				setTimeout(() => {
					success = false;
					importResult = null;
				}, 5000);
			}
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Failed to import clients';
		} finally {
			importingClients = false;
		}
	}

	async function handleImportInvoices() {
		if (!invoicesFile) {
			importError = 'Please select an invoices Excel file';
			return;
		}

		if (!invoicesFile.name.match(/\.(xls|xlsx)$/i)) {
			importError = 'Please select an Excel file (.xls or .xlsx)';
			return;
		}

		importingInvoices = true;
		importError = null;
		importResult = null;

		try {
			const fileData = await handleFileToBase64(invoicesFile);
			const result = await importInvoicesFromExcel({
				fileData,
				fileName: invoicesFile.name
			}).updates(getInvoices({}));

			if (result.success) {
				importResult = { imported: result.imported, skipped: result.skipped };
				success = true;
				clearInvoicesFile();
				setTimeout(() => {
					success = false;
					importResult = null;
				}, 5000);
			}
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Failed to import invoices';
		} finally {
			importingInvoices = false;
		}
	}

	function handleClientsFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = target.files;
		if (files && files.length > 0) {
			clientsFile = files[0];
			importError = null;
		}
	}

	function handleInvoicesFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = target.files;
		if (files && files.length > 0) {
			invoicesFile = files[0];
			importError = null;
		}
	}

	function clearClientsFile() {
		clientsFile = null;
		if (clientsFileInput) {
			clientsFileInput.value = '';
		}
	}

	function clearInvoicesFile() {
		invoicesFile = null;
		if (invoicesFileInput) {
			invoicesFileInput.value = '';
		}
	}
</script>

<p class="text-muted-foreground mb-6">
	Manage your SmartBill integration. Connect your account for automatic invoice syncing, or import clients and invoices from SmartBill Excel exports.
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
					<CardTitle>SmartBill Connection</CardTitle>
					<Badge variant="default" class="gap-1">
						<CheckCircle2 class="h-3 w-3" />
						Connected
					</Badge>
				</div>
			</div>
			<CardDescription>Your SmartBill account is connected and active</CardDescription>
		</CardHeader>
		<CardContent class="space-y-6">
			<div class="space-y-2">
				<Label>Email</Label>
				<Input type="email" value={status.email || ''} disabled class="bg-muted" />
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
					<h3 class="text-lg font-semibold">Import from SmartBill Excel</h3>
					<p class="text-sm text-muted-foreground">
						Import clients and invoices from SmartBill Excel export files. Files should be in the
						format exported by SmartBill.
					</p>

					<div class="space-y-4">
						<div class="space-y-2">
							<Label for="clientsFile">Import Clients</Label>
							<div class="space-y-2">
								<input
									id="clientsFile"
									type="file"
									accept=".xls,.xlsx"
									onchange={handleClientsFileSelect}
									disabled={importingClients || importingInvoices}
									bind:this={clientsFileInput}
									class="hidden"
								/>
								<div class="flex gap-2">
									<Button
										type="button"
										variant="outline"
										onclick={() => clientsFileInput?.click()}
										disabled={importingClients || importingInvoices}
									>
										{clientsFile ? clientsFile.name : 'Select Clients File'}
									</Button>
									{#if clientsFile}
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onclick={clearClientsFile}
											disabled={importingClients || importingInvoices}
										>
											×
										</Button>
									{/if}
									<Button
										type="button"
										variant="default"
										onclick={handleImportClients}
										disabled={!clientsFile || importingClients || importingInvoices}
									>
										<Upload class="h-4 w-4 mr-2" />
										{importingClients ? 'Importing...' : 'Import Clients'}
									</Button>
								</div>
								<p class="text-xs text-muted-foreground">
									Upload an Excel file exported from SmartBill with client data
								</p>
							</div>
						</div>

						<div class="space-y-2">
							<Label for="invoicesFile">Import Invoices</Label>
							<div class="space-y-2">
								<input
									id="invoicesFile"
									type="file"
									accept=".xls,.xlsx"
									onchange={handleInvoicesFileSelect}
									disabled={importingClients || importingInvoices}
									bind:this={invoicesFileInput}
									class="hidden"
								/>
								<div class="flex gap-2">
									<Button
										type="button"
										variant="outline"
										onclick={() => invoicesFileInput?.click()}
										disabled={importingClients || importingInvoices}
									>
										{invoicesFile ? invoicesFile.name : 'Select Invoices File'}
									</Button>
									{#if invoicesFile}
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onclick={clearInvoicesFile}
											disabled={importingClients || importingInvoices}
										>
											×
										</Button>
									{/if}
									<Button
										type="button"
										variant="default"
										onclick={handleImportInvoices}
										disabled={!invoicesFile || importingClients || importingInvoices}
									>
										<Upload class="h-4 w-4 mr-2" />
										{importingInvoices ? 'Importing...' : 'Import Invoices'}
									</Button>
								</div>
								<p class="text-xs text-muted-foreground">
									Upload an Excel file exported from SmartBill with invoice data
								</p>
							</div>
						</div>
					</div>
				</div>

				<Separator />

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
						Successfully imported {importResult.imported} item{importResult.imported === 1 ? '' : 's'}{importResult.skipped > 0 ? `, ${importResult.skipped} skipped` : ''}!
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
				<CardTitle>Connect SmartBill</CardTitle>
				<Badge variant="outline" class="gap-1">
					<XCircle class="h-3 w-3" />
					Not Connected
				</Badge>
			</div>
			<CardDescription>
				Enter your SmartBill credentials to connect your account. Your API token can be found in SmartBill Cloud under Contul Meu > Integrari.
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
						<Label for="email">Email Address</Label>
						<Input
							id="email"
							type="email"
							bind:value={email}
							placeholder="your-email@example.com"
							required
						/>
						<p class="text-xs text-muted-foreground">
							The email address you use to log in to SmartBill
						</p>
					</div>

					<div class="space-y-2">
						<Label for="token">API Token</Label>
						<Input
							id="token"
							type="password"
							bind:value={token}
							placeholder="Enter your SmartBill API token"
							required
						/>
						<p class="text-xs text-muted-foreground">
							Find your API token in SmartBill Cloud: Contul Meu > Integrari
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

				<Button type="submit" disabled={connecting || !email || !token}>
					{connecting ? 'Connecting...' : 'Connect SmartBill'}
				</Button>
			</form>
		</CardContent>
	</Card>
{/if}
