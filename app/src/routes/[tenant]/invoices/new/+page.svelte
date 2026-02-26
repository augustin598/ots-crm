<script lang="ts">
	import { getClients, updateClient } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getServices } from '$lib/remotes/services.remote';
	import {
		createInvoiceFromService,
		createInvoice,
		getInvoices
	} from '$lib/remotes/invoices.remote';
	import { getKeezItems, getKeezNextInvoiceNumber } from '$lib/remotes/keez.remote';
	import { createRecurringInvoice } from '$lib/remotes/recurring-invoices.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { getPlugins } from '$lib/remotes/plugins.remote';
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
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle,
		DialogTrigger
	} from '$lib/components/ui/dialog';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { CURRENCIES, type Currency, formatAmount } from '$lib/utils/currency';
	import type { KeezItem } from '$lib/server/plugins/keez/client';
	import { Calendar, X, Plus, Trash2, FileText, Send, Save } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { untrack } from 'svelte';

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

	// Plugin detection - invoice provider plugins (those that provide items)
	const invoiceProviderPlugins = $derived(
		plugins.filter((p) => (p.name === 'keez' || p.name === 'smartbill') && p.enabled)
	);
	const isKeezActive = $derived(plugins.some((p) => p.name === 'keez' && p.enabled));
	const isSmartbillActive = $derived(plugins.some((p) => p.name === 'smartbill' && p.enabled));

	// Determine which plugin series to use based on active plugins
	// Priority: keez if active, then smartbill if active, otherwise empty
	const defaultInvoiceSeries = $derived(() => {
		if (isKeezActive && invoiceSettings?.keezSeries) {
			return invoiceSettings.keezSeries;
		}
		if (isSmartbillActive && invoiceSettings?.smartbillSeries) {
			return invoiceSettings.smartbillSeries;
		}
		return '';
	});

	const defaultInvoiceNumber = $derived(() => {
		if (isKeezActive && invoiceSettings?.keezStartNumber) {
			return invoiceSettings.keezStartNumber;
		}
		if (isSmartbillActive && invoiceSettings?.smartbillStartNumber) {
			return invoiceSettings.smartbillStartNumber;
		}
		return '';
	});

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

	// Next invoice number from Keez (auto-filled when series is known)
	const keezSeriesForQuery = $derived(isKeezActive && invoiceSettings?.keezSeries ? invoiceSettings.keezSeries : '');
	let keezNextNumberQuery = $derived(
		keezSeriesForQuery
			? getKeezNextInvoiceNumber({ series: keezSeriesForQuery })
			: { current: { nextNumber: null }, loading: false, error: null }
	);
	const keezNextNumber = $derived(keezNextNumberQuery?.current?.nextNumber ?? null);

	// Form state
	let clientId = $state('');
	let selectedClient = $derived(clientId ? clients.find((c) => c.id === clientId) : null);
	let clientQuery = $derived(clientId ? getClient(clientId) : null);
	let clientData = $derived(clientQuery?.current);

	// Use clientData if available, otherwise use selectedClient
	const currentClient = $derived(clientData || selectedClient);

	// Editable client fields
	let clientName = $state('');
	let clientEmail = $state('');
	let clientPhone = $state('');
	let clientCui = $state('');
	let clientRegistrationNumber = $state('');
	let clientIban = $state('');
	let clientBankName = $state('');
	let clientAddress = $state('');
	let clientCity = $state('');
	let clientCounty = $state('');
	let clientPostalCode = $state('');
	let clientCountry = $state('România');

	// Initialize client fields when client is selected
	$effect(() => {
		if (currentClient) {
			untrack(() => {
				clientName = currentClient.name || '';
				clientEmail = currentClient.email || '';
				clientPhone = currentClient.phone || '';
				clientCui = currentClient.cui || '';
				clientRegistrationNumber = currentClient.registrationNumber || '';
				clientIban = currentClient.iban || '';
				clientBankName = currentClient.bankName || '';
				clientAddress = currentClient.address || '';
				clientCity = currentClient.city || '';
				clientCounty = currentClient.county || '';
				clientPostalCode = currentClient.postalCode || '';
				clientCountry = currentClient.country || 'România';
			});
		}
	});

	let sourceType = $state<'service' | 'manual'>('manual');
	let serviceId = $state('');
	let projectId = $state('');
	let invoiceSeries = $state('');
	let invoiceNumber = $state('');
	// Initialize currency from settings if available, otherwise use first available currency
	let currency = $state<Currency>((invoiceSettings?.defaultCurrency as Currency) || CURRENCIES[0]);
	let invoiceCurrency = $state<Currency>(
		(invoiceSettings?.defaultCurrency as Currency) || CURRENCIES[0]
	);
	let issueDate = $state(new Date().toISOString().split('T')[0]);
	let dueDate = $state('');
	let paymentTerms = $state('Net 15');
	let paymentMethod = $state('Bank Transfer');
	let exchangeRate = $state('');
	let vatOnCollection = $state(false);
	let isCreditNote = $state(false);
	let taxApplicationType = $state<'apply' | 'none' | 'reverse'>('apply');
	let notes = $state('');
	let invoiceDiscountType = $state<'none' | 'percent' | 'value'>('none');
	let invoiceDiscountValue = $state(0);
	let loading = $state(false);
	let error = $state<string | null>(null);
	
	// Recurring invoice state
	let isRecurringInvoice = $state(false);
	let recurringType = $state<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
	let recurringInterval = $state(1);
	let recurringStartDate = $state(new Date().toISOString().split('T')[0]);
	let recurringEndDate = $state('');
	let recurringIssueDateOffset = $state(0);
	let recurringDueDateOffset = $state(30);
	let addItemDialogOpen = $state(false);
	let dialogSourceType = $state<string>('manual');
	let dialogServiceId = $state('');
	let dialogPluginItemId = $state<Record<string, string>>({});
	let dialogItemDescription = $state('');
	let dialogItemNote = $state('');

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
		unitOfMeasure?: string;
		serviceId?: string; // Service ID if item came from a service
	}

	let lineItems = $state<LineItem[]>([]);

	// Update form fields when settings load or plugins change
	$effect(() => {
		console.log('[invoice/new] invoiceSettings:', invoiceSettings);
		console.log('[invoice/new] plugins:', { isKeezActive, isSmartbillActive });

		if (invoiceSettings) {
			// Set currency from settings
			if (invoiceSettings.defaultCurrency) {
				currency = invoiceSettings.defaultCurrency as Currency;
				invoiceCurrency = invoiceSettings.defaultCurrency as Currency;
			}
		}

		// Set invoice series based on active plugin (only if series is empty to avoid overwriting user input)
		const series = defaultInvoiceSeries();
		if (series && !invoiceSeries) {
			invoiceSeries = series;
		}

		// Set invoice number based on active plugin (only if number is empty to avoid overwriting user input)
		// For Keez, prefer the live next number from API; fall back to settings start number
		const keezLiveNumber = keezNextNumber !== null ? String(keezNextNumber) : null;
		const number = isKeezActive ? (keezLiveNumber || defaultInvoiceNumber()) : defaultInvoiceNumber();
		if (number) {
			invoiceNumber = number;
		}

		console.log('[invoice/new] resolved series:', series, '| resolved number:', number, '| keezNextNumber:', keezNextNumber);
	});

	// Update exchange rate when currencies match
	$effect(() => {
		if (currency === invoiceCurrency && currency) {
			exchangeRate = '1,0000';
		} else if (currency !== invoiceCurrency) {
			// Reset exchange rate when currencies differ (user should set it)
			if (exchangeRate === '1,0000') {
				exchangeRate = '';
			}
		}
	});

	// Parse payment terms to extract number of days
	function parsePaymentTerms(terms: string): number {
		if (!terms) return 30; // Default to 30 days

		// Handle "Due on Receipt" as 0 days
		if (terms.toLowerCase().includes('receipt') || terms.toLowerCase().includes('immediate')) {
			return 0;
		}

		// Match patterns like "Net 30", "30", "Net 15", etc.
		const match = terms.match(/(\d+)/);
		if (match) {
			return parseInt(match[1], 10);
		}

		return 30; // Default fallback
	}

	// Calculate issue and due dates for recurring invoices
	const calculatedIssueDate = $derived.by(() => {
		if (!isRecurringInvoice || !recurringStartDate) return issueDate;
		const date = new Date(recurringStartDate);
		date.setDate(date.getDate() + (recurringIssueDateOffset || 0));
		return date.toISOString().split('T')[0];
	});

	const calculatedDueDate = $derived.by(() => {
		if (!isRecurringInvoice || !calculatedIssueDate) {
			// For non-recurring, use payment terms calculation
			if (issueDate && paymentTerms) {
				const days = parsePaymentTerms(paymentTerms);
				const date = new Date(issueDate);
				date.setDate(date.getDate() + days);
				return date.toISOString().split('T')[0];
			}
			return dueDate;
		}
		const date = new Date(calculatedIssueDate);
		date.setDate(date.getDate() + (recurringDueDateOffset || 30));
		return date.toISOString().split('T')[0];
	});

	// Auto-set due date based on payment terms and issue date (for non-recurring)
	$effect(() => {
		if (!isRecurringInvoice && issueDate && paymentTerms) {
			const days = parsePaymentTerms(paymentTerms);
			const date = new Date(issueDate);
			date.setDate(date.getDate() + days);
			const calculatedDueDate = date.toISOString().split('T')[0];

			// Update due date when payment terms or issue date changes
			dueDate = calculatedDueDate;
		}
	});

	// Update issue and due dates when recurring settings change
	$effect(() => {
		if (isRecurringInvoice) {
			issueDate = calculatedIssueDate;
			dueDate = calculatedDueDate;
		}
	});

	// Filter services and projects by selected client
	const clientOptions = $derived(
		clients.map((c) => ({
			value: c.id,
			label: c.cui ? `${c.cui} - ${c.name}` : c.name
		}))
	);
	const filteredServices = $derived(
		clientId ? services.filter((s) => s.clientId === clientId) : services
	);
	const filteredProjects = $derived(
		clientId ? projects.filter((p) => p.clientId === clientId) : projects
	);

	// Get default tax rate from settings
	const defaultTaxRate = $derived(invoiceSettings?.defaultTaxRate ?? 19);

	// Calculate totals grouped by currency
	const totalsByCurrency = $derived.by(() => {
		const totals: Record<
			string,
			{
				subtotal: number;
				taxTotal: number;
				netValue: number;
				grossValue: number;
				grandTotal: number;
				balance: number;
			}
		> = {};

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
			// Only calculate tax if taxApplicationType is 'apply'
			const itemTax =
				taxApplicationType === 'apply'
					? (itemSubtotal * (item.taxRate || defaultTaxRate)) / 100
					: 0;

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

	const netValue = $derived(totalsByCurrency[currency]?.netValue || 0);
	const grossValue = $derived(totalsByCurrency[currency]?.grossValue || 0);
	const grandTotal = $derived(totalsByCurrency[currency]?.grandTotal || 0);
	const balance = $derived(totalsByCurrency[currency]?.balance || 0);

	function removeLineItem(id: string) {
		lineItems = lineItems.filter((item) => item.id !== id);
	}

	function updateItem(id: string, field: keyof LineItem, value: any) {
		lineItems = lineItems.map((item) => {
			if (item.id === id) {
				return { ...item, [field]: value };
			}
			return item;
		});
	}

	async function handleSubmit(status: 'draft' | 'sent' = 'draft') {
		console.log('[invoice/new] handleSubmit', {
			status,
			clientId,
			invoiceSeries,
			invoiceNumber,
			currency,
			invoiceCurrency,
			issueDate,
			dueDate,
			paymentTerms,
			taxApplicationType,
			lineItems
		});

		if (!clientId) {
			error = 'Please select a client';
			toast.error('Please select a client');
			return;
		}

		if (!clientName.trim()) {
			error = 'Client name is required';
			toast.error('Client name is required');
			return;
		}

		if (lineItems.length === 0) {
			error = 'Please add at least one item';
			toast.error('Please add at least one item');
			return;
		}

		if (lineItems.some((item) => !item.description.trim())) {
			error = 'All items must have a description';
			toast.error('All items must have a description');
			return;
		}

		// Validate recurring invoice fields if enabled
		if (isRecurringInvoice) {
			if (!recurringStartDate) {
				error = 'Start date is required for recurring invoices';
				toast.error('Start date is required for recurring invoices');
				return;
			}
			if (recurringInterval < 1) {
				error = 'Recurring interval must be at least 1';
				toast.error('Recurring interval must be at least 1');
				return;
			}
		}

		loading = true;
		error = null;

		try {
			if (isRecurringInvoice) {
				// Create recurring invoice
				// Generate name from first line item or client name
				const invoiceName =
					lineItems.length > 0 && lineItems[0].description
						? lineItems[0].description
						: `${clientName} Recurring Invoice`;

				const result = await createRecurringInvoice({
					name: invoiceName,
					clientId,
					projectId: projectId || undefined,
					serviceId: serviceId || undefined,
					lineItems: lineItems.map((item) => ({
						description: item.description,
						quantity: item.quantity,
						rate: item.rate,
						taxRate: item.taxRate,
						discountType: item.discountType || undefined,
						discount: item.discount || undefined,
						note: item.note || undefined,
						currency: item.currency || undefined,
						unitOfMeasure: item.unitOfMeasure || undefined,
						keezItemExternalId: item.keezItem?.externalId || undefined,
						serviceId: item.serviceId || undefined
					})),
					currency: currency || undefined,
					recurringType,
					recurringInterval,
					startDate: recurringStartDate,
					endDate: recurringEndDate || undefined,
					issueDateOffset: recurringIssueDateOffset,
					dueDateOffset: recurringDueDateOffset,
					notes: notes || undefined,
					discountType: invoiceDiscountType !== 'none' ? invoiceDiscountType : undefined,
					discountValue: invoiceDiscountType !== 'none' ? invoiceDiscountValue : undefined,
					taxApplicationType: taxApplicationType || undefined,
					invoiceSeries: invoiceSeries || undefined,
					invoiceCurrency: invoiceCurrency || undefined,
					paymentTerms: paymentTerms || undefined,
					paymentMethod: paymentMethod || undefined,
					exchangeRate: exchangeRate || undefined,
					vatOnCollection: vatOnCollection || undefined,
					isCreditNote: isCreditNote || undefined,
					isActive: true
				});

				if (result.success) {
					// Update client with modified data
					await updateClient({
						clientId,
						name: clientName,
						email: clientEmail || undefined,
						phone: clientPhone || undefined,
						cui: clientCui || undefined,
						registrationNumber: clientRegistrationNumber || undefined,
						iban: clientIban || undefined,
						bankName: clientBankName || undefined,
						address: clientAddress || undefined,
						city: clientCity || undefined,
						county: clientCounty || undefined,
						postalCode: clientPostalCode || undefined,
						country: clientCountry || undefined
					}).updates(clientsQuery, ...(clientQuery ? [clientQuery] : []));

					toast.success('Recurring invoice created successfully');
					goto(`/${tenantSlug}/invoices`);
				}
			} else {
				// Create regular invoice with line items
				const result = await createInvoice({
					status,
					clientId,
					projectId: projectId || undefined,
					serviceId: serviceId || undefined,
					lineItems: lineItems.map((item) => ({
						description: item.description,
						quantity: item.quantity,
						rate: item.rate,
						taxRate: item.taxRate,
						discountType: item.discountType || undefined,
						discount: item.discount || undefined,
						note: item.note || undefined,
						currency: item.currency || undefined,
						unitOfMeasure: item.unitOfMeasure || undefined,
						keezItemExternalId: item.keezItem?.externalId || undefined,
						serviceId: item.serviceId || undefined
					})),
					currency: currency || undefined,
					issueDate: issueDate || undefined,
					dueDate: dueDate || undefined,
					notes: notes || undefined,
					invoiceSeries: invoiceSeries || undefined,
					invoiceNumber: invoiceNumber || undefined,
					invoiceCurrency: invoiceCurrency || undefined,
					paymentTerms: paymentTerms || undefined,
					paymentMethod: paymentMethod || undefined,
					exchangeRate: exchangeRate || undefined,
					vatOnCollection: vatOnCollection || undefined,
					isCreditNote: isCreditNote || undefined,
					taxApplicationType: taxApplicationType || undefined,
					discountType: invoiceDiscountType !== 'none' ? invoiceDiscountType : undefined,
					discountValue: invoiceDiscountType !== 'none' ? invoiceDiscountValue : undefined
				}).updates(getInvoices({}));

				if (result.success) {
					// Update client with modified data
					await updateClient({
						clientId,
						name: clientName,
						email: clientEmail || undefined,
						phone: clientPhone || undefined,
						cui: clientCui || undefined,
						registrationNumber: clientRegistrationNumber || undefined,
						iban: clientIban || undefined,
						bankName: clientBankName || undefined,
						address: clientAddress || undefined,
						city: clientCity || undefined,
						county: clientCounty || undefined,
						postalCode: clientPostalCode || undefined,
						country: clientCountry || undefined
					}).updates(clientsQuery, ...(clientQuery ? [clientQuery] : []));

					if (status === 'draft') {
						toast.success('Invoice saved as draft');
					} else {
						toast.success('Invoice created and sent successfully');
					}
					goto(`/${tenantSlug}/invoices`);
				}
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Error creating invoice';
			toast.error(error);
		} finally {
			loading = false;
		}
	}

	function formatDate(date: string): string {
		if (!date) return '';
		try {
			const d = new Date(date);
			return d.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
		} catch {
			return '';
		}
	}

	function formatNumber(value: number): string {
		return value.toFixed(2).replace('.', ',');
	}

	// Keez item options for combobox
	const keezItemOptions = $derived(
		keezItems.map((item) => ({
			value: item.externalId || '',
			label: `${item.name}${item.code ? ` (${item.code})` : ''}`
		}))
	);

	// Handle adding item from dialog
	function handleAddItemFromDialog() {
		if (dialogSourceType === 'service' && dialogServiceId) {
			const service = services.find((s) => s.id === dialogServiceId);
			if (service) {
				// Track service ID for invoice
				if (!serviceId) {
					serviceId = dialogServiceId;
				}
				const newItem: LineItem = {
					id: crypto.randomUUID(),
					description: service.name,
					quantity: 1,
					rate: service.price ? service.price / 100 : 0,
					taxRate: defaultTaxRate,
					discountType: '',
					discount: 0,
					note: dialogItemNote,
					currency: (service.currency as Currency) || currency,
					unitOfMeasure: 'Pcs',
					serviceId: dialogServiceId // Track service ID for this line item
				};
				lineItems = [...lineItems, newItem];
			}
		} else if (dialogSourceType === 'plugin-keez' && dialogPluginItemId['keez']) {
			const keezItem = keezItems.find((ki) => ki.externalId === dialogPluginItemId['keez']);
			if (keezItem) {
				const newItem: LineItem = {
					id: crypto.randomUUID(),
					description: keezItem.name,
					quantity: 1,
					rate: keezItem.lastPrice || 0,
					taxRate: defaultTaxRate,
					discountType: '',
					discount: 0,
					note: dialogItemNote,
					currency: (CURRENCIES.includes(keezItem.currencyCode as Currency) ? keezItem.currencyCode as Currency : currency),
					unitOfMeasure: ({ 1: 'Buc', 2: 'Luna om', 3: 'An', 4: 'Zi', 5: 'Ora', 6: 'Kg', 7: 'Km', 8: 'KWh', 9: 'KW', 10: 'M', 11: 'L', 12: 'Min', 13: 'Luna', 14: 'Mp', 15: 'Oz', 16: 'Per', 17: 'Trim', 18: 'T', 19: 'Sapt', 20: 'Mc', 22: 'Cutie', 23: 'Pag', 24: 'Rola', 25: 'Coala', 26: 'Tambur', 27: 'Set' } as Record<number, string>)[keezItem.measureUnitId] || 'Buc',
					keezItem: keezItem
				};
				lineItems = [...lineItems, newItem];
			}
		} else if (dialogSourceType === 'manual' && dialogItemDescription.trim()) {
			const newItem: LineItem = {
				id: crypto.randomUUID(),
				description: dialogItemDescription.trim(),
				quantity: 1,
				rate: 0,
				taxRate: defaultTaxRate,
				discountType: '',
				discount: 0,
				note: dialogItemNote,
				currency: currency,
				unitOfMeasure: 'Pcs'
			};
			lineItems = [...lineItems, newItem];
		}

		// Reset dialog state
		dialogSourceType = 'manual';
		dialogServiceId = '';
		dialogPluginItemId = {};
		dialogItemDescription = '';
		dialogItemNote = '';
		addItemDialogOpen = false;
	}

	// Add empty row to table
	function addEmptyRow() {
		const newItem: LineItem = {
			id: crypto.randomUUID(),
			description: '',
			quantity: 1,
			rate: 0,
			taxRate: defaultTaxRate,
			discountType: '',
			discount: 0,
			currency: currency,
			unitOfMeasure: 'Pcs'
		};
		lineItems = [...lineItems, newItem];
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="mb-8 flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">New Invoice</h1>
			<p class="mt-1 text-muted-foreground">Create a new invoice</p>
		</div>
		<div class="flex items-center gap-2">
			{#if !isRecurringInvoice}
				<Button
					type="button"
					variant="outline"
					disabled={loading}
					onclick={() => handleSubmit('draft')}
				>
					<FileText class="mr-2 h-4 w-4" />
					Save as Draft
				</Button>
			{/if}
			<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/invoices`)}>
				Cancel
			</Button>
			<Button
				type="button"
				disabled={loading}
				onclick={() => handleSubmit('sent')}
			>
				<Send class="mr-2 h-4 w-4" />
				{loading
					? isRecurringInvoice
						? 'Creating...'
						: 'Sending...'
					: isRecurringInvoice
						? 'Create Recurring Invoice'
						: 'Send Invoice'}
			</Button>
		</div>
	</div>

	<!-- Main Content -->
	<form
		id="invoice-form"
		onsubmit={(e) => e.preventDefault()}
		class="space-y-6"
	>
		<!-- Client and Invoice Details - Two Columns -->
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<!-- Client Information Card -->
			<Card class="border border-gray-200">
				<CardContent class="p-6">
					<div class="space-y-4">
						<p class="mb-4 text-sm font-semibold text-gray-900">Client Information</p>
						<div class="flex gap-2">
							<div class="flex-1">
								<Combobox
									bind:value={clientId}
									options={clientOptions}
									placeholder="Select a client"
									searchPlaceholder="Search clients..."
								/>
							</div>
							<Button
								type="button"
								variant="default"
								onclick={() => goto(`/${tenantSlug}/clients/new`)}
							>
								<Plus class="mr-2 h-4 w-4" />
								Add New Client
							</Button>
						</div>
						{#if currentClient}
							<div class="mt-4 space-y-4 border-t border-gray-200 pt-4">
								<!-- Basic Information -->
								<div class="grid grid-cols-2 gap-4">
									<div class="space-y-2">
										<Label>Name</Label>
										<Input bind:value={clientName} />
									</div>

									<div class="space-y-2">
										<Label>Email</Label>
										<Input bind:value={clientEmail} type="email" />
									</div>
									<div class="space-y-2">
										<Label>Phone</Label>
										<Input bind:value={clientPhone} />
									</div>
								</div>

								<!-- Legal Information -->
								<div class="grid grid-cols-2 gap-4 pt-2">
									<div class="space-y-2">
										<Label>Vat ID</Label>
										<Input bind:value={clientCui} />
									</div>
									<div class="space-y-2">
										<Label>Registration Number</Label>
										<Input bind:value={clientRegistrationNumber} />
									</div>
								</div>

								<!-- Banking Information -->
								<div class="grid grid-cols-2 gap-4 pt-2">
									<div class="space-y-2">
										<Label>IBAN</Label>
										<Input bind:value={clientIban} />
									</div>
									<div class="space-y-2">
										<Label>Bank Name</Label>
										<Input bind:value={clientBankName} />
									</div>
								</div>

								<!-- Address Information -->
								<div class="grid grid-cols-2 gap-4 pt-2">
									<div class="space-y-2">
										<Label>Address</Label>
										<Input bind:value={clientAddress} />
									</div>
									<div class="space-y-2">
										<Label>City</Label>
										<Input bind:value={clientCity} />
									</div>
									<div class="space-y-2">
										<Label>County</Label>
										<Input bind:value={clientCounty} />
									</div>
									<div class="space-y-2">
										<Label>Postal Code</Label>
										<Input bind:value={clientPostalCode} />
									</div>
									<div class="space-y-2">
										<Label>Country</Label>
										<Input bind:value={clientCountry} />
									</div>
								</div>
							</div>
						{/if}
					</div>
				</CardContent>
			</Card>

			<!-- Invoice Details Card -->
			<Card class="border border-gray-200">
				<CardContent class="p-6">
					<div class="space-y-4">
						<p class="mb-4 text-sm font-semibold text-gray-900">Invoice Details</p>
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label>Series</Label>
								<Input bind:value={invoiceSeries} placeholder="Enter invoice series" />
							</div>
							<div class="space-y-2">
								<Label>Number</Label>
								<Input
									bind:value={invoiceNumber}
									placeholder="521"
									readonly={isKeezActive}
									disabled={isKeezActive}
									class={isKeezActive ? 'opacity-70 cursor-not-allowed' : ''}
								/>
							</div>
							<div class="space-y-2">
								<Label>Date</Label>
								<div class="relative">
									<Calendar
										class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform text-gray-400"
									/>
									<Input
										bind:value={issueDate}
										type="date"
										class="pl-10"
										required
										disabled={isRecurringInvoice}
										readonly={isRecurringInvoice}
									/>
									{#if isRecurringInvoice}
										<p class="mt-1 text-xs text-muted-foreground">
											Calculated: {calculatedIssueDate}
										</p>
									{/if}
								</div>
							</div>
							<div class="space-y-2">
								<Label>Payment Terms</Label>
								<Select type="single" bind:value={paymentTerms}>
									<SelectTrigger>
										{paymentTerms || 'Select payment terms'}
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="Net 15">Net 15</SelectItem>
										<SelectItem value="Net 30">Net 30</SelectItem>
										<SelectItem value="Net 45">Net 45</SelectItem>
										<SelectItem value="Net 60">Net 60</SelectItem>
										<SelectItem value="Net 90">Net 90</SelectItem>
										<SelectItem value="Due on Receipt">Due on Receipt</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div class="space-y-2">
								<Label>Due Date</Label>
								<div class="relative">
									<Calendar
										class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform text-gray-400"
									/>
									<Input
										bind:value={dueDate}
										type="date"
										class="pl-10"
										required
										disabled={isRecurringInvoice}
										readonly={isRecurringInvoice}
									/>
									{#if isRecurringInvoice}
										<p class="mt-1 text-xs text-muted-foreground">
											Calculated: {calculatedDueDate}
										</p>
									{/if}
								</div>
							</div>
							<div class="space-y-2">
								<Label>Project</Label>
								<Combobox
									bind:value={projectId}
									options={[
										{ value: '', label: 'None' },
										...filteredProjects.map((p) => ({ value: p.id, label: p.name }))
									]}
									placeholder="Select a project (optional)"
									searchPlaceholder="Search projects..."
								/>
							</div>
							<div class="space-y-2">
								<Label>Payment</Label>
								<Select type="single" bind:value={paymentMethod}>
									<SelectTrigger>
										{paymentMethod || 'Select payment method'}
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
										<SelectItem value="BFCard">Bon Fiscal Card</SelectItem>
										<SelectItem value="BFCash">Bon Fiscal Cash</SelectItem>
										<SelectItem value="ChitCash">Chitanță Cash</SelectItem>
										<SelectItem value="Ramburs">Ramburs</SelectItem>
										<SelectItem value="ProcesatorPlati">Procesator Plăți</SelectItem>
										<SelectItem value="PlatformaDistributie">Platformă Distribuție</SelectItem>
										<SelectItem value="VoucherVacantaCard">Voucher Vacanță Card</SelectItem>
										<SelectItem value="VoucherVacantaTichet">Voucher Vacanță Tichet</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div class="space-y-2">
								<Label>Calculation Currency</Label>
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
								<Label>Invoice Currency</Label>
								<Select type="single" bind:value={invoiceCurrency}>
									<SelectTrigger>
										{invoiceCurrency}
									</SelectTrigger>
									<SelectContent>
										{#each CURRENCIES as curr}
											<SelectItem value={curr}>{curr}</SelectItem>
										{/each}
									</SelectContent>
								</Select>
							</div>
							<div class="space-y-2">
								<Label>Exchange Rate</Label>
								<Input
									bind:value={exchangeRate}
									placeholder={currency === invoiceCurrency ? '1,0000' : 'Enter exchange rate'}
								/>
							</div>
							<div class="space-y-2">
								<Label>Tax Application</Label>
								<Select type="single" bind:value={taxApplicationType}>
									<SelectTrigger>
										{taxApplicationType === 'apply'
											? 'Apply Tax (Normala)'
											: taxApplicationType === 'none'
												? 'Do Not Apply Tax'
												: 'Reverse Tax (Taxare inversa)'}
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="apply">Apply Tax (Normala)</SelectItem>
										<SelectItem value="none">Do Not Apply Tax</SelectItem>
										<SelectItem value="reverse">Reverse Tax (Taxare inversa)</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div class="col-span-2 mt-2 flex items-center gap-4">
								<div class="flex items-center gap-2">
									<Checkbox id="vat-on-collection" bind:checked={vatOnCollection} />
									<label for="vat-on-collection" class="cursor-pointer text-sm text-gray-700">
										VAT on Collection
									</label>
								</div>
								<div class="flex items-center gap-2">
									<Checkbox id="credit-note" bind:checked={isCreditNote} />
									<label for="credit-note" class="cursor-pointer text-sm text-gray-700">
										Credit Note
									</label>
								</div>
								<div class="flex items-center gap-2">
									<Checkbox id="recurring-invoice" bind:checked={isRecurringInvoice} />
									<label for="recurring-invoice" class="cursor-pointer text-sm text-gray-700">
										Create as Recurring Invoice
									</label>
								</div>
							</div>
							{#if isRecurringInvoice}
								<div class="col-span-2 mt-4 space-y-4 border-t border-gray-200 pt-4">
									<p class="text-sm font-semibold text-gray-900">Recurring Settings</p>

									<div class="grid grid-cols-2 gap-4">
										<div class="space-y-2">
											<Label>Recurring Type</Label>
											<Select type="single" bind:value={recurringType}>
												<SelectTrigger>
													{recurringType.charAt(0).toUpperCase() + recurringType.slice(1)}
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="daily">Daily</SelectItem>
													<SelectItem value="weekly">Weekly</SelectItem>
													<SelectItem value="monthly">Monthly</SelectItem>
													<SelectItem value="yearly">Yearly</SelectItem>
												</SelectContent>
											</Select>
										</div>

										<div class="space-y-2">
											<Label>Interval</Label>
											<Input
												type="number"
												bind:value={recurringInterval}
												min="1"
												placeholder="1"
											/>
											<p class="text-xs text-muted-foreground">
												Every {recurringInterval} {recurringInterval === 1
													? recurringType === 'daily'
														? 'day'
														: recurringType === 'weekly'
															? 'week'
															: recurringType === 'monthly'
																? 'month'
																: 'year'
													: recurringType === 'daily'
														? 'days'
														: recurringType === 'weekly'
															? 'weeks'
															: recurringType === 'monthly'
																? 'months'
																: 'years'}
											</p>
										</div>

										<div class="space-y-2">
											<Label>Start Date</Label>
											<Input
												type="date"
												bind:value={recurringStartDate}
												required
											/>
										</div>

										<div class="space-y-2">
											<Label>End Date (Optional)</Label>
											<Input
												type="date"
												bind:value={recurringEndDate}
											/>
										</div>

										<div class="space-y-2">
											<Label>Issue Date Offset (days)</Label>
											<Input
												type="number"
												bind:value={recurringIssueDateOffset}
												placeholder="0"
											/>
										</div>

										<div class="space-y-2">
											<Label>Due Date Offset (days)</Label>
											<Input
												type="number"
												bind:value={recurringDueDateOffset}
												placeholder="30"
											/>
										</div>
									</div>
								</div>
							{/if}
						</div>
					</div>
				</CardContent>
			</Card>
		</div>

		<!-- Items Card -->
		<Card class="border border-gray-200">
			<CardContent class="p-6">
				<div class="space-y-4">
					<div class="mb-4 flex items-center justify-between">
						<p class="text-sm font-semibold text-gray-900">Items</p>
						<Dialog bind:open={addItemDialogOpen}>
							<DialogTrigger>
								{#snippet child({ props })}
									<Button type="button" variant="outline" size="sm" {...props}>
										<Plus class="mr-2 h-4 w-4" />
										Add Item
									</Button>
								{/snippet}
							</DialogTrigger>
							<DialogContent class="max-w-2xl">
								<DialogHeader>
									<DialogTitle>Add Item to Invoice</DialogTitle>
									<DialogDescription>
										Select an item from a service, project, Keez, or add manually
									</DialogDescription>
								</DialogHeader>
								<Tabs
									bind:value={dialogSourceType}
									onValueChange={(val) => (dialogSourceType = val)}
								>
									<TabsList
										class="grid w-full {invoiceProviderPlugins.length === 0
											? 'grid-cols-2'
											: invoiceProviderPlugins.length === 1
												? 'grid-cols-3'
												: 'grid-cols-4'}"
									>
										<TabsTrigger value="service">From Service</TabsTrigger>
										{#each invoiceProviderPlugins as plugin}
											<TabsTrigger value="plugin-{plugin.name}"
												>From {plugin.name.charAt(0).toUpperCase() +
													plugin.name.slice(1)}</TabsTrigger
											>
										{/each}
										<TabsTrigger value="manual">Manual</TabsTrigger>
									</TabsList>
									<TabsContent value="service" class="space-y-4">
										<div class="space-y-2">
											<Label>Select Service</Label>
											<Combobox
												bind:value={dialogServiceId}
												options={[
													{ value: '', label: 'Select a service' },
													...filteredServices.map((s) => ({ value: s.id, label: s.name }))
												]}
												placeholder="Select a service"
												searchPlaceholder="Search services..."
											/>
										</div>
										<div class="space-y-2">
											<Label>Item Note (Optional)</Label>
											<Textarea
												bind:value={dialogItemNote}
												placeholder="Add transaction-specific details..."
												rows={2}
											/>
										</div>
									</TabsContent>
									{#each invoiceProviderPlugins as plugin}
										{#if plugin.name === 'keez'}
											<TabsContent value="plugin-keez" class="space-y-4">
												<div class="space-y-2">
													<Label>Select Keez Item</Label>
													<Combobox
														options={keezItemOptions}
														value={dialogPluginItemId['keez'] || ''}
														onValueChange={(val) => {
															dialogPluginItemId = {
																...dialogPluginItemId,
																keez: String(val || '')
															};
															const keezItem = keezItems.find((ki) => ki.externalId === val);
															if (keezItem) {
																dialogItemDescription = keezItem.name;
															}
														}}
														placeholder="Select from Keez items"
														searchPlaceholder="Search Keez items..."
													/>
												</div>
												<div class="space-y-2">
													<Label>Item Note (Optional)</Label>
													<Textarea
														bind:value={dialogItemNote}
														placeholder="Add transaction-specific details..."
														rows={2}
													/>
												</div>
											</TabsContent>
										{/if}
									{/each}
									<TabsContent value="manual" class="space-y-4">
										<div class="space-y-2">
											<Label>Item Description</Label>
											<Input
												bind:value={dialogItemDescription}
												placeholder="Describe the service or product"
											/>
										</div>
										<div class="space-y-2">
											<Label>Item Note (Optional)</Label>
											<Textarea
												bind:value={dialogItemNote}
												placeholder="Add transaction-specific details..."
												rows={2}
											/>
										</div>
									</TabsContent>
								</Tabs>
								<DialogFooter>
									<Button
										type="button"
										variant="outline"
										onclick={() => {
											addItemDialogOpen = false;
											dialogSourceType = 'manual';
											dialogServiceId = '';
											dialogPluginItemId = {};
											dialogItemDescription = '';
											dialogItemNote = '';
										}}
									>
										Cancel
									</Button>
									<Button type="button" onclick={handleAddItemFromDialog}>Add Item</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</div>

					<!-- Line Items Table -->
					<div class="overflow-x-auto">
						<table class="w-full border-collapse">
							<thead>
								<tr class="border-b border-gray-200">
									<th
										class="px-4 py-3 text-left text-sm font-semibold text-gray-700"
										style="min-width: 200px;">Item</th
									>
									<th
										class="px-4 py-3 text-left text-sm font-semibold text-gray-700"
										style="width: 80px;">Unit</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 100px;">Quantity</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 120px;">Unit Price</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 120px;">Discount Type</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 100px;">Discount</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 100px;">Amount</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 80px;">VAT</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 120px;">Final Amount</th
									>
									<th class="w-10 px-4">
										<Button
											type="button"
											variant="ghost"
											size="icon"
											class="h-6 w-6"
											onclick={addEmptyRow}
											title="Add empty row"
										>
											<Plus class="h-4 w-4" />
										</Button>
									</th>
								</tr>
							</thead>
							<tbody>
								{#each lineItems as item}
									{@const itemSubtotal = item.quantity * item.rate}
									{@const itemDiscount =
										item.discountType === 'percent'
											? (itemSubtotal * (item.discount || 0)) / 100
											: item.discountType === 'fixed'
												? item.discount || 0
												: 0}
									{@const itemNetValue = itemSubtotal - itemDiscount}
									{@const itemTaxRate = item.taxRate || defaultTaxRate}
									{@const itemTaxValue =
										taxApplicationType === 'apply'
											? (itemNetValue * itemTaxRate) / 100
											: 0}
									{@const itemFinalValue = itemNetValue + itemTaxValue}
									<tr class="border-b border-gray-100">
										<td class="px-4 py-3">
											<Input
												bind:value={item.description}
												oninput={(e) => updateItem(item.id, 'description', e.currentTarget.value)}
												placeholder="Describe the service or product"
												class="h-auto w-full border-0 bg-transparent p-0"
											/>
										</td>
										<td class="px-4 py-3">
											<Input
												value={item.unitOfMeasure || 'Pcs'}
												oninput={(e) => updateItem(item.id, 'unitOfMeasure', e.currentTarget.value)}
												class="h-auto w-full border-0 bg-transparent p-0"
											/>
										</td>
										<td class="px-4 py-3 text-right">
											<Input
												type="number"
												step="0.0001"
												value={item.quantity}
												oninput={(e) =>
													updateItem(item.id, 'quantity', parseFloat(e.currentTarget.value) || 0)}
												class="h-auto w-full border-0 bg-transparent p-0 text-right"
											/>
										</td>
										<td class="px-4 py-3 text-right">
											<Input
												type="number"
												step="0.0001"
												value={item.rate}
												oninput={(e) =>
													updateItem(item.id, 'rate', parseFloat(e.currentTarget.value) || 0)}
												class="h-auto w-full border-0 bg-transparent p-0 text-right"
												placeholder="0,0000"
											/>
										</td>
										<td class="px-4 py-3 text-right">
											<Select
												type="single"
												bind:value={item.discountType}
												onValueChange={(val) => updateItem(item.id, 'discountType', val || '')}
											>
												<SelectTrigger class="h-8 w-full border-0 bg-transparent">
													{item.discountType || '-'}
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="">-</SelectItem>
													<SelectItem value="percent">%</SelectItem>
													<SelectItem value="fixed">Fixed</SelectItem>
												</SelectContent>
											</Select>
										</td>
										<td class="px-4 py-3 text-right">
											<Input
												type="number"
												step="0.01"
												value={item.discount || 0}
												oninput={(e) =>
													updateItem(item.id, 'discount', parseFloat(e.currentTarget.value) || 0)}
												class="h-auto w-full border-0 bg-transparent p-0 text-right"
											/>
										</td>
										<td class="px-4 py-3 text-right font-medium text-gray-900">
											{formatNumber(itemSubtotal)}
										</td>
										<td class="px-4 py-3 text-right text-nowrap text-gray-900">
											{taxApplicationType === 'apply' ? `${itemTaxRate} %` : '-'}
										</td>
										<td class="px-4 py-3 text-right font-medium text-gray-900">
											{formatNumber(itemFinalValue)}
										</td>
										<td class="px-4 py-3 text-center">
											<Button
												type="button"
												variant="ghost"
												size="icon"
												class="h-6 w-6"
												onclick={() => removeLineItem(item.id)}
											>
												<X class="h-4 w-4" />
											</Button>
										</td>
									</tr>
								{:else}
									<tr>
										<td colspan="11" class="py-8 text-center text-gray-500">
											No items yet. Click the + button to add items.
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- Notes & Attachments Card -->
		<Card class="border border-gray-200">
			<CardContent class="p-6">
				<div class="space-y-4">
					<p class="mb-4 text-sm font-semibold text-gray-900">Notes & Attachments</p>
					<Textarea
						bind:value={notes}
						placeholder="Add any additional notes or payment instructions."
						rows={3}
						class="resize-none"
					/>
				</div>
			</CardContent>
		</Card>

		<!-- Summary Card - Invoice Style -->
		<Card class="border border-gray-200">
			<CardContent class="p-6">
				<div class="space-y-4">
					<p class="mb-4 text-sm font-semibold text-gray-900">Summary</p>

					<!-- Discount Controls -->
					<div class="space-y-2 border-b border-gray-200 pb-4">
						<Label>Discount</Label>
						<div class="flex gap-2">
							<Select
								type="single"
								bind:value={invoiceDiscountType}
								onValueChange={(val) => {
									invoiceDiscountType = val as 'none' | 'percent' | 'value';
									if (val === 'none') invoiceDiscountValue = 0;
								}}
							>
								<SelectTrigger class="flex-1">
									{invoiceDiscountType === 'none'
										? 'No Discount'
										: invoiceDiscountType === 'percent'
											? 'P - Percentage'
											: 'V - Value'}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">No Discount</SelectItem>
									<SelectItem value="percent">P - Percentage</SelectItem>
									<SelectItem value="value">V - Value</SelectItem>
								</SelectContent>
							</Select>
							{#if invoiceDiscountType !== 'none'}
								<Input
									type="number"
									step="0.01"
									bind:value={invoiceDiscountValue}
									placeholder="0,00"
									class="w-24"
								/>
							{/if}
						</div>
					</div>

					<div class="space-y-3">
						<div class="flex justify-between">
							<span class="text-gray-700">Subtotal</span>
							<span class="font-medium text-gray-900">{formatNumber(subtotal)} {currency}</span>
						</div>
						{#if taxApplicationType === 'apply'}
							<div class="flex justify-between">
								<span class="text-gray-700">Tax Total ({defaultTaxRate}%)</span>
								<span class="font-medium text-gray-900">{formatNumber(taxTotal)} {currency}</span>
							</div>
						{/if}
						{#if invoiceDiscountType !== 'none' && invoiceDiscountAmount > 0}
							<div class="flex justify-between">
								<span class="text-gray-700">Discount</span>
								<span class="font-medium text-gray-900"
									>-{formatNumber(invoiceDiscountAmount)} {currency}</span
								>
							</div>
						{/if}
						<Separator />
						<div class="flex justify-between">
							<span class="text-lg font-semibold text-gray-900">Grand Total</span>
							<span class="text-lg font-bold text-gray-900"
								>{formatNumber(grandTotal)} {currency}</span
							>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>

		{#if error}
			<div class="rounded-md border border-red-200 bg-red-50 p-4">
				<p class="text-sm text-red-800">{error}</p>
			</div>
		{/if}
	</form>
</div>
