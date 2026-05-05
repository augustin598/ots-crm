<script lang="ts">
	import {
		getInvoices,
		deleteInvoice,
		markInvoiceAsPaid,
		getInvoice,
		sendInvoice,
		getInvoiceEmailLogs
	} from '$lib/remotes/invoices.remote';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import {
		getRecurringInvoices,
		createRecurringInvoice,
		updateRecurringInvoice,
		deleteRecurringInvoice,
		toggleRecurringInvoiceActive,
		triggerRecurringInvoice
	} from '$lib/remotes/recurring-invoices.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getServices } from '$lib/remotes/services.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { syncInvoicesFromKeez, getKeezStatus, createStornoInKeez, validateInvoiceInKeez, sendInvoiceToEFactura, cancelInvoiceInKeez, syncInvoiceToKeez } from '$lib/remotes/keez.remote';
	import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';
	import { page } from '$app/state';
	import { useQueryState } from 'nuqs-svelte';
	import { parseAsStringEnum, parseAsArrayOf, parseAsString } from 'nuqs-svelte';
	import { formatAmount, CURRENCIES, type Currency } from '$lib/utils/currency';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle,
		DialogTrigger
	} from '$lib/components/ui/dialog';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import * as Popover from '$lib/components/ui/popover';
	import InvoiceFilters from '$lib/components/invoice-filters.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import SendIcon from '@lucide/svelte/icons/send';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import EditIcon from '@lucide/svelte/icons/edit';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import PowerIcon from '@lucide/svelte/icons/power';
	import PowerOffIcon from '@lucide/svelte/icons/power-off';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
