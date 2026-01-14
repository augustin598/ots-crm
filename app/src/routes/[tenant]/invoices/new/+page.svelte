<script lang="ts">
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getServices } from '$lib/remotes/services.remote';
	import { createInvoiceFromService, createInvoice, getInvoices } from '$lib/remotes/invoices.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { getPlugins } from '$lib/remotes/plugins.remote';
	import { getKeezItems } from '$lib/remotes/keez.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Separator } from '$lib/components/ui/separator';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { CURRENCIES, type Currency, formatAmount } from '$lib/utils/currency';
	import type { KeezItem } from '$lib/server/plugins/keez/client';
	import {
		ArrowLeft,
		ChevronLeft,
		ChevronRight,
		Calendar,
		X,
		Plus,
		Unlock,
		Trash2,
		Copy,
		Download,
		Send,
		FileCheck,
		Paperclip
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant);

	// Data queries
	const clientsQuery = $derived(getClients());
	const clients = $derived(clientsQuery.current || []);
	const projectsQuery = $derived(getProjects(undefined));
	const projects = $derived(projectsQuery.current || []);
	const servicesQuery = $derived(getServices({}));
	const services = $derived(servicesQuery.current || []);
	const invoiceSettingsQuery = $derived(getInvoiceSettings());
	const invoiceSettings = $derived(invoiceSettingsQuery.current);
	const pluginsQuery = $derived(getPlugins());
	const plugins = $derived(pluginsQuery.current || []);

	// Plugin detection
	const isKeezActive = $derived(plugins.some((p) => p.name === 'keez' && p.enabled));
	let keezItemsQuery = $derived(
		isKeezActive
			? getKeezItems({ count: 1000 })
			: {
					current: { data: [] },
					loading: false,
					error: null
				}
	);
	const keezItems = $derived(keezItemsQuery?.current?.data || []);

	// Form state
	let clientId = $state('');
	let selectedClient = $derived(clientId ? clients.find((c) => c.id === clientId) : null);
	let clientQuery = $derived(clientId ? getClient(clientId) : null);
	let clientData = $derived(clientQuery?.current);
	
	// Use clientData if available, otherwise use selectedClient
	const currentClient = $derived(clientData || selectedClient);

	let sourceType = $state<'service' | 'project' | 'manual'>('manual');
	let serviceId = $state('');
	let projectId = $state('');
	let invoiceSeries = $state(invoiceSettings?.keezSeries || 'OTS');
	let invoiceNumber = $state('');
	let currency = $state<Currency>((invoiceSettings?.defaultCurrency || 'RON') as Currency);
	let issueDate = $state(new Date().toISOString().split('T')[0]);
	let dueDate = $state('');
	let paymentMethod = $state('Transfer bancar');
	let exchangeRate = $state('1,0000');
	let vatOnCollection = $state(false);
	let isCreditNote = $state(false);
	let notes = $state('');
	let itemNote = $state('');
	let itemDescription = $state('');
	let itemPrice = $state<number | null>(null);
	let itemCurrency = $state<Currency | null>(null);
	let invoiceDiscountType = $state<'none' | 'percent' | 'value'>('none');
	let invoiceDiscountValue = $state(0);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Line items state
	interface LineItem {
		id: string;
		description: string;
		quantity: number;
		rate: number;
		taxRate?: number;
		discountType?: string;
		discount?: number;
		keezItem?: KeezItem;
		note?: string;
		currency?: Currency;
	}

	let lineItems = $state<LineItem[]>([]);

	// Update currency when settings load
	$effect(() => {
		if (invoiceSettings?.defaultCurrency) {
			currency = invoiceSettings.defaultCurrency as Currency;
		}
		if (invoiceSettings?.keezSeries) {
			invoiceSeries = invoiceSettings.keezSeries;
		}
	});

	// Auto-set due date
	$effect(() => {
		if (dueDate === '' && issueDate) {
			const date = new Date(issueDate);
			date.setDate(date.getDate() + 30);
			dueDate = date.toISOString().split('T')[0];
		}
	});

	// Filter services and projects by selected client
	const clientOptions = $derived(
		clients.map((c) => ({
			value: c.id,
			label: c.cui ? `${c.cui} - ${c.name}` : c.name
		}))
	);
	const filteredServices = $derived(clientId ? services.filter((s) => s.clientId === clientId) : services);
	const filteredProjects = $derived(clientId ? projects.filter((p) => p.clientId === clientId) : projects);

	const serviceOptions = $derived(filteredServices.map((s) => ({ value: s.id, label: s.name })));
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...filteredProjects.map((p) => ({ value: p.id, label: p.name }))
	]);

	// Get default tax rate from settings
	const defaultTaxRate = $derived(invoiceSettings?.defaultTaxRate ?? 19);

	// When service is selected, populate line items
	$effect(() => {
		if (sourceType === 'service' && serviceId) {
			const service = services.find((s) => s.id === serviceId);
			if (service) {
				lineItems = [
					{
						id: crypto.randomUUID(),
						description: service.name,
						quantity: 1,
						rate: service.price ? service.price / 100 : 0,
						taxRate: defaultTaxRate
					}
				];
				if (service.currency) {
					currency = service.currency as Currency;
				}
			}
		} else if (sourceType === 'service' && !serviceId) {
			lineItems = [];
		}
	});

	// When project is selected, allow manual line items
	$effect(() => {
		if (sourceType === 'project' && projectId) {
			const project = projects.find((p) => p.id === projectId);
			if (project && project.currency) {
				currency = project.currency as Currency;
			}
		}
	});

	// Calculate totals grouped by currency
	const totalsByCurrency = $derived.by(() => {
		const totals: Record<string, {
			subtotal: number;
			taxTotal: number;
			netValue: number;
			grossValue: number;
			grandTotal: number;
			balance: number;
		}> = {};

		lineItems.forEach((item) => {
			const itemCurrency = item.currency || currency;
			if (!totals[itemCurrency]) {
				totals[itemCurrency] = {
					subtotal: 0,
					taxTotal: 0,
					netValue: 0,
					grossValue: 0,
					grandTotal: 0,
					balance: 0
				};
			}

			const itemSubtotal = item.quantity * item.rate;
			const itemTax = (itemSubtotal * (item.taxRate || defaultTaxRate)) / 100;

			totals[itemCurrency].subtotal += itemSubtotal;
			totals[itemCurrency].taxTotal += itemTax;
		});

		// Calculate net, gross, grand total and balance for each currency
		Object.keys(totals).forEach((curr) => {
			const currSubtotal = totals[curr].subtotal;
			const currTaxTotal = totals[curr].taxTotal;
			
			// Apply discount only to the primary currency (invoice currency)
			let discountAmount = 0;
			if (curr === currency && invoiceDiscountType !== 'none' && invoiceDiscountValue) {
				if (invoiceDiscountType === 'percent') {
					discountAmount = (currSubtotal * invoiceDiscountValue) / 100;
				} else {
					discountAmount = invoiceDiscountValue;
				}
			}

			totals[curr].netValue = currSubtotal - discountAmount;
			totals[curr].grossValue = totals[curr].netValue + currTaxTotal;
			totals[curr].grandTotal = totals[curr].grossValue;
			totals[curr].balance = totals[curr].grandTotal;
		});

		return totals;
	});

	// Legacy totals for backward compatibility (primary currency)
	const subtotal = $derived(totalsByCurrency[currency]?.subtotal || 0);
	const taxTotal = $derived(totalsByCurrency[currency]?.taxTotal || 0);
	const invoiceDiscountAmount = $derived.by(() => {
		if (invoiceDiscountType === 'none' || !invoiceDiscountValue) return 0;
		if (invoiceDiscountType === 'percent') {
			return (subtotal * invoiceDiscountValue) / 100;
		}
		return invoiceDiscountValue; // value type
	});
	
	const invoiceDiscountPercent = $derived.by(() => {
		if (invoiceDiscountType === 'percent') return invoiceDiscountValue;
		if (invoiceDiscountType === 'value' && subtotal > 0) {
			return (invoiceDiscountValue / subtotal) * 100;
		}
		return 0;
	});
	
	const netValue = $derived(totalsByCurrency[currency]?.netValue || 0);
	const grossValue = $derived(totalsByCurrency[currency]?.grossValue || 0);
	const grandTotal = $derived(totalsByCurrency[currency]?.grandTotal || 0);
	const balance = $derived(totalsByCurrency[currency]?.balance || 0);

	function updateLineItems(items: LineItem[]) {
		lineItems = items;
	}

	function removeLineItem(id: string) {
		lineItems = lineItems.filter((item) => item.id !== id);
	}

	function addLineItem() {
		const newItem: LineItem = {
			id: crypto.randomUUID(),
			description: '',
			quantity: 1,
			rate: 0,
			taxRate: defaultTaxRate,
			discountType: '',
			discount: 0,
			note: itemNote,
			currency: currency // Use invoice currency as default
		};
		lineItems = [...lineItems, newItem];
		itemNote = ''; // Reset note after adding
	}

	function updateItem(id: string, field: keyof LineItem, value: any) {
		lineItems = lineItems.map((item) => {
			if (item.id === id) {
				return { ...item, [field]: value };
			}
			return item;
		});
	}

	async function handleSubmit() {
		if (!clientId) {
			error = 'Vă rugăm să selectați un client';
			toast.error('Vă rugăm să selectați un client');
			return;
		}

		if (sourceType === 'service' && !serviceId) {
			error = 'Vă rugăm să selectați un serviciu';
			toast.error('Vă rugăm să selectați un serviciu');
			return;
		}

		if (sourceType === 'project' && !projectId) {
			error = 'Vă rugăm să selectați un proiect';
			toast.error('Vă rugăm să selectați un proiect');
			return;
		}

		if (sourceType === 'manual' && lineItems.length === 0) {
			error = 'Vă rugăm să adăugați cel puțin un articol';
			toast.error('Vă rugăm să adăugați cel puțin un articol');
			return;
		}

		if (lineItems.length > 0 && lineItems.some((item) => !item.description.trim())) {
			error = 'Toate articolele trebuie să aibă o descriere';
			toast.error('Toate articolele trebuie să aibă o descriere');
			return;
		}

		loading = true;
		error = null;

		try {
			let result;

			if (sourceType === 'service' && serviceId) {
				// Create from service
				result = await createInvoiceFromService(serviceId).updates(getInvoices({}));
			} else {
				// Create with line items
				result = await createInvoice({
					clientId,
					projectId: sourceType === 'project' ? projectId : undefined,
					serviceId: sourceType === 'service' ? serviceId : undefined,
					lineItems: lineItems.map((item) => ({
						description: item.description,
						quantity: item.quantity,
						rate: item.rate,
						taxRate: item.taxRate
					})),
					currency: currency || undefined,
					issueDate: issueDate || undefined,
					dueDate: dueDate || undefined,
					notes: notes || undefined
				}).updates(getInvoices({}));
			}

			if (result.success) {
				toast.success('Factura a fost creată cu succes');
				goto(`/${tenantSlug}/invoices`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Eroare la crearea facturii';
			toast.error(error);
		} finally {
			loading = false;
		}
	}

	function formatDate(date: string): string {
		if (!date) return '';
		try {
			const d = new Date(date);
			return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
		} catch {
			return '';
		}
	}

	function formatNumber(value: number): string {
		return value.toFixed(2).replace('.', ',');
	}

	function formatNumber4Decimals(value: number): string {
		return value.toFixed(4).replace('.', ',');
	}

	// Keez item options for combobox
	const keezItemOptions = $derived(
		keezItems.map((item) => ({
			value: item.externalId || '',
			label: `${item.name}${item.code ? ` (${item.code})` : ''}`
		}))
	);

	// Track selected Keez item for new item input
	let selectedKeezItemId = $state('');

	function handleKeezItemSelect(itemId: string | number | undefined) {
		if (itemId) {
			const keezItem = keezItems.find((ki) => ki.externalId === itemId);
			if (keezItem) {
				// Auto-fill description, price and currency when Keez item is selected
				selectedKeezItemId = String(itemId);
				itemDescription = keezItem.name; // Pre-fill with Keez item name, but allow manual editing
				// Prețul din Keez este în format decimal, trebuie convertit la formatul folosit (rate este în format decimal, nu centi)
				itemPrice = keezItem.lastPrice || null;
				// Preia moneda din Keez (RON, EUR, etc.)
				itemCurrency = (keezItem.currencyCode as Currency) || currency;
			}
		} else {
			selectedKeezItemId = '';
			itemPrice = null; // Clear price when switching to manual
			itemCurrency = null; // Clear currency when switching to manual
			// Don't clear itemDescription when switching to manual, allow user to keep typing
		}
	}

	function handleAddItem() {
		// Use itemDescription (which can be from Keez or manually entered)
		const description = itemDescription.trim();
		
		if (!description) {
			return; // Don't add empty items
		}
		
		addLineItem();
		// Update the last added item with description, price and currency
		const lastItem = lineItems[lineItems.length - 1];
		if (lastItem) {
			updateItem(lastItem.id, 'description', description);
			// Set price from Keez if available, otherwise keep default (0)
			if (itemPrice !== null && itemPrice !== undefined) {
				updateItem(lastItem.id, 'rate', itemPrice);
			}
			// Set currency from Keez if available, otherwise use invoice currency
			if (itemCurrency) {
				updateItem(lastItem.id, 'currency', itemCurrency);
			}
		}
		selectedKeezItemId = '';
		itemDescription = ''; // Reset description after adding
		itemPrice = null; // Reset price after adding
		itemCurrency = null; // Reset currency after adding
	}
</script>

<div class="min-h-screen bg-gray-50">
	<!-- Top Navigation Bar -->
	<div class="bg-white border-b border-gray-200 px-6 py-4">
		<div class="flex items-center justify-between">
			<!-- Left: Navigation and Invoice Info -->
			<div class="flex items-center gap-4">
				<button
					onclick={() => {}}
					class="p-2 hover:bg-gray-100 rounded-md transition-colors text-pink-500"
					title="Factura anterioară"
				>
					<ChevronLeft class="h-5 w-5" />
				</button>
				<button
					onclick={() => {}}
					class="p-2 hover:bg-gray-100 rounded-md transition-colors text-pink-500"
					title="Factura următoare"
				>
					<ChevronRight class="h-5 w-5" />
				</button>
				<div class="flex items-center gap-3">
					<span class="text-gray-600">{formatDate(issueDate)}</span>
					<span class="text-gray-400">-</span>
					<span class="font-semibold text-gray-900">{invoiceSeries}</span>
					<span class="text-gray-400">-</span>
					<span class="text-gray-600">{currentClient?.name || 'Selectați client'}</span>
				</div>
				<div class="flex items-center gap-2 ml-4">
					<Badge variant="outline" class="bg-yellow-100 text-yellow-800 border-yellow-300">
						Proformă
					</Badge>
				</div>
			</div>

			<!-- Right: Action Buttons -->
			<div class="flex items-center gap-2">
				<Button
					type="submit"
					form="invoice-form"
					class="bg-pink-500 hover:bg-pink-600 text-white border-0"
					disabled={loading}
				>
					{loading ? 'Se salvează...' : 'SALVEAZĂ'}
				</Button>
				<Button
					variant="ghost"
					class="bg-pink-500 hover:bg-pink-600 text-white border-0"
					onclick={() => goto(`/${tenantSlug}/invoices`)}
				>
					ÎNAPOI
				</Button>
			</div>
		</div>
	</div>

	<!-- Main Content -->
	<div class="max-w-7xl mx-auto px-6 py-6">
		<form
			id="invoice-form"
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
			class="space-y-6"
		>
			<div class="grid grid-cols-1 lg:grid-cols-[2.5fr_2.5fr_0.8fr] gap-6 items-stretch">
				<!-- Column 1: Client Information -->
				<div class="space-y-6 flex flex-col">
					<Card class="border border-gray-200 flex-1">
						<CardContent class="p-6">
							<div class="space-y-4">
								<p class="text-sm font-semibold text-gray-900 mb-4">Client</p>
								<div class="space-y-2">
									<Label>PJ (Persoană Juridică)</Label>
									<Combobox
										bind:value={clientId}
										options={clientOptions}
										placeholder="Selectați un client"
										searchPlaceholder="Căutați clienți..."
									/>
								</div>
								{#if currentClient}
									<div class="space-y-4 mt-4">
										<div class="space-y-2">
											<Label>Țară</Label>
											<Input value={currentClient.country || 'România'} readonly />
										</div>
										<div class="space-y-2">
											<Label>Județ</Label>
											<Input value={currentClient.county || ''} readonly />
										</div>
										<div class="space-y-2">
											<Label>Localitate</Label>
											<Input value={currentClient.city || ''} readonly />
										</div>
										<div class="space-y-2">
											<Label>Adresă</Label>
											<Input value={currentClient.address || ''} readonly />
										</div>
									</div>
								{/if}
							</div>
						</CardContent>
					</Card>
				</div>

				<!-- Column 2: Invoice Details, Line Items, Notes, Totals -->
				<div class="space-y-6 flex flex-col">
					<!-- Invoice Details Card -->
					<Card class="border border-gray-200 flex-1">
							<CardContent class="p-6">
								<div class="space-y-4">
									<p class="text-sm font-semibold text-gray-900 mb-4">Detalii Factură</p>
									<div class="grid grid-cols-2 gap-4">
										<div class="space-y-2">
											<Label>Serie</Label>
											<Input bind:value={invoiceSeries} placeholder="OTS" />
										</div>
										<div class="space-y-2">
											<Label>Număr</Label>
											<Input bind:value={invoiceNumber} placeholder="521" />
										</div>
										<div class="space-y-2">
											<Label>Data</Label>
											<div class="relative">
												<Calendar class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
												<Input
													bind:value={issueDate}
													type="date"
													class="pl-10"
													required
												/>
											</div>
										</div>
										<div class="space-y-2">
											<Label>Scadența la</Label>
											<div class="relative">
												<Calendar class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
												<Input
													bind:value={dueDate}
													type="date"
													class="pl-10"
													required
												/>
											</div>
										</div>
										<div class="space-y-2">
											<Label>Plată</Label>
											<Select type="single" bind:value={paymentMethod}>
												<SelectTrigger>
													{paymentMethod}
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="Transfer bancar">Transfer bancar</SelectItem>
													<SelectItem value="Card">Card</SelectItem>
													<SelectItem value="Cash">Cash</SelectItem>
												</SelectContent>
											</Select>
										</div>
										<div class="space-y-2">
											<Label>Monedă calcul</Label>
											<Select type="single" bind:value={currency}>
												<SelectTrigger>
													{currency}
												</SelectTrigger>
												<SelectContent>
													{#each CURRENCIES as curr}
														<SelectItem value={curr}>{curr}</SelectItem>
													{/each}
												</SelectContent>
											</Select>
										</div>
										<div class="space-y-2">
											<Label>Monedă factură</Label>
											<Select type="single" bind:value={currency}>
												<SelectTrigger>
													{currency}
												</SelectTrigger>
												<SelectContent>
													{#each CURRENCIES as curr}
														<SelectItem value={curr}>{curr}</SelectItem>
													{/each}
												</SelectContent>
											</Select>
										</div>
										<div class="space-y-2">
											<Label>Rată schimb</Label>
											<Input bind:value={exchangeRate} placeholder="1,0000" />
										</div>
										<div class="col-span-2 flex items-center gap-4 mt-2">
											<div class="flex items-center gap-2">
												<Checkbox id="vat-on-collection" bind:checked={vatOnCollection} />
												<label for="vat-on-collection" class="text-sm text-gray-700 cursor-pointer">
													TVA la încasare
												</label>
											</div>
											<div class="flex items-center gap-2">
												<Checkbox id="credit-note" bind:checked={isCreditNote} />
												<label for="credit-note" class="text-sm text-gray-700 cursor-pointer">
													Factură storno
												</label>
											</div>
										</div>
									</div>
								</div>
							</CardContent>
					</Card>

					{#if error}
						<div class="rounded-md bg-red-50 border border-red-200 p-4">
							<p class="text-sm text-red-800">{error}</p>
						</div>
					{/if}
				</div>

				<!-- Column 3: Right Sidebar - Action Buttons -->
				<div class="flex flex-col">
					<Card class="border border-gray-200 sticky top-6 flex-1">
						<CardContent class="p-3">
							<div class="space-y-0.5">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50 text-xs h-8"
									onclick={() => toast.info('Validarea va fi implementată în curând')}
								>
									<FileCheck class="mr-1.5 h-3.5 w-3.5" />
									Validează
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50 text-xs h-8"
									onclick={() => goto(`/${tenantSlug}/invoices`)}
								>
									<X class="mr-1.5 h-3.5 w-3.5" />
									Anulează
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50 text-xs h-8"
									onclick={() => {
										if (confirm('Sigur doriți să ștergeți această factură?')) {
											goto(`/${tenantSlug}/invoices`);
										}
									}}
								>
									<Trash2 class="mr-1.5 h-3.5 w-3.5" />
									Șterge
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50 text-xs h-8"
									onclick={() => toast.info('Stornarea va fi implementată în curând')}
								>
									<FileCheck class="mr-1.5 h-3.5 w-3.5" />
									Stornează
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50 text-xs h-8"
									onclick={() => toast.info('Copierea va fi implementată în curând')}
								>
									<Copy class="mr-1.5 h-3.5 w-3.5" />
									Copiază
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50 text-xs h-8"
									onclick={() => toast.info('Descărcarea va fi implementată în curând')}
								>
									<Download class="mr-1.5 h-3.5 w-3.5" />
									Descarcă
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50 text-xs h-8"
									onclick={() => toast.info('Trimiterea va fi implementată în curând')}
								>
									<Send class="mr-1.5 h-3.5 w-3.5" />
									Trimite
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50 text-xs h-8"
									onclick={() => toast.info('eFactura va fi implementată în curând')}
								>
									<FileCheck class="mr-1.5 h-3.5 w-3.5" />
									eFactura
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50 text-xs h-8"
									onclick={() => toast.info('Atașarea fișierului va fi implementată în curând')}
								>
									<Paperclip class="mr-1.5 h-3.5 w-3.5" />
									Atașează fișier
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>

			<!-- Line Items Card - Full Width -->
			<Card class="border border-gray-200 shadow-sm">
				<CardContent class="p-6">
					<div class="space-y-4">
						<div>
							<p class="text-sm font-semibold text-gray-900 mb-2">Articol</p>
							{#if lineItems.length > 0}
								<p class="text-gray-900 font-medium">{lineItems[0]?.description || ''}</p>
							{/if}
						</div>

						{#if lineItems.length > 0 && lineItems[0]?.note}
							<div>
								<p class="text-sm text-gray-500 mb-1">Notă Articol</p>
								<p class="text-gray-900">{lineItems[0].note}</p>
							</div>
						{/if}

						{#if lineItems.length > 0}
							<div class="overflow-x-auto">
								<table class="w-full border-collapse">
									<thead>
										<tr class="border-b border-gray-200">
											<th class="text-left py-3 px-4 text-sm font-semibold text-gray-700">UM</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Cantitate
											</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Preț unitar
											</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Tip rabat
											</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">Rabat</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">Valoare</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">TVA</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Valoare TVA
											</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Valoare finală
											</th>
											<th class="w-10"></th>
										</tr>
									</thead>
									<tbody>
										{#each lineItems as item}
											<tr class="border-b border-gray-100">
												<td class="py-3 px-4 text-gray-900">Buc</td>
												<td class="py-3 px-4 text-right text-gray-900">
													<Input
														type="number"
														step="0.0001"
														value={item.quantity}
														oninput={(e) =>
															updateItem(
																item.id,
																'quantity',
																parseFloat(e.currentTarget.value) || 0
															)}
														class="w-24 text-right border-0 bg-transparent p-0 h-auto"
													/>
												</td>
												<td class="py-3 px-4 text-right text-gray-900">
													<div class="flex items-center justify-end gap-1">
														<Input
															type="number"
															step="0.0001"
															value={item.rate}
															oninput={(e) =>
																updateItem(
																	item.id,
																	'rate',
																	parseFloat(e.currentTarget.value) || 0
																)}
															class="w-32 text-right border-0 bg-transparent p-0 h-auto"
															placeholder="0,0000"
														/>
													</div>
												</td>
												<td class="py-3 px-4 text-right">
													<Select
														type="single"
														bind:value={item.discountType}
														onValueChange={(val) => updateItem(item.id, 'discountType', val)}
													>
														<SelectTrigger class="w-24 h-8 border-0 bg-transparent">
															{item.discountType || '-'}
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="">-</SelectItem>
															<SelectItem value="percent">%</SelectItem>
															<SelectItem value="fixed">Fix</SelectItem>
														</SelectContent>
													</Select>
												</td>
												<td class="py-3 px-4 text-right text-gray-900">
													<Input
														type="number"
														step="0.01"
														value={item.discount || 0}
														oninput={(e) =>
															updateItem(
																item.id,
																'discount',
																parseFloat(e.currentTarget.value) || 0
															)}
														class="w-20 text-right border-0 bg-transparent p-0 h-auto"
													/>
												</td>
												<td class="py-3 px-4 text-right text-gray-900 font-medium">
													{formatNumber(item.quantity * item.rate)}
												</td>
												<td class="py-3 px-4 text-right text-gray-900">
													{item.taxRate || defaultTaxRate} %
												</td>
												<td class="py-3 px-4 text-right text-gray-900">
													{formatNumber(
														(item.quantity * item.rate * (item.taxRate || defaultTaxRate)) /
															100
													)}
												</td>
												<td class="py-3 px-4 text-right text-gray-900 font-medium">
													{formatNumber(
														item.quantity * item.rate +
															(item.quantity * item.rate * (item.taxRate || defaultTaxRate)) /
																100
													)}
												</td>
												<td class="py-3 px-4">
													<Button
														type="button"
														variant="ghost"
														size="icon"
														class="h-6 w-6 text-pink-500 hover:text-pink-600 hover:bg-pink-50"
														onclick={() => removeLineItem(item.id)}
													>
														<X class="h-4 w-4" />
													</Button>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}

						<!-- Add Item Fields -->
						<div class="space-y-3 pt-4 border-t border-gray-200">
							<div class="flex gap-2">
								<div class="flex-1">
									{#if isKeezActive}
										<Combobox
											options={[
												{ value: '', label: 'Introduceți manual' },
												...keezItemOptions
											]}
											value={selectedKeezItemId}
											onValueChange={handleKeezItemSelect}
											placeholder="Selectează din lista de articole"
											searchPlaceholder="Căutați articole..."
										/>
									{/if}
									<Input
										bind:value={itemDescription}
										placeholder={isKeezActive ? "Sau introduceți manual denumirea articolului" : "Completează denumirea articolului / selectează din lista de articole"}
										class="bg-gray-100 {isKeezActive ? 'mt-2' : ''}"
										onkeydown={(e) => {
											if (e.key === 'Enter') {
												e.preventDefault();
												handleAddItem();
											}
										}}
									/>
								</div>
								<Button
									type="button"
									variant="ghost"
									class="bg-pink-500 hover:bg-pink-600 text-white border-0 h-10 w-10 p-0"
									onclick={handleAddItem}
								>
									<Plus class="h-5 w-5" />
								</Button>
							</div>
							<Input
								bind:value={itemNote}
								placeholder="Completează detaliile specifice acestei tranzacții (Ex: Luna Martie 20xx, Contract nr. yy, faza de implementare, etc.)"
								class="bg-gray-100"
							/>
						</div>

						<!-- Invoice Totals Section -->
						<div class="space-y-4 pt-4 border-t border-gray-200">
							<!-- Discount Table -->
							<div class="overflow-x-auto">
								<table class="w-full border-collapse">
									<thead>
										<tr class="border-b border-gray-200">
											<th class="text-left py-3 px-4 text-sm font-semibold text-gray-700">
												<span class="text-pink-600">Tip</span>
											</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Valoare procent
											</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Valoare netă
											</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Valoare brută
											</th>
										</tr>
									</thead>
									<tbody>
										<tr>
											<td class="py-3 px-4">
												<Select
													type="single"
													bind:value={invoiceDiscountType}
													onValueChange={(val) => {
														invoiceDiscountType = val as 'none' | 'percent' | 'value';
														if (val === 'none') invoiceDiscountValue = 0;
													}}
												>
													<SelectTrigger class="w-full border-0 bg-transparent p-0 h-auto">
														{invoiceDiscountType === 'none'
															? 'Fără rabat'
															: invoiceDiscountType === 'percent'
																? 'P - Procentual'
																: 'V - Valoric'}
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="none">Fără rabat</SelectItem>
														<SelectItem value="percent">P - Procentual</SelectItem>
														<SelectItem value="value">V - Valoric</SelectItem>
													</SelectContent>
												</Select>
											</td>
											<td class="py-3 px-4 text-right text-gray-900">
												{#if invoiceDiscountType === 'percent'}
													<Input
														type="number"
														step="0.01"
														value={invoiceDiscountValue}
														oninput={(e) => {
															invoiceDiscountValue = parseFloat(e.currentTarget.value) || 0;
														}}
														class="w-24 text-right border-0 bg-transparent p-0 h-auto"
														placeholder="0,00"
													/>
												{:else if invoiceDiscountType === 'value'}
													<Input
														type="number"
														step="0.01"
														value={invoiceDiscountValue}
														oninput={(e) => {
															invoiceDiscountValue = parseFloat(e.currentTarget.value) || 0;
														}}
														class="w-24 text-right border-0 bg-transparent p-0 h-auto"
														placeholder="0,00"
													/>
												{:else}
													<span>0,00</span>
												{/if}
											</td>
											<td class="py-3 px-4 text-right text-gray-900">
												{formatNumber(netValue)}
											</td>
											<td class="py-3 px-4 text-right text-gray-900">
												{formatNumber(grossValue)}
											</td>
										</tr>
									</tbody>
								</table>
							</div>
							
							<Separator />
							<!-- Totals grouped by currency -->
							{#each Object.entries(totalsByCurrency) as [curr, totals]}
								{@const hasMultipleCurrencies = Object.keys(totalsByCurrency).length > 1}
								<div class="space-y-2 {hasMultipleCurrencies ? 'mb-4 pb-4 border-b border-gray-200' : ''}">
									{#if hasMultipleCurrencies}
										<p class="text-sm font-semibold text-gray-900 mb-2">Totaluri {curr}</p>
									{/if}
									<div class="flex justify-between">
										<span class="text-gray-700 font-medium">Total Valoare</span>
										<span class="text-gray-900 font-semibold">{formatNumber(totals.subtotal)} {curr}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-gray-700 font-medium">Total TVA</span>
										<span class="text-gray-900 font-semibold">{formatNumber(totals.taxTotal)} {curr}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-gray-700 font-medium">Total de plată</span>
										<span class="text-gray-900 font-semibold text-lg">{formatNumber(totals.grandTotal)} {curr}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-gray-700 font-medium">Sold</span>
										<span class="text-gray-900 font-semibold text-lg">{formatNumber(totals.balance)} {curr}</span>
									</div>
								</div>
							{/each}
						</div>
					</div>
				</CardContent>
			</Card>

			<!-- Invoice Notes Card - Full Width -->
			<Card class="border border-gray-200 shadow-sm">
				<CardContent class="p-6">
					<div>
						<p class="text-sm text-gray-500 mb-1">Note Factură</p>
						<Textarea
							bind:value={notes}
							placeholder="Adăugați note sau termeni suplimentari pentru această factură..."
							rows={3}
							class="resize-none"
						/>
						<div class="mt-4">
							<button
								type="button"
								class="text-sm text-pink-600 hover:underline flex items-center gap-1"
							>
								<Plus class="h-4 w-4" />
								Adaugă informații adiționale
							</button>
						</div>
					</div>
				</CardContent>
			</Card>
		</form>
	</div>
</div>
