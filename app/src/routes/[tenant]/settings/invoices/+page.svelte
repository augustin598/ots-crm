<script lang="ts">
	import { getInvoiceSettings, updateInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Receipt } from '@lucide/svelte';
	import { CURRENCIES, type Currency } from '$lib/utils/currency';
	import { page } from '$app/state';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const activePlugins = $derived(data?.activePlugins || []);
	const tenantSlug = $derived(page.params.tenant);

	const settingsQuery = getInvoiceSettings();
	const settings = $derived(settingsQuery.current);
	const loading = $derived(settingsQuery.loading);
	const error = $derived(settingsQuery.error);

	const isSmartBillActive = $derived(activePlugins.includes('smartbill'));
	const isKeezActive = $derived(activePlugins.includes('keez'));

	let smartbillSeries = $state(settings?.smartbillSeries || '');
	let smartbillStartNumber = $state(settings?.smartbillStartNumber || '');
	let smartbillAutoSync = $state(settings?.smartbillAutoSync || false);
	let keezSeries = $state(settings?.keezSeries || '');
	let keezStartNumber = $state(settings?.keezStartNumber || '');
	let keezAutoSync = $state(settings?.keezAutoSync || false);
	let defaultCurrency = $state<Currency>((settings?.defaultCurrency || 'RON') as Currency);
	let invoiceEmailsEnabled = $state(settings?.invoiceEmailsEnabled ?? true);
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let saveSuccess = $state(false);

	// Update local state when settings load
	$effect(() => {
		if (settings) {
			smartbillSeries = settings.smartbillSeries || '';
			smartbillStartNumber = settings.smartbillStartNumber || '';
			smartbillAutoSync = settings.smartbillAutoSync || false;
			keezSeries = settings.keezSeries || '';
			keezStartNumber = settings.keezStartNumber || '';
			keezAutoSync = settings.keezAutoSync || false;
			defaultCurrency = (settings.defaultCurrency || 'RON') as Currency;
			invoiceEmailsEnabled = settings.invoiceEmailsEnabled ?? true;
		}
	});

	async function handleSubmit() {
		saving = true;
		saveError = null;
		saveSuccess = false;

		try {
			await updateInvoiceSettings({
				smartbillSeries: smartbillSeries || undefined,
				smartbillStartNumber: smartbillStartNumber || undefined,
				smartbillAutoSync,
				keezSeries: keezSeries || undefined,
				keezStartNumber: keezStartNumber || undefined,
				keezAutoSync,
				defaultCurrency: defaultCurrency || undefined,
				invoiceEmailsEnabled
			}).updates(settingsQuery);
			saveSuccess = true;
			setTimeout(() => {
				saveSuccess = false;
			}, 3000);
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Failed to update invoice settings';
		} finally {
			saving = false;
		}
	}
</script>

