<script lang="ts">
	import { getInvoiceSettings, updateInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Receipt, Upload, X } from '@lucide/svelte';
	import { CURRENCIES, CURRENCY_LABELS, type Currency } from '$lib/utils/currency';
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

	let smartbillSeries = $state('');
	let smartbillStartNumber = $state('');
	let smartbillAutoSync = $state(false);
	let smartbillTaxNameApply = $state('');
	let smartbillTaxNameNone = $state('');
	let smartbillTaxNameReverse = $state('');
	let keezSeries = $state('');
	let keezStartNumber = $state('');
	let keezAutoSync = $state(false);
	let keezDefaultPaymentTypeId = $state('3');
	let defaultCurrency = $state<Currency>('RON');
	let defaultTaxRate = $state(19);
	let invoiceEmailsEnabled = $state(true);
	let sendInvoiceEmailEnabled = $state(true);
	let paidConfirmationEmailEnabled = $state(true);
	let overdueReminderEnabled = $state(false);
	let overdueReminderDaysAfterDue = $state(3);
	let overdueReminderRepeatDays = $state(7);
	let overdueReminderMaxCount = $state(3);
	let autoSendRecurringInvoices = $state(false);
	let invoiceLogo = $state<string | null>(null);
	let logoPreview = $state<string | null>(null);
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let saveSuccess = $state(false);

	// Update local state when settings load
	$effect(() => {
		if (settings) {
			smartbillSeries = settings.smartbillSeries || '';
			smartbillStartNumber = settings.smartbillStartNumber || '';
			smartbillAutoSync = settings.smartbillAutoSync || false;
			smartbillTaxNameApply = settings.smartbillTaxNameApply || '';
			smartbillTaxNameNone = settings.smartbillTaxNameNone || '';
			smartbillTaxNameReverse = settings.smartbillTaxNameReverse || '';
			keezSeries = settings.keezSeries || '';
			keezStartNumber = settings.keezStartNumber || '';
			keezAutoSync = settings.keezAutoSync || false;
			keezDefaultPaymentTypeId = String(settings.keezDefaultPaymentTypeId ?? 3);
			defaultCurrency = (settings.defaultCurrency || 'RON') as Currency;
			defaultTaxRate = settings.defaultTaxRate ?? 19;
			invoiceEmailsEnabled = settings.invoiceEmailsEnabled ?? true;
			sendInvoiceEmailEnabled = settings.sendInvoiceEmailEnabled ?? true;
			paidConfirmationEmailEnabled = settings.paidConfirmationEmailEnabled ?? true;
			overdueReminderEnabled = settings.overdueReminderEnabled ?? false;
			overdueReminderDaysAfterDue = settings.overdueReminderDaysAfterDue ?? 3;
			overdueReminderRepeatDays = settings.overdueReminderRepeatDays ?? 7;
			overdueReminderMaxCount = settings.overdueReminderMaxCount ?? 3;
			autoSendRecurringInvoices = settings.autoSendRecurringInvoices ?? false;
			invoiceLogo = settings.invoiceLogo || null;
			logoPreview = settings.invoiceLogo || null;
		}
	});

	function handleLogoSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		if (!file.type.startsWith('image/')) {
			saveError = 'File must be an image (PNG or JPEG)';
			return;
		}

		if (file.size > 2 * 1024 * 1024) {
			saveError = 'Logo must be smaller than 2MB';
			return;
		}

		const reader = new FileReader();
		reader.onload = () => {
			const base64 = reader.result as string;
			invoiceLogo = base64;
			logoPreview = base64;
		};
		reader.readAsDataURL(file);
	}

	function removeLogo() {
		invoiceLogo = null;
		logoPreview = null;
	}

	async function handleSubmit() {
		saving = true;
		saveError = null;
		saveSuccess = false;

		try {
			await updateInvoiceSettings({
				smartbillSeries: smartbillSeries || undefined,
				smartbillStartNumber: smartbillStartNumber || undefined,
				smartbillAutoSync,
				smartbillTaxNameApply: smartbillTaxNameApply || undefined,
				smartbillTaxNameNone: smartbillTaxNameNone || undefined,
				smartbillTaxNameReverse: smartbillTaxNameReverse || undefined,
				keezSeries: keezSeries || undefined,
				keezStartNumber: keezStartNumber || undefined,
				keezAutoSync,
				keezDefaultPaymentTypeId: Number(keezDefaultPaymentTypeId),
				defaultCurrency: defaultCurrency || undefined,
				defaultTaxRate: defaultTaxRate !== undefined ? defaultTaxRate : undefined,
				invoiceEmailsEnabled,
				sendInvoiceEmailEnabled,
				paidConfirmationEmailEnabled,
				overdueReminderEnabled,
				overdueReminderDaysAfterDue,
				overdueReminderRepeatDays,
				overdueReminderMaxCount,
				autoSendRecurringInvoices,
				invoiceLogo
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
			<Card>
				<CardHeader>
					<CardTitle>Invoice Logo</CardTitle>
					<CardDescription>Upload a logo to appear on your generated invoice PDFs</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if logoPreview}
						<div class="flex items-start gap-4">
							<div class="border rounded-lg p-2 bg-white">
								<img src={logoPreview} alt="Invoice logo" class="h-16 max-w-[200px] object-contain" />
							</div>
							<Button type="button" variant="outline" size="sm" onclick={removeLogo}>
								<X class="h-4 w-4 mr-1" />
								Remove
							</Button>
						</div>
					{:else}
						<label
							class="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
						>
							<Upload class="h-8 w-8 text-muted-foreground mb-2" />
							<span class="text-sm text-muted-foreground">Click to upload logo</span>
							<span class="text-xs text-muted-foreground mt-1">PNG or JPEG, max 2MB</span>
							<input type="file" class="hidden" accept="image/png,image/jpeg" onchange={handleLogoSelect} />
						</label>
					{/if}
					<p class="text-xs text-muted-foreground">
						This logo will appear in the top-left corner of your invoice PDFs. If no logo is uploaded, a default logo will be used.
					</p>
				</CardContent>
			</Card>

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

						<Separator />

						<div class="space-y-4">
							<h3 class="text-sm font-semibold">Tax Name Mappings</h3>
							<p class="text-xs text-muted-foreground">
								Configure the tax names to send to SmartBill for each tax application type. Leave empty to
								use default values (Normala, Neimpozabil, Taxare inversa).
							</p>

							<div class="space-y-2">
								<Label for="smartbillTaxNameApply">Tax Name for "Apply Tax"</Label>
								<Input
									id="smartbillTaxNameApply"
									bind:value={smartbillTaxNameApply}
									type="text"
									placeholder="Normala"
								/>
								<p class="text-xs text-muted-foreground">
									Tax name sent to SmartBill when "Apply Tax" is selected (default: "Normala")
								</p>
							</div>

							<div class="space-y-2">
								<Label for="smartbillTaxNameNone">Tax Name for "Do Not Apply Tax"</Label>
								<Input
									id="smartbillTaxNameNone"
									bind:value={smartbillTaxNameNone}
									type="text"
									placeholder="Neimpozabil"
								/>
								<p class="text-xs text-muted-foreground">
									Tax name sent to SmartBill when "Do Not Apply Tax" is selected (default: "Neimpozabil")
								</p>
							</div>

							<div class="space-y-2">
								<Label for="smartbillTaxNameReverse">Tax Name for "Reverse Tax"</Label>
								<Input
									id="smartbillTaxNameReverse"
									bind:value={smartbillTaxNameReverse}
									type="text"
									placeholder="Taxare inversa"
								/>
								<p class="text-xs text-muted-foreground">
									Tax name sent to SmartBill when "Reverse Tax" is selected (default: "Taxare inversa")
								</p>
							</div>
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

						<div class="space-y-2">
							<Label for="keezDefaultPaymentTypeId">Default Payment Type</Label>
							<Select type="single" bind:value={keezDefaultPaymentTypeId}>
								<SelectTrigger id="keezDefaultPaymentTypeId">
									{[
										{ id: '1', label: 'Bon fiscal platit cu numerar (BFCash)' },
										{ id: '2', label: 'Bon fiscal platit cu cardul (BFCard)' },
										{ id: '3', label: 'Transfer bancar (Bank)' },
										{ id: '4', label: 'Plată numerar cu chitanță (ChitCash)' },
										{ id: '5', label: 'Ramburs' },
										{ id: '6', label: 'Procesator plăți - PayU, Netopia (ProcesatorPlati)' },
										{ id: '7', label: 'Platforme distribuție - Emag (PlatformaDistributie)' },
										{ id: '8', label: 'Voucher de Vacanță - Card' },
										{ id: 9, label: 'Voucher de Vacanță - Tichet' }
									].find((p) => p.id === keezDefaultPaymentTypeId)?.label || 'Transfer bancar (Bank)'}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={"1"}>Bon fiscal platit cu numerar (BFCash)</SelectItem>
									<SelectItem value={"2"}>Bon fiscal platit cu cardul (BFCard)</SelectItem>
									<SelectItem value={"3"}>Transfer bancar (Bank)</SelectItem>
									<SelectItem value={"4"}>Plată numerar cu chitanță (ChitCash)</SelectItem>
									<SelectItem value={"5"}>Ramburs</SelectItem>
									<SelectItem value={"6"}>Procesator plăți - PayU, Netopia (ProcesatorPlati)</SelectItem>
									<SelectItem value={"7"}>Platforme distribuție - Emag (PlatformaDistributie)</SelectItem>
									<SelectItem value={"8"}>Voucher de Vacanță - Card</SelectItem>
									<SelectItem value={"9"}>Voucher de Vacanță - Tichet</SelectItem>
								</SelectContent>
							</Select>
							<p class="text-xs text-muted-foreground">
								Tipul de plată implicit trimis către Keez când factura nu are o metodă de plată specifică
								setată. Se aplică numai când factura nu are "Bank Transfer", "Cash" etc. setat explicit.
							</p>
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
								{CURRENCY_LABELS[defaultCurrency]}
							</SelectTrigger>
							<SelectContent>
								{#each CURRENCIES as curr}
									<SelectItem value={curr}>{CURRENCY_LABELS[curr]}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
						<p class="text-xs text-muted-foreground">
							Default currency for new invoices. You can change the currency for individual invoices
							when creating them.
						</p>
					</div>

					<div class="space-y-2">
						<Label for="defaultTaxRate">Default VAT Tax Rate (%)</Label>
						<Input
							id="defaultTaxRate"
							type="number"
							min="0"
							max="100"
							step="0.01"
							bind:value={defaultTaxRate}
							placeholder="19"
						/>
						<p class="text-xs text-muted-foreground">
							Default VAT tax rate (as percentage) for new invoices and line items. This will be
							automatically applied when creating invoices unless overridden.
						</p>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Notificari Email Facturi</CardTitle>
					<CardDescription>Configureaza emailurile trimise automat pentru facturi</CardDescription>
				</CardHeader>
				<CardContent class="space-y-6">
					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<Label for="invoiceEmailsEnabled">Emailuri Facturi (Master)</Label>
							<p class="text-xs text-muted-foreground">
								Activeaza/dezactiveaza toate emailurile legate de facturi
							</p>
						</div>
						<Switch id="invoiceEmailsEnabled" bind:checked={invoiceEmailsEnabled} />
					</div>

					{#if invoiceEmailsEnabled}
						<Separator />

						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="sendInvoiceEmailEnabled">Trimitere Factura</Label>
								<p class="text-xs text-muted-foreground">
									Trimite email clientului cand apesi "Trimite Factura"
								</p>
							</div>
							<Switch id="sendInvoiceEmailEnabled" bind:checked={sendInvoiceEmailEnabled} />
						</div>

						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="paidConfirmationEmailEnabled">Confirmare Plata</Label>
								<p class="text-xs text-muted-foreground">
									Trimite email clientului cand factura este marcata ca platita
								</p>
							</div>
							<Switch id="paidConfirmationEmailEnabled" bind:checked={paidConfirmationEmailEnabled} />
						</div>

						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="autoSendRecurringInvoices">Auto-trimitere Facturi Recurente</Label>
								<p class="text-xs text-muted-foreground">
									Facturile generate automat de recurenta sunt trimise pe email clientului
								</p>
							</div>
							<Switch id="autoSendRecurringInvoices" bind:checked={autoSendRecurringInvoices} />
						</div>

						<Separator />

						<div class="space-y-4">
							<div class="flex items-center justify-between">
								<div class="space-y-0.5">
									<Label for="overdueReminderEnabled">Reminder Factura Restanta</Label>
									<p class="text-xs text-muted-foreground">
										Trimite remindere automate pentru facturile restante (Luni-Vineri la 9:00)
									</p>
								</div>
								<Switch id="overdueReminderEnabled" bind:checked={overdueReminderEnabled} />
							</div>

							{#if overdueReminderEnabled}
								<div class="ml-4 space-y-4 border-l-2 border-muted pl-4">
									<div class="space-y-2">
										<Label for="overdueReminderDaysAfterDue">
											Zile dupa scadenta pentru primul reminder
										</Label>
										<Input
											id="overdueReminderDaysAfterDue"
											type="number"
											min="1"
											max="30"
											bind:value={overdueReminderDaysAfterDue}
										/>
										<p class="text-xs text-muted-foreground">
											Numarul de zile dupa data scadenta cand se trimite primul reminder (1-30)
										</p>
									</div>

									<div class="space-y-2">
										<Label for="overdueReminderRepeatDays">
											Interval repetare (zile)
										</Label>
										<Input
											id="overdueReminderRepeatDays"
											type="number"
											min="0"
											max="30"
											bind:value={overdueReminderRepeatDays}
										/>
										<p class="text-xs text-muted-foreground">
											La cate zile se repeta reminderul (0 = fara repetare)
										</p>
									</div>

									<div class="space-y-2">
										<Label for="overdueReminderMaxCount">
											Numar maxim de remindere
										</Label>
										<Input
											id="overdueReminderMaxCount"
											type="number"
											min="1"
											max="10"
											bind:value={overdueReminderMaxCount}
										/>
										<p class="text-xs text-muted-foreground">
											Numarul maxim de remindere trimise per factura (1-10)
										</p>
									</div>
								</div>
							{/if}
						</div>
					{/if}
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
