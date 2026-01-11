<script lang="ts">
	import {
		getRevolutConfig,
		generateRevolutCertificate,
		updateRevolutConfig,
		deleteRevolutConfig
	} from '$lib/remotes/revolut.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Badge } from '$lib/components/ui/badge';
	import { Textarea } from '$lib/components/ui/textarea';
	import { CheckCircle2, XCircle, Copy, Trash2 } from '@lucide/svelte';
	import { page } from '$app/state';

	const tenantSlug = $derived(page.params.tenant);

	const configQuery = getRevolutConfig();
	const config = $derived(configQuery.current);
	const loading = $derived(configQuery.loading);

	let clientId = $state('');
	let redirectUri = $state('');
	let publicCertificate = $state('');
	let expectedRedirectUri = $derived(config?.expectedRedirectUri || '');
	let updating = $state(false);
	let generating = $state(false);
	let deleting = $state(false);
	let error = $state<string | null>(null);
	let success = $state(false);
	let copySuccess = $state(false);

	// Load config when available
	$effect(() => {
		if (config) {
			clientId = config.clientId || '';
			// Use stored redirectUri if available, otherwise use expected one
			redirectUri = config.redirectUri || config.expectedRedirectUri || '';
			publicCertificate = config.publicCertificate || '';
		}
	});

	async function handleGenerateCertificate() {
		generating = true;
		error = null;
		success = false;

		try {
			const result = await generateRevolutCertificate().updates(configQuery);
			publicCertificate = result.publicCertificate;
			success = true;
			setTimeout(() => {
				success = false;
			}, 3000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to generate certificate';
		} finally {
			generating = false;
		}
	}

	async function handleUpdateConfig() {
		if (!publicCertificate) {
			error = 'Please generate a certificate first';
			return;
		}

		updating = true;
		error = null;
		success = false;

		try {
			await updateRevolutConfig({
				clientId: clientId || undefined,
				redirectUri: redirectUri || undefined
			}).updates(configQuery);
			success = true;
			setTimeout(() => {
				success = false;
			}, 3000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update configuration';
		} finally {
			updating = false;
		}
	}

	async function handleDeleteConfig() {
		if (!confirm('Are you sure you want to delete the Revolut configuration? This will remove the certificate and all configuration.')) {
			return;
		}

		deleting = true;
		error = null;

		try {
			await deleteRevolutConfig().updates(configQuery);
			clientId = '';
			redirectUri = '';
			publicCertificate = '';
			success = true;
			setTimeout(() => {
				success = false;
			}, 3000);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to delete configuration';
		} finally {
			deleting = false;
		}
	}

	async function handleCopyCertificate() {
		if (!publicCertificate) return;

		try {
			await navigator.clipboard.writeText(publicCertificate);
			copySuccess = true;
			setTimeout(() => {
				copySuccess = false;
			}, 2000);
		} catch (e) {
			error = 'Failed to copy certificate to clipboard';
		}
	}
</script>

<svelte:head>
	<title>Revolut Configuration - Settings</title>
</svelte:head>

<p class="text-muted-foreground mb-6">
	Configure your Revolut Business API integration. Generate a certificate, upload it to Revolut Business app, then enter your Client ID and Redirect URI.
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
{:else if config?.isConfigured}
	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<CardTitle>Revolut Configuration</CardTitle>
					<Badge variant="default" class="gap-1">
						<CheckCircle2 class="h-3 w-3" />
						Configured
					</Badge>
				</div>
			</div>
			<CardDescription>Your Revolut API certificate and configuration</CardDescription>
		</CardHeader>
		<CardContent class="space-y-6">
			<div class="space-y-4">
				<div class="space-y-2">
					<Label for="publicCertificate">Public Certificate</Label>
					<div class="space-y-2">
						<Textarea
							id="publicCertificate"
							value={publicCertificate}
							readonly
							class="font-mono text-sm bg-muted min-h-[200px]"
							placeholder="Certificate will appear here after generation..."
						/>
						<div class="flex items-center gap-2">
							<Button variant="outline" size="sm" onclick={handleCopyCertificate} disabled={!publicCertificate}>
								<Copy class="h-4 w-4 mr-2" />
								{copySuccess ? 'Copied!' : 'Copy Certificate'}
							</Button>
							<p class="text-xs text-muted-foreground">
								Copy this certificate and upload it to Revolut Business app (APIs → Business API → Add API certificate)
							</p>
						</div>
					</div>
				</div>

				<Separator />

				<div class="space-y-4">
					<div class="space-y-2">
						<Label for="clientId">Client ID</Label>
						<Input
							id="clientId"
							type="text"
							bind:value={clientId}
							placeholder="Enter Client ID from Revolut Business app"
						/>
						<p class="text-xs text-muted-foreground">
							The Client ID is shown after you upload the certificate in Revolut Business app
						</p>
					</div>

					<div class="space-y-2">
						<Label for="redirectUri">Redirect URI</Label>
						<Input
							id="redirectUri"
							type="text"
							bind:value={redirectUri}
							placeholder={expectedRedirectUri}
						/>
						<p class="text-xs text-muted-foreground">
							Must match the redirect URI configured in Revolut Business app when you upload the certificate.
							Expected format: <code class="text-xs bg-muted px-1 py-0.5 rounded">{expectedRedirectUri}</code>
						</p>
					</div>
				</div>
			</div>

			<Separator />

			<div class="flex gap-2">
				<Button onclick={handleUpdateConfig} disabled={updating || !publicCertificate}>
					{updating ? 'Saving...' : 'Save Configuration'}
				</Button>
				<Button variant="outline" onclick={handleDeleteConfig} disabled={deleting}>
					{#if deleting}
						Deleting...
					{:else}
						<Trash2 class="h-4 w-4 mr-2" />
					{/if}
					Delete Configuration
				</Button>
			</div>

			{#if error}
				<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
					<p class="text-sm text-red-800 dark:text-red-200">{error}</p>
				</div>
			{/if}

			{#if success}
				<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
					<p class="text-sm text-green-800 dark:text-green-200">Configuration saved successfully!</p>
				</div>
			{/if}
		</CardContent>
	</Card>
{:else}
	<Card>
		<CardHeader>
			<div class="flex items-center gap-2">
				<CardTitle>Configure Revolut</CardTitle>
				<Badge variant="outline" class="gap-1">
					<XCircle class="h-3 w-3" />
					Not Configured
				</Badge>
			</div>
			<CardDescription>
				Generate a certificate for Revolut Business API integration. You'll need to upload the certificate to Revolut Business app and then enter your Client ID.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<div class="space-y-6">
				<div class="space-y-4">
					<div class="rounded-md bg-blue-50 dark:bg-blue-900/20 p-4">
						<h3 class="text-sm font-semibold mb-2">Setup Instructions</h3>
						<ol class="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
							<li>Click "Generate Certificate" below to create a new RSA key pair</li>
							<li>Copy the public certificate (the entire text including BEGIN/END markers)</li>
							<li>Go to Revolut Business app → APIs → Business API → Add API certificate</li>
							<li>Paste the certificate in the X509 public key field</li>
							<li>
								<strong>Important:</strong> Set the OAuth redirect URI to: <code class="text-xs bg-white dark:bg-gray-800 px-1 py-0.5 rounded">{expectedRedirectUri}</code>
							</li>
							<li>Click Continue and copy the Client ID shown</li>
							<li>Return here and enter the Client ID (Redirect URI is pre-filled)</li>
							<li>Click "Save Configuration"</li>
						</ol>
					</div>

					{#if publicCertificate}
						<div class="space-y-2">
							<Label for="publicCertificate">Public Certificate</Label>
							<div class="space-y-2">
								<Textarea
									id="publicCertificate"
									value={publicCertificate}
									readonly
									class="font-mono text-sm bg-muted min-h-[200px]"
								/>
								<div class="flex items-center gap-2">
									<Button variant="outline" size="sm" onclick={handleCopyCertificate}>
										<Copy class="h-4 w-4 mr-2" />
										{copySuccess ? 'Copied!' : 'Copy Certificate'}
									</Button>
								</div>
							</div>
						</div>

						<Separator />

						<div class="space-y-4">
							<div class="space-y-2">
								<Label for="clientId">Client ID</Label>
								<Input
									id="clientId"
									type="text"
									bind:value={clientId}
									placeholder="Enter Client ID from Revolut Business app"
								/>
								<p class="text-xs text-muted-foreground">
									The Client ID is shown after you upload the certificate in Revolut Business app
								</p>
							</div>

							<div class="space-y-2">
								<Label for="redirectUri">Redirect URI</Label>
								<Input
									id="redirectUri"
									type="text"
									bind:value={redirectUri}
									placeholder={expectedRedirectUri}
								/>
								<p class="text-xs text-muted-foreground">
									Must match the redirect URI configured in Revolut Business app when you upload the certificate.
									Expected format: <code class="text-xs bg-muted px-1 py-0.5 rounded">{expectedRedirectUri}</code>
								</p>
							</div>

							<Button onclick={handleUpdateConfig} disabled={updating || !publicCertificate}>
								{updating ? 'Saving...' : 'Save Configuration'}
							</Button>
						</div>
					{:else}
						<Button onclick={handleGenerateCertificate} disabled={generating}>
							{generating ? 'Generating...' : 'Generate Certificate'}
						</Button>
					{/if}
				</div>

				{#if error}
					<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
						<p class="text-sm text-red-800 dark:text-red-200">{error}</p>
					</div>
				{/if}

				{#if success}
					<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
						<p class="text-sm text-green-800 dark:text-green-200">
							{publicCertificate ? 'Certificate generated successfully! Copy it and upload to Revolut.' : 'Configuration saved successfully!'}
						</p>
					</div>
				{/if}
			</div>
		</CardContent>
	</Card>
{/if}