import FileTextIcon from '@lucide/svelte/icons/file-text';
import CoinsIcon from '@lucide/svelte/icons/coins';
import MailIcon from '@lucide/svelte/icons/mail';
import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
import XCircleIcon from '@lucide/svelte/icons/x-circle';
import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
import { goto } from '$app/navigation';

	const tenantSlug = $derived(page.params.tenant);

	// Filter states
	const statuses = useQueryState(
		'status',
		parseAsArrayOf(parseAsStringEnum(['draft', 'sent', 'paid', 'overdue', 'cancelled']))
	);
	const clientIds = useQueryState('client', parseAsArrayOf(parseAsString));
	const projectIds = useQueryState('project', parseAsArrayOf(parseAsString));
	const serviceIds = useQueryState('service', parseAsArrayOf(parseAsString));
	const search = useQueryState('search', parseAsString.withDefault(''));
	const issueDate = useQueryState('issueDate', parseAsStringEnum(['overdue', 'today', 'thisWeek', 'thisMonth', 'lastMonth']));
	const dueDate = useQueryState('dueDate', parseAsStringEnum(['overdue', 'today', 'thisWeek', 'thisMonth']));

	// Build filter params for getInvoices
	const filterParams = $derived({
		status: (statuses.current as string[] | null) && (statuses.current as string[]).length > 0 ? (statuses.current as string[]) : undefined,
		clientId: (clientIds.current as string[] | null) && (clientIds.current as string[]).length > 0 ? (clientIds.current as string[]) : undefined,
		projectId: (projectIds.current as string[] | null) && (projectIds.current as string[]).length > 0 ? (projectIds.current as string[]) : undefined,
		serviceId: (serviceIds.current as string[] | null) && (serviceIds.current as string[]).length > 0 ? (serviceIds.current as string[]) : undefined,
		search: search.current || undefined,
		issueDate: issueDate.current || undefined,
		dueDate: dueDate.current || undefined
	});

	const invoicesQuery = $derived(getInvoices(filterParams));
	const invoices = $derived(invoicesQuery.current || []);
	const invoicesLoading = $derived(invoicesQuery.loading);
	const invoicesError = $derived(invoicesQuery.error);

	// Client-side pagination — same shape as admin/logs page (emailPage etc.).
	let invoicePage = $state(1);
	let invoicePageSize = $state(20);
	const invoiceTotalPages = $derived(Math.max(1, Math.ceil(invoices.length / invoicePageSize)));
	const paginatedInvoices = $derived(
		invoices.slice((invoicePage - 1) * invoicePageSize, invoicePage * invoicePageSize)
	);

	// Reset to page 1 whenever filters or page size change. Same pattern as
	// the admin/logs page (emailPage / emailStatusFilter etc.).
	$effect(() => {
		filterParams;
		invoicePageSize;
		invoicePage = 1;
	});

	const recurringInvoicesQuery = getRecurringInvoices({});
	const recurringInvoices = $derived(recurringInvoicesQuery.current || []);
	const recurringInvoicesLoading = $derived(recurringInvoicesQuery.loading);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const clientMap = $derived(new Map(clients.map((client) => [client.id, client.name])));

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);
	const servicesQuery = getServices({});
	const services = $derived(servicesQuery.current || []);

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	const keezStatusQuery = getKeezStatus();
	const keezStatus = $derived(keezStatusQuery.current);
	const isKeezActive = $derived(keezStatus?.connected && keezStatus?.isActive);

	// Email notification history per invoice
	const emailLogsQuery = getInvoiceEmailLogs();
	const emailLogsByInvoice = $derived(emailLogsQuery.current || {});

	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);
	const serviceOptions = $derived([
		{ value: '', label: 'None' },
		...services.map((s) => ({ value: s.id, label: s.name }))
	]);


	// Recurring invoice dialog state
	let isRecurringDialogOpen = $state(false);
	let isEditingRecurring = $state(false);
	let editingRecurringId = $state<string | null>(null);
	let recurringName = $state('');
	let recurringClientId = $state('');
	let recurringProjectId = $state('');
	let recurringServiceId = $state('');
	let recurringAmount = $state('');
	let recurringTaxRate = $state('19');
	let recurringCurrency = $state<Currency>('RON');
	let recurringType = $state<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
	let recurringInterval = $state('1');
	let recurringStartDate = $state(new Date().toISOString().split('T')[0]);
	let recurringEndDate = $state('');
	let recurringIssueDateOffset = $state('0');
	let recurringDueDateOffset = $state('30');
	let recurringNotes = $state('');
	let recurringIsActive = $state(true);
	let recurringFormLoading = $state(false);
	let recurringError = $state<string | null>(null);

	// Update currency when settings load
	$effect(() => {
		if (invoiceSettings?.defaultCurrency) {
			recurringCurrency = invoiceSettings.defaultCurrency as Currency;
		}
	});

	// Pre-fill amount from service if selected
	$effect(() => {
		if (recurringServiceId) {
			const service = services.find((s) => s.id === recurringServiceId);
			if (service && service.price) {
				recurringAmount = (service.price / 100).toString();
				recurringCurrency = (service.currency as Currency) || recurringCurrency;
			}
		}
	});


	function getStatusColor(status: string) {
		switch (status) {
			case 'paid':
				return 'success';
			case 'partially_paid':
				return 'outline';
			case 'unpaid':
				return 'warning';
			case 'overdue':
				return 'destructive';
			case 'sent':
				return 'secondary';
			case 'draft':
				return 'outline';
			case 'cancelled':
				return 'destructive';
			default:
				return 'secondary';
		}
	}

	function getStatusIcon(status: string) {
		switch (status) {
			case 'paid':
				return '✓';
			case 'partially_paid':
				return '◐';
			case 'overdue':
				return '!';
			default:
				return '';
		}
	}

	function getStatusText(status: string) {
		switch (status) {
			case 'paid':
				return 'Achitată';
			case 'partially_paid':
				return 'Achitată parțial';
			case 'sent':
				return 'Trimisă';
			case 'overdue':
				return 'Restantă';
			case 'draft':
				return 'Ciornă';
			case 'cancelled':
				return 'Anulată';
			default:
				return status;
		}
	}

	function formatRecurringPattern(recurringType: string, interval: number): string {
		const typeMap: Record<string, string> = {
			daily: 'Day',
			weekly: 'Week',
			monthly: 'Month',
			yearly: 'Year'
		};

		const type = typeMap[recurringType] || recurringType;
		if (interval === 1) {
			return `Every ${type}`;
		}
		return `Every ${interval} ${type}s`;
	}

	function formatDate(date: Date | string | null | undefined): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
				return d.toLocaleDateString('ro-RO', {
					year: 'numeric',
					month: 'short',
					day: 'numeric'
				});
			}
		} catch {
			// ignore
		}
		return '-';
	}

	function isValidDate(date: Date | string | null | undefined): boolean {
		if (!date) return false;
		try {
			const d = date instanceof Date ? date : new Date(date);
			return !isNaN(d.getTime()) && d.getFullYear() > 1970;
		} catch {
			return false;
		}
	}


	async function handleDeleteInvoice(invoiceId: string) {
		if (!confirm('Sigur ștergi factura? Acțiunea e permisă doar pentru status Draft.')) {
			return;
		}

		try {
			await deleteInvoice(invoiceId).updates(invoicesQuery);
			toast.success('Factura a fost ștearsă');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergerea facturii');
		}
	}

	async function handleCancelInvoice(invoiceId: string) {
		if (!confirm('Anulează factura? Statusul devine "Anulată" în CRM și — dacă e sincronizată — și pe Keez.')) {
			return;
		}

		try {
			const result = await cancelInvoiceInKeez({ invoiceId }).updates(invoicesQuery);
			if ((result as any)?.cancelledOn === 'keez') {
				toast.success('Factura a fost anulată (CRM + Keez)');
			} else if ((result as any)?.alreadyCancelled) {
				toast.success('Factura era deja anulată');
			} else {
				toast.success('Factura a fost anulată în CRM');
			}
		} catch (e) {
			clientLogger.apiError('invoice_cancel', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la anularea facturii');
		}
	}

	async function handleMarkAsPaid(invoiceId: string) {
		try {
			await markInvoiceAsPaid(invoiceId).updates(invoicesQuery, getInvoices({}));
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to mark invoice as paid');
		}
	}

	async function handleDownloadPDF(invoiceId: string) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to generate PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Invoice-${invoiceId}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to download PDF');
		}
	}

	async function handlePreviewPDF(invoiceId: string) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to generate PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to preview PDF');
		}
	}

	async function handleSendInvoice(invoiceId: string) {
		try {
			// Get the invoice to find the client
			const invoice = invoices.find((inv) => inv.id === invoiceId);
			if (!invoice) {
				clientLogger.warn({ message: 'Invoice not found', action: 'invoice_send' });
				return;
			}

			// Get the client to check for email
			const client = clients.find((c) => c.id === invoice.clientId);
			if (!client || !client.email) {
				clientLogger.warn({ message: 'Clientul nu are email configurat. Nu se poate trimite factura.', action: 'invoice_send' });
				return;
			}

			// Send the invoice
			await sendInvoice(invoiceId).updates(invoicesQuery);
			toast.success('Factura a fost trimisă cu succes!');
		} catch (e) {
			clientLogger.apiError('invoice_send', e);
		}
	}

	// Recurring invoice handlers
	function openRecurringDialog(recurringInvoiceId?: string) {
		if (recurringInvoiceId) {
			// Edit mode - find from already loaded list
			const ri = recurringInvoices.find((r) => r.id === recurringInvoiceId);
			if (ri) {
				isEditingRecurring = true;
				editingRecurringId = recurringInvoiceId;
				recurringName = ri.name || '';
				recurringClientId = ri.clientId || '';
				recurringProjectId = ri.projectId || '';
				recurringServiceId = ri.serviceId || '';
				recurringAmount = ri.amount ? (ri.amount / 100).toString() : '';
				recurringTaxRate = ri.taxRate ? (ri.taxRate / 100).toString() : '19';
				recurringCurrency = (ri.currency || invoiceSettings?.defaultCurrency || 'RON') as Currency;
				recurringType = ri.recurringType as 'daily' | 'weekly' | 'monthly' | 'yearly';
				recurringInterval = ri.recurringInterval?.toString() || '1';
				recurringStartDate = ri.startDate
					? new Date(ri.startDate).toISOString().split('T')[0]
					: new Date().toISOString().split('T')[0];
				recurringEndDate = ri.endDate ? new Date(ri.endDate).toISOString().split('T')[0] : '';
				recurringIssueDateOffset = ri.issueDateOffset?.toString() || '0';
				recurringDueDateOffset = ri.dueDateOffset?.toString() || '30';
				recurringNotes = ri.notes || '';
				recurringIsActive = ri.isActive ?? true;
			}
		} else {
			// Create mode
			isEditingRecurring = false;
			editingRecurringId = null;
			recurringName = '';
			recurringClientId = '';
			recurringProjectId = '';
			recurringServiceId = '';
			recurringAmount = '';
			recurringTaxRate = '19';
			recurringCurrency = (invoiceSettings?.defaultCurrency || 'RON') as Currency;
			recurringType = 'monthly';
			recurringInterval = '1';
			recurringStartDate = new Date().toISOString().split('T')[0];
			recurringEndDate = '';
			recurringIssueDateOffset = '0';
			recurringDueDateOffset = '30';
			recurringNotes = '';
			recurringIsActive = true;
		}
		isRecurringDialogOpen = true;
	}

	function closeRecurringDialog() {
		isRecurringDialogOpen = false;
		isEditingRecurring = false;
		editingRecurringId = null;
		recurringError = null;
	}

	async function handleCreateRecurringInvoice() {
		if (!recurringName || !recurringClientId) {
			recurringError = 'Name and client are required';
			return;
		}
		if (!recurringAmount) {
			recurringError = 'Amount is required';
			return;
		}
		if (!recurringStartDate) {
			recurringError = 'Start date is required';
			return;
		}

		recurringFormLoading = true;
		recurringError = null;

		try {
			if (isEditingRecurring && editingRecurringId) {
				await updateRecurringInvoice({
					recurringInvoiceId: editingRecurringId,
					name: recurringName,
					clientId: recurringClientId,
					projectId: recurringProjectId || undefined,
					serviceId: recurringServiceId || undefined,
					amount: parseFloat(recurringAmount),
					taxRate: parseFloat(recurringTaxRate) || undefined,
					currency: recurringCurrency || undefined,
					recurringType,
					recurringInterval: parseInt(recurringInterval) || 1,
					startDate: recurringStartDate,
					endDate: recurringEndDate || undefined,
					issueDateOffset: parseInt(recurringIssueDateOffset) || 0,
					dueDateOffset: parseInt(recurringDueDateOffset) || 30,
					notes: recurringNotes || undefined,
					isActive: recurringIsActive
				}).updates(recurringInvoicesQuery);
			} else {
				await createRecurringInvoice({
					name: recurringName,
					clientId: recurringClientId,
					projectId: recurringProjectId || undefined,
					serviceId: recurringServiceId || undefined,
					amount: parseFloat(recurringAmount),
					taxRate: parseFloat(recurringTaxRate) || undefined,
					currency: recurringCurrency || undefined,
					recurringType,
					recurringInterval: parseInt(recurringInterval) || 1,
					startDate: recurringStartDate,
					endDate: recurringEndDate || undefined,
					issueDateOffset: parseInt(recurringIssueDateOffset) || 0,
					dueDateOffset: parseInt(recurringDueDateOffset) || 30,
					notes: recurringNotes || undefined,
					isActive: recurringIsActive
				}).updates(recurringInvoicesQuery);
			}
			closeRecurringDialog();
		} catch (e) {
			recurringError = e instanceof Error ? e.message : 'Failed to save recurring invoice';
		} finally {
			recurringFormLoading = false;
		}
	}

	async function handleDeleteRecurring(recurringInvoiceId: string) {
		if (!confirm('Are you sure you want to delete this recurring invoice?')) {
			return;
		}

		try {
			await deleteRecurringInvoice(recurringInvoiceId).updates(recurringInvoicesQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete recurring invoice');
		}
	}

	async function handleToggleActive(recurringInvoiceId: string) {
		try {
			await toggleRecurringInvoiceActive(recurringInvoiceId).updates(recurringInvoicesQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to toggle recurring invoice');
		}
	}

	async function handleTriggerRecurring(recurringInvoiceId: string) {
		if (!confirm('Generate an invoice now from this template?')) {
			return;
		}

		try {
			await triggerRecurringInvoice(recurringInvoiceId).updates(recurringInvoicesQuery, invoicesQuery);
			alert('Invoice generated successfully!');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to generate invoice');
		}
	}

	// Keez sync state
	let syncingInvoices = $state(false);
	let syncError = $state<string | null>(null);
	let syncResult = $state<{
		imported: number;
		updated: number;
		unchanged: number;
		skipped: number;
	} | null>(null);
	// Held so we can clear an in-flight 5s clear-timer when a new sync starts.
	let syncResultClearTimer: ReturnType<typeof setTimeout> | null = null;
	let syncWarning = $state<{
		message: string;
		imported: number;
		updated: number;
		skipped: number;
		retryAt: string | null;
		degraded: boolean;
	} | null>(null);

	function stripHtml(s: string): string {
		return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
	}

	function formatRelativeTime(date: Date | string | null | undefined): string {
		if (!date) return '—';
		const d = typeof date === 'string' ? new Date(date) : date;
		const minutes = Math.floor((Date.now() - d.getTime()) / 60_000);
		if (minutes < 1) return 'acum';
		if (minutes < 60) return `acum ${minutes} min`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `acum ${hours} h`;
		const days = Math.floor(hours / 24);
		return `acum ${days} ${days === 1 ? 'zi' : 'zile'}`;
	}

	async function handleSyncInvoices(force = false) {
		// Force re-sync hits Keez ~555 times instead of ~2 (smart-sync), takes ~3
		// minutes, and bypasses the cache. Confirm so a stray click doesn't lock
		// the user into a long wait.
		if (force) {
			const ok = confirm(
				'Re-sync complet va ignora cache-ul și va aduce TOATE detaliile facturilor de la Keez. Durează ~3 minute. Continui?'
			);
			if (!ok) return;
		}

		// Clear any pending 5s clear-timer from a previous sync so we don't end up
		// with stacked timers racing to null `syncResult`.
		if (syncResultClearTimer) {
			clearTimeout(syncResultClearTimer);
			syncResultClearTimer = null;
		}

		syncingInvoices = true;
		syncError = null;
		syncResult = null;
		syncWarning = null;
		console.log('[Keez-Debug] Starting sync invoices from Keez...', { force });

		try {
			const result = await syncInvoicesFromKeez({ force }).updates(invoicesQuery, keezStatusQuery);
			console.log('[Keez-Debug] syncInvoicesFromKeez result:', JSON.stringify(result, null, 2));

			if (result.success) {
				syncResult = {
					imported: result.imported,
					updated: result.updated || 0,
					unchanged: result.unchanged || 0,
					skipped: result.skipped
				};
				console.log('[Keez-Debug] Sync success:', $state.snapshot(syncResult));
				await invoicesQuery.refresh();
				syncResultClearTimer = setTimeout(() => {
					syncResult = null;
					syncResultClearTimer = null;
				}, 5000);
			} else if (result.partial) {
				// Sync stopped mid-page on transient upstream errors. DB rows from
				// successful invoices are persisted; show a warning + retry ETA.
				syncWarning = {
					message: result.message,
					imported: result.imported,
					updated: result.updated,
					skipped: result.skipped,
					retryAt: result.retryAt,
					degraded: result.degraded
				};
				await invoicesQuery.refresh();
			} else {
				// Hard error (4xx, credentials, etc.) — show as red error.
				syncError = stripHtml(result.message);
			}
		} catch (e) {
			// Network/transport errors that escaped the server-side wrapper.
			syncError = stripHtml(e instanceof Error ? e.message : 'Failed to sync invoices from Keez');
			console.error('[Keez-Debug] syncInvoicesFromKeez ERROR:', e);
		} finally {
			syncingInvoices = false;
		}
	}

	async function handleValidateInKeez(invoiceId: string) {
		if (!confirm('Validează factura în Keez? Factura va deveni factură fiscală și nu mai poate fi ștearsă.')) {
			return;
		}

		console.log('[Keez-Debug] Validating invoice in Keez:', invoiceId);
		try {
			const result = await validateInvoiceInKeez({ invoiceId });
			console.log('[Keez-Debug] validateInvoiceInKeez result:', result);
			toast.success('Factura a fost validată în Keez');
			await invoicesQuery.refresh();
		} catch (e) {
			console.error('[Keez-Debug] validateInvoiceInKeez ERROR:', e);
			clientLogger.apiError('invoice_validate_keez', e);
		}
	}

	async function handleCreateStorno(invoiceId: string) {
		if (!confirm('Create a storno (credit note) for this invoice in Keez?')) {
			return;
		}

		console.log('[Keez-Debug] Creating storno for invoice:', invoiceId);
		try {
			const result = await createStornoInKeez({ invoiceId });
			console.log('[Keez-Debug] createStornoInKeez result:', result);
			toast.success(`Storno created in Keez (ID: ${result.stornoExternalId})`);
			await invoicesQuery.refresh();
		} catch (e) {
			console.error('[Keez-Debug] createStornoInKeez ERROR:', e);
			clientLogger.apiError('invoice_create_storno', e);
		}
	}

	async function handleSendToEFactura(invoiceId: string) {
		if (!confirm('Trimite factura în sistemul eFactura? Factura trebuie să fie validată.')) {
			return;
		}
		console.log('[Keez-Debug] Sending invoice to eFactura:', invoiceId);
		try {
			const result = await sendInvoiceToEFactura({ invoiceId });
			console.log('[Keez-Debug] sendInvoiceToEFactura result:', result);
			toast.success('Factura a fost trimisă în eFactura');
			await invoicesQuery.refresh();
		} catch (e) {
			console.error('[Keez-Debug] sendInvoiceToEFactura ERROR:', e);
			clientLogger.apiError('invoice_send_efactura', e);
		}
	}

	async function handleSyncToKeez(invoiceId: string) {
		if (!confirm('Sincronizează factura în Keez?')) return;
		try {
			await syncInvoiceToKeez({ invoiceId });
			toast.success('Factura a fost sincronizată în Keez');
			await invoicesQuery.refresh();
		} catch (e) {
			clientLogger.apiError('invoice_sync_keez', e);
		}
	}
</script>

<svelte:head>
	<title>Invoices - CRM</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Invoices</h1>
			<p class="text-muted-foreground mt-1">Create and manage invoices and recurring invoice templates</p>
		</div>
		<div class="flex gap-2">
			{#if isKeezActive}
				<div class="flex items-center gap-2">
					{#if keezStatus?.lastSyncAt}
						<span class="text-xs text-muted-foreground hidden md:inline">
							Ultima verificare: {formatRelativeTime(keezStatus.lastSyncAt)}
						</span>
					{/if}
					<div class="inline-flex">
						<Button
							variant="default"
							class="rounded-r-none"
							onclick={() => handleSyncInvoices(false)}
							disabled={syncingInvoices}
						>
							{#if syncingInvoices}
								<RefreshCwIcon class="mr-2 h-4 w-4 animate-spin" />
								Syncing...
							{:else}
								<RefreshCwIcon class="mr-2 h-4 w-4" />
								Sync Invoices from Keez
							{/if}
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger>
								<Button
									variant="default"
									class="rounded-l-none border-l border-primary-foreground/20 px-2"
									disabled={syncingInvoices}
									aria-label="Mai multe opțiuni de sincronizare"
									aria-haspopup="menu"
								>
									<ChevronDownIcon class="h-4 w-4" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onclick={() => handleSyncInvoices(true)}>
									Re-sync complet (ignoră cache)
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			{/if}
		

			<a href="/api/export/invoices?format=excel{statuses.current && (statuses.current as string[]).length > 0 ? '&status=' + (statuses.current as string[]).join(',') : ''}" download>
				<Button variant="outline">
					<DownloadIcon class="mr-2 h-4 w-4" />
					Export Excel
				</Button>
			</a>
			<Button onclick={() => goto(`/${tenantSlug}/invoices/new`)}>
				<PlusIcon class="mr-2 h-4 w-4" />
				New Invoice
			</Button>
		</div>
	</div>

	{#if syncWarning}
		<div class="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-1">
			<p class="text-sm text-amber-800 dark:text-amber-200">
				⚠ {syncWarning.message}
			</p>
			<p class="text-xs text-amber-700 dark:text-amber-300">
				Progres parțial salvat: {syncWarning.imported} importate · {syncWarning.updated} actualizate · {syncWarning.skipped} sărite.
				{#if syncWarning.retryAt}
					Următoarea încercare automată: {new Date(syncWarning.retryAt).toLocaleString('ro-RO')}.
				{/if}
				{#if syncWarning.degraded}
					Integrarea este marcată ca degradată; verifică setările.
				{/if}
			</p>
		</div>
	{:else if syncError}
		<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
			<p class="text-sm text-red-800 dark:text-red-200">{syncError}</p>
		</div>
	{/if}

	{#if syncResult}
		<div class="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
			<p class="text-sm text-green-800 dark:text-green-200">
				Sync completat:
				{#if syncResult.imported > 0}{syncResult.imported} importate{#if syncResult.updated > 0 || syncResult.unchanged > 0 || syncResult.skipped > 0}, {/if}{/if}
				{#if syncResult.updated > 0}{syncResult.updated} actualizate{#if syncResult.unchanged > 0 || syncResult.skipped > 0}, {/if}{/if}
				{#if syncResult.unchanged > 0}{syncResult.unchanged} neschimbate{#if syncResult.skipped > 0}, {/if}{/if}
				{#if syncResult.skipped > 0}{syncResult.skipped} sărite{/if}
				{#if syncResult.imported === 0 && syncResult.updated === 0 && syncResult.unchanged === 0 && syncResult.skipped === 0}nimic de procesat{/if}
			</p>
		</div>
	{/if}

	<Tabs value="invoices" class="w-full">
		<TabsList>
			<TabsTrigger value="invoices">Invoices</TabsTrigger>
			<TabsTrigger value="recurring">Recurring Invoices</TabsTrigger>
		</TabsList>

		<TabsContent value="invoices" class="space-y-4">
			<InvoiceFilters
				clients={clients.map((c) => ({ id: c.id, name: c.name }))}
				projects={projects.map((p) => ({ id: p.id, name: p.name }))}
				services={services.map((s) => ({ id: s.id, name: s.name }))}
			/>

			{#if invoicesLoading}
				<p>Loading invoices...</p>
			{:else if invoicesError}
				<div class="rounded-md bg-red-50 p-3">
					<p class="text-sm text-red-800">
						{invoicesError instanceof Error ? invoicesError.message : 'Failed to load invoices'}
					</p>
				</div>
			{:else if invoices.length === 0}
				<Card>
					<div class="p-6 text-center">
						<p class="text-muted-foreground">No invoices found. {search.current ? 'Try adjusting your filters.' : 'Get started by creating your first invoice.'}</p>
					</div>
				</Card>
			{:else}
				<div class="space-y-4">
					{#each paginatedInvoices as invoice (invoice.id)}
						<Card class="group relative overflow-hidden border-2 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20 hover:-translate-y-0.5">
							<!-- Modern gradient accent bar -->
							<div class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-primary/80 to-primary/60"></div>
							
							<div class="p-4 pt-5">
								<div class="flex items-start justify-between gap-4">
									<div class="flex-1 min-w-0">
										<!-- Header with invoice number and status -->
										<div class="flex items-center gap-2 mb-2 flex-wrap">
											<div class="flex items-center gap-1.5">
												<div class="p-1.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
													<FileTextIcon class="h-3.5 w-3.5 text-primary" />
												</div>
												<h3 class="text-lg font-bold tracking-tight text-foreground">
													{formatInvoiceNumberDisplay(invoice, invoiceSettings)}
												</h3>
											</div>
											{#if invoice.isCreditNote || ((invoice.totalAmount ?? 0) < 0)}
												<Badge
													variant="outline"
													class="text-xs font-semibold px-2 py-0.5 shadow-sm border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
												>
													↩ Storno
												</Badge>
											{:else}
												<Badge
													variant={getStatusColor(invoice.status)}
													class="text-xs font-semibold px-2 py-0.5 shadow-sm {invoice.status === 'partially_paid' ? 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700' : ''}"
												>
													{getStatusIcon(invoice.status)} {getStatusText(invoice.status)}
												</Badge>
											{/if}
											{#if invoice.status === 'partially_paid' && invoice.remainingAmount}
												<span class="text-xs font-medium text-orange-600 dark:text-orange-400">
													Sold restant: {(invoice.remainingAmount / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} {invoice.currency}
												</span>
											{/if}
											{#if isKeezActive && invoice.keezExternalId}
												{#if invoice.keezStatus === 'Valid'}
													<Badge variant="outline" class="text-xs px-2 py-0.5 border-green-500 text-green-600 dark:text-green-400">
														Keez ✓
													</Badge>
												{:else if invoice.keezStatus === 'Cancelled'}
													<Badge variant="outline" class="text-xs px-2 py-0.5 border-red-500 text-red-600 dark:text-red-400">
														Keez Anulată
													</Badge>
												{:else}
													<Badge variant="outline" class="text-xs px-2 py-0.5 border-yellow-500 text-yellow-600 dark:text-yellow-400">
														Keez Proformă
													</Badge>
												{/if}
											{/if}
											{#if emailLogsByInvoice[invoice.id]?.total > 0}
											{@const emailStats = emailLogsByInvoice[invoice.id]}
												<Popover.Root>
													<Popover.Trigger>
														{#snippet child({ props })}
															<button {...props} class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors
																{emailStats.failed > 0
																	? 'border-red-300 bg-red-50 text-red-600 dark:border-red-700 dark:bg-red-950/40 dark:text-red-400'
																	: 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-400'}">
																<MailIcon class="h-3 w-3" />
																{emailStats.total}
															</button>
														{/snippet}
													</Popover.Trigger>
													<Popover.Content class="w-64 p-3" align="start">
														<p class="mb-2 text-xs font-semibold text-muted-foreground">Notificări trimise</p>
														<div class="space-y-1.5 text-xs">
															{#if emailStats.types.invoice > 0}
																<div class="flex items-center justify-between">
																	<span class="text-muted-foreground">Factură trimisă</span>
																	<span class="font-medium">{emailStats.types.invoice}x</span>
																</div>
															{/if}
															{#if emailStats.types.reminder > 0}
																<div class="flex items-center justify-between">
																	<span class="text-muted-foreground">Reminder restanță</span>
																	<span class="font-medium text-amber-600">{emailStats.types.reminder}x</span>
																</div>
															{/if}
															{#if emailStats.types.paid > 0}
																<div class="flex items-center justify-between">
																	<span class="text-muted-foreground">Confirmare plată</span>
																	<span class="font-medium text-green-600">{emailStats.types.paid}x</span>
																</div>
															{/if}
															{#if emailStats.failed > 0}
																<div class="flex items-center justify-between">
																	<span class="text-red-500">Eșuate</span>
																	<span class="font-medium text-red-600">{emailStats.failed}x</span>
																</div>
															{/if}
															<div class="border-t pt-1.5 mt-1.5">
																<div class="flex items-center justify-between text-muted-foreground">
																	<span>Total</span>
																	<span class="font-medium">{emailStats.completed} trimise / {emailStats.total} total</span>
																</div>
																{#if emailStats.lastSentAt}
																	<div class="flex items-center justify-between text-muted-foreground mt-1">
																		<span>Ultimul email</span>
																		<span>{new Date(emailStats.lastSentAt).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
																	</div>
																{/if}
															</div>
														</div>
													</Popover.Content>
												</Popover.Root>
											{/if}
										</div>

										<!-- Client name -->
										<p class="text-xs font-medium text-muted-foreground mb-4 flex items-center gap-1.5">
											<span class="w-1 h-1 rounded-full bg-muted-foreground/40"></span>
											{clientMap.get(invoice.clientId) || 'Unknown Client'}
										</p>

										<!-- Modern info grid with icons -->
										<div class="grid gap-3 md:grid-cols-4">
											<!-- Amount - Featured prominently -->
											<div class="relative p-3 rounded-lg bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/10 group-hover:border-primary/20 transition-all">
												<div class="flex items-center gap-1.5 mb-1.5">
													<CoinsIcon class="h-3.5 w-3.5 text-primary/60" />
													<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount</p>
												</div>
												<p class="text-2xl font-bold text-primary leading-tight">
													{formatAmount(invoice.totalAmount, (invoice.currency || 'RON') as Currency)}
												</p>
											</div>

											<!-- Issue Date -->
											<div class="p-3 rounded-lg bg-muted/30 border border-border/50 group-hover:bg-muted/50 transition-all">
												<div class="flex items-center gap-1.5 mb-1.5">
													<CalendarIcon class="h-3.5 w-3.5 text-muted-foreground/60" />
													<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Issue Date</p>
												</div>
												<p class="text-sm font-semibold text-foreground">
													{#if invoice.issueDate && isValidDate(invoice.issueDate)}
														{formatDate(invoice.issueDate)}
													{:else}
														<span class="text-muted-foreground font-normal">Not set</span>
													{/if}
												</p>
											</div>

											<!-- Due Date -->
											<div class="p-3 rounded-lg bg-muted/30 border border-border/50 group-hover:bg-muted/50 transition-all">
												<div class="flex items-center gap-1.5 mb-1.5">
													<CalendarIcon class="h-3.5 w-3.5 text-muted-foreground/60" />
													<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Due Date</p>
												</div>
												<p class="text-sm font-semibold text-foreground">
													{#if invoice.dueDate && isValidDate(invoice.dueDate)}
														{formatDate(invoice.dueDate)}
													{:else}
														<span class="text-muted-foreground font-normal">Not set</span>
													{/if}
												</p>
											</div>

											<!-- Paid Date (conditional) -->
											{#if invoice.paidDate}
												<div class="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
													<div class="flex items-center gap-1.5 mb-1.5">
														<CalendarIcon class="h-3.5 w-3.5 text-green-600/60" />
														<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Paid Date</p>
													</div>
													<p class="text-sm font-semibold text-green-600 dark:text-green-400">
														{new Date(invoice.paidDate).toLocaleDateString()}
													</p>
												</div>
											{/if}
										</div>
									</div>

									<!-- Action buttons with modern styling -->
									<div class="flex items-center gap-1.5 flex-shrink-0">
										<Button
											variant="outline"
											size="icon"
											class="h-8 w-8 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
											onclick={(e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); handlePreviewPDF(invoice.id); }}
											title="Preview PDF"
										>
											<EyeIcon class="h-3.5 w-3.5" />
										</Button>
										<Button
											variant="outline"
											size="icon"
											class="h-8 w-8 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
											onclick={(e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); handleDownloadPDF(invoice.id); }}
											title="Download PDF"
										>
											<DownloadIcon class="h-3.5 w-3.5" />
										</Button>
									{#if invoice.status !== 'paid'}
										<div class="relative flex items-center gap-1">
											<Button 
												variant="outline" 
												size="icon"
												class="h-8 w-8 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
												onclick={() => handleSendInvoice(invoice.id)}
											>
												<SendIcon class="h-3.5 w-3.5" />
											</Button>
											{#if invoice.lastEmailStatus}
												<div class="absolute -right-1 -top-1 flex items-center justify-center">
													{#if invoice.lastEmailStatus === 'sent'}
														<CheckCircleIcon class="h-3 w-3 text-green-600 dark:text-green-400 bg-white dark:bg-background rounded-full" />
													{:else if invoice.lastEmailStatus === 'failed'}
														<XCircleIcon class="h-3 w-3 text-red-600 dark:text-red-400 bg-white dark:bg-background rounded-full" />
													{/if}
												</div>
											{/if}
										</div>
									{/if}
										<DropdownMenu>
											<DropdownMenuTrigger>
												<Button 
													variant="ghost" 
													size="icon"
													class="h-8 w-8 hover:bg-muted transition-all"
												>
													<MoreVerticalIcon class="h-3.5 w-3.5" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/invoices/${invoice.id}/edit`)}>
													Edit
												</DropdownMenuItem>
												<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/invoices/${invoice.id}`)}>
													View Details
												</DropdownMenuItem>
												{#if invoice.status !== 'paid'}
													<DropdownMenuItem onclick={() => handleMarkAsPaid(invoice.id)}>Mark as Paid</DropdownMenuItem>
												{/if}
												{#if isKeezActive && !invoice.keezExternalId}
													<DropdownMenuItem onclick={() => handleSyncToKeez(invoice.id)}>
														Sincronizează în Keez
													</DropdownMenuItem>
												{/if}
												{#if isKeezActive && invoice.keezExternalId}
													<DropdownMenuItem onclick={() => handleValidateInKeez(invoice.id)}>
														Validează în Keez
													</DropdownMenuItem>
													<DropdownMenuItem onclick={() => handleSendToEFactura(invoice.id)}>
														Trimite eFactura
													</DropdownMenuItem>
													<DropdownMenuItem onclick={() => handleCreateStorno(invoice.id)}>
														Storno în Keez
													</DropdownMenuItem>
												{/if}
												{#if invoice.status === 'draft'}
													<DropdownMenuItem class="text-destructive" onclick={() => handleDeleteInvoice(invoice.id)}>
														Șterge
													</DropdownMenuItem>
												{:else if invoice.status !== 'cancelled'}
													<DropdownMenuItem class="text-destructive" onclick={() => handleCancelInvoice(invoice.id)}>
														Anulează
													</DropdownMenuItem>
												{/if}
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</div>
							</div>
						</Card>
					{/each}

					{#if invoiceTotalPages > 1}
						<div class="flex items-center justify-between pt-2">
							<p class="text-sm text-muted-foreground">
								Afișare {(invoicePage - 1) * invoicePageSize + 1}–{Math.min(invoicePage * invoicePageSize, invoices.length)} din {invoices.length}
							</p>
							<div class="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									disabled={invoicePage <= 1}
									onclick={() => invoicePage--}
								>
									<ChevronLeftIcon class="h-4 w-4" />
									Anterior
								</Button>
								<span class="text-sm text-muted-foreground">
									Pagina {invoicePage} / {invoiceTotalPages}
								</span>
								<Button
									variant="outline"
									size="sm"
									disabled={invoicePage >= invoiceTotalPages}
									onclick={() => invoicePage++}
								>
									Următor
									<ChevronRightIcon class="h-4 w-4" />
								</Button>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</TabsContent>

		<TabsContent value="recurring" class="space-y-4">
			{#if recurringInvoicesLoading}
				<div class="flex items-center justify-center p-8">
					<p class="text-muted-foreground">Loading recurring invoices...</p>
				</div>
			{:else if recurringInvoices.length === 0}
				<Card class="p-8 text-center">
					<p class="text-muted-foreground mb-4">No recurring invoices found.</p>
					<Button onclick={() => openRecurringDialog()}>
						<PlusIcon class="mr-2 h-4 w-4" />
						Create Your First Recurring Invoice
					</Button>
				</Card>
			{:else}
				<div class="grid gap-4">
					{#each recurringInvoices as recurringInvoice (recurringInvoice.id)}
						<Card class="p-6">
							<div class="flex items-start justify-between">
								<div class="flex-1 space-y-2">
									<div class="flex items-center gap-3">
										<h3 class="text-lg font-semibold">{recurringInvoice.name}</h3>
										<Badge variant={recurringInvoice.isActive ? 'default' : 'secondary'}>
											{recurringInvoice.isActive ? 'Active' : 'Inactive'}
										</Badge>
									</div>
									<div class="grid grid-cols-2 gap-4 text-sm">
										<div>
											<p class="text-muted-foreground">Client</p>
											<p class="font-medium">
												{clientMap.get(recurringInvoice.clientId) || 'Unknown'}
											</p>
										</div>
										<div>
											<p class="text-muted-foreground">Amount</p>
											<p class="font-medium">
												{formatAmount(recurringInvoice.amount, recurringInvoice.currency as Currency)}
											</p>
										</div>
										<div>
											<p class="text-muted-foreground">Recurring Pattern</p>
											<p class="font-medium">
												{formatRecurringPattern(
													recurringInvoice.recurringType,
													recurringInvoice.recurringInterval
												)}
											</p>
										</div>
										<div>
											<p class="text-muted-foreground">Next Run Date</p>
											<p class="font-medium">{formatDate(recurringInvoice.nextRunDate)}</p>
										</div>
										{#if recurringInvoice.lastRunDate}
											<div>
												<p class="text-muted-foreground">Last Run Date</p>
												<p class="font-medium">{formatDate(recurringInvoice.lastRunDate)}</p>
											</div>
										{/if}
									</div>
								</div>
								<DropdownMenu>
									<DropdownMenuTrigger>
										<Button variant="ghost" size="icon">
											<MoreVerticalIcon class="h-4 w-4" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem
											onclick={() => handleTriggerRecurring(recurringInvoice.id)}
											disabled={!recurringInvoice.isActive}
										>
											<PlayIcon class="mr-2 h-4 w-4" />
											Generate Now
										</DropdownMenuItem>
										<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/invoices/recurring/${recurringInvoice.id}`)}>
											<EditIcon class="mr-2 h-4 w-4" />
											Edit
										</DropdownMenuItem>
										<DropdownMenuItem onclick={() => handleToggleActive(recurringInvoice.id)}>
											{#if recurringInvoice.isActive}
												<PowerOffIcon class="mr-2 h-4 w-4" />
												Deactivate
											{:else}
												<PowerIcon class="mr-2 h-4 w-4" />
												Activate
											{/if}
										</DropdownMenuItem>
										<DropdownMenuItem
											onclick={() => handleDeleteRecurring(recurringInvoice.id)}
											class="text-destructive"
										>
											<TrashIcon class="mr-2 h-4 w-4" />
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</Card>
					{/each}
				</div>
			{/if}
		</TabsContent>
	</Tabs>
</div>
