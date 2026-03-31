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
	import { getBnrRate } from '$lib/remotes/bnr.remote';
	import { getPlugins } from '$lib/remotes/plugins.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import { getContracts } from '$lib/remotes/contracts.remote';
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
	import ClientComboboxLogo from '$lib/components/client-combobox-logo.svelte';
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
	import { Calendar as CalendarIcon, X, Plus, Trash2, FileText, Send, Save, Hash, CreditCard, ArrowLeftRight, Percent, Clock, FolderOpen, RefreshCw, BadgePercent, Banknote, User, Building2, MapPin, Mail, Phone, Landmark } from '@lucide/svelte';
	import { Calendar } from '$lib/components/ui/calendar';
	import * as Popover from '$lib/components/ui/popover';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
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

	// Log Keez items when loaded
	$effect(() => {
		if (isKeezActive && keezItems.length > 0) {
			clientLogger.info({ message: `Keez articole încărcate: ${keezItems.length} articole`, action: 'keez_items_loaded' });
		}
	});

	// Form state
	let clientId = $state('');
	let contractId = $state('');
	let selectedClient = $derived(clientId ? clients.find((c) => c.id === clientId) : null);
	let clientQuery = $derived(clientId ? getClient(clientId) : null);
	let clientData = $derived(clientQuery?.current);

	// Contracts for selected client
	const clientContractsQuery = $derived(clientId ? getContracts({ clientId, status: ['signed', 'active'] }) : null);
	const clientContracts = $derived(clientContractsQuery?.current?.contracts || []);

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

				// Auto-set tax application based on client country
				// Romania: apply tax (TVA 19%), EU non-RO: reverse charge (no VAT), non-EU: no VAT
				const country = (currentClient.country || 'România').toUpperCase().trim();
				const isRO = country === 'ROMÂNIA' || country === 'ROMANIA' || country === 'RO';
				if (!isRO) {
					taxApplicationType = 'reverse';
				} else {
					taxApplicationType = 'apply';
				}
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
	let issueDateValue = $state<DateValue | undefined>((() => { const d = new Date(); return new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate()); })());
	let issueDateOpen = $state(false);
	let dueDate = $state('');
	let dueDateValue = $state<DateValue | undefined>(undefined);
	let dueDateOpen = $state(false);
	let paymentTermsDays = $state(5);
	const paymentTerms = $derived(`Net ${paymentTermsDays}`);
	// Map keezDefaultPaymentTypeId (integer) to Keez code string
	const KEEZ_PAYMENT_ID_TO_CODE: Record<number, string> = {
		1: 'BFCash', 2: 'BFCard', 3: 'Bank', 4: 'ChitCash',
		5: 'Ramburs', 6: 'ProcesatorPlati', 7: 'PlatformaDistributie',
		8: 'VoucherVacantaCard', 9: 'VoucherVacantaTichet'
	};
	const KEEZ_PAYMENT_LABELS: Record<string, string> = {
		BFCash: 'Bon fiscal platit cu numerar',
		BFCard: 'Bon fiscal platit cu cardul',
		Bank: 'Transfer bancar',
		ChitCash: 'Plată numerar cu chitanță',
		Ramburs: 'Ramburs',
		ProcesatorPlati: 'Procesator plăți (PayU, Netopia, euplatesc)',
		PlatformaDistributie: 'Platforme distribuție și plată (Emag)',
		VoucherVacantaCard: 'Voucher de Vacanță - Card',
		VoucherVacantaTichet: 'Voucher de Vacanță - Tichet'
	};
	let paymentMethod = $state('Bank Transfer');
	let exchangeRate = $state('');
	// BNR rate query — reactive, updates when target currency changes
	const bnrTargetCurrency = $derived(
		currency !== invoiceCurrency
			? (currency !== 'RON' ? currency : invoiceCurrency !== 'RON' ? invoiceCurrency : null)
			: null
	);
	let bnrRateQuery = $derived(bnrTargetCurrency ? getBnrRate(bnrTargetCurrency) : null);
	let bnrRate = $derived(bnrRateQuery?.current ?? null);
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
	let recurringStartDateValue = $state<DateValue | undefined>((() => { const d = new Date(); return new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate()); })());
	let recurringEndDateValue = $state<DateValue | undefined>(undefined);
	let recurringStartDateOpen = $state(false);
	let recurringEndDateOpen = $state(false);
	let recurringIssueDateOffset = $state(0);
	let recurringDurationMonths = $state<number | undefined>(undefined);
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

		if (isKeezActive) {
			clientLogger.info({ message: `Keez plugin activ. Setări: serie=${invoiceSettings?.keezSeries}, startNr=${invoiceSettings?.keezStartNumber}, paymentType=${invoiceSettings?.keezDefaultPaymentTypeId}`, action: 'keez_plugin_init' });
		}

		if (invoiceSettings) {
			// Set currency from settings
			if (invoiceSettings.defaultCurrency) {
				currency = invoiceSettings.defaultCurrency as Currency;
				invoiceCurrency = invoiceSettings.defaultCurrency as Currency;
			}
			// Set default payment method from Keez settings
			if (isKeezActive && invoiceSettings.keezDefaultPaymentTypeId) {
				paymentMethod = KEEZ_PAYMENT_ID_TO_CODE[invoiceSettings.keezDefaultPaymentTypeId] || 'Bank';
				clientLogger.info({ message: `Keez metoda plată default: ${paymentMethod} (id=${invoiceSettings.keezDefaultPaymentTypeId})`, action: 'keez_payment_default' });
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

		if (isKeezActive) {
			clientLogger.info({ message: `Keez serie=${series}, număr=${number} (live=${keezLiveNumber}, fallback=${defaultInvoiceNumber()})`, action: 'keez_number_resolved' });
		}

		console.log('[invoice/new] resolved series:', series, '| resolved number:', number, '| keezNextNumber:', keezNextNumber);
	});

	// Update exchange rate when currencies change — auto-fill from BNR
	$effect(() => {
		if (currency === invoiceCurrency && currency) {
			exchangeRate = '1,0000';
		} else if (currency !== invoiceCurrency) {
			if (exchangeRate === '1,0000') {
				exchangeRate = '';
			}
		}
	});

	// Auto-fill exchange rate from BNR when available
	$effect(() => {
		if (bnrRate && !exchangeRate) {
			exchangeRate = bnrRate.toFixed(4).replace('.', ',');
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
		date.setDate(date.getDate() + (paymentTermsDays || 30));
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
			const dd = new Date(calculatedDueDate);
			dueDateValue = new CalendarDate(dd.getFullYear(), dd.getMonth() + 1, dd.getDate());
		}
	});

	// Update issue and due dates when recurring settings change
	$effect(() => {
		if (isRecurringInvoice) {
			issueDate = calculatedIssueDate;
			dueDate = calculatedDueDate;
		}
	});

	// Sync issueDateValue -> issueDate string
	$effect(() => {
		if (issueDateValue) {
			issueDate = `${issueDateValue.year}-${String(issueDateValue.month).padStart(2, '0')}-${String(issueDateValue.day).padStart(2, '0')}`;
		}
	});

	// Sync dueDateValue -> dueDate string
	$effect(() => {
		if (dueDateValue) {
			dueDate = `${dueDateValue.year}-${String(dueDateValue.month).padStart(2, '0')}-${String(dueDateValue.day).padStart(2, '0')}`;
		}
	});

	// Sync recurringStartDateValue -> recurringStartDate string
	$effect(() => {
		if (recurringStartDateValue) {
			recurringStartDate = `${recurringStartDateValue.year}-${String(recurringStartDateValue.month).padStart(2, '0')}-${String(recurringStartDateValue.day).padStart(2, '0')}`;
		}
	});

	// Sync recurringEndDateValue -> recurringEndDate string
	$effect(() => {
		if (recurringEndDateValue) {
			recurringEndDate = `${recurringEndDateValue.year}-${String(recurringEndDateValue.month).padStart(2, '0')}-${String(recurringEndDateValue.day).padStart(2, '0')}`;
		} else {
			recurringEndDate = '';
		}
	});

	// Auto-calculate End Date from Start Date + duration months
	$effect(() => {
		if (recurringDurationMonths && recurringDurationMonths > 0 && recurringStartDateValue) {
			const d = new Date(recurringStartDate + 'T00:00:00');
			d.setMonth(d.getMonth() + recurringDurationMonths);
			recurringEndDateValue = new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
		}
	});


	// Filter services and projects by selected client
	const clientOptions = $derived(
		clients.map((c) => ({
			value: c.id,
			label: c.cui ? `${c.cui} - ${c.name}` : c.name,
			meta: {
				name: c.name,
				websiteUrl: (c.defaultWebsiteUrl ?? c.website ?? null) as string | null
			}
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
			// Apply item-level discount before calculating tax
			const itemDiscount =
				item.discountType === 'percent'
					? (itemSubtotal * (item.discount || 0)) / 100
					: item.discountType === 'fixed'
						? item.discount || 0
						: 0;
			const itemNetValue = itemSubtotal - itemDiscount;
			// Only calculate tax if taxApplicationType is 'apply' — tax on net value (after discount)
			const itemTax =
				taxApplicationType === 'apply'
					? (itemNetValue * (item.taxRate || defaultTaxRate)) / 100
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
			clientLogger.warn({ message: 'Please select a client', action: 'invoice_create' });
			return;
		}

		if (!clientName.trim()) {
			error = 'Client name is required';
			clientLogger.warn({ message: 'Client name is required', action: 'invoice_create' });
			return;
		}

		if (lineItems.length === 0) {
			error = 'Please add at least one item';
			clientLogger.warn({ message: 'Please add at least one item', action: 'invoice_create' });
			return;
		}

		if (lineItems.some((item) => !item.description.trim())) {
			error = 'All items must have a description';
			clientLogger.warn({ message: 'All items must have a description', action: 'invoice_create' });
			return;
		}

		// Validate recurring invoice fields if enabled
		if (isRecurringInvoice) {
			if (!recurringStartDate) {
				error = 'Start date is required for recurring invoices';
				clientLogger.warn({ message: 'Start date is required for recurring invoices', action: 'invoice_create' });
				return;
			}
			if (recurringInterval < 1) {
				error = 'Recurring interval must be at least 1';
				clientLogger.warn({ message: 'Recurring interval must be at least 1', action: 'invoice_create' });
				return;
			}
		}

		loading = true;
		error = null;

		if (isKeezActive) {
			const keezLineItems = lineItems.filter((i) => i.keezItem);
			clientLogger.info({
				message: `Keez submit ${isRecurringInvoice ? 'recurent' : 'factură'}: serie=${invoiceSeries}, nr=${invoiceNumber}, articole=${lineItems.length} (keez=${keezLineItems.length}), plată=${paymentMethod}, monedă=${currency}/${invoiceCurrency}`,
				action: isRecurringInvoice ? 'keez_recurring_submit' : 'keez_invoice_submit'
			});
		}

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
					dueDateOffset: paymentTermsDays,
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
					contractId: contractId || undefined,
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
			clientLogger.apiError('invoice_create', e);
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

	// Keez item options for combobox — show price so user sees which items have values
	const keezItemOptions = $derived(
		keezItems.map((item) => ({
			value: item.externalId || '',
			label: `${item.name}${item.code ? ` (${item.code})` : ''} — ${item.lastPrice ? `${item.lastPrice} ${item.currencyCode || 'RON'}` : 'fără preț'}`
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
				const MEASURE_UNIT_MAP: Record<number, string> = { 1: 'Buc', 2: 'Luna om', 3: 'An', 4: 'Zi', 5: 'Ora', 6: 'Kg', 7: 'Km', 8: 'KWh', 9: 'KW', 10: 'M', 11: 'L', 12: 'Min', 13: 'Luna', 14: 'Mp', 15: 'Oz', 16: 'Per', 17: 'Trim', 18: 'T', 19: 'Sapt', 20: 'Mc', 22: 'Cutie', 23: 'Pag', 24: 'Rola', 25: 'Coala', 26: 'Tambur', 27: 'Set' };
				const newItem: LineItem = {
					id: crypto.randomUUID(),
					description: keezItem.name,
					quantity: 1,
					rate: keezItem.lastPrice || 0,
					taxRate: keezItem.vatRate && keezItem.vatRate > 0 ? keezItem.vatRate : defaultTaxRate,
					discountType: '',
					discount: 0,
					note: dialogItemNote,
					currency: (CURRENCIES.includes(keezItem.currencyCode as Currency) ? keezItem.currencyCode as Currency : currency),
					unitOfMeasure: MEASURE_UNIT_MAP[keezItem.measureUnitId] || 'Buc',
					keezItem: keezItem
				};
				lineItems = [...lineItems, newItem];
				clientLogger.info({ message: `Keez articol adăugat: "${keezItem.name}" (externalId=${keezItem.externalId}, preț=${keezItem.lastPrice}, TVA=${keezItem.vatRate}%, monedă=${keezItem.currencyCode})`, action: 'keez_item_added' });
				if (!keezItem.lastPrice) {
					clientLogger.warn({ message: `Articolul "${keezItem.name}" nu are preț în Keez. Completează prețul manual.`, action: 'invoice_add_keez_item' });
				}
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
			<h1 class="text-3xl font-bold tracking-tight">{isKeezActive ? 'Factură nouă' : 'New Invoice'}</h1>
			<p class="mt-1 text-muted-foreground">{isKeezActive ? 'Creează o factură nouă' : 'Create a new invoice'}</p>
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
					{isKeezActive ? 'Salvează ciornă' : 'Save as Draft'}
				</Button>
			{/if}
			<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/invoices`)}>
				{isKeezActive ? 'Anulează' : 'Cancel'}
			</Button>
			<Button
				type="button"
				disabled={loading}
				onclick={() => handleSubmit('sent')}
			>
				<Send class="mr-2 h-4 w-4" />
				{loading
					? isRecurringInvoice
						? (isKeezActive ? 'Se creează...' : 'Creating...')
						: (isKeezActive ? 'Se trimite...' : 'Sending...')
					: isRecurringInvoice
						? (isKeezActive ? 'Creează factură recurentă' : 'Create Recurring Invoice')
						: (isKeezActive ? 'Trimite factura' : 'Send Invoice')}
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
			<Card class="border shadow-sm">
				<CardContent class="space-y-5 p-6">
					<div class="flex items-center justify-between border-b pb-4">
						<div class="flex items-center gap-2">
							<User class="h-4 w-4 text-muted-foreground" />
							<h2 class="text-sm font-semibold">{isKeezActive ? 'Informații client' : 'Client Information'}</h2>
						</div>
						{#if currentClient}
							<span class="text-xs text-muted-foreground">{currentClient.name}</span>
						{/if}
					</div>
					<!-- Client Selector -->
					<div class="flex gap-2">
						<div class="flex-1">
							<Combobox
								bind:value={clientId}
								options={clientOptions}
								placeholder={isKeezActive ? 'Selectează client' : 'Select a client'}
								searchPlaceholder={isKeezActive ? 'Caută clienți...' : 'Search clients...'}
							>
								{#snippet optionSnippet({ option })}
									<span class="flex items-center gap-2">
										<ClientComboboxLogo
											website={option.meta?.websiteUrl as string | null}
											name={(option.meta?.name as string) ?? option.label}
										/>
										<span class="truncate">{option.label}</span>
									</span>
								{/snippet}
								{#snippet selectedSnippet({ option })}
									<span class="flex items-center gap-2">
										<ClientComboboxLogo
											website={option.meta?.websiteUrl as string | null}
											name={(option.meta?.name as string) ?? option.label}
										/>
										<span class="truncate">{option.label}</span>
									</span>
								{/snippet}
							</Combobox>
						</div>
						<Button
							type="button"
							variant="default"
							onclick={() => goto(`/${tenantSlug}/clients/new`)}
						>
							<Plus class="mr-2 h-4 w-4" />
							{isKeezActive ? 'Adaugă client nou' : 'Add New Client'}
						</Button>
					</div>

					{#if clientContracts.length > 0}
						<div class="space-y-1.5 mt-3">
							<Label class="text-xs text-muted-foreground">Contract asociat (opțional)</Label>
							<select
								class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
								bind:value={contractId}
							>
								<option value="">— Fără contract —</option>
								{#each clientContracts as c}
									<option value={c.id}>{c.contractNumber} — {c.contractTitle || 'Contract'}</option>
								{/each}
							</select>
						</div>
					{/if}

					{#if currentClient}
						<!-- Contact -->
						<div class="rounded-xl border border-teal-100 bg-teal-50/60 p-4 dark:border-teal-900/40 dark:bg-teal-950/20">
							<div class="mb-3 flex items-center gap-2">
								<div class="rounded-md bg-teal-100 p-1.5 dark:bg-teal-900/50">
									<User class="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
								</div>
								<span class="text-xs font-semibold uppercase tracking-widest text-teal-600 dark:text-teal-400">{isKeezActive ? 'Contact' : 'Contact'}</span>
							</div>
							<div class="grid grid-cols-2 gap-3">
								<div class="space-y-1.5">
									<Label class="text-xs text-muted-foreground">{isKeezActive ? 'Nume' : 'Name'}</Label>
									<Input bind:value={clientName} />
								</div>
								<div class="space-y-1.5">
									<Label class="flex items-center gap-1.5 text-xs text-muted-foreground">
										<Mail class="h-3 w-3" /> Email
									</Label>
									<Input bind:value={clientEmail} type="email" />
								</div>
								<div class="col-span-2 space-y-1.5">
									<Label class="flex items-center gap-1.5 text-xs text-muted-foreground">
										<Phone class="h-3 w-3" /> {isKeezActive ? 'Telefon' : 'Phone'}
									</Label>
									<Input bind:value={clientPhone} />
								</div>
							</div>
						</div>

						<!-- Legal -->
						<div class="rounded-xl border border-amber-100 bg-amber-50/60 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
							<div class="mb-3 flex items-center gap-2">
								<div class="rounded-md bg-amber-100 p-1.5 dark:bg-amber-900/50">
									<Building2 class="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
								</div>
								<span class="text-xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">{isKeezActive ? 'Juridic' : 'Legal'}</span>
							</div>
							<div class="grid grid-cols-2 gap-3">
								<div class="space-y-1.5">
									<Label class="text-xs text-muted-foreground">{isKeezActive ? 'CUI' : 'VAT ID'}</Label>
									<Input bind:value={clientCui} />
								</div>
								<div class="space-y-1.5">
									<Label class="text-xs text-muted-foreground">{isKeezActive ? 'Nr. Reg. Comerț' : 'Registration Number'}</Label>
									<Input bind:value={clientRegistrationNumber} />
								</div>
							</div>
						</div>

						<!-- Banking -->
						<div class="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
							<div class="mb-3 flex items-center gap-2">
								<div class="rounded-md bg-emerald-100 p-1.5 dark:bg-emerald-900/50">
									<Landmark class="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
								</div>
								<span class="text-xs font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">{isKeezActive ? 'Bancar' : 'Banking'}</span>
							</div>
							<div class="grid grid-cols-2 gap-3">
								<div class="space-y-1.5">
									<Label class="text-xs text-muted-foreground">IBAN</Label>
									<Input bind:value={clientIban} class="font-mono" />
								</div>
								<div class="space-y-1.5">
									<Label class="text-xs text-muted-foreground">{isKeezActive ? 'Bancă' : 'Bank Name'}</Label>
									<Input bind:value={clientBankName} />
								</div>
							</div>
						</div>

						<!-- Address -->
						<div class="rounded-xl border border-sky-100 bg-sky-50/60 p-4 dark:border-sky-900/40 dark:bg-sky-950/20">
							<div class="mb-3 flex items-center gap-2">
								<div class="rounded-md bg-sky-100 p-1.5 dark:bg-sky-900/50">
									<MapPin class="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
								</div>
								<span class="text-xs font-semibold uppercase tracking-widest text-sky-600 dark:text-sky-400">{isKeezActive ? 'Adresă' : 'Address'}</span>
							</div>
							<div class="grid grid-cols-2 gap-3">
								<div class="col-span-2 space-y-1.5">
									<Label class="text-xs text-muted-foreground">{isKeezActive ? 'Stradă' : 'Street Address'}</Label>
									<Input bind:value={clientAddress} />
								</div>
								<div class="space-y-1.5">
									<Label class="text-xs text-muted-foreground">{isKeezActive ? 'Oraș' : 'City'}</Label>
									<Input bind:value={clientCity} />
								</div>
								<div class="space-y-1.5">
									<Label class="text-xs text-muted-foreground">{isKeezActive ? 'Județ' : 'County'}</Label>
									<Input bind:value={clientCounty} />
								</div>
								<div class="space-y-1.5">
									<Label class="text-xs text-muted-foreground">{isKeezActive ? 'Cod poștal' : 'Postal Code'}</Label>
									<Input bind:value={clientPostalCode} />
								</div>
								<div class="space-y-1.5">
									<Label class="text-xs text-muted-foreground">{isKeezActive ? 'Țară' : 'Country'}</Label>
									<Input bind:value={clientCountry} />
								</div>
							</div>
						</div>
					{/if}
				</CardContent>
			</Card>

			<!-- Invoice Details Card -->
			<Card class="border shadow-sm">
				<CardContent class="space-y-5 p-6">
					<div class="flex items-center justify-between border-b pb-4">
						<div class="flex items-center gap-2">
							<FileText class="h-4 w-4 text-muted-foreground" />
							<h2 class="text-sm font-semibold">{isKeezActive ? 'Detalii factură' : 'Invoice Details'}</h2>
						</div>
						<span class="font-mono text-xs text-muted-foreground">
							{invoiceSeries || '—'} #{invoiceNumber || '—'}
						</span>
					</div>
					<!-- Series & Number -->
					<div class="rounded-xl border border-violet-100 bg-violet-50/60 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
						<div class="mb-3 flex items-center gap-2">
							<div class="rounded-md bg-violet-100 p-1.5 dark:bg-violet-900/50">
								<Hash class="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
							</div>
							<span class="text-xs font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">{isKeezActive ? 'Număr factură' : 'Invoice Number'}</span>
						</div>
						<div class="grid grid-cols-2 gap-3">
							<div class="space-y-1.5">
								<Label class="text-xs text-muted-foreground">{isKeezActive ? 'Serie' : 'Series'}</Label>
								<Input bind:value={invoiceSeries} placeholder="OTS" class="font-mono font-semibold" />
							</div>
							<div class="space-y-1.5">
								<Label class="text-xs text-muted-foreground">
									{isKeezActive ? 'Număr' : 'Number'} {#if isKeezActive}<span class="ml-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:bg-violet-900/50 dark:text-violet-400">auto</span>{/if}
								</Label>
								<Input
									bind:value={invoiceNumber}
									placeholder="533"
									readonly={isKeezActive}
									disabled={isKeezActive}
									class="font-mono font-semibold {isKeezActive ? 'cursor-not-allowed opacity-60' : ''}"
								/>
							</div>
						</div>
					</div>

					<!-- Dates & Terms -->
					<div class="grid grid-cols-4 gap-4">
						<div class="space-y-1.5">
							<Label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
								<CalendarIcon class="h-3.5 w-3.5 text-indigo-400" /> {isKeezActive ? 'Dată' : 'Date'}
							</Label>
							<Popover.Root bind:open={issueDateOpen}>
								<Popover.Trigger>
									{#snippet child({ props })}
										<Button {...props} variant="outline" class="h-9 w-full justify-start text-start font-normal text-sm" disabled={isRecurringInvoice}>
											<CalendarIcon class="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
											{issueDateValue
												? new Date(issueDate + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
												: 'Alege data'}
										</Button>
									{/snippet}
								</Popover.Trigger>
								<Popover.Content class="w-auto p-0" align="start">
									<Calendar type="single" bind:value={issueDateValue} onValueChange={() => (issueDateOpen = false)} locale="ro-RO" captionLayout="dropdown" />
								</Popover.Content>
							</Popover.Root>
							{#if isRecurringInvoice}
								<p class="text-xs text-muted-foreground">{isKeezActive ? 'Calculat' : 'Calculated'}: {calculatedIssueDate}</p>
							{/if}
						</div>
						<div class="space-y-1.5">
							<Label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
								<CalendarIcon class="h-3.5 w-3.5 text-rose-400" /> {isKeezActive ? 'Scadentă' : 'Due Date'}
							</Label>
							<Popover.Root bind:open={dueDateOpen}>
								<Popover.Trigger>
									{#snippet child({ props })}
										<Button {...props} variant="outline" class="h-9 w-full justify-start text-start font-normal text-sm" disabled={isRecurringInvoice}>
											<CalendarIcon class="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
											{dueDateValue
												? new Date(dueDate + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
												: 'Alege data'}
										</Button>
									{/snippet}
								</Popover.Trigger>
								<Popover.Content class="w-auto p-0" align="start">
									<Calendar type="single" bind:value={dueDateValue} onValueChange={() => (dueDateOpen = false)} locale="ro-RO" captionLayout="dropdown" />
								</Popover.Content>
							</Popover.Root>
							{#if isRecurringInvoice}
								<p class="text-xs text-muted-foreground">{isKeezActive ? 'Calculat' : 'Calculated'}: {calculatedDueDate}</p>
							{/if}
						</div>
						<div class="space-y-1.5">
							<Label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
								<Clock class="h-3.5 w-3.5 text-indigo-400" /> {isKeezActive ? 'Termen plată (zile)' : 'Payment Terms (days)'}
							</Label>
							<Input
								type="number"
								min="0"
								bind:value={paymentTermsDays}
								placeholder="5"
							/>
						</div>
						<div class="space-y-1.5">
							<Label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
								<FolderOpen class="h-3.5 w-3.5 text-amber-400" /> {isKeezActive ? 'Proiect' : 'Project'}
							</Label>
							<Combobox
								bind:value={projectId}
								options={[
									{ value: '', label: isKeezActive ? 'Niciunul' : 'None' },
									...filteredProjects.map((p) => ({ value: p.id, label: p.name }))
								]}
								placeholder={isKeezActive ? 'Selectează proiect (opțional)' : 'Select a project (optional)'}
								searchPlaceholder={isKeezActive ? 'Caută proiecte...' : 'Search projects...'}
							/>
						</div>
					</div>

					<!-- Payment & Currency -->
					<div class="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
						<div class="mb-3 flex items-center gap-2">
							<div class="rounded-md bg-emerald-100 p-1.5 dark:bg-emerald-900/50">
								<Banknote class="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
							</div>
							<span class="text-xs font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">{isKeezActive ? 'Plată & Monedă' : 'Payment & Currency'}</span>
						</div>
						<div class="grid grid-cols-2 gap-3">
							<div class="space-y-1.5">
								<Label class="flex items-center gap-1.5 text-xs text-muted-foreground">
									<CreditCard class="h-3 w-3" /> {isKeezActive ? 'Plată' : 'Payment'}
								</Label>
								<Select type="single" bind:value={paymentMethod}>
									<SelectTrigger>
										{isKeezActive
											? (KEEZ_PAYMENT_LABELS[paymentMethod] || paymentMethod || 'Selectează metoda')
											: (paymentMethod || 'Select method')}
									</SelectTrigger>
									<SelectContent>
										{#if isKeezActive}
											<SelectItem value="BFCash">Bon fiscal platit cu numerar</SelectItem>
											<SelectItem value="BFCard">Bon fiscal platit cu cardul</SelectItem>
											<SelectItem value="Bank">Transfer bancar</SelectItem>
											<SelectItem value="ChitCash">Plată numerar cu chitanță</SelectItem>
											<SelectItem value="Ramburs">Ramburs</SelectItem>
											<SelectItem value="ProcesatorPlati">Procesator plăți (PayU, Netopia, euplatesc)</SelectItem>
											<SelectItem value="PlatformaDistributie">Platforme distribuție și plată (Emag)</SelectItem>
											<SelectItem value="VoucherVacantaCard">Voucher de Vacanță - Card</SelectItem>
											<SelectItem value="VoucherVacantaTichet">Voucher de Vacanță - Tichet</SelectItem>
										{:else}
											<SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
											<SelectItem value="Cash">Cash</SelectItem>
											<SelectItem value="Card">Card</SelectItem>
											<SelectItem value="Ramburs">Ramburs</SelectItem>
										{/if}
									</SelectContent>
								</Select>
							</div>
							<div class="space-y-1.5">
								<Label class="text-xs text-muted-foreground">{isKeezActive ? 'Monedă de calcul' : 'Calculation Currency'}</Label>
								<Select type="single" bind:value={currency}>
									<SelectTrigger>{currency}</SelectTrigger>
									<SelectContent>
										{#each CURRENCIES as curr}
											<SelectItem value={curr}>{curr}</SelectItem>
										{/each}
									</SelectContent>
								</Select>
							</div>
							<div class="space-y-1.5">
								<Label class="text-xs text-muted-foreground">{isKeezActive ? 'Monedă factură' : 'Invoice Currency'}</Label>
								<Select type="single" bind:value={invoiceCurrency}>
									<SelectTrigger>{invoiceCurrency}</SelectTrigger>
									<SelectContent>
										{#each CURRENCIES as curr}
											<SelectItem value={curr}>{curr}</SelectItem>
										{/each}
									</SelectContent>
								</Select>
							</div>
							<div class="space-y-1.5">
								<Label class="flex items-center gap-1.5 text-xs text-muted-foreground">
									<ArrowLeftRight class="h-3 w-3" /> {isKeezActive ? 'Curs valutar' : 'Exchange Rate'}
								</Label>
								<Input
									bind:value={exchangeRate}
									placeholder={currency === invoiceCurrency ? '1,0000' : 'Curs BNR'}
									class="font-mono"
								/>
								{#if currency !== invoiceCurrency && exchangeRate}
									<p class="text-xs text-muted-foreground">Curs BNR auto-completat</p>
								{/if}
							</div>
						</div>
					</div>

					<!-- Tax Application -->
					<div class="space-y-1.5">
						<Label class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
							<Percent class="h-3.5 w-3.5 text-orange-400" /> {isKeezActive ? 'Aplicare TVA' : 'Tax Application'}
						</Label>
						<Select type="single" bind:value={taxApplicationType}>
							<SelectTrigger>
								{taxApplicationType === 'apply'
									? (isKeezActive ? 'Taxare normală' : 'Apply Tax (Normala)')
									: taxApplicationType === 'none'
										? (isKeezActive ? 'Fără TVA' : 'Do Not Apply Tax')
										: (isKeezActive ? 'Taxare inversă' : 'Reverse Tax (Taxare inversa)')}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="apply">{isKeezActive ? 'Taxare normală' : 'Apply Tax (Normala)'}</SelectItem>
								<SelectItem value="none">{isKeezActive ? 'Fără TVA' : 'Do Not Apply Tax'}</SelectItem>
								<SelectItem value="reverse">{isKeezActive ? 'Taxare inversă' : 'Reverse Tax (Taxare inversa)'}</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<!-- Options -->
					<div class="flex flex-wrap gap-2 border-t border-dashed pt-4">
						<label class="flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all
							{vatOnCollection ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-border bg-background text-muted-foreground hover:border-blue-200 hover:text-blue-600'}">
							<Checkbox id="vat-on-collection" bind:checked={vatOnCollection} class="sr-only" />
							<span class="h-1.5 w-1.5 rounded-full {vatOnCollection ? 'bg-blue-500' : 'bg-muted-foreground/40'}"></span>
							{isKeezActive ? 'TVA la încasare' : 'VAT on Collection'}
						</label>
						<label class="flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all
							{isCreditNote ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'border-border bg-background text-muted-foreground hover:border-amber-200 hover:text-amber-600'}">
							<Checkbox id="credit-note" bind:checked={isCreditNote} class="sr-only" />
							<span class="h-1.5 w-1.5 rounded-full {isCreditNote ? 'bg-amber-500' : 'bg-muted-foreground/40'}"></span>
							{isKeezActive ? 'Storno' : 'Credit Note'}
						</label>
						<label class="flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all
							{isRecurringInvoice ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300' : 'border-border bg-background text-muted-foreground hover:border-violet-200 hover:text-violet-600'}">
							<Checkbox id="recurring-invoice" bind:checked={isRecurringInvoice} class="sr-only" />
							<span class="h-1.5 w-1.5 rounded-full {isRecurringInvoice ? 'bg-violet-500' : 'bg-muted-foreground/40'}"></span>
							{isKeezActive ? 'Factură recurentă' : 'Recurring Invoice'}
						</label>
					</div>

					<!-- Recurring Settings -->
					{#if isRecurringInvoice}
						<div class="rounded-xl border border-violet-100 bg-violet-50/60 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
							<div class="mb-3 flex items-center gap-2">
								<div class="rounded-md bg-violet-100 p-1.5 dark:bg-violet-900/50">
									<RefreshCw class="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
								</div>
								<span class="text-xs font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">{isKeezActive ? 'Setări recurență' : 'Recurring Settings'}</span>
							</div>
							<div class="grid grid-cols-4 gap-3">
								<!-- Row 1: Tip recurență | Dată început | Dată sfârșit | Durată (luni) -->
								<div class="space-y-1.5">
									<Label class="flex items-center gap-1.5 text-xs text-muted-foreground">
										<RefreshCw class="h-3 w-3" /> {isKeezActive ? 'Tip recurență' : 'Recurring Type'}
									</Label>
									<Select type="single" bind:value={recurringType}>
										<SelectTrigger class="w-full">
											{isKeezActive
												? (recurringType === 'daily' ? 'Zilnic' : recurringType === 'weekly' ? 'Săptămânal' : recurringType === 'monthly' ? 'Lunar' : 'Anual')
												: recurringType.charAt(0).toUpperCase() + recurringType.slice(1)}
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="daily">{isKeezActive ? 'Zilnic' : 'Daily'}</SelectItem>
											<SelectItem value="weekly">{isKeezActive ? 'Săptămânal' : 'Weekly'}</SelectItem>
											<SelectItem value="monthly">{isKeezActive ? 'Lunar' : 'Monthly'}</SelectItem>
											<SelectItem value="yearly">{isKeezActive ? 'Anual' : 'Yearly'}</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div class="space-y-1.5">
									<Label class="flex items-center gap-1.5 text-xs text-muted-foreground">
										<CalendarIcon class="h-3 w-3" /> {isKeezActive ? 'Dată început' : 'Start Date'}
									</Label>
									<Popover.Root bind:open={recurringStartDateOpen}>
										<Popover.Trigger>
											{#snippet child({ props })}
												<Button {...props} variant="outline" class="h-9 w-full justify-start text-start font-normal text-sm">
													<CalendarIcon class="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
													{recurringStartDateValue
														? new Date(recurringStartDate + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
														: 'Alege data'}
												</Button>
											{/snippet}
										</Popover.Trigger>
										<Popover.Content class="w-auto p-0" align="start">
											<Calendar type="single" bind:value={recurringStartDateValue} onValueChange={() => (recurringStartDateOpen = false)} locale="ro-RO" captionLayout="dropdown" />
										</Popover.Content>
									</Popover.Root>
								</div>
								<div class="space-y-1.5">
									<Label class="flex items-center gap-1.5 text-xs text-muted-foreground">
										<CalendarIcon class="h-3 w-3" /> {isKeezActive ? 'Dată sfârșit (opțional)' : 'End Date (Optional)'}
									</Label>
									<Popover.Root bind:open={recurringEndDateOpen}>
										<Popover.Trigger>
											{#snippet child({ props })}
												<Button {...props} variant="outline" class="h-9 w-full justify-start text-start font-normal text-sm">
													<CalendarIcon class="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
													{recurringEndDateValue
														? new Date(recurringEndDate + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
														: 'Fără dată de sfârșit'}
												</Button>
											{/snippet}
										</Popover.Trigger>
										<Popover.Content class="w-auto p-0" align="start">
											<Calendar type="single" bind:value={recurringEndDateValue} onValueChange={() => (recurringEndDateOpen = false)} locale="ro-RO" captionLayout="dropdown" />
										</Popover.Content>
									</Popover.Root>
								</div>
								<div class="space-y-1.5">
									<Label class="flex items-center gap-1.5 text-xs text-muted-foreground">
										<Clock class="h-3 w-3" /> Durată (luni)
									</Label>
									<Input
										type="number"
										min="1"
										bind:value={recurringDurationMonths}
										placeholder="ex: 6"
									/>
									{#if recurringDurationMonths && recurringDurationMonths > 0 && recurringStartDate}
										{@const lastInvoiceD = (() => { const d = new Date(recurringStartDate + 'T00:00:00'); d.setMonth(d.getMonth() + recurringDurationMonths - 1); return d; })()}
										<p class="text-xs text-muted-foreground">
											Ultima factură: {lastInvoiceD.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })}
										</p>
									{/if}
								</div>
								<!-- Row 2: Interval | Offset emitere | Termen plată -->
								<div class="space-y-1.5">
									<Label class="flex items-center gap-1.5 text-xs text-muted-foreground">
										<Hash class="h-3 w-3" /> Interval
									</Label>
									<Input type="number" bind:value={recurringInterval} min="1" placeholder="1" />
									<p class="text-xs text-muted-foreground">
										{isKeezActive
											? `La fiecare ${recurringInterval} ${recurringInterval === 1
												? recurringType === 'daily' ? 'zi' : recurringType === 'weekly' ? 'săptămână' : recurringType === 'monthly' ? 'lună' : 'an'
												: recurringType === 'daily' ? 'zile' : recurringType === 'weekly' ? 'săptămâni' : recurringType === 'monthly' ? 'luni' : 'ani'}`
											: `Every ${recurringInterval} ${recurringInterval === 1
												? recurringType === 'daily' ? 'day' : recurringType === 'weekly' ? 'week' : recurringType === 'monthly' ? 'month' : 'year'
												: recurringType === 'daily' ? 'days' : recurringType === 'weekly' ? 'weeks' : recurringType === 'monthly' ? 'months' : 'years'}`}
									</p>
								</div>
								<div class="space-y-1.5">
									<Label class="flex items-center gap-1.5 text-xs text-muted-foreground">
										<CalendarIcon class="h-3 w-3" /> {isKeezActive ? 'Offset dată emitere (zile)' : 'Issue Date Offset (days)'}
									</Label>
									<Input type="number" bind:value={recurringIssueDateOffset} placeholder="0" />
								</div>
								<div class="space-y-1.5">
									<Label class="flex items-center gap-1.5 text-xs text-muted-foreground">
										<Clock class="h-3 w-3" /> {isKeezActive ? 'Termen plată (zile)' : 'Payment Terms (days)'}
									</Label>
									<Input type="number" bind:value={paymentTermsDays} placeholder="5" />
								</div>
							</div>
						</div>
					{/if}
				</CardContent>
			</Card>
		</div>

		<!-- Items Card -->
		<Card class="border border-gray-200">
			<CardContent class="p-6">
				<div class="space-y-4">
					<div class="mb-4 flex items-center justify-between">
						<p class="text-sm font-semibold text-gray-900">{isKeezActive ? 'Articole' : 'Items'}</p>
						<Dialog bind:open={addItemDialogOpen}>
							<DialogTrigger>
								{#snippet child({ props })}
									<Button type="button" variant="outline" size="sm" {...props}>
										<Plus class="mr-2 h-4 w-4" />
										{isKeezActive ? 'Adaugă articol' : 'Add Item'}
									</Button>
								{/snippet}
							</DialogTrigger>
							<DialogContent class="max-w-2xl max-h-[85vh] overflow-y-auto">
								<DialogHeader>
									<DialogTitle>{isKeezActive ? 'Adaugă articol pe factură' : 'Add Item to Invoice'}</DialogTitle>
									<DialogDescription>
										{isKeezActive ? 'Selectează un articol din serviciu, proiect, Keez, sau adaugă manual' : 'Select an item from a service, project, Keez, or add manually'}
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
										<TabsTrigger value="service">{isKeezActive ? 'Din serviciu' : 'From Service'}</TabsTrigger>
										{#each invoiceProviderPlugins as plugin}
											<TabsTrigger value="plugin-{plugin.name}"
												>{isKeezActive ? 'Din' : 'From'} {plugin.name.charAt(0).toUpperCase() +
													plugin.name.slice(1)}</TabsTrigger
											>
										{/each}
										<TabsTrigger value="manual">{isKeezActive ? 'Manual' : 'Manual'}</TabsTrigger>
									</TabsList>
									<TabsContent value="service" class="space-y-4">
										<div class="space-y-2">
											<Label>{isKeezActive ? 'Selectează serviciu' : 'Select Service'}</Label>
											<Combobox
												bind:value={dialogServiceId}
												options={[
													{ value: '', label: isKeezActive ? 'Selectează serviciu' : 'Select a service' },
													...filteredServices.map((s) => ({ value: s.id, label: s.name }))
												]}
												placeholder={isKeezActive ? 'Selectează serviciu' : 'Select a service'}
												searchPlaceholder={isKeezActive ? 'Caută servicii...' : 'Search services...'}
											/>
										</div>
										<div class="space-y-2">
											<Label>{isKeezActive ? 'Notă articol (opțional)' : 'Item Note (Optional)'}</Label>
											<Textarea
												bind:value={dialogItemNote}
												placeholder={isKeezActive ? 'Adaugă detalii specifice tranzacției...' : 'Add transaction-specific details...'}
												rows={2}
											/>
										</div>
									</TabsContent>
									{#each invoiceProviderPlugins as plugin}
										{#if plugin.name === 'keez'}
											<TabsContent value="plugin-keez" class="space-y-4">
												<div class="space-y-2">
													<Label>{isKeezActive ? 'Selectează articol Keez' : 'Select Keez Item'}</Label>
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
														placeholder={isKeezActive ? 'Selectează din articolele Keez' : 'Select from Keez items'}
														searchPlaceholder={isKeezActive ? 'Caută articole Keez...' : 'Search Keez items...'}
													/>
												</div>
												<div class="space-y-2">
													<Label>{isKeezActive ? 'Notă articol (opțional)' : 'Item Note (Optional)'}</Label>
													<Textarea
														bind:value={dialogItemNote}
														placeholder={isKeezActive ? 'Adaugă detalii specifice tranzacției...' : 'Add transaction-specific details...'}
														rows={2}
													/>
												</div>
											</TabsContent>
										{/if}
									{/each}
									<TabsContent value="manual" class="space-y-4">
										<div class="space-y-2">
											<Label>{isKeezActive ? 'Descriere articol' : 'Item Description'}</Label>
											<Input
												bind:value={dialogItemDescription}
												placeholder={isKeezActive ? 'Descrie serviciul sau produsul' : 'Describe the service or product'}
											/>
										</div>
										<div class="space-y-2">
											<Label>{isKeezActive ? 'Notă articol (opțional)' : 'Item Note (Optional)'}</Label>
											<Textarea
												bind:value={dialogItemNote}
												placeholder={isKeezActive ? 'Adaugă detalii specifice tranzacției...' : 'Add transaction-specific details...'}
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
										{isKeezActive ? 'Anulează' : 'Cancel'}
									</Button>
									<Button type="button" onclick={handleAddItemFromDialog}>{isKeezActive ? 'Adaugă articol' : 'Add Item'}</Button>
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
										style="min-width: 200px;">{isKeezActive ? 'Articol' : 'Item'}</th
									>
									<th
										class="px-4 py-3 text-left text-sm font-semibold text-gray-700"
										style="width: 80px;">{isKeezActive ? 'U.M.' : 'Unit'}</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 100px;">{isKeezActive ? 'Cantitate' : 'Quantity'}</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 120px;">{isKeezActive ? 'Preț unitar' : 'Unit Price'}</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 120px;">{isKeezActive ? 'Tip reducere' : 'Discount Type'}</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 100px;">{isKeezActive ? 'Reducere' : 'Discount'}</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 100px;">{isKeezActive ? 'Valoare' : 'Amount'}</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 80px;">TVA</th
									>
									<th
										class="px-4 py-3 text-right text-sm font-semibold text-gray-700"
										style="width: 120px;">{isKeezActive ? 'Total' : 'Final Amount'}</th
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
												placeholder={isKeezActive ? 'Descrie serviciul sau produsul' : 'Describe the service or product'}
												class="h-auto w-full border-0 bg-transparent p-0"
											/>
											{#if item.note}
												<p class="mt-1 text-xs text-muted-foreground italic">{item.note}</p>
											{/if}
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
													<SelectItem value="fixed">{isKeezActive ? 'Fix' : 'Fixed'}</SelectItem>
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
										<td class="px-4 py-3 text-right text-nowrap font-medium text-gray-900">
											{formatNumber(itemSubtotal)}{#if item.currency && item.currency !== currency}&nbsp;<span class="text-xs text-gray-500">{item.currency}</span>{/if}
										</td>
										<td class="px-4 py-3 text-right text-nowrap text-gray-900">
											{taxApplicationType === 'apply' ? `${itemTaxRate} %` : '-'}
										</td>
										<td class="px-4 py-3 text-right text-nowrap font-medium text-gray-900">
											{formatNumber(itemFinalValue)}{#if item.currency && item.currency !== currency}&nbsp;<span class="text-xs text-gray-500">{item.currency}</span>{/if}
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
											{isKeezActive ? 'Niciun articol. Apasă + pentru a adăuga.' : 'No items yet. Click the + button to add items.'}
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
					<p class="mb-4 text-sm font-semibold text-gray-900">{isKeezActive ? 'Note & Atașamente' : 'Notes & Attachments'}</p>
					<Textarea
						bind:value={notes}
						placeholder={isKeezActive ? 'Adaugă note suplimentare sau instrucțiuni de plată.' : 'Add any additional notes or payment instructions.'}
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
					<p class="mb-4 text-sm font-semibold text-gray-900">{isKeezActive ? 'Sumar' : 'Summary'}</p>

					<!-- Discount Controls -->
					<div class="space-y-2 border-b border-gray-200 pb-4">
						<Label>{isKeezActive ? 'Reducere' : 'Discount'}</Label>
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
										? (isKeezActive ? 'Fără reducere' : 'No Discount')
										: invoiceDiscountType === 'percent'
											? (isKeezActive ? 'P - Procentual' : 'P - Percentage')
											: (isKeezActive ? 'V - Valoare' : 'V - Value')}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">{isKeezActive ? 'Fără reducere' : 'No Discount'}</SelectItem>
									<SelectItem value="percent">{isKeezActive ? 'P - Procentual' : 'P - Percentage'}</SelectItem>
									<SelectItem value="value">{isKeezActive ? 'V - Valoare' : 'V - Value'}</SelectItem>
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

					{#each Object.entries(totalsByCurrency) as [curr, currTotals]}
					<div class="space-y-3">
						{#if Object.keys(totalsByCurrency).length > 1}
							<p class="text-xs font-semibold uppercase text-gray-500">{curr}</p>
						{/if}
						<div class="flex justify-between">
							<span class="text-gray-700">Subtotal</span>
							<span class="font-medium text-gray-900">{formatNumber(currTotals.subtotal)} {curr}</span>
						</div>
						{#if taxApplicationType === 'apply'}
							<div class="flex justify-between">
								<span class="text-gray-700">{isKeezActive ? `Total TVA (${defaultTaxRate}%)` : `Tax Total (${defaultTaxRate}%)`}</span>
								<span class="font-medium text-gray-900">{formatNumber(currTotals.taxTotal)} {curr}</span>
							</div>
						{/if}
						{#if curr === currency && invoiceDiscountType !== 'none' && invoiceDiscountAmount > 0}
							<div class="flex justify-between">
								<span class="text-gray-700">{isKeezActive ? 'Reducere' : 'Discount'}</span>
								<span class="font-medium text-gray-900"
									>-{formatNumber(invoiceDiscountAmount)} {curr}</span
								>
							</div>
						{/if}
						<Separator />
						<div class="flex justify-between">
							<span class="text-lg font-semibold text-gray-900">{isKeezActive ? 'Total general' : 'Grand Total'}</span>
							<span class="text-lg font-bold text-gray-900"
								>{formatNumber(currTotals.grandTotal)} {curr}</span
							>
						</div>
					</div>
				{:else}
					<div class="space-y-3">
						<div class="flex justify-between">
							<span class="text-gray-700">Subtotal</span>
							<span class="font-medium text-gray-900">0,00 {currency}</span>
						</div>
						<Separator />
						<div class="flex justify-between">
							<span class="text-lg font-semibold text-gray-900">{isKeezActive ? 'Total general' : 'Grand Total'}</span>
							<span class="text-lg font-bold text-gray-900">0,00 {currency}</span>
						</div>
					</div>
				{/each}
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