{#if !isSmartBillActive && !isKeezActive}
	<Card>
		<CardHeader>
			<CardTitle>Invoice Settings</CardTitle>
			<CardDescription>Configure invoice settings for your integrations</CardDescription>
		</CardHeader>
		<CardContent>
			<p class="text-muted-foreground">
				No invoice integration plugins are currently enabled. Please enable SmartBill or Keez plugins in the{' '}
				<a href="/{tenantSlug}/settings/plugins" class="text-primary underline">Plugins settings</a> to
				configure invoice settings.
			</p>
		</CardContent>
	</Card>
{:else}
	<p class="text-muted-foreground mb-6">
		Configure invoice settings for your enabled integrations. Set the invoice series and starting number for
		automatic syncing.
	</p>

	{#if loading}
		<Card>
			<CardContent class="pt-6">
				<div class="space-y-4">
					<div class="animate-pulse space-y-4">
						<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
						<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
					</div>
				</div>
			</CardContent>
		</Card>
	{:else}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
			class="space-y-6"
		>
			{#if isSmartBillActive}
				<Card>
					<CardHeader>
						<CardTitle>SmartBill Invoice Settings</CardTitle>
						<CardDescription>Configure how invoices are synced with SmartBill</CardDescription>
					</CardHeader>
					<CardContent class="space-y-4">
						<div class="space-y-2">
							<Label for="smartbillSeries">SmartBill Invoice Series</Label>
							<Input
								id="smartbillSeries"
								bind:value={smartbillSeries}
								type="text"
								placeholder="e.g., FAC"
								maxlength={10}
							/>
							<p class="text-xs text-muted-foreground">
								The invoice series name used in SmartBill (e.g., "FAC", "FT", "F")
							</p>
						</div>

						<div class="space-y-2">
							<Label for="smartbillStartNumber">Starting Invoice Number</Label>
							<Input
								id="smartbillStartNumber"
								bind:value={smartbillStartNumber}
								type="text"
								placeholder="e.g., 0001"
								maxlength={20}
							/>
							<p class="text-xs text-muted-foreground">
								The starting invoice number for iteration (e.g., "0001", "001"). Numbers will be
								incremented automatically.
							</p>
						</div>

						{#if settings?.smartbillLastSyncedNumber}
							<div class="space-y-2">
								<Label>Last Synced Number</Label>
								<Input
									type="text"
									value={settings.smartbillLastSyncedNumber}
									disabled
									class="bg-muted"
								/>
								<p class="text-xs text-muted-foreground">
									The last invoice number that was synced to/from SmartBill. This is updated
									automatically.
								</p>
							</div>
						{/if}

						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="smartbillAutoSync">Automatic Sync</Label>
								<p class="text-xs text-muted-foreground">
									Automatically sync invoices to SmartBill when they are created
								</p>
							</div>
							<Switch id="smartbillAutoSync" bind:checked={smartbillAutoSync} />
						</div>
					</CardContent>
				</Card>
			{/if}

			{#if isKeezActive}
				<Card>
					<CardHeader>
						<CardTitle>Keez Invoice Settings</CardTitle>
						<CardDescription>Configure how invoices are synced with Keez</CardDescription>
					</CardHeader>
					<CardContent class="space-y-4">
						<div class="space-y-2">
							<Label for="keezSeries">Keez Invoice Series</Label>
							<Input
								id="keezSeries"
								bind:value={keezSeries}
								type="text"
								placeholder="e.g., FAC"
								maxlength={10}
							/>
							<p class="text-xs text-muted-foreground">
								The invoice series name used in Keez (e.g., "FAC", "FT", "F")
							</p>
						</div>

						<div class="space-y-2">
							<Label for="keezStartNumber">Starting Invoice Number</Label>
							<Input
								id="keezStartNumber"
								bind:value={keezStartNumber}
								type="text"
								placeholder="e.g., 0001"
								maxlength={20}
							/>
							<p class="text-xs text-muted-foreground">
								The starting invoice number for iteration (e.g., "0001", "001"). Numbers will be
								incremented automatically.
							</p>
						</div>

						{#if settings?.keezLastSyncedNumber}
							<div class="space-y-2">
								<Label>Last Synced Number</Label>
								<Input
									type="text"
									value={settings.keezLastSyncedNumber}
									disabled
									class="bg-muted"
								/>
								<p class="text-xs text-muted-foreground">
									The last invoice external ID that was synced to/from Keez. This is updated
									automatically.
								</p>
							</div>
						{/if}

						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="keezAutoSync">Automatic Sync</Label>
								<p class="text-xs text-muted-foreground">
									Automatically sync invoices to Keez when they are created
								</p>
							</div>
							<Switch id="keezAutoSync" bind:checked={keezAutoSync} />
						</div>
					</CardContent>
				</Card>
			{/if}

			<Card>
				<CardHeader>
					<CardTitle>General Invoice Settings</CardTitle>
					<CardDescription>Configure general invoice settings</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="space-y-2">
						<Label for="defaultCurrency">Default Currency</Label>
						<Select type="single" bind:value={defaultCurrency}>
							<SelectTrigger>
								{defaultCurrency}
							</SelectTrigger>
							<SelectContent>
								{#each CURRENCIES as curr}
									<SelectItem value={curr}>{curr}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
						<p class="text-xs text-muted-foreground">
							Default currency for new invoices. You can change the currency for individual invoices
							when creating them.
						</p>
					</div>

					<Separator />

					<div class="space-y-6">
						<h3 class="text-lg font-semibold">Email Notifications</h3>

						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="invoiceEmailsEnabled">Invoice Emails</Label>
								<p class="text-xs text-muted-foreground">
									Send invoice emails to clients when invoices are sent or marked as paid
								</p>
							</div>
							<Switch id="invoiceEmailsEnabled" bind:checked={invoiceEmailsEnabled} />
						</div>
					</div>
				</CardContent>
			</Card>

			{#if saveError}
				<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
					<p class="text-sm text-red-800 dark:text-red-200">{saveError}</p>
				</div>
			{/if}

			{#if saveSuccess}
				<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
					<p class="text-sm text-green-800 dark:text-green-200">Settings saved successfully!</p>
				</div>
			{/if}

			<div class="flex gap-2">
				<Button type="submit" disabled={saving}>
					{saving ? 'Saving...' : 'Save Settings'}
				</Button>
			</div>
		</form>
	{/if}
{/if}
