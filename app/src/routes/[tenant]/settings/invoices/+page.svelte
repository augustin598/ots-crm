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

	const settingsQuery = getInvoiceSettings();
	const settings = $derived(settingsQuery.current);
	const loading = $derived(settingsQuery.loading);
	const error = $derived(settingsQuery.error);

	let smartbillSeries = $state(settings?.smartbillSeries || '');
	let smartbillStartNumber = $state(settings?.smartbillStartNumber || '');
	let smartbillAutoSync = $state(settings?.smartbillAutoSync || false);
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

<p class="text-muted-foreground mb-6">
	Configure invoice settings for SmartBill integration. Set the invoice series and starting number for automatic syncing.
</p>

<Card>
	<CardHeader>
		<CardTitle>SmartBill Invoice Settings</CardTitle>
		<CardDescription>Configure how invoices are synced with SmartBill</CardDescription>
	</CardHeader>
	<CardContent>
		{#if loading}
			<div class="space-y-4">
				<div class="animate-pulse space-y-4">
					<div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
					<div class="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
				</div>
			</div>
		{:else}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-6"
			>
				<div class="space-y-4">
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
							The starting invoice number for iteration (e.g., "0001", "001"). Numbers will be incremented automatically.
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
								The last invoice number that was synced to/from SmartBill. This is updated automatically.
							</p>
						</div>
					{/if}

					<Separator />

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
							Default currency for new invoices. You can change the currency for individual invoices when creating them.
						</p>
					</div>

					<Separator />

					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<Label for="smartbillAutoSync">Automatic Sync</Label>
							<p class="text-xs text-muted-foreground">
								Automatically sync invoices to SmartBill when they are created
							</p>
						</div>
						<Switch id="smartbillAutoSync" bind:checked={smartbillAutoSync} />
					</div>
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
		</CardContent>
	</Card>
