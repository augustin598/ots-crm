<script lang="ts">
	import {
		getSeoLinks,
		createSeoLink,
		createSeoLinksBulk,
		createSeoLinksMulti,
		updateSeoLink,
		deleteSeoLink,
		deleteSeoLinksBulk,
		importSeoLinksFromFile,
		checkSeoLink,
		extractSeoLinkData,
		extractTargetUrlForSeoLink,
		extractTargetUrlBatch
	} from '$lib/remotes/seo-links.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { getClientWebsites } from '$lib/remotes/client-websites.remote';
	import { formatAmount, CURRENCIES, CURRENCY_LABELS, type Currency } from '$lib/utils/currency';
	import { getFaviconUrl } from '$lib/utils';
	import ClientLogo from '$lib/components/client-logo.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
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
	import {
		Table,
		TableBody,
		TableCell,
		TableFooter,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import {
		Tooltip,
		TooltipContent,
		TooltipProvider,
		TooltipTrigger
	} from '$lib/components/ui/tooltip';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Rows3Icon from '@lucide/svelte/icons/rows-3';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import EditIcon from '@lucide/svelte/icons/edit';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import HelpCircleIcon from '@lucide/svelte/icons/help-circle';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import HashIcon from '@lucide/svelte/icons/hash';
	import NewspaperIcon from '@lucide/svelte/icons/newspaper';
	import KeyIcon from '@lucide/svelte/icons/key';
	import TargetIcon from '@lucide/svelte/icons/target';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import TagIcon from '@lucide/svelte/icons/tag';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import BanknoteIcon from '@lucide/svelte/icons/banknote';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import SeoLinkUrlCell from '$lib/components/seo-link-url-cell.svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ScanSearchIcon from '@lucide/svelte/icons/scan-search';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import StopCircleIcon from '@lucide/svelte/icons/stop-circle';
	import SearchIcon from '@lucide/svelte/icons/search';
	import FilterIcon from '@lucide/svelte/icons/filter';
	import XIcon from '@lucide/svelte/icons/x';
	import FileIcon from '@lucide/svelte/icons/file';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import { getMaterialDownloadUrl } from '$lib/remotes/marketing-materials.remote';
	import { Calendar } from '$lib/components/ui/calendar';
	import * as Popover from '$lib/components/ui/popover';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	const tenantSlug = $derived(page.params.tenant);

	// Filters — primare
	let filterClientIds = $state<string[]>([]);
	let clientFilterPopoverOpen = $state(false);
	let clientFilterSearch = $state('');
	let filterMonth = $state('');
	let filterDateOpen = $state(false);
	let filterDateValue = $state<DateValue | undefined>(undefined);
	let filterStatus = $state('');
	let filterCheckStatus = $state('');
	// Filters — avansate
	let filterLinkType = $state('');
	let filterLinkAttribute = $state('');
	let filterPressTrust = $state('');
	let filterWebsiteId = $state('');
	let filterSearch = $state('');
	let advancedOpen = $state(false);

	const STORAGE_KEY_CLIENTS = (tenant: string) => `crm-seo-links-clients-filter-${tenant}`;

	const filterParams = $derived({
		clientIds: filterClientIds.length > 0 ? filterClientIds : undefined,
		month: filterMonth || undefined,
		status: filterStatus || undefined,
		checkStatus: filterCheckStatus || undefined,
		linkType: filterLinkType || undefined,
		linkAttribute: filterLinkAttribute || undefined,
		pressTrust: filterPressTrust.trim() || undefined,
		websiteId: filterWebsiteId || undefined,
		search: filterSearch.trim() || undefined
	});

	// Câte filtre avansate sunt active
	const advancedActiveCount = $derived(
		[filterLinkType, filterLinkAttribute, filterPressTrust.trim(), filterWebsiteId, filterSearch.trim()].filter(Boolean).length
	);
	// Câte filtre totale sunt active
	const totalActiveFilters = $derived(
		[(filterClientIds.length > 0 ? 'x' : ''), filterMonth, filterStatus, filterCheckStatus,
		 filterLinkType, filterLinkAttribute, filterPressTrust.trim(), filterWebsiteId, filterSearch.trim()].filter(Boolean).length
	);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const clientMap = $derived(new Map(clients.map((c) => [c.id, c.name])));
	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));
	const clientById = $derived(new Map(clients.map((c) => [c.id, c])));

	function resetAllFilters() {
		filterClientIds = [];
		filterMonth = '';
		filterDateValue = undefined;
		filterStatus = '';
		filterCheckStatus = '';
		filterLinkType = '';
		filterLinkAttribute = '';
		filterPressTrust = '';
		filterWebsiteId = '';
		filterSearch = '';
	}

	function toggleClient(clientId: string) {
		if (filterClientIds.includes(clientId)) {
			filterClientIds = filterClientIds.filter((id) => id !== clientId);
		} else {
			filterClientIds = [...filterClientIds, clientId];
		}
	}

	function selectAllClients() {
		filterClientIds = clients.map((c) => c.id);
	}

	function clearClientFilter() {
		filterClientIds = [];
		clientFilterPopoverOpen = false;
	}

	const popoverClients = $derived(
		clientFilterSearch.trim()
			? clients.filter((c) => c.name.toLowerCase().includes(clientFilterSearch.trim().toLowerCase()))
			: clients
	);

	// Persistă filtrele client în localStorage
	onMount(() => {
		if (!browser || !tenantSlug) return;
		try {
			const stored = localStorage.getItem(STORAGE_KEY_CLIENTS(tenantSlug));
			if (stored) {
				const ids = JSON.parse(stored);
				if (Array.isArray(ids) && ids.length > 0) filterClientIds = ids;
			}
		} catch {
			// ignore invalid stored data
		}
	});

	$effect(() => {
		if (!browser || !tenantSlug) return;
		if (filterClientIds.length > 0) {
			localStorage.setItem(STORAGE_KEY_CLIENTS(tenantSlug), JSON.stringify(filterClientIds));
		} else {
			localStorage.removeItem(STORAGE_KEY_CLIENTS(tenantSlug));
		}
	});

	const seoLinksQuery = $derived(getSeoLinks(filterParams));
	const seoLinks = $derived(seoLinksQuery.current || []);
	const loading = $derived(seoLinksQuery.loading);

	// Website queries for filter and form
	const filterWebsitesQuery = $derived(filterClientIds.length === 1 ? getClientWebsites(filterClientIds[0]) : null);
	const filterWebsites = $derived(filterWebsitesQuery?.current || []);
	const filterWebsiteMap = $derived(new Map(filterWebsites.map((w) => [w.id, w.name || w.url.replace(/^https?:\/\//, '').replace(/^www\./, '')])));

	// Reset filterWebsiteId when client changes (only show website filter for single client)
	$effect(() => { if (filterClientIds.length !== 1) filterWebsiteId = ''; });

	// Init from URL params (?clientId=X&websiteId=Y)
	$effect(() => {
		const params = page.url.searchParams;
		const qClient = params.get('clientId');
		const qWebsite = params.get('websiteId');
		if (qClient && filterClientIds.length === 0) filterClientIds = [qClient];
		if (qWebsite && !filterWebsiteId) filterWebsiteId = qWebsite;
	});

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	// Add/Edit dialog state
	let isDialogOpen = $state(false);
	let isEditing = $state(false);
	let editingId = $state<string | null>(null);
	let formClientId = $state('');
	let formWebsiteId = $state('');
	let formPressTrust = $state('');
	let formMonth = $state(new Date().toISOString().slice(0, 7)); // YYYY-MM
	let formKeyword = $state('');
	let formLinkType = $state('');
	let formLinkAttribute = $state('dofollow');
	let formStatus = $state('pending');
	let formArticleUrl = $state('');
	let formArticleUrlsBulk = $state('');
	let formBulkMode = $state(false);
	let formTargetUrl = $state('');
	let formArticlePublishedAt = $state<string | null>(null);
	let formPrice = $state('');
	let formCurrency = $state<Currency>('RON');
	let formAnchorText = $state('');
	let formProjectId = $state('');
	let formNotes = $state('');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);
	let extractedLinks = $state<{ url: string; keyword: string }[]>([]);

	// Form website query (depends on formClientId $state)
	const formWebsitesQuery = $derived(formClientId ? getClientWebsites(formClientId) : null);
	const formWebsites = $derived(formWebsitesQuery?.current || []);

	// Auto-selectează website-ul implicit când dialogul se deschide în modul add
	$effect(() => {
		if (isDialogOpen && !isEditing && formWebsites.length > 0 && !formWebsiteId) {
			const defaultW = formWebsites.find((w) => w.isDefault) || formWebsites[0];
			if (defaultW) {
				formWebsiteId = defaultW.id;
				if (!formTargetUrl) formTargetUrl = defaultW.url;
			}
		}
	});

	// Sincronizează formTargetUrl când formWebsiteId se schimbă programatic
	$effect(() => {
		if (formWebsiteId && formWebsites.length > 0) {
			const w = formWebsites.find((x) => x.id === formWebsiteId);
			if (w && !formTargetUrl) formTargetUrl = w.url;
		}
	});

	// Import state
	let isImportDialogOpen = $state(false);
	let importFile = $state<File | null>(null);
	let importClientId = $state('');
	let importLoading = $state(false);
	let importError = $state<string | null>(null);
	let importResult = $state<{
		imported: number;
		skipped: number;
		autoDetected?: number;
		columnsFound?: string[];
	} | null>(null);

	// Link check state
	let checkingId = $state<string | null>(null);

	// Selection state
	let selectedIds = $state<Set<string>>(new Set());

	// Inline price editing
	let editingPriceId = $state<string | null>(null);
	let editingPriceValue = $state('');
	let editingPriceCurrency = $state<Currency>('RON');

	// Inline keyword editing
	let editingKeywordId = $state<string | null>(null);
	let editingKeywordValue = $state('');

	// Extract state
	let extractLoading = $state(false);
	let extractError = $state<string | null>(null);
	let showAdvanced = $state(false);
	let extractingTargetUrlId = $state<string | null>(null);

	// Report collapsible state
	let reportOpen = $state(false);

	// ── Scan Backlinks dialog ──────────────────────────────────────────────────
	type ScanResult = {
		id: string;
		keyword: string;
		articleUrl: string;
		targetUrl: string | null;
		clientId: string;
		status: string;
		httpCode: number | null;
	};
	let isScanDialogOpen = $state(false);
	let scanClientId = $state('');
	let scanMode = $state<'all' | 'unchecked' | 'problems'>('unchecked');
	let scanRunning = $state(false);
	let scanCurrent = $state(0);
	let scanTotal = $state(0);
	let scanResults = $state<ScanResult[]>([]);
	let scanDone = $state(false);
	let scanAborted = $state(false);
	let scanCurrentUrl = $state('');

	const scanQueryParams = $derived({
		clientId: scanClientId || undefined,
		checkStatus:
			scanMode === 'unchecked' ? 'never' : scanMode === 'problems' ? 'problem' : undefined
	});
	const scanLinksQuery = $derived(getSeoLinks(scanQueryParams));
	const scanLinks = $derived(scanLinksQuery.current || []);
	const scanProgressPct = $derived(scanTotal > 0 ? Math.round((scanCurrent / scanTotal) * 100) : 0);
	const scanOkCount = $derived(scanResults.filter((r) => r.status === 'ok').length);
	const scanProblemCount = $derived(scanResults.filter((r) => r.status !== 'ok').length);

	function openScanDialog() {
		scanClientId = filterClientIds.length === 1 ? filterClientIds[0] : '';
		scanMode = 'unchecked';
		scanRunning = false;
		scanCurrent = 0;
		scanTotal = 0;
		scanResults = [];
		scanDone = false;
		scanAborted = false;
		scanCurrentUrl = '';
		isScanDialogOpen = true;
	}

	function abortScan() {
		scanAborted = true;
	}

	async function handleStartScan() {
		const linksToScan = [...scanLinks];
		if (linksToScan.length === 0) {
			clientLogger.warn({ message: 'Nu există linkuri de verificat cu filtrele selectate', action: 'seo_scan' });
			return;
		}
		scanRunning = true;
		scanCurrent = 0;
		scanTotal = linksToScan.length;
		scanResults = [];
		scanDone = false;
		scanAborted = false;

		for (const link of linksToScan) {
			if (scanAborted) break;
			scanCurrentUrl = link.articleUrl;
			try {
				const result = await checkSeoLink(link.id).updates(seoLinksQuery);
				scanResults = [
					...scanResults,
					{
						id: link.id,
						keyword: link.keyword,
						articleUrl: link.articleUrl,
						targetUrl: link.targetUrl ?? null,
						clientId: link.clientId,
						status: result.status,
						httpCode: result.httpCode
					}
				];
			} catch {
				scanResults = [
					...scanResults,
					{
						id: link.id,
						keyword: link.keyword,
						articleUrl: link.articleUrl,
						targetUrl: link.targetUrl ?? null,
						clientId: link.clientId,
						status: 'error',
						httpCode: null
					}
				];
			}
			scanCurrent++;
			if (scanCurrent < linksToScan.length && !scanAborted) {
				await new Promise((r) => setTimeout(r, 600));
			}
		}

		scanRunning = false;
		scanDone = true;
		scanCurrentUrl = '';
		if (!scanAborted) {
			toast.success(`Scanare completă: ${scanOkCount} OK, ${scanProblemCount} cu probleme`);
		}
	}
	// ──────────────────────────────────────────────────────────────────────────

	// Inline multi-row state
	type InlineRow = {
		id: string;
		pressTrust: string;
		keyword: string;
		targetUrl: string;
		articleUrl: string;
		status: string;
		linkType: string;
		linkAttribute: string;
		price: string;
		currency: Currency;
		articleType: '' | 'gdrive' | 'press-article' | 'seo-article';
		gdriveUrl: string;
		articleFile: File | null;
	};

	function createEmptyRow(): InlineRow {
		const defaultTargetUrl = (() => {
			if (filterClientIds.length !== 1) return '';
			const c = clientById.get(filterClientIds[0]);
			if (c?.website) return c.website;
			if (filterWebsites.length > 0) return filterWebsites[0].url;
			return '';
		})();
		return {
			id: crypto.randomUUID(),
			pressTrust: '',
			keyword: '',
			targetUrl: defaultTargetUrl,
			articleUrl: '',
			status: 'pending',
			linkType: '',
			linkAttribute: 'dofollow',
			price: '',
			currency: (invoiceSettings?.defaultCurrency || 'RON') as Currency,
			articleType: '',
			gdriveUrl: '',
			articleFile: null,
		};
	}

	let inlineRows = $state<InlineRow[]>([]);
	let isAddingInlineRows = $state(false);
	let inlineRowsLoading = $state(false);
	let inlineRowsError = $state<string | null>(null);

	// ── Inline row EDIT state ──────────────────────────────────────────────
	let editingRowId = $state<string | null>(null);
	let editRowPressTrust = $state('');
	let editRowKeyword = $state('');
	let editRowTargetUrl = $state('');
	let editRowArticleUrl = $state('');
	let editRowStatus = $state('pending');
	let editRowArticlePublishedAt = $state<string | null>(null);
	let editRowLinkType = $state('');
	let editRowLinkAttribute = $state('dofollow');
	let editRowPrice = $state('');
	let editRowCurrency = $state<Currency>('RON');
	let editRowArticleType = $state('');
	let editRowGdriveUrl = $state('');
	let editRowWebsiteId = $state<string | null>(null);
	let editRowLoading = $state(false);
	let editRowError = $state<string | null>(null);

	// Article modal state
	let articleModalOpen = $state(false);
	let articleModalLinkId = $state<string | null>(null);
	let articleModalLink = $state<(typeof seoLinks)[0] | null>(null);
	let articleModalOption = $state<'' | 'gdrive' | 'press-article' | 'seo-article'>('');
	let articleModalInlineRowId = $state<string | null>(null);
	let articleModalGdriveUrl = $state('');
	let articleModalFile = $state<File | null>(null);
	let articleModalLoading = $state(false);
	let articleModalFileInput = $state<HTMLInputElement | null>(null);

	async function downloadArticleMaterial(materialId: string | null) {
		if (!materialId) return;
		try {
			const result = await getMaterialDownloadUrl(materialId);
			window.open(result.url, '_blank');
		} catch (err) {
			clientLogger.apiError('seo_download_article', err);
		}
	}

	function openArticleModal(link: (typeof seoLinks)[0]) {
		articleModalInlineRowId = null;
		articleModalLinkId = link.id;
		articleModalLink = link;
		articleModalOption = (link.articleType as '' | 'gdrive' | 'press-article' | 'seo-article') || '';
		articleModalGdriveUrl = link.gdriveUrl || '';
		articleModalFile = null;
		articleModalLoading = false;
		articleModalOpen = true;
	}

	function openArticleModalForInlineRow(row: InlineRow) {
		articleModalInlineRowId = row.id;
		articleModalLinkId = null;
		articleModalLink = null;
		articleModalOption = row.articleType || '';
		articleModalGdriveUrl = row.gdriveUrl || '';
		articleModalFile = row.articleFile || null;
		articleModalLoading = false;
		articleModalOpen = true;
	}

	async function saveArticleModal() {
		// Inline row mode — store in InlineRow state, don't call server
		if (articleModalInlineRowId) {
			const row = inlineRows.find(r => r.id === articleModalInlineRowId);
			if (row) {
				if (articleModalOption === 'gdrive') {
					if (!articleModalGdriveUrl.trim()) {
						clientLogger.warn({ message: 'Introduceți URL-ul GDrive', action: 'seo_save_article_inline' });
						return;
					}
					row.articleType = 'gdrive';
					row.gdriveUrl = articleModalGdriveUrl.trim();
					row.articleFile = null;
				} else if (articleModalOption === 'press-article' || articleModalOption === 'seo-article') {
					if (!articleModalFile) {
						clientLogger.warn({ message: 'Selectați un fișier', action: 'seo_save_article_inline' });
						return;
					}
					row.articleType = articleModalOption;
					row.gdriveUrl = '';
					row.articleFile = articleModalFile;
				} else {
					row.articleType = '';
					row.gdriveUrl = '';
					row.articleFile = null;
				}
			}
			toast.success('Articol salvat');
			articleModalInlineRowId = null;
			articleModalOption = '';
			articleModalGdriveUrl = '';
			articleModalFile = null;
			articleModalOpen = false;
			return;
		}

		if (!articleModalLinkId || !articleModalLink) return;
		articleModalLoading = true;

		try {
			if (articleModalOption === 'gdrive') {
				if (!articleModalGdriveUrl.trim()) {
					clientLogger.warn({ message: 'Introduceți URL-ul GDrive', action: 'seo_save_article' });
					articleModalLoading = false;
					return;
				}
				await updateSeoLink({
					seoLinkId: articleModalLinkId,
					articleType: 'gdrive',
					gdriveUrl: articleModalGdriveUrl.trim()
				}).updates(seoLinksQuery);
			} else if (articleModalOption === 'press-article' || articleModalOption === 'seo-article') {
				if (!articleModalFile) {
					clientLogger.warn({ message: 'Selectați un fișier', action: 'seo_save_article' });
					articleModalLoading = false;
					return;
				}
				// Upload file via marketing upload endpoint
				const formData = new FormData();
				formData.append('file', articleModalFile);
				formData.append('clientId', articleModalLink.clientId);
				formData.append('category', articleModalOption);
				formData.append('title', articleModalFile.name.replace(/\.[^.]+$/, ''));
				formData.append('seoLinkId', articleModalLinkId);

				const res = await fetch(`/${tenantSlug}/marketing-materials/upload`, {
					method: 'POST',
					body: formData
				});
				if (!res.ok) {
					const err = await res.json().catch(() => null);
					throw new Error(err?.error || 'Eroare la upload');
				}

				// Mark articleType on the seo link
				await updateSeoLink({
					seoLinkId: articleModalLinkId,
					articleType: articleModalOption
				}).updates(seoLinksQuery);
			}

			toast.success('Articol salvat');
			articleModalOpen = false;
		} catch (e) {
			clientLogger.apiError('seo_save_article', e);
		} finally {
			articleModalLoading = false;
		}
	}

	async function clearArticleType() {
		if (!articleModalLinkId) return;
		articleModalLoading = true;
		try {
			await updateSeoLink({
				seoLinkId: articleModalLinkId,
				articleType: null,
				gdriveUrl: null
			}).updates(seoLinksQuery);
			toast.success('Articol șters');
			articleModalOpen = false;
		} catch (e) {
			clientLogger.apiError('seo_clear_article', e);
		} finally {
			articleModalLoading = false;
		}
	}

	const projectsQuery = $derived(getProjects(formClientId || undefined));
	const projects = $derived(projectsQuery.current || []);
	const projectOptions = $derived([
		{ value: '', label: 'Niciunul' },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);

	$effect(() => {
		if (filterMonth) {
			const [y, m] = filterMonth.split('-').map(Number);
			if (y && m) filterDateValue = new CalendarDate(y, m, 1);
		} else {
			filterDateValue = undefined;
		}
	});

	$effect(() => {
		if (filterDateValue) {
			const mm = `${filterDateValue.year}-${String(filterDateValue.month).padStart(2, '0')}`;
			if (filterMonth !== mm) filterMonth = mm;
		}
	});

	$effect(() => {
		if (invoiceSettings?.defaultCurrency && !isEditing) {
			formCurrency = invoiceSettings.defaultCurrency as Currency;
		}
	});

	$effect(() => {
		if (formBulkMode) showAdvanced = true;
	});

	// Auto-fill URL client from client.website when adding new link
	$effect(() => {
		if (!isEditing && formClientId && !formTargetUrl) {
			const c = clientById.get(formClientId);
			if (c?.website) {
				formTargetUrl = c.website;
			}
		}
	});

	function openInlineRows() {
		if (editingRowId) cancelEditRow();
		inlineRows = [createEmptyRow()];
		isAddingInlineRows = true;
		inlineRowsError = null;
	}

	function addInlineRow() {
		inlineRows = [...inlineRows, createEmptyRow()];
	}

	function removeInlineRow(id: string) {
		if (inlineRows.length <= 1) return;
		inlineRows = inlineRows.filter(r => r.id !== id);
	}

	function cancelInlineRows() {
		isAddingInlineRows = false;
		inlineRows = [];
		inlineRowsError = null;
	}

	async function saveInlineRows() {
		if (inlineRows.length === 0) {
			inlineRowsError = 'Adăugați cel puțin un rând';
			return;
		}
		if (filterClientIds.length !== 1) {
			inlineRowsError = 'Selectați un singur client în filtre';
			return;
		}

		inlineRowsLoading = true;
		inlineRowsError = null;
		const monthToUse = filterMonth || new Date().toISOString().slice(0, 7);

		try {
			const result = await createSeoLinksMulti({
				clientId: filterClientIds[0],
				month: monthToUse,
				rows: inlineRows.map(r => ({
					pressTrust: r.pressTrust || undefined,
					keyword: r.keyword.trim() || undefined,
					articleUrl: r.articleUrl || undefined,
					targetUrl: r.targetUrl ? normalizeTargetUrl(r.targetUrl) : undefined,
					status: r.status as 'pending' | 'submitted' | 'published' | 'rejected',
					linkType: parseLinkType(r.linkType),
					linkAttribute: r.linkAttribute as 'dofollow' | 'nofollow',
					price: r.price ? parseFloat(r.price) : undefined,
					currency: r.currency,
					articleType: r.articleType || undefined,
					gdriveUrl: r.articleType === 'gdrive' ? r.gdriveUrl || undefined : undefined,
				}))
			}).updates(seoLinksQuery);

			// Upload article files for press-article / seo-article rows
			const seoLinkIds = result.seoLinkIds || [];
			let uploadErrors = 0;
			for (let i = 0; i < inlineRows.length; i++) {
				const row = inlineRows[i];
				const seoLinkId = seoLinkIds[i];
				if (!seoLinkId || !row.articleFile || !row.articleType || row.articleType === 'gdrive') continue;

				try {
					const formData = new FormData();
					formData.append('file', row.articleFile);
					formData.append('clientId', filterClientIds[0]);
					formData.append('category', row.articleType);
					formData.append('title', row.articleFile.name.replace(/\.[^.]+$/, ''));
					formData.append('seoLinkId', seoLinkId);

					const res = await fetch(`/${tenantSlug}/marketing-materials/upload`, {
						method: 'POST',
						body: formData
					});
					if (!res.ok) {
						uploadErrors++;
					} else {
						await updateSeoLink({ seoLinkId, articleType: row.articleType }).updates(seoLinksQuery);
					}
				} catch {
					uploadErrors++;
				}
			}

			if (uploadErrors > 0) {
				toast.success(`${result.created} linkuri adăugate (${uploadErrors} fișiere nu s-au încărcat)`);
			} else {
				toast.success(`${result.created} linkuri adăugate`);
			}
			cancelInlineRows();
		} catch (e) {
			inlineRowsError = e instanceof Error ? e.message : 'A apărut o eroare';
		} finally {
			inlineRowsLoading = false;
		}
	}

	// ── Inline row EDIT functions ─────────────────────────────────────────
	function startEditRow(link: (typeof seoLinks)[0]) {
		// Cancel any active inline add or single-field editors
		if (isAddingInlineRows) cancelInlineRows();
		editingKeywordId = null;
		editingKeywordValue = '';
		editingPriceId = null;
		editingPriceValue = '';
		editingPriceCurrency = 'RON';

		editingRowId = link.id;
		editRowPressTrust = link.pressTrust || '';
		editRowKeyword = link.keyword || '';
		editRowTargetUrl = link.targetUrl || '';
		editRowArticleUrl = link.articleUrl || '';
		editRowStatus = link.status || 'pending';
		editRowArticlePublishedAt = link.articlePublishedAt || null;
		editRowLinkType = link.linkType || '';
		editRowLinkAttribute = link.linkAttribute || 'dofollow';
		editRowPrice = link.price != null ? (link.price / 100).toFixed(2) : '';
		editRowCurrency = (link.currency || invoiceSettings?.defaultCurrency || 'RON') as Currency;
		editRowArticleType = link.articleType || '';
		editRowGdriveUrl = link.gdriveUrl || '';
		editRowWebsiteId = link.websiteId || null;
		editRowLoading = false;
		editRowError = null;
	}

	function cancelEditRow() {
		editingRowId = null;
		editRowPressTrust = '';
		editRowKeyword = '';
		editRowTargetUrl = '';
		editRowArticleUrl = '';
		editRowStatus = 'pending';
		editRowArticlePublishedAt = null;
		editRowLinkType = '';
		editRowLinkAttribute = 'dofollow';
		editRowPrice = '';
		editRowCurrency = 'RON';
		editRowArticleType = '';
		editRowGdriveUrl = '';
		editRowWebsiteId = null;
		editRowLoading = false;
		editRowError = null;
	}

	async function saveEditRow() {
		if (!editingRowId) return;
		editRowLoading = true;
		editRowError = null;

		try {
			await updateSeoLink({
				seoLinkId: editingRowId,
				pressTrust: editRowPressTrust || undefined,
				keyword: editRowKeyword.trim(),
				targetUrl: editRowTargetUrl ? normalizeTargetUrl(editRowTargetUrl) : undefined,
				articleUrl: editRowArticleUrl.trim(),
				status: editRowStatus as 'pending' | 'submitted' | 'published' | 'rejected',
				articlePublishedAt: editRowArticlePublishedAt || undefined,
				linkType: parseLinkType(editRowLinkType),
				linkAttribute: editRowLinkAttribute as 'dofollow' | 'nofollow',
				price: editRowPrice ? parseFloat(editRowPrice) : undefined,
				currency: editRowCurrency,
				anchorText: editRowKeyword.trim(),
				websiteId: editRowWebsiteId || undefined
			}).updates(seoLinksQuery);
			toast.success('Link actualizat');
			cancelEditRow();
		} catch (e) {
			editRowError = e instanceof Error ? e.message : 'Eroare la salvare';
		} finally {
			editRowLoading = false;
		}
	}
	// ──────────────────────────────────────────────────────────────────────

	function resetForm() {
		isEditing = false;
		editingId = null;
		formClientId = '';
		formWebsiteId = '';
		formPressTrust = '';
		formMonth = new Date().toISOString().slice(0, 7);
		formKeyword = '';
		formLinkType = '';
		formLinkAttribute = 'dofollow';
		formStatus = 'pending';
		formArticleUrl = '';
		formArticleUrlsBulk = '';
		formBulkMode = false;
		formTargetUrl = '';
		formArticlePublishedAt = null;
		formPrice = '';
		formCurrency = (invoiceSettings?.defaultCurrency || 'RON') as Currency;
		formAnchorText = '';
		formProjectId = '';
		formNotes = '';
		formError = null;
		extractError = null;
		extractedLinks = [];
		showAdvanced = false;
	}

	function openAddDialog() {
		resetForm();
		// Pre-completează clientul din filtru dacă e deja selectat (doar când e 1 client)
		if (filterClientIds.length === 1) {
			formClientId = filterClientIds[0];
		}
		// formWebsiteId se auto-selectează prin $effect când formWebsites se încarcă
		isDialogOpen = true;
	}

	function openEditDialog(link: (typeof seoLinks)[0]) {
		isEditing = true;
		editingId = link.id;
		formClientId = link.clientId;
		formWebsiteId = link.websiteId || '';
		formPressTrust = link.pressTrust || '';
		formMonth = link.month;
		formKeyword = link.keyword;
		formLinkType = link.linkType || '';
		formLinkAttribute = link.linkAttribute || 'dofollow';
		formStatus = link.status || 'pending';
		formArticleUrl = link.articleUrl;
		formTargetUrl = link.targetUrl || '';
		formArticlePublishedAt = link.articlePublishedAt || null;
		formPrice = link.price != null ? String(link.price / 100) : '';
		formCurrency = (link.currency || 'RON') as Currency;
		formAnchorText = link.anchorText || '';
		formProjectId = link.projectId || '';
		formNotes = link.notes || '';
		extractedLinks = parseExtractedLinks(link);
		formError = null;
		extractError = null;
		showAdvanced = true;
		isDialogOpen = true;
	}

	function normalizeTargetUrl(url: string): string {
		if (!url?.trim()) return '';
		const u = url.trim();
		if (u.startsWith('http://') || u.startsWith('https://')) return u;
		return `https://${u}`;
	}

	function parseBulkArticleUrls(text: string): string[] {
		return text
			.split(/[\r\n]+/)
			.map((s) => s.trim())
			.filter(Boolean)
			.map((u) => (u.startsWith('http://') || u.startsWith('https://') ? u : `https://${u}`));
	}

	async function handleSubmit() {
		if (formBulkMode) {
			const urls = parseBulkArticleUrls(formArticleUrlsBulk);
			if (!formClientId || !formMonth || urls.length === 0) {
				formError =
					urls.length === 0
						? 'Introduceți cel puțin un URL articol (câte unul pe linie)'
						: 'Client și luna sunt obligatorii';
				return;
			}
		} else if (!formClientId || !formMonth || !formKeyword || !formArticleUrl) {
			formError = 'Client, luna, cuvântul cheie și linkul articol sunt obligatorii';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			if (formBulkMode) {
				const urls = parseBulkArticleUrls(formArticleUrlsBulk);
				const bulkResult = await createSeoLinksBulk({
					clientId: formClientId,
					websiteId: formWebsiteId || undefined,
					pressTrust: formPressTrust || undefined,
					month: formMonth,
					keyword: '—',
					linkType: parseLinkType(formLinkType),
					linkAttribute: formLinkAttribute as 'dofollow' | 'nofollow',
					status: 'published',
					articleUrls: urls,
					targetUrl: formTargetUrl ? normalizeTargetUrl(formTargetUrl) : undefined,
					price: formPrice ? parseFloat(formPrice) : undefined,
					currency: formCurrency,
					anchorText: formAnchorText || undefined,
					projectId: formProjectId || undefined,
					notes: formNotes || undefined
				}).updates(seoLinksQuery);
				toast.success(`${urls.length} linkuri adăugate. Se extrag cuvintele cheie...`);
				resetForm();
				isDialogOpen = false;
				// Auto-extrage keyword/anchorText/targetUrl din fiecare articol
				if (bulkResult?.seoLinkIds?.length) {
					extractTargetUrlBatch({ seoLinkIds: bulkResult.seoLinkIds })
						.updates(seoLinksQuery)
						.then((r) => {
							if (r.extracted > 0) toast.success(`Cuvinte cheie extrase pentru ${r.extracted} din ${urls.length} linkuri`);
							if (r.failed > 0) clientLogger.warn({ message: `${r.failed} linkuri fără cuvânt cheie detectat`, action: 'seo_bulk_extract' });
						})
						.catch((e) => clientLogger.error({ message: 'Extragerea automată a eșuat', action: 'seo_bulk_extract' }));
				}
				return;
			}
			if (isEditing && editingId) {
				await updateSeoLink({
					seoLinkId: editingId,
					clientId: formClientId,
					websiteId: formWebsiteId || undefined,
					pressTrust: formPressTrust || undefined,
					month: formMonth,
					keyword: formKeyword,
					linkType: parseLinkType(formLinkType),
					linkAttribute: formLinkAttribute as 'dofollow' | 'nofollow',
					status: formStatus as 'pending' | 'submitted' | 'published' | 'rejected',
					articleUrl: formArticleUrl,
					articlePublishedAt: formArticlePublishedAt || undefined,
					targetUrl: formTargetUrl ? normalizeTargetUrl(formTargetUrl) : undefined,
					price: formPrice ? parseFloat(formPrice) : undefined,
					currency: formCurrency,
					anchorText: formAnchorText || undefined,
					projectId: formProjectId || undefined,
					notes: formNotes || undefined,
					extractedLinks: extractedLinks.length > 1 ? JSON.stringify(extractedLinks) : undefined
				}).updates(seoLinksQuery);
			} else {
				const result = await createSeoLink({
					clientId: formClientId,
					websiteId: formWebsiteId || undefined,
					pressTrust: formPressTrust || undefined,
					month: formMonth,
					keyword: formKeyword,
					linkType: parseLinkType(formLinkType),
					linkAttribute: formLinkAttribute as 'dofollow' | 'nofollow',
					status: formStatus as 'pending' | 'submitted' | 'published' | 'rejected',
					articleUrl: formArticleUrl,
					articlePublishedAt: formArticlePublishedAt || undefined,
					targetUrl: formTargetUrl ? normalizeTargetUrl(formTargetUrl) : undefined,
					price: formPrice ? parseFloat(formPrice) : undefined,
					currency: formCurrency,
					anchorText: formAnchorText || undefined,
					projectId: formProjectId || undefined,
					notes: formNotes || undefined,
					extractedLinks: extractedLinks.length > 1 ? JSON.stringify(extractedLinks) : undefined
				}).updates(seoLinksQuery);
				if (result?.seoLinkId) {
					try {
						await checkSeoLink(result.seoLinkId).updates(seoLinksQuery);
						toast.success('Link adăugat și verificat');
					} catch {
						toast.success('Link adăugat (verificarea a eșuat)');
					}
				} else {
					toast.success('Link adăugat');
				}
			}
			resetForm();
			isDialogOpen = false;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'A apărut o eroare';
		} finally {
			formLoading = false;
		}
	}

	async function handleDelete(seoLinkId: string) {
		if (!confirm('Sigur doriți să ștergeți acest link SEO?')) return;

		try {
			await deleteSeoLink(seoLinkId).updates(seoLinksQuery);
		} catch (e) {
			clientLogger.apiError('seo_delete', e);
		}
	}

	function getStatusBadge(status: string) {
		switch (status) {
			case 'published':
				return 'success';
			case 'submitted':
				return 'default';
			case 'rejected':
				return 'destructive';
			case 'pending':
				return 'warning';
			default:
				return 'outline';
		}
	}

	function getLinkTypeLabel(type: string) {
		const labels: Record<string, string> = {
			article: 'Articol',
			'guest-post': 'Guest post',
			'press-release': 'Comunicat de presă',
			directory: 'Director',
			other: 'Altul'
		};
		return labels[type] || type;
	}

	function getStatusLabel(status: string) {
		const labels: Record<string, string> = {
			pending: 'În așteptare',
			submitted: 'Trimis',
			published: 'Publicat',
			rejected: 'Refuzat'
		};
		return labels[status] || status;
	}

	function formatArticleDate(iso: string): string {
		try {
			const d = new Date(iso);
			if (isNaN(d.getTime())) return iso;
			return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
		} catch {
			return iso;
		}
	}

	function getPublicationDateDisplay(link: (typeof seoLinks)[0]): string | null {
		if (link.articlePublishedAt) return formatArticleDate(link.articlePublishedAt);
		if (link.status === 'published' && link.month) {
			const [y, m] = link.month.split('-').map(Number);
			if (y && m) {
				const d = new Date(y, m - 1, 1);
				return d.toLocaleDateString('ro-RO', { month: 'short', year: 'numeric' });
			}
		}
		return null;
	}

	const validLinkTypes = ['article', 'guest-post', 'press-release', 'directory', 'other'] as const;
	function parseLinkType(
		value: string
	): (typeof validLinkTypes)[number] | undefined {
		return validLinkTypes.includes(value as (typeof validLinkTypes)[number])
			? (value as (typeof validLinkTypes)[number])
			: undefined;
	}

	async function fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
	}

	async function handleImport() {
		if (!importFile) {
			importError = 'Selectați un fișier';
			return;
		}
		if (!importFile.name.match(/\.(xlsx|xls|csv)$/i)) {
			importError = 'Fișier acceptat: Excel (.xlsx, .xls) sau CSV (.csv)';
			return;
		}

		importLoading = true;
		importError = null;
		importResult = null;

		try {
			const fileData = await fileToBase64(importFile);
			const result = await importSeoLinksFromFile({
				fileData,
				fileName: importFile.name,
				defaultClientId: importClientId || undefined
			}).updates(seoLinksQuery);

			if (result.success && result.imported !== undefined) {
				importResult = {
					imported: result.imported,
					skipped: result.skipped ?? 0,
					autoDetected: result.autoDetected ?? 0,
					columnsFound: result.columnsFound
				};
				importFile = null;
				setTimeout(() => {
					isImportDialogOpen = false;
					importResult = null;
				}, 3000);
			}
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Import eșuat';
		} finally {
			importLoading = false;
		}
	}

	function handleImportFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = target.files;
		if (files?.length) {
			importFile = files[0];
			importError = null;
		}
	}

	function getCheckStatusBadge(link: (typeof seoLinks)[0]) {
		if (!link.lastCheckedAt) return { variant: 'secondary' as const, label: 'Neverificat', icon: HelpCircleIcon };
		if (link.lastCheckStatus === 'ok' || link.lastCheckStatus === 'redirect')
			return { variant: 'success' as const, label: 'OK', icon: CheckCircleIcon };
		return { variant: 'destructive' as const, label: 'Problemă', icon: XCircleIcon };
	}

	function getCheckTooltip(link: (typeof seoLinks)[0]) {
		if (!link.lastCheckedAt) return 'Neverificat';
		const d = link.lastCheckedAt instanceof Date ? link.lastCheckedAt : new Date(link.lastCheckedAt);
		const dateStr = d.toLocaleDateString('ro-RO', { dateStyle: 'short' });
		const code = link.lastCheckHttpCode != null ? ` (${link.lastCheckHttpCode})` : '';
		return `Verificat: ${dateStr}${code}`;
	}

	async function handleCheckLink(seoLinkId: string) {
		checkingId = seoLinkId;
		try {
			await checkSeoLink(seoLinkId).updates(seoLinksQuery);
		} catch (e) {
			clientLogger.apiError('seo_check_link', e);
		} finally {
			checkingId = null;
		}
	}

	async function handleExtractTargetUrl(seoLinkId: string) {
		extractingTargetUrlId = seoLinkId;
		try {
			await extractTargetUrlForSeoLink(seoLinkId).updates(seoLinksQuery);
		} catch (e) {
			clientLogger.apiError('seo_extract_target_url', e);
		} finally {
			extractingTargetUrlId = null;
		}
	}

	async function handleSavePrice(link: (typeof seoLinks)[0], value: string, currency?: Currency) {
		editingPriceId = null;
		editingPriceValue = '';
		const num = value.trim() ? parseFloat(value.replace(',', '.')) : null;
		if (num != null && (Number.isNaN(num) || num < 0)) return;
		const curr = currency ?? editingPriceCurrency;
		try {
			await updateSeoLink({
				seoLinkId: link.id,
				price: num,
				currency: curr
			}).updates(seoLinksQuery);
			toast.success(num != null ? 'Preț actualizat' : 'Preț eliminat');
		} catch (e) {
			clientLogger.apiError('seo_save_price', e);
		}
	}

	async function handleSaveKeyword(link: (typeof seoLinks)[0], value: string) {
		editingKeywordId = null;
		editingKeywordValue = '';
		const trimmed = value.trim();
		if (!trimmed) return;
		if (trimmed === link.keyword) return;
		try {
			await updateSeoLink({
				seoLinkId: link.id,
				keyword: trimmed,
				anchorText: trimmed
			}).updates(seoLinksQuery);
			toast.success('Cuvânt cheie actualizat');
		} catch (e) {
			clientLogger.apiError('seo_save_keyword', e);
		}
	}

	async function handleExtract() {
		if (!formArticleUrl || (!formTargetUrl && !formWebsiteId)) {
			extractError = 'Completează URL articol și URL client (sau selectează un website) pentru extragere';
			return;
		}
		extractLoading = true;
		extractError = null;
		extractedLinks = [];
		try {
			const result = await extractSeoLinkData({
				articleUrl: formArticleUrl,
				...(formWebsiteId ? { websiteId: formWebsiteId } : { clientUrl: formTargetUrl })
			});
			formKeyword = result.keyword || formKeyword;
			formPressTrust = result.pressTrust || formPressTrust;
			formAnchorText = result.anchorText || formAnchorText;
			formLinkType = result.linkType || formLinkType;
			if (result.targetUrl) formTargetUrl = result.targetUrl;
			if (result.articlePublishedAt) formArticlePublishedAt = result.articlePublishedAt;
			if (result.allLinks) extractedLinks = result.allLinks;
			showAdvanced = true;
		} catch (e: any) {
			extractError = e?.body?.message || e?.message || 'Extragere eșuată';
		} finally {
			extractLoading = false;
		}
	}

	function selectExtractedLink(link: { url: string; keyword: string }) {
		formTargetUrl = link.url;
		formKeyword = link.keyword;
		formAnchorText = link.keyword;
	}

	const stats = $derived({
		total: seoLinks.length,
		published: seoLinks.filter((l) => l.status === 'published').length,
		withProblems: seoLinks.filter((l) =>
			['unreachable', 'timeout', 'error'].includes(l.lastCheckStatus || '')
		).length,
		neverChecked: seoLinks.filter((l) => !l.lastCheckedAt).length
	});

	const totalByCurrency = $derived.by(() => {
		const sums: Record<string, number> = {};
		for (const link of seoLinks) {
			if (link.price != null && link.price > 0) {
				const curr = (link.currency || 'RON') as Currency;
				sums[curr] = (sums[curr] ?? 0) + link.price;
			}
		}
		return Object.entries(sums).map(([curr, cents]) => ({ currency: curr as Currency, cents }));
	});

	const priceReport = $derived.by(() => {
		const byCurrency: Record<
			string,
			{ total: number; count: number; min: number; max: number; avg: number }
		> = {};
		for (const link of seoLinks) {
			if (link.price != null && link.price > 0) {
				const curr = (link.currency || 'RON') as Currency;
				if (!byCurrency[curr]) {
					byCurrency[curr] = { total: 0, count: 0, min: link.price, max: link.price, avg: 0 };
				}
				const r = byCurrency[curr];
				r.total += link.price;
				r.count += 1;
				r.min = Math.min(r.min, link.price);
				r.max = Math.max(r.max, link.price);
			}
		}
		for (const r of Object.values(byCurrency)) {
			r.avg = r.count > 0 ? Math.round(r.total / r.count) : 0;
		}
		return Object.entries(byCurrency).map(([currency, data]) => ({
			currency: currency as Currency,
			...data
		}));
	});

	// SEO Analysis Report - requires at least 2 links
	const MIN_LINKS_FOR_REPORT = 2;
	const GENERIC_ANCHOR_PATTERNS = [
		'aici',
		'click',
		'click aici',
		'site',
		'website',
		'link',
		'citeste',
		'citeste mai mult',
		'mai mult'
	];

	const seoReport = $derived.by(() => {
		try {
			if (seoLinks.length < MIN_LINKS_FOR_REPORT) {
				return null;
			}

			// Keyword density: group by normalized keyword, count, percentage
			const keywordCounts = new Map<string, { count: number; displayKeyword: string }>();
			for (const link of seoLinks) {
				const kw = (link.keyword ?? '').toString().trim();
				if (!kw) continue;
				const normalized = kw.toLowerCase();
				const displayKeyword = kw;
			const existing = keywordCounts.get(normalized);
			if (existing) {
				existing.count++;
			} else {
				keywordCounts.set(normalized, { count: 1, displayKeyword });
			}
		}
		const totalLinks = seoLinks.length;
		const keywordDensity = Array.from(keywordCounts.entries())
			.map(([norm, { count, displayKeyword }]) => ({
				keyword: displayKeyword,
				count,
				percent: Math.round((count / totalLinks) * 100)
			}))
			.sort((a, b) => b.count - a.count);

		// Anchor diversity: anchor = anchorText || keyword
		type AnchorType = 'exact' | 'partial' | 'branded' | 'generic';
		const anchorTypes: Record<AnchorType, number> = {
			exact: 0,
			partial: 0,
			branded: 0,
			generic: 0
		};
		const uniqueAnchors = new Set<string>();

		function isUrlLike(text: string): boolean {
			return /^https?:\/\//i.test(text) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(text);
		}

		function isGenericAnchor(anchor: string): boolean {
			const lower = anchor.trim().toLowerCase();
			if (isUrlLike(anchor)) return true;
			return GENERIC_ANCHOR_PATTERNS.some((p) => lower === p || lower.includes(p));
		}

		for (const link of seoLinks) {
			const anchor = ((link.anchorText ?? link.keyword) ?? '').toString().trim();
			const anchorNorm = anchor.toLowerCase();
			const keywordNorm = ((link.keyword ?? '').toString().trim()).toLowerCase();
			uniqueAnchors.add(anchorNorm);

			const clientName = link.clientId ? clientById.get(link.clientId)?.name : null;
			const clientNameNorm = clientName?.trim().toLowerCase() ?? '';

			// Classify into exactly one type (priority order)
			if (isGenericAnchor(anchor)) {
				anchorTypes.generic++;
			} else if (clientNameNorm && anchorNorm.includes(clientNameNorm)) {
				anchorTypes.branded++;
			} else if (anchorNorm === keywordNorm) {
				anchorTypes.exact++;
			} else {
				anchorTypes.partial++;
			}
		}

		const diversityRatio = uniqueAnchors.size / totalLinks;
		const exactMatchPct = (anchorTypes.exact / totalLinks) * 100;
		const emptyAnchorPct =
			(seoLinks.filter((l) => !l.anchorText?.trim()).length / totalLinks) * 100;

		// Over-optimization risk: 0-100
		const risk =
			(exactMatchPct / 100) * 40 +
			(emptyAnchorPct / 100) * 30 +
			(1 - diversityRatio) * 30;
		const riskScore = Math.round(Math.min(100, Math.max(0, risk)));
		const riskLevel: 'low' | 'medium' | 'high' =
			riskScore <= 30 ? 'low' : riskScore <= 60 ? 'medium' : 'high';

		// Recommendations
		const recommendations: string[] = [];
		if (riskLevel === 'high') {
			recommendations.push('Reduceți procentul de anchor exact match');
		}
		if (anchorTypes.branded === 0 && totalLinks > 0) {
			recommendations.push('Adăugați anchoruri branded (nume companie)');
		}
		const topKeywordPercent = keywordDensity[0]?.percent ?? 0;
		if (topKeywordPercent > 40) {
			recommendations.push('Diversificați cuvintele cheie');
		}
		if (diversityRatio < 0.5) {
			recommendations.push('Folosiți mai multe variații de anchor text');
		}

		return {
			keywordDensity,
			anchorDiversity: {
				exact: anchorTypes.exact,
				partial: anchorTypes.partial,
				branded: anchorTypes.branded,
				generic: anchorTypes.generic,
				uniqueAnchors: uniqueAnchors.size,
				totalLinks
			},
			overOptRisk: { score: riskScore, level: riskLevel },
			recommendations
		};
		} catch (err) {
			console.error('seoReport error:', err);
			return null;
		}
	});

	const riskStyles = $derived.by(() => {
		const level = seoReport?.overOptRisk?.level;
		if (!level) return null;
		if (level === 'low')
			return {
				card: 'border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-teal-50/60 dark:border-emerald-500/40 dark:from-emerald-950/30 dark:to-teal-950/20',
				ring: 'ring-emerald-400/30',
				circleBg: 'from-emerald-500 to-teal-600',
				circleRing: 'ring-emerald-400/50',
				circleTrack: 'stroke-emerald-200/50 dark:stroke-emerald-800/40',
				circleFill: 'stroke-white',
				badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
			};
		if (level === 'medium')
			return {
				card: 'border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50/60 dark:border-amber-500/40 dark:from-amber-950/30 dark:to-orange-950/20',
				ring: 'ring-amber-400/30',
				circleBg: 'from-amber-500 to-orange-600',
				circleRing: 'ring-amber-400/50',
				circleTrack: 'stroke-amber-200/50 dark:stroke-amber-800/40',
				circleFill: 'stroke-white',
				badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
			};
		return {
			card: 'border-rose-200/80 bg-gradient-to-br from-rose-50 to-red-50/60 dark:border-rose-500/40 dark:from-rose-950/30 dark:to-red-950/20',
			ring: 'ring-rose-400/30',
			circleBg: 'from-rose-500 to-red-600',
			circleRing: 'ring-rose-400/50',
			circleTrack: 'stroke-rose-200/50 dark:stroke-rose-800/40',
			circleFill: 'stroke-white',
			badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300'
		};
	});

	const selectedIdsArray = $derived(Array.from(selectedIds));
	const allSelected = $derived(
		seoLinks.length > 0 && selectedIdsArray.length === seoLinks.length
	);
	const someSelected = $derived(selectedIdsArray.length > 0);

	function toggleSelect(id: string, checked: boolean | 'indeterminate') {
		if (checked === true) {
			selectedIds = new Set([...selectedIds, id]);
		} else if (checked === false) {
			selectedIds = new Set([...selectedIds].filter((i) => i !== id));
		}
	}

	function toggleSelectAll(checked: boolean | 'indeterminate') {
		if (checked === true) {
			selectedIds = new Set(seoLinks.map((l) => l.id));
		} else {
			selectedIds = new Set();
		}
	}

	let bulkDeleteConfirm = $state(false);
	let bulkDeleteLoading = $state(false);

	async function handleBulkDelete() {
		if (selectedIdsArray.length === 0) return;
		bulkDeleteLoading = true;
		try {
			await deleteSeoLinksBulk(selectedIdsArray).updates(seoLinksQuery);
			toast.success(`${selectedIdsArray.length} linkuri șterse`);
			selectedIds = new Set();
		} catch (e) {
			clientLogger.apiError('seo_bulk_delete', e);
		} finally {
			bulkDeleteLoading = false;
			bulkDeleteConfirm = false;
		}
	}

	function parseExtractedLinks(link: { extractedLinks?: string | null }): { url: string; keyword: string }[] {
		if (!link.extractedLinks) return [];
		try {
			const parsed = JSON.parse(link.extractedLinks);
			if (!Array.isArray(parsed)) return [];
			return parsed.filter((el: any) => el && typeof el.url === 'string' && typeof el.keyword === 'string');
		} catch { return []; }
	}

	function getPressTrustDisplay(link: { pressTrust: string | null; articleUrl: string }): string {
		if (link.pressTrust?.trim()) return link.pressTrust;
		try {
			const host = new URL(link.articleUrl).hostname.replace(/^www\./, '');
			const base = host.split('.')[0] || '';
			if (base.length <= 3) return base.toUpperCase();
			return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
		} catch {
			return '—';
		}
	}
</script>

<svelte:window onkeydown={(e) => {
	if (e.key === 'Escape' && editingRowId && !editRowLoading) {
		cancelEditRow();
	}
}} />

<svelte:head>
	<title>Linkuri SEO - CRM</title>
</svelte:head>

<div class="space-y-6">
		<div class="flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Linkuri SEO</h1>
			<p class="text-muted-foreground mt-1">
				Gestionați linkurile SEO realizate pentru clienți
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button
				variant="outline"
				onclick={openScanDialog}
			>
				<ScanSearchIcon class="mr-2 h-4 w-4" />
				Scanează Backlinks
			</Button>
			<Dialog bind:open={isImportDialogOpen}>
				<DialogTrigger>
					<Button variant="outline">
						<UploadIcon class="mr-2 h-4 w-4" />
						Import Excel / CSV
					</Button>
				</DialogTrigger>
				<DialogContent class="sm:max-w-md max-h-[85vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Import linkuri SEO</DialogTitle>
						<DialogDescription>
							Încărcați un fișier Excel (.xlsx, .xls) sau CSV cu una sau mai multe luni (sheet-uri). Coloanele: Luna, TRUST, PENTRU, CUVANT CHEIE, LINK CATRE, STATUS, LINK ARTICOL.
						</DialogDescription>
					</DialogHeader>
					<div class="space-y-4 py-4">
						<div class="space-y-2">
							<Label>Client <span class="text-muted-foreground font-normal text-xs">(opțional)</span></Label>
							<Combobox
								bind:value={importClientId}
								options={clientOptions}
								placeholder="Detectare automată din articol"
								searchPlaceholder="Căutați clienți..."
							/>
							<p class="text-xs text-muted-foreground">
								{#if importClientId}
									Toate linkurile fără coloana PENTRU vor fi asociate acestui client.
								{:else}
									Clientul și website-ul se detectează automat din linkurile fiecărui articol. Asigurați-vă că toți clienții au website-urile configurate.
								{/if}
							</p>
						</div>
						<div class="space-y-2">
							<Label>Fișier *</Label>
							<Input
								type="file"
								accept=".xlsx,.xls,.csv"
								onchange={handleImportFileSelect}
							/>
							{#if importFile}
								<p class="text-sm text-muted-foreground">{importFile.name}</p>
							{/if}
						</div>
						{#if importError}
							<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
								<p class="text-sm text-red-800 dark:text-red-300">{importError}</p>
							</div>
						{/if}
						{#if importResult}
							<div
								class="rounded-md p-3 {importResult.imported > 0
									? 'bg-green-50 dark:bg-green-900/20'
									: 'bg-amber-50 dark:bg-amber-900/20'}"
							>
								<p
									class="text-sm {importResult.imported > 0
										? 'text-green-800 dark:text-green-300'
										: 'text-amber-800 dark:text-amber-300'}"
								>
									{importResult.imported > 0
										? `Import reușit: ${importResult.imported} adăugate${importResult.autoDetected ? ` (${importResult.autoDetected} cu website detectat automat)` : ''}, ${importResult.skipped} omise.`
										: `Toate ${importResult.skipped} rândurile au fost omise.`}
								</p>
								{#if importResult.columnsFound?.length}
									<p class="text-xs text-muted-foreground mt-2">
										Coloane detectate: {importResult.columnsFound.join(', ')}
									</p>
									<p class="text-xs text-muted-foreground mt-1">
										Verificați că există coloanele: CUVANT CHEIE (sau Keyword), LINK ARTICOL sau LINK.
									</p>
								{/if}
							</div>
						{/if}
					</div>
					<DialogFooter>
						<Button
							variant="outline"
						onclick={() => {
							isImportDialogOpen = false;
							importFile = null;
							importError = null;
							importResult = null;
						}}
						>
							Anulare
						</Button>
						<Button onclick={handleImport} disabled={importLoading || !importFile}>
							{importLoading ? 'Se importă...' : 'Importă'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Button variant="outline" onclick={openInlineRows} disabled={isAddingInlineRows || loading || filterClientIds.length !== 1 || editingRowId !== null}>
				<Rows3Icon class="mr-2 h-4 w-4" />
				Adaugă rând
			</Button>
			<Dialog bind:open={isDialogOpen}>
				<DialogTrigger>
					<Button onclick={openAddDialog}>
						<PlusIcon class="mr-2 h-4 w-4" />
						Adaugă link
					</Button>
				</DialogTrigger>
			<DialogContent class="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{isEditing ? 'Editează link SEO' : 'Adaugă link SEO'}</DialogTitle>
					<DialogDescription>
						{isEditing
							? 'Modificați detaliile linkului SEO'
							: 'Adăugați un nou link SEO. Introduceți URL-urile și apăsați „Extrage date” pentru a pre-completa automat.'}
					</DialogDescription>
				</DialogHeader>
				<div class="grid gap-4 py-4">
					<!-- Câmpuri principale: Client, URL articol, URL client -->
					<div class="grid gap-2">
						<Label for="clientId">Client (companie) *</Label>
						{#if formClientId}
							<div class="flex h-9 items-center rounded-md border border-input bg-muted/50 px-3 py-2 text-sm">
								{clientMap.get(formClientId) || formClientId}
							</div>
						{:else}
							<Combobox
								bind:value={formClientId}
								options={clientOptions}
								placeholder="Selectați clientul"
								searchPlaceholder="Căutați clienți..."
							/>
						{/if}
					</div>
					{#if formClientId && formWebsites.length > 0}
					<div class="grid gap-2">
						<Label for="formWebsiteId">Website</Label>
						<Select value={formWebsiteId || 'none'} type="single" onValueChange={(v) => { formWebsiteId = v === 'none' ? '' : v || ''; if (v && v !== 'none') { const w = formWebsites.find(x => x.id === v); if (w) formTargetUrl = w.url; } }}>
							<SelectTrigger id="formWebsiteId" class="h-9">
								{#if formWebsiteId}
									{@const selW = formWebsites.find(w => w.id === formWebsiteId)}
									{#if selW}
										<span class="flex items-center gap-1.5 min-w-0">
											<img src={getFaviconUrl(selW.url)} alt="" class="h-4 w-4 shrink-0 rounded-sm object-contain" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />
											<span class="truncate">{selW.name || selW.url.replace(/^https?:\/\//, '').replace(/^www\./, '')}</span>
										</span>
									{:else}
										Fără website selectat
									{/if}
								{:else}
									Fără website selectat
								{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">Fără website selectat</SelectItem>
								{#each formWebsites as w}
									<SelectItem value={w.id}>
										<span class="flex items-center gap-2">
											<img src={getFaviconUrl(w.url)} alt="" class="h-4 w-4 shrink-0 rounded-sm object-contain" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />
											{w.name || w.url.replace(/^https?:\/\//, '').replace(/^www\./, '')}{w.isDefault ? ' ★' : ''}
										</span>
									</SelectItem>
								{/each}
							</SelectContent>
						</Select>
						<p class="text-xs text-muted-foreground">Website-ul clientului către care pointează backlinkul</p>
					</div>
					{/if}
					<div class="grid gap-2">
						<div class="flex items-center justify-between gap-2">
							<Label for="articleUrl">URL articol *</Label>
							{#if !isEditing}
								<label class="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground">
									<Checkbox bind:checked={formBulkMode} />
									Adaugă linkuri în bulk
								</label>
							{/if}
						</div>
						{#if formBulkMode}
							<Textarea
								id="articleUrl"
								bind:value={formArticleUrlsBulk}
								placeholder="Un URL pe linie, ex:&#10;https://bzi.ro/articol-1&#10;https://libertatea.ro/articol-2"
								rows={6}
								class="font-mono text-sm"
							/>
							<p class="text-xs text-muted-foreground">
								Introduceți un URL pe linie. Linkurile unde sunt plasate backlinkurile (ex: bzi.ro, libertatea.ro)
							</p>
						{:else}
							<Input
								id="articleUrl"
								bind:value={formArticleUrl}
								placeholder="https://www.bzi.ro/articol-..."
								type="url"
							/>
							<p class="text-xs text-muted-foreground">
								Linkul unde este plasat backlinkul (ex: bzi.ro, libertatea.ro)
							</p>
						{/if}
					</div>
					<div class="grid gap-2">
						<div class="flex items-center justify-between">
							<Label for="targetUrl">URL client {formWebsiteId ? '' : '*'}</Label>
							{#if formWebsiteId}
								<span class="text-xs text-muted-foreground">Auto din website selectat</span>
							{/if}
						</div>
						{#if formWebsiteId}
							<div class="flex h-9 items-center rounded-md border border-input bg-muted/50 px-3 py-2 text-sm font-mono text-muted-foreground truncate">
								{formTargetUrl || '—'}
							</div>
							<p class="text-xs text-muted-foreground">URL preluat din website-ul selectat. Schimbă website-ul de mai sus pentru a-l modifica.</p>
						{:else}
							<Input
								id="targetUrl"
								bind:value={formTargetUrl}
								placeholder="glemis.ro sau https://www.glemis.ro/..."
								type="text"
							/>
							<p class="text-xs text-muted-foreground">
								Domeniul sau pagina clientului unde pointează linkul.
							</p>
						{/if}
					</div>

					{#if formBulkMode}
						<div class="grid gap-2">
							<Label for="monthBulk">Lună *</Label>
							<Input id="monthBulk" type="month" bind:value={formMonth} />
						</div>
					{/if}

					{#if !isEditing && !formBulkMode}
						<Button
							type="button"
							variant="secondary"
							onclick={handleExtract}
							disabled={extractLoading || !formArticleUrl || !formTargetUrl}
						>
							{#if extractLoading}
								Se extrag date...
							{:else}
								<SparklesIcon class="mr-2 h-4 w-4" />
								Extrage date din articol
							{/if}
						</Button>
						{#if extractError}
							<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
								<p class="text-sm text-red-800 dark:text-red-300">{extractError}</p>
							</div>
						{/if}
						{#if extractedLinks.length > 0}
							<div class="rounded-md border bg-muted/30 p-3">
								<p class="text-sm font-medium mb-2">{extractedLinks.length} link-uri gasite in articol:</p>
								<div class="space-y-1.5">
									{#each extractedLinks as link}
										<button
											type="button"
											class="flex items-start gap-2 w-full text-left rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent {formTargetUrl === link.url ? 'bg-accent ring-1 ring-primary' : ''}"
											onclick={() => selectExtractedLink(link)}
										>
											<span class="font-medium text-primary shrink-0">{link.keyword}</span>
											<span class="text-muted-foreground truncate text-xs mt-0.5">{link.url}</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
					{/if}

					<!-- Detalii suplimentare (ascuns în modul bulk) -->
					{#if !formBulkMode}
					<Collapsible bind:open={showAdvanced}>
						<CollapsibleTrigger>
							<Button type="button" variant="ghost" size="sm">
								{showAdvanced ? 'Ascunde' : 'Afișează'} detalii suplimentare
							</Button>
						</CollapsibleTrigger>
						<CollapsibleContent>
							<div class="grid gap-4 pt-4 border-t mt-2">
								<div class="grid gap-2">
									<Label for="pressTrust">Trust de presă</Label>
									<Input
										id="pressTrust"
										bind:value={formPressTrust}
										placeholder="ex: BZI, Gândul, Adevărul"
									/>
								</div>
								<div class="grid grid-cols-2 gap-4">
									<div class="grid gap-2">
										<Label for="month">Lună *</Label>
										<Input id="month" type="month" bind:value={formMonth} />
									</div>
									<div class="grid gap-2">
										<Label for="keyword">Cuvânt cheie *</Label>
										<Input id="keyword" bind:value={formKeyword} placeholder="cuvânt cheie" />
									</div>
								</div>
								<div class="grid grid-cols-2 gap-4">
									<div class="grid gap-2">
										<Label for="linkType">Tip link</Label>
										<Select type="single" bind:value={formLinkType}>
											<SelectTrigger id="linkType">
												{#if formLinkType}
													{getLinkTypeLabel(formLinkType)}
												{:else}
													Selectați tipul
												{/if}
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="article">Articol</SelectItem>
												<SelectItem value="guest-post">Guest post</SelectItem>
												<SelectItem value="press-release">Comunicat de presă</SelectItem>
												<SelectItem value="directory">Director</SelectItem>
												<SelectItem value="other">Altul</SelectItem>
											</SelectContent>
										</Select>
									</div>
									<div class="grid gap-2">
										<Label for="linkAttribute">Dofollow / Nofollow</Label>
										<Select type="single" bind:value={formLinkAttribute}>
											<SelectTrigger id="linkAttribute">
												{formLinkAttribute === 'dofollow' ? 'Dofollow' : 'Nofollow'}
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="dofollow">Dofollow</SelectItem>
												<SelectItem value="nofollow">Nofollow</SelectItem>
											</SelectContent>
										</Select>
									</div>
								</div>
								<div class="grid gap-2">
									<Label for="status">Status</Label>
									<Select type="single" bind:value={formStatus}>
										<SelectTrigger id="status">
											{getStatusLabel(formStatus)}
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="pending">În așteptare</SelectItem>
											<SelectItem value="submitted">Trimis</SelectItem>
											<SelectItem value="published">Publicat</SelectItem>
											<SelectItem value="rejected">Refuzat</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div class="grid grid-cols-2 gap-4">
									<div class="grid gap-2">
										<Label for="price">Preț</Label>
										<Input
											id="price"
											type="number"
											bind:value={formPrice}
											placeholder="0"
											step="0.01"
										/>
									</div>
									<div class="grid gap-2">
										<Label for="currency">Monedă</Label>
										<Select type="single" bind:value={formCurrency}>
											<SelectTrigger id="currency">{CURRENCY_LABELS[formCurrency]}</SelectTrigger>
											<SelectContent>
												{#each CURRENCIES as curr}
													<SelectItem value={curr}>{CURRENCY_LABELS[curr]}</SelectItem>
												{/each}
											</SelectContent>
										</Select>
									</div>
								</div>
								<div class="grid gap-2">
									<Label for="anchorText">Anchor text</Label>
									<Input
										id="anchorText"
										bind:value={formAnchorText}
										placeholder="Textul ancorat al linkului"
									/>
								</div>
								{#if formClientId}
									<div class="grid gap-2">
										<Label for="projectId">Proiect</Label>
										<Combobox
											bind:value={formProjectId}
											options={projectOptions}
											placeholder="Selectați un proiect (opțional)"
											searchPlaceholder="Căutați proiecte..."
										/>
									</div>
								{/if}
								<div class="grid gap-2">
									<Label for="notes">Notițe</Label>
									<Textarea id="notes" bind:value={formNotes} placeholder="Notițe adiționale" />
								</div>
							</div>
						</CollapsibleContent>
					</Collapsible>
					{/if}
				</div>
				{#if formError}
					<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
						<p class="text-sm text-red-800 dark:text-red-300">{formError}</p>
					</div>
				{/if}
				<DialogFooter>
					<Button variant="outline" onclick={() => (isDialogOpen = false)}>
						Anulare
					</Button>
					<Button onclick={handleSubmit} disabled={formLoading}>
						{#if formLoading}
							Se salvează...
						{:else if isEditing}
							Salvează
						{:else if formBulkMode}
							Adaugă {parseBulkArticleUrls(formArticleUrlsBulk).length || 0} linkuri
						{:else}
							Adaugă
						{/if}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
		</div>
	</div>

	<!-- Client header cu logo website (când e selectat exact un client) -->
	{#if filterClientIds.length === 1}
		{@const selectedClient = clientById.get(filterClientIds[0])}
		{#if selectedClient}
			<div class="mb-2 flex items-start justify-between">
				<div class="flex items-center gap-4">
					<ClientLogo website={selectedClient.defaultWebsiteUrl ?? selectedClient.website} name={selectedClient.name} size="lg" />
					<div>
						<h2 class="text-2xl font-bold tracking-tight">{selectedClient.name}</h2>
						{#if selectedClient.website}
							<a
								href={selectedClient.website.startsWith('http') ? selectedClient.website : `https://${selectedClient.website}`}
								target="_blank"
								rel="noopener noreferrer"
								class="text-sm text-muted-foreground hover:text-primary hover:underline mt-0.5 inline-flex items-center gap-1"
							>
								{selectedClient.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
								<ExternalLinkIcon class="h-3 w-3" />
							</a>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Stats -->
	{#if !loading && seoLinks.length > 0}
		<div class="space-y-4">
			<div class="grid gap-3 md:grid-cols-4">
				<div class="rounded-xl border border-border/40 bg-card/50 px-4 py-3.5">
					<p class="text-xs font-medium uppercase tracking-wider text-muted-foreground/90">Total afișate</p>
					<p class="mt-0.5 text-xl font-semibold tabular-nums">{stats.total}</p>
				</div>
				<div class="rounded-xl border border-border/40 bg-card/50 px-4 py-3.5">
					<p class="text-xs font-medium uppercase tracking-wider text-muted-foreground/90">Publicate</p>
					<p class="mt-0.5 text-xl font-semibold tabular-nums">{stats.published}</p>
				</div>
				<div class="rounded-xl border border-border/40 bg-card/50 px-4 py-3.5">
					<p class="text-xs font-medium uppercase tracking-wider text-muted-foreground/90">Cu probleme</p>
					<p class="mt-0.5 text-xl font-semibold tabular-nums text-destructive">{stats.withProblems}</p>
				</div>
				<div class="rounded-xl border border-border/40 bg-card/50 px-4 py-3.5">
					<p class="text-xs font-medium uppercase tracking-wider text-muted-foreground/90">Neverificate</p>
					<p class="mt-0.5 text-xl font-semibold tabular-nums">{stats.neverChecked}</p>
				</div>
			</div>
			{#if priceReport.length > 0}
				<div class="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
					<div class="px-4 py-3 border-b border-border bg-muted/50 flex flex-wrap items-center justify-between gap-3">
						<h3 class="text-sm font-semibold flex items-center gap-2 text-foreground">
							<BanknoteIcon class="h-4 w-4" />
							Raport prețuri articole
						</h3>
						<div class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
							{#if filterClientIds.length === 1}
								<span class="font-medium text-foreground/90">Client: {clientMap.get(filterClientIds[0]) || filterClientIds[0]}</span>
							{:else if filterClientIds.length > 1}
								<span class="font-medium text-foreground/90">{filterClientIds.length} clienți selectați</span>
							{/if}
							{#if filterMonth}
								<span class="font-medium text-foreground/90">
									Lună: {new Date(filterMonth + '-01').toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })}
								</span>
							{/if}
							{#if filterClientIds.length === 0 && !filterMonth}
								<span>Toate datele</span>
							{/if}
						</div>
					</div>
					<div class="p-4">
						<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{#each priceReport as { currency, total, count, avg, min, max }}
								<div class="rounded-lg border border-border bg-card p-4 space-y-3 shadow-sm">
									<p class="text-xs font-semibold uppercase tracking-wider text-foreground/80">
										{CURRENCY_LABELS[currency] || currency}
									</p>
									<div class="space-y-2 text-sm">
										<div class="flex justify-between items-baseline">
											<span class="text-muted-foreground">Total</span>
											<span class="font-semibold tabular-nums text-foreground">{formatAmount(total, currency)}</span>
										</div>
										<div class="flex justify-between items-baseline">
											<span class="text-muted-foreground">Articole cu preț</span>
											<span class="font-medium tabular-nums text-foreground">{count}</span>
										</div>
										<div class="flex justify-between items-baseline">
											<span class="text-muted-foreground">Medie / articol</span>
											<span class="font-semibold tabular-nums text-foreground">{formatAmount(avg, currency)}</span>
										</div>
										<div class="flex justify-between items-baseline text-xs pt-1 border-t border-border/40">
											<span class="text-muted-foreground">Min / Max</span>
											<span class="tabular-nums text-foreground/90">{formatAmount(min, currency)} / {formatAmount(max, currency)}</span>
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- ── Filtre ───────────────────────────────────────────────────────────── -->
	<div class="rounded-xl border bg-card shadow-sm">

		<!-- Rândul principal: filtre primare pe toată lățimea -->
		<div class="grid grid-cols-[2fr_1.5fr_auto_1fr_1fr_auto] gap-3 items-end p-4">

			<!-- 1. Căutare — cel mai lat, prima coloană -->
			<div class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">Caută</p>
				<div class="relative">
					<SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
					<Input bind:value={filterSearch} placeholder="keyword, anchor, URL articol..." class="pl-8 h-9 text-sm" />
				</div>
			</div>

			<!-- 2. Client -->
			<div class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">Client</p>
				<Popover.Root bind:open={clientFilterPopoverOpen}>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" class="h-9 w-full justify-start font-normal text-sm gap-2">
								<FilterIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
								{#if filterClientIds.length === 0}
									Toți clienții
								{:else if filterClientIds.length === 1}
									{clientMap.get(filterClientIds[0]) ?? 'Client'}
								{:else}
									{filterClientIds.length} clienți selectați
								{/if}
								{#if filterClientIds.length > 0}
									<Badge variant="secondary" class="ml-auto">{filterClientIds.length}</Badge>
								{/if}
							</Button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content class="w-72 p-2" align="start">
						<div class="flex items-center justify-between mb-2">
							<p class="text-xs font-medium">Filtrează clienți</p>
							{#if filterClientIds.length > 0}
								<button class="text-xs text-muted-foreground hover:text-foreground" onclick={clearClientFilter}>
									Resetează
								</button>
							{/if}
						</div>
						<div class="relative mb-2">
							<SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
							<Input bind:value={clientFilterSearch} placeholder="Caută client..." class="pl-8 h-8 text-sm" />
						</div>
						<Button variant="outline" size="sm" class="w-full mb-2" onclick={selectAllClients}>
							Selectează toți
						</Button>
						<p class="text-xs text-muted-foreground mb-1">
							{filterClientIds.length === 0 ? 'Toți clienții afișați' : `${filterClientIds.length} din ${clients.length} selectați`}
						</p>
						<div class="max-h-[200px] overflow-y-auto space-y-0.5">
							{#each popoverClients as client}
								<div class="flex items-center space-x-2 rounded px-1 py-1 hover:bg-muted/50">
									<Checkbox
										checked={filterClientIds.includes(client.id)}
										onCheckedChange={() => toggleClient(client.id)}
										id={`flt-client-${client.id}`}
									/>
									<Label for={`flt-client-${client.id}`} class="cursor-pointer flex-1 truncate text-sm font-normal">
										{client.name}
									</Label>
								</div>
							{/each}
						</div>
					</Popover.Content>
				</Popover.Root>
			</div>

			<!-- 3. Lună — lățime fixă (date picker) -->
			<div class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">Lună</p>
				<Popover.Root bind:open={filterDateOpen}>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" class="w-[168px] h-9 justify-start text-start font-normal text-sm">
								<CalendarIcon class="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
								{filterMonth
									? (() => { const [y, m] = filterMonth.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('ro-RO', { month: 'short', year: 'numeric' }); })()
									: 'Toate lunile'}
							</Button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content class="w-auto p-0" align="start">
						<div class="flex flex-col">
							<Calendar type="single" bind:value={filterDateValue} onValueChange={() => (filterDateOpen = false)} locale="ro-RO" captionLayout="dropdown" />
							<Button variant="ghost" class="rounded-t-none border-t text-muted-foreground text-sm" onclick={() => { filterMonth = ''; filterDateValue = undefined; filterDateOpen = false; }}>
								Toate lunile
							</Button>
						</div>
					</Popover.Content>
				</Popover.Root>
			</div>

			<!-- 4. Status -->
			<div class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">Status</p>
				<Select value={filterStatus || 'all'} type="single" onValueChange={(v) => { filterStatus = v === 'all' ? '' : v || ''; }}>
					<SelectTrigger class="h-9">
						{filterStatus ? getStatusLabel(filterStatus) : 'Toate'}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">Toate</SelectItem>
						<SelectItem value="pending">În așteptare</SelectItem>
						<SelectItem value="submitted">Trimis</SelectItem>
						<SelectItem value="published">Publicat</SelectItem>
						<SelectItem value="rejected">Refuzat</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<!-- 5. Verificare -->
			<div class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">Verificare link</p>
				<Select value={filterCheckStatus || 'all'} type="single" onValueChange={(v) => { filterCheckStatus = v === 'all' ? '' : v || ''; }}>
					<SelectTrigger class="h-9">
						{#if filterCheckStatus === 'problem'}Cu probleme
						{:else if filterCheckStatus === 'never'}Neverificate
						{:else if filterCheckStatus === 'ok'}OK
						{:else}Toate{/if}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">Toate</SelectItem>
						<SelectItem value="ok">OK</SelectItem>
						<SelectItem value="problem">Cu probleme</SelectItem>
						<SelectItem value="never">Neverificate</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<!-- 6. Buton Avansat — dreapta, aliniat jos cu inputurile -->
			<div class="space-y-1.5">
				<p class="text-xs font-medium text-transparent select-none">·</p>
				<Button
					variant={advancedOpen || advancedActiveCount > 0 ? 'secondary' : 'outline'}
					onclick={() => (advancedOpen = !advancedOpen)}
					class="h-9 gap-1.5 px-3"
				>
					<FilterIcon class="h-3.5 w-3.5" />
					Avansat
					{#if advancedActiveCount > 0}
						<span class="inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
							{advancedActiveCount}
						</span>
					{/if}
					{#if advancedOpen}
						<ChevronUpIcon class="h-3.5 w-3.5 opacity-50" />
					{:else}
						<ChevronDownIcon class="h-3.5 w-3.5 opacity-50" />
					{/if}
				</Button>
			</div>
		</div>

		<!-- Filtre avansate — colapsabil, cu separator -->
		{#if advancedOpen}
			<div class="border-t px-4 py-3 bg-muted/30">
				<div class="grid grid-cols-4 gap-3">
					<!-- Website (apare doar când clientul e selectat) -->
					<div class="space-y-1.5">
						<p class="text-xs font-medium text-muted-foreground">Website</p>
						{#if filterClientIds.length === 1 && filterWebsites.length > 0}
							<Select value={filterWebsiteId || 'all'} type="single" onValueChange={(v) => { filterWebsiteId = v === 'all' ? '' : v || ''; }}>
								<SelectTrigger class="h-9">
									{#if filterWebsiteId}
										{@const selW = filterWebsites.find(w => w.id === filterWebsiteId)}
										{#if selW}
											<span class="flex items-center gap-1.5 min-w-0">
												<img src={getFaviconUrl(selW.url)} alt="" class="h-4 w-4 shrink-0 rounded-sm object-contain" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />
												<span class="truncate">{filterWebsiteMap.get(filterWebsiteId) || 'Website'}</span>
											</span>
										{:else}
											{filterWebsiteMap.get(filterWebsiteId) || 'Website'}
										{/if}
									{:else}
										Toate website-urile
									{/if}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">Toate website-urile</SelectItem>
									{#each filterWebsites as w}
										<SelectItem value={w.id}>
											<span class="flex items-center gap-2">
												<img src={getFaviconUrl(w.url)} alt="" class="h-4 w-4 shrink-0 rounded-sm object-contain" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />
												{w.name || w.url.replace(/^https?:\/\//, '').replace(/^www\./, '')}
											</span>
										</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						{:else}
							<div class="h-9 flex items-center px-3 rounded-md border border-dashed border-border text-xs text-muted-foreground">
								{filterClientIds.length === 1 ? 'Fără website-uri' : 'Selectați un client'}
							</div>
						{/if}
					</div>

					<!-- Tip link -->
					<div class="space-y-1.5">
						<p class="text-xs font-medium text-muted-foreground">Tip link</p>
						<Select value={filterLinkType || 'all'} type="single" onValueChange={(v) => { filterLinkType = v === 'all' ? '' : v || ''; }}>
							<SelectTrigger class="h-9">
								{#if filterLinkType === 'article'}Articol
								{:else if filterLinkType === 'guest-post'}Guest post
								{:else if filterLinkType === 'press-release'}Comunicat presă
								{:else if filterLinkType === 'directory'}Director
								{:else if filterLinkType === 'other'}Altul
								{:else}Toate tipurile{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Toate tipurile</SelectItem>
								<SelectItem value="article">Articol</SelectItem>
								<SelectItem value="guest-post">Guest post</SelectItem>
								<SelectItem value="press-release">Comunicat presă</SelectItem>
								<SelectItem value="directory">Director</SelectItem>
								<SelectItem value="other">Altul</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<!-- Atribut link -->
					<div class="space-y-1.5">
						<p class="text-xs font-medium text-muted-foreground">Atribut link</p>
						<Select value={filterLinkAttribute || 'all'} type="single" onValueChange={(v) => { filterLinkAttribute = v === 'all' ? '' : v || ''; }}>
							<SelectTrigger class="h-9">
								{#if filterLinkAttribute === 'dofollow'}Dofollow
								{:else if filterLinkAttribute === 'nofollow'}Nofollow
								{:else}Dofollow + Nofollow{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Dofollow + Nofollow</SelectItem>
								<SelectItem value="dofollow">Dofollow</SelectItem>
								<SelectItem value="nofollow">Nofollow</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<!-- Platformă presă -->
					<div class="space-y-1.5">
						<p class="text-xs font-medium text-muted-foreground">Platformă presă</p>
						<Input bind:value={filterPressTrust} placeholder="ex: Gândul, Adevărul..." class="h-9 text-sm" />
					</div>
				</div>
			</div>
		{/if}

		<!-- Footer card: chips filtre active + counter + reset -->
		{#if totalActiveFilters > 0 || !loading}
			<div class="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 bg-muted/20">

				<!-- Chips filtre active -->
				{#if filterSearch.trim()}
					<button onclick={() => (filterSearch = '')} class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						🔍 "{filterSearch.trim()}" <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#each filterClientIds as cId}
					<button onclick={() => { filterClientIds = filterClientIds.filter((id) => id !== cId); }} class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						{clientMap.get(cId) ?? 'Client'} <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/each}
				{#if filterMonth}
					<button onclick={() => { filterMonth = ''; filterDateValue = undefined; }} class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						📅 {(() => { const [y, m] = filterMonth.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' }); })()}
						<XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#if filterStatus}
					<button onclick={() => (filterStatus = '')} class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						{getStatusLabel(filterStatus)} <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#if filterCheckStatus}
					<button onclick={() => (filterCheckStatus = '')} class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						{filterCheckStatus === 'ok' ? '✅ OK' : filterCheckStatus === 'problem' ? '❌ Cu probleme' : '○ Neverificate'} <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#if filterLinkType}
					<button onclick={() => (filterLinkType = '')} class="inline-flex items-center gap-1 rounded-full border bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2.5 py-0.5 text-xs font-medium hover:opacity-75 transition-opacity">
						{filterLinkType === 'article' ? 'Articol' : filterLinkType === 'guest-post' ? 'Guest post' : filterLinkType === 'press-release' ? 'Comunicat' : filterLinkType === 'directory' ? 'Director' : 'Altul'}
						<XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#if filterLinkAttribute}
					<button onclick={() => (filterLinkAttribute = '')} class="inline-flex items-center gap-1 rounded-full border bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 px-2.5 py-0.5 text-xs font-medium hover:opacity-75 transition-opacity">
						{filterLinkAttribute === 'dofollow' ? 'Dofollow' : 'Nofollow'} <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#if filterPressTrust.trim()}
					<button onclick={() => (filterPressTrust = '')} class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						📰 "{filterPressTrust.trim()}" <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#if filterWebsiteId}
					<button onclick={() => (filterWebsiteId = '')} class="inline-flex items-center gap-1 rounded-full border bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400 px-2.5 py-0.5 text-xs font-medium hover:opacity-75 transition-opacity">
						🌐 {filterWebsiteMap.get(filterWebsiteId) ?? 'Website'} <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}

				<!-- Counter + Reset — împins la dreapta -->
				<div class="ml-auto flex items-center gap-3 shrink-0">
					{#if !loading}
						<span class="text-xs text-muted-foreground tabular-nums">
							<span class="font-medium text-foreground">{seoLinks.length}</span>
							{seoLinks.length === 1 ? 'link' : 'linkuri'}
						</span>
					{/if}
					{#if totalActiveFilters > 0}
						<button onclick={resetAllFilters} class="text-xs text-muted-foreground hover:text-destructive underline underline-offset-2 transition-colors">
							Resetează tot
						</button>
					{/if}
				</div>

			</div>
		{/if}

	</div>
	<!-- ────────────────────────────────────────────────────────────────────── -->

	<!-- Raport analiză SEO -->
	{#if !loading && seoLinks.length >= MIN_LINKS_FOR_REPORT && seoReport}
		<Collapsible bind:open={reportOpen}>
			<div
				class="overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-b from-card to-card/80 shadow-sm ring-1 ring-black/5 dark:ring-white/5"
			>
				<CollapsibleTrigger
					class="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-muted/30"
				>
					<div class="flex items-center gap-3">
						<div
							class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
						>
							<BarChart3Icon class="h-4 w-4" />
						</div>
						<div>
							<h3 class="font-semibold text-foreground">Raport analiză SEO</h3>
							<p class="text-xs text-muted-foreground">
								Densitate keywords · Diversitate anchoruri · Risc over-optimization
							</p>
						</div>
					</div>
					{#if reportOpen}
						<ChevronUpIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
					{:else}
						<ChevronDownIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
					{/if}
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div class="border-t border-border/40 px-5 pb-5 pt-4">
						<div class="grid gap-6 lg:grid-cols-2">
							<!-- Keyword density - bar chart style -->
							<div class="space-y-3">
								<h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
									Densitatea cuvintelor cheie
								</h4>
								<div class="space-y-3">
									{#each seoReport.keywordDensity as row}
										<div class="group">
											<div class="mb-1 flex items-baseline justify-between gap-2">
												<span class="truncate text-sm font-medium text-foreground">{row.keyword}</span>
												<span class="shrink-0 text-xs tabular-nums text-muted-foreground">
													{row.count} linkuri · {row.percent}%
												</span>
											</div>
											<div
												class="h-2 overflow-hidden rounded-full bg-muted/60"
												role="progressbar"
												aria-valuenow={row.percent}
												aria-valuemin="0"
												aria-valuemax="100"
											>
												<div
													class="h-full rounded-full bg-primary/80 transition-all duration-500 ease-out"
													style="width: {row.percent}%"
												></div>
											</div>
										</div>
									{/each}
								</div>
							</div>

							<!-- Anchor diversity + Risk -->
							<div class="space-y-4">
								<!-- Risk score - design modern cu culori pe nivel -->
								{#if riskStyles}
								<div
									class="flex items-center gap-5 rounded-2xl border-2 p-5 shadow-sm backdrop-blur-sm {riskStyles.card} {riskStyles.ring} ring-2"
								>
									<div
										class="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br {riskStyles.circleBg} shadow-lg {riskStyles.circleRing} ring-2"
									>
										<svg class="h-16 w-16 -rotate-90 absolute" viewBox="0 0 36 36">
											<path
												class="fill-none {riskStyles.circleTrack}"
												stroke-width="2.5"
												d="M18 2.5 a 15.5 15.5 0 0 1 0 31 a 15.5 15.5 0 0 1 0 -31"
											/>
											<path
												class="transition-all duration-700 ease-out {riskStyles.circleFill}"
												stroke-width="2.5"
												stroke-linecap="round"
												stroke-dasharray={`${seoReport.overOptRisk.score * 0.97} 97`}
												d="M18 2.5 a 15.5 15.5 0 0 1 0 31 a 15.5 15.5 0 0 1 0 -31"
											/>
										</svg>
										<span class="relative z-10 text-lg font-bold tabular-nums text-white drop-shadow-sm">
											{seoReport.overOptRisk.score}
										</span>
									</div>
									<div class="flex flex-1 flex-col gap-1">
										<p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/90">
											Risc over-optimization
										</p>
										<span
											class="inline-flex w-fit items-center rounded-lg px-3 py-1 text-sm font-bold {riskStyles.badge}"
										>
											{seoReport.overOptRisk.level === 'low'
												? 'Scăzut'
												: seoReport.overOptRisk.level === 'medium'
													? 'Mediu'
													: 'Ridicat'}
										</span>
									</div>
								</div>
								{/if}

								<!-- Anchor diversity -->
								<div class="space-y-3">
									<h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
										Diversitatea anchorurilor
									</h4>
									<p class="text-sm text-muted-foreground">
										<span class="font-medium text-foreground">{seoReport.anchorDiversity.uniqueAnchors}</span>
										anchoruri unice din
										<span class="font-medium text-foreground">{seoReport.anchorDiversity.totalLinks}</span>
										total
									</p>
									<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
										<div
											class="rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-center"
										>
											<p class="text-lg font-semibold tabular-nums text-foreground">
												{seoReport.anchorDiversity.exact}
											</p>
											<p class="text-[11px] text-muted-foreground">Exact</p>
										</div>
										<div
											class="rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-center"
										>
											<p class="text-lg font-semibold tabular-nums text-foreground">
												{seoReport.anchorDiversity.partial}
											</p>
											<p class="text-[11px] text-muted-foreground">Parțial</p>
										</div>
										<div
											class="rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-center"
										>
											<p class="text-lg font-semibold tabular-nums text-foreground">
												{seoReport.anchorDiversity.branded}
											</p>
											<p class="text-[11px] text-muted-foreground">Branded</p>
										</div>
										<div
											class="rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-center"
										>
											<p class="text-lg font-semibold tabular-nums text-foreground">
												{seoReport.anchorDiversity.generic}
											</p>
											<p class="text-[11px] text-muted-foreground">Generic</p>
										</div>
									</div>
								</div>
							</div>
						</div>

						<!-- Recommendations -->
						{#if seoReport.recommendations.length > 0}
							<div class="mt-6 space-y-2">
								<h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
									Recomandări
								</h4>
								<div class="flex flex-wrap gap-2">
									{#each seoReport.recommendations as rec}
										<span
											class="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-2 text-sm font-medium text-foreground/90 dark:bg-muted/20"
										>
											<span class="text-primary">→</span>
											{rec}
										</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	{:else if !loading && seoLinks.length > 0 && seoLinks.length < MIN_LINKS_FOR_REPORT}
		<p class="text-sm text-muted-foreground">
			Nu există suficiente date pentru analiză (minim {MIN_LINKS_FOR_REPORT} linkuri).
		</p>
	{/if}

	{#if loading}
		<p class="text-muted-foreground">Se încarcă...</p>
	{:else if seoLinks.length === 0 && !isAddingInlineRows}
		<Card>
			<div class="p-6 text-center">
				<p class="text-muted-foreground">
					Nu există linkuri SEO. Adăugați primul link pentru un client.
				</p>
			</div>
		</Card>
	{:else}

	{#if someSelected}
		<div class="flex items-center gap-3 rounded-lg border border-border bg-muted/60 px-4 py-2.5">
			<span class="text-sm font-medium">{selectedIdsArray.length} selectate</span>
			<div class="ml-auto flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={() => (selectedIds = new Set())}>
					Anulează selecția
				</Button>
				{#if bulkDeleteConfirm}
					<span class="text-sm text-muted-foreground">Sigur ștergi {selectedIdsArray.length} linkuri?</span>
					<Button variant="outline" size="sm" onclick={() => (bulkDeleteConfirm = false)}>Nu</Button>
					<Button variant="destructive" size="sm" onclick={handleBulkDelete} disabled={bulkDeleteLoading}>
						{bulkDeleteLoading ? 'Se șterge...' : 'Da, șterge'}
					</Button>
				{:else}
					<Button variant="destructive" size="sm" onclick={() => (bulkDeleteConfirm = true)}>
						<TrashIcon class="mr-1.5 h-3.5 w-3.5" />
						Șterge selecția
					</Button>
				{/if}
			</div>
		</div>
	{/if}

		<div class="rounded-2xl border border-border/40 bg-card/50 shadow-sm backdrop-blur-[2px] overflow-hidden">
			<div class="overflow-x-auto">
				<Table class="text-sm">
					<TableHeader>
						<TableRow class="border-b border-border/50 hover:bg-transparent">
							<TableHead class="w-12 pl-5 pr-2 h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90">
								<Checkbox
									checked={allSelected}
									indeterminate={someSelected && !allSelected}
									onCheckedChange={toggleSelectAll}
									aria-label="Selectează toate"
								/>
							</TableHead>
							<TableHead class="w-12 h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<HashIcon class="h-3.5 w-3.5 shrink-0" />
									Nr.
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Număr</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													Numărul de ordine al link-ului în listă.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3 w-0 whitespace-nowrap">
								<span class="inline-flex items-center gap-1.5">
									<NewspaperIcon class="h-3.5 w-3.5 shrink-0" />
									Trust presă
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<KeyIcon class="h-3.5 w-3.5 shrink-0" />
									Cuvânt cheie
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Cuvânt cheie</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													Cuvântul cheie pentru care a fost optimizat anchor text-ul link-ului. Este extras din textul vizibil al link-ului pe pagină.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<TargetIcon class="h-3.5 w-3.5 shrink-0" />
									URL țintă
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">URL țintă</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													URL-ul site-ului tău către care face link articolul. Este pagina de destinație a backlink-ului.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							{#if filterClientIds.length === 1}
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									🌐 Website
								</span>
							</TableHead>
							{/if}
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<FileTextIcon class="h-3.5 w-3.5 shrink-0" />
									Link articol
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Link articol</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													URL-ul articolului pe care este publicat link-ul către site-ul tău. Este sursa backlink-ului.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<CircleDotIcon class="h-3.5 w-3.5 shrink-0" />
									Status / Data publicare
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Status</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													<strong class="text-foreground">În așteptare</strong> — în lucru. <strong class="text-foreground">Trimis</strong> — articol trimis. <strong class="text-foreground">Publicat</strong> — live pe site. <strong class="text-foreground">Refuzat</strong> — respins. Data este extrasă din articol.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<TagIcon class="h-3.5 w-3.5 shrink-0" />
									Tip
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Dofollow vs Nofollow</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													<strong class="text-foreground">Dofollow</strong> — link transmite autoritate către site-ul țintă; Google urmărește link-ul pentru SEO.
												</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed mt-1">
													<strong class="text-foreground">Nofollow</strong> — link nu transmite link equity; Google nu îl urmărește pentru ranking.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<CheckCircle2Icon class="h-3.5 w-3.5 shrink-0" />
									Check
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger>
												<HelpCircleIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 cursor-help" />
											</TooltipTrigger>
											<TooltipContent
												class="max-w-[260px] !bg-popover !text-popover-foreground border border-border shadow-lg p-3 rounded-lg"
												arrowClasses="!bg-popover"
											>
												<p class="font-semibold text-sm mb-1.5 text-foreground">Verificare link</p>
												<p class="text-[13px] text-foreground/90 leading-relaxed">
													<strong class="text-foreground">OK</strong> — link accesibil. <strong class="text-foreground">Redirect</strong> — redirecționare. <strong class="text-foreground">Unreachable</strong> — inaccesibil. <strong class="text-foreground">Neverificat</strong> — încă neverificat.
												</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<FileIcon class="h-3.5 w-3.5 shrink-0" />
									Articol
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<BanknoteIcon class="h-3.5 w-3.5 shrink-0" />
									Preț
								</span>
							</TableHead>
							<TableHead class="w-14 pr-5 h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90"></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#if isAddingInlineRows}
							{#each inlineRows as row (row.id)}
							<TableRow class="border-b border-border/30 bg-muted/30 hover:bg-muted/40">
								<TableCell class="pl-5 pr-2 py-2 align-middle"></TableCell>
								<TableCell class="text-muted-foreground text-[13px] px-3 py-2 align-middle">—</TableCell>
								<TableCell class="px-3 py-2 align-middle">
									<Input bind:value={row.pressTrust} placeholder="Trust presă" class="h-8 text-[13px] w-full min-w-[6rem]" />
								</TableCell>
								<TableCell class="px-3 py-2 align-middle">
									<Input bind:value={row.keyword} placeholder="Cuvânt cheie" class="h-8 text-[13px] w-full min-w-[7rem]" />
								</TableCell>
								<TableCell class="px-3 py-2 align-middle">
									<Input bind:value={row.targetUrl} placeholder="URL țintă" class="h-8 text-[13px] w-full min-w-[8rem]" />
								</TableCell>
								{#if filterClientIds.length === 1}<TableCell class="px-3 py-2 align-middle text-muted-foreground/50 text-[13px]">—</TableCell>{/if}
								<TableCell class="px-3 py-2 align-middle">
									<Input bind:value={row.articleUrl} placeholder="Link articol" class="h-8 text-[13px] w-full min-w-[10rem]" />
								</TableCell>
								<TableCell class="px-3 py-2 align-middle">
									<Select type="single" bind:value={row.status}>
										<SelectTrigger class="h-8 text-[13px] min-w-[6rem]">
											{getStatusLabel(row.status)}
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="pending">În așteptare</SelectItem>
											<SelectItem value="submitted">Trimis</SelectItem>
											<SelectItem value="published">Publicat</SelectItem>
											<SelectItem value="rejected">Refuzat</SelectItem>
										</SelectContent>
									</Select>
								</TableCell>
								<TableCell class="px-3 py-2 align-middle">
									<div class="flex flex-col gap-1">
										<Select type="single" bind:value={row.linkType}>
											<SelectTrigger class="h-8 text-[12px] min-w-[5rem]">
												{row.linkType ? getLinkTypeLabel(row.linkType) : 'Tip'}
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="article">Articol</SelectItem>
												<SelectItem value="guest-post">Guest post</SelectItem>
												<SelectItem value="press-release">Comunicat</SelectItem>
												<SelectItem value="directory">Director</SelectItem>
												<SelectItem value="other">Altul</SelectItem>
											</SelectContent>
										</Select>
										<Select type="single" bind:value={row.linkAttribute}>
											<SelectTrigger class="h-7 text-[11px] min-w-[5rem]">
												{row.linkAttribute}
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="dofollow">Dofollow</SelectItem>
												<SelectItem value="nofollow">Nofollow</SelectItem>
											</SelectContent>
										</Select>
									</div>
								</TableCell>
								<TableCell class="px-3 py-2 align-middle text-muted-foreground text-[13px]">—</TableCell>
								<TableCell class="px-3 py-2 align-middle">
									{#if row.articleType === 'gdrive'}
										<div class="flex items-center gap-1.5">
											<Badge variant="outline" class="text-[11px] h-5 rounded-full px-2 font-normal bg-emerald-50 text-emerald-700 border-emerald-200">GDrive</Badge>
											<button type="button" class="text-muted-foreground hover:text-foreground" onclick={() => openArticleModalForInlineRow(row)}>
												<EditIcon class="h-3 w-3" />
											</button>
										</div>
									{:else if row.articleType === 'press-article'}
										<div class="flex items-center gap-1.5">
											<Badge variant="outline" class="text-[11px] h-5 rounded-full px-2 font-normal bg-amber-50 text-amber-700 border-amber-200">Presă</Badge>
											<button type="button" class="text-muted-foreground hover:text-foreground" onclick={() => openArticleModalForInlineRow(row)}>
												<EditIcon class="h-3 w-3" />
											</button>
										</div>
									{:else if row.articleType === 'seo-article'}
										<div class="flex items-center gap-1.5">
											<Badge variant="outline" class="text-[11px] h-5 rounded-full px-2 font-normal bg-blue-50 text-blue-700 border-blue-200">SEO</Badge>
											<button type="button" class="text-muted-foreground hover:text-foreground" onclick={() => openArticleModalForInlineRow(row)}>
												<EditIcon class="h-3 w-3" />
											</button>
										</div>
									{:else}
										<Button variant="ghost" size="sm" class="h-7 text-[12px] text-muted-foreground" onclick={() => openArticleModalForInlineRow(row)}>
											<PlusIcon class="h-3.5 w-3.5 mr-1" />
											Adaugă
										</Button>
									{/if}
								</TableCell>
								<TableCell class="px-3 py-2 align-middle">
									<div class="flex items-center gap-1.5">
										<Input
											type="number"
											bind:value={row.price}
											placeholder="0"
											step="0.01"
											class="h-8 w-16 text-[13px] px-2"
										/>
										<Select type="single" bind:value={row.currency}>
											<SelectTrigger class="h-8 w-[4.5rem] text-[12px] px-2">
												{CURRENCY_LABELS[row.currency]}
											</SelectTrigger>
											<SelectContent>
												{#each CURRENCIES as curr}
													<SelectItem value={curr}>{CURRENCY_LABELS[curr]}</SelectItem>
												{/each}
											</SelectContent>
										</Select>
									</div>
								</TableCell>
								<TableCell class="py-2 pr-5 align-middle">
									{#if inlineRows.length > 1}
										<Button size="sm" variant="ghost" class="h-8 w-8 p-0" onclick={() => removeInlineRow(row.id)}>
											<XIcon class="h-4 w-4" />
										</Button>
									{/if}
								</TableCell>
							</TableRow>
							{/each}
							<TableRow class="bg-muted/20 border-b border-border/30">
								<TableCell colspan={filterClientIds.length === 1 ? 13 : 12} class="px-5 py-2">
									<div class="flex items-center gap-2">
										<Button size="sm" variant="outline" class="h-8" onclick={addInlineRow}>
											<PlusIcon class="mr-1 h-3.5 w-3.5" />
											Adaugă rând
										</Button>
										<div class="ml-auto flex items-center gap-1">
											<Button size="sm" class="h-8" onclick={saveInlineRows} disabled={inlineRowsLoading}>
												{inlineRowsLoading ? 'Se salvează...' : `Salvează tot (${inlineRows.length})`}
											</Button>
											<Button size="sm" variant="ghost" class="h-8" onclick={cancelInlineRows} disabled={inlineRowsLoading}>
												Anulează
											</Button>
										</div>
									</div>
								</TableCell>
							</TableRow>
							{#if inlineRowsError}
								<TableRow class="bg-destructive/10">
									<TableCell colspan={filterClientIds.length === 1 ? 13 : 12} class="px-5 py-2 text-sm text-destructive">
										{inlineRowsError}
									</TableCell>
								</TableRow>
							{/if}
						{/if}
						{#each seoLinks as link, index}
						{#if editingRowId === link.id}
						<!-- ── Inline edit row ── -->
						<TableRow class="border-b border-border/30 bg-muted/30 hover:bg-muted/40">
							<TableCell class="pl-5 pr-2 py-2 align-middle">
								<Checkbox
									checked={selectedIds.has(link.id)}
									onCheckedChange={(v) => toggleSelect(link.id, v)}
									aria-label="Selectează"
								/>
							</TableCell>
							<TableCell class="text-muted-foreground tabular-nums text-[13px] px-3 py-2 align-middle">
								{index + 1}
							</TableCell>
							<TableCell class="px-3 py-2 align-middle">
								<Input bind:value={editRowPressTrust} placeholder="Trust presă" class="h-8 text-[13px] w-full min-w-[6rem]" />
							</TableCell>
							<TableCell class="px-3 py-2 align-middle">
								<Input bind:value={editRowKeyword} placeholder="Cuvânt cheie" class="h-8 text-[13px] w-full min-w-[7rem]" />
							</TableCell>
							<TableCell class="px-3 py-2 align-middle">
								<Input bind:value={editRowTargetUrl} placeholder="URL țintă" class="h-8 text-[13px] w-full min-w-[8rem]" />
							</TableCell>
							{#if filterClientIds.length === 1}
							<TableCell class="px-3 py-2 align-middle">
								{#if filterWebsites.length > 0}
									<Select type="single" value={editRowWebsiteId || ''} onValueChange={(v) => { editRowWebsiteId = v || null; }}>
										<SelectTrigger class="h-8 text-[13px] min-w-[7rem]">
											{#if editRowWebsiteId && filterWebsiteMap.has(editRowWebsiteId)}
												{@const selW = filterWebsites.find(w => w.id === editRowWebsiteId)}
												<span class="flex items-center gap-1.5 min-w-0">
													{#if selW}
														<img src={getFaviconUrl(selW.url)} alt="" class="h-4 w-4 shrink-0 rounded-sm object-contain" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />
													{/if}
													<span class="truncate">{filterWebsiteMap.get(editRowWebsiteId)}</span>
												</span>
											{:else}
												<span class="text-muted-foreground">Website</span>
											{/if}
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="">—</SelectItem>
											{#each filterWebsites as w}
												<SelectItem value={w.id}>
													<span class="flex items-center gap-2">
														<img src={getFaviconUrl(w.url)} alt="" class="h-4 w-4 shrink-0 rounded-sm object-contain" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')} />
														{w.name || w.url.replace(/^https?:\/\//, '').replace(/^www\./, '')}
													</span>
												</SelectItem>
											{/each}
										</SelectContent>
									</Select>
								{:else}
									<span class="text-muted-foreground/50 text-[13px]">—</span>
								{/if}
							</TableCell>
							{/if}
							<TableCell class="px-3 py-2 align-middle">
								<Input bind:value={editRowArticleUrl} placeholder="Link articol" class="h-8 text-[13px] w-full min-w-[10rem]" />
							</TableCell>
							<TableCell class="px-3 py-2 align-middle">
								<div class="flex flex-col gap-1">
									<Select type="single" bind:value={editRowStatus}>
										<SelectTrigger class="h-8 text-[13px] min-w-[6rem]">
											{getStatusLabel(editRowStatus)}
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="pending">În așteptare</SelectItem>
											<SelectItem value="submitted">Trimis</SelectItem>
											<SelectItem value="published">Publicat</SelectItem>
											<SelectItem value="rejected">Refuzat</SelectItem>
										</SelectContent>
									</Select>
									<Input
										type="date"
										class="h-7 text-[12px] px-2"
										value={editRowArticlePublishedAt ? editRowArticlePublishedAt.slice(0, 10) : ''}
										onchange={(e) => { editRowArticlePublishedAt = e.currentTarget.value || null; }}
									/>
								</div>
							</TableCell>
							<TableCell class="px-3 py-2 align-middle">
								<div class="flex flex-col gap-1">
									<Select type="single" bind:value={editRowLinkType}>
										<SelectTrigger class="h-8 text-[12px] min-w-[5rem]">
											{editRowLinkType ? getLinkTypeLabel(editRowLinkType) : 'Tip'}
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="article">Articol</SelectItem>
											<SelectItem value="guest-post">Guest post</SelectItem>
											<SelectItem value="press-release">Comunicat</SelectItem>
											<SelectItem value="directory">Director</SelectItem>
											<SelectItem value="other">Altul</SelectItem>
										</SelectContent>
									</Select>
									<Select type="single" bind:value={editRowLinkAttribute}>
										<SelectTrigger class="h-7 text-[11px] min-w-[5rem]">
											{editRowLinkAttribute}
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="dofollow">Dofollow</SelectItem>
											<SelectItem value="nofollow">Nofollow</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</TableCell>
							<TableCell class="px-3 py-2 align-middle">
								<Badge variant={getCheckStatusBadge(link).variant} class="text-[11px] h-5 rounded-full px-2 font-normal">
									{getCheckStatusBadge(link).label}
								</Badge>
							</TableCell>
							<TableCell class="px-3 py-2 align-middle text-muted-foreground text-[13px]">—</TableCell>
							<TableCell class="px-3 py-2 align-middle">
								<div class="flex items-center gap-1.5">
									<Input
										type="number"
										bind:value={editRowPrice}
										placeholder="0"
										step="0.01"
										class="h-8 w-16 text-[13px] px-2"
									/>
									<Select type="single" bind:value={editRowCurrency}>
										<SelectTrigger class="h-8 w-[4.5rem] text-[12px] px-2">
											{CURRENCY_LABELS[editRowCurrency]}
										</SelectTrigger>
										<SelectContent>
											{#each CURRENCIES as curr}
												<SelectItem value={curr}>{CURRENCY_LABELS[curr]}</SelectItem>
											{/each}
										</SelectContent>
									</Select>
								</div>
							</TableCell>
							<TableCell class="py-2 pr-5 align-middle">
								<div class="flex items-center gap-1">
									<Button size="sm" class="h-8" onclick={saveEditRow} disabled={editRowLoading}>
										{editRowLoading ? 'Se salvează...' : 'Salvează'}
									</Button>
									<Button size="sm" variant="ghost" class="h-8" onclick={cancelEditRow} disabled={editRowLoading}>
										Anulează
									</Button>
								</div>
							</TableCell>
						</TableRow>
						{#if editRowError}
							<TableRow class="bg-destructive/10">
								<TableCell colspan={13} class="px-5 py-2 text-sm text-destructive">
									{editRowError}
								</TableCell>
							</TableRow>
						{/if}
						{:else}
						<!-- ── Display row ── -->
						<TableRow class="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors duration-150" ondblclick={() => startEditRow(link)}>
								<TableCell class="pl-5 pr-2 py-3.5 align-middle">
									<Checkbox
										checked={selectedIds.has(link.id)}
										onCheckedChange={(v) => toggleSelect(link.id, v)}
										aria-label="Selectează"
									/>
								</TableCell>
								<TableCell class="text-muted-foreground tabular-nums text-[13px] px-3 py-3.5 align-middle">
									{index + 1}
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									<div class="flex items-center gap-2.5">
										{#if link.articleUrl}
											<img
												src={getFaviconUrl(link.articleUrl, 32)}
												alt={getPressTrustDisplay(link)}
												class="h-5 w-5 shrink-0 rounded-md object-contain bg-muted/40"
												loading="lazy"
												onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')}
											/>
										{/if}
										<span class="text-[13px] font-medium text-foreground/90">{getPressTrustDisplay(link)}</span>
									</div>
								</TableCell>
								<TableCell class="px-3 py-3.5 max-w-[180px] align-middle whitespace-normal">
									{@const elLinks = parseExtractedLinks(link)}
									{#if editingKeywordId === link.id}
										<div role="presentation" onclick={(e) => e.stopPropagation()}>
											<Input
												type="text"
												class="h-8 w-full text-[13px] px-2"
												bind:value={editingKeywordValue}
												placeholder="cuvânt cheie"
												autofocus
												onblur={(e) => handleSaveKeyword(link, e.currentTarget.value)}
												onkeydown={(e) => {
													if (e.key === 'Enter') {
														e.currentTarget.blur();
													} else if (e.key === 'Escape') {
														editingKeywordId = null;
														editingKeywordValue = '';
														e.currentTarget.blur();
													}
												}}
											/>
										</div>
									{:else if elLinks.length > 1}
										<div class="flex flex-col gap-1">
											{#each elLinks as el, i}
												<button
													type="button"
													class="text-left w-full min-w-[4rem] py-0.5 px-1.5 -mx-1.5 rounded hover:bg-muted/50 text-foreground/85 hover:text-foreground transition-colors text-[13px] leading-tight"
													onclick={() => {
														if (editingRowId === link.id) return;
														editingKeywordId = link.id;
														editingKeywordValue = el.keyword;
													}}
												>
													<span class="text-muted-foreground/60 text-[11px] mr-1">{i + 1}.</span>{el.keyword}
												</button>
											{/each}
										</div>
									{:else}
										<button
											type="button"
											class="text-left w-full min-w-[4rem] py-1 px-1.5 -mx-1.5 rounded hover:bg-muted/50 text-foreground/85 hover:text-foreground transition-colors text-[13px] line-clamp-2"
											onclick={() => {
												if (editingRowId === link.id) return;
												editingKeywordId = link.id;
												editingKeywordValue = link.keyword;
											}}
										>
											{link.keyword || '—'}
										</button>
									{/if}
								</TableCell>
								<TableCell class="px-3 py-3.5 max-w-[180px] align-middle">
									{@const elLinksTarget = parseExtractedLinks(link)}
									{#if elLinksTarget.length > 1}
										<div class="flex flex-col gap-1">
											{#each elLinksTarget as el, i}
												<div class="flex items-center gap-1">
													<span class="text-muted-foreground/60 text-[11px] shrink-0">{i + 1}.</span>
													<SeoLinkUrlCell url={el.url} maxChars={30} />
												</div>
											{/each}
										</div>
									{:else if link.targetUrl}
										<SeoLinkUrlCell url={link.targetUrl} maxChars={35} />
									{:else}
										<span class="text-muted-foreground/90 text-[13px]">—</span>
									{/if}
								</TableCell>
								{#if filterClientIds.length === 1}
								<TableCell class="px-3 py-3.5 align-middle">
									{#if link.websiteId && filterWebsiteMap.has(link.websiteId)}
										<span class="text-[13px] text-muted-foreground">{filterWebsiteMap.get(link.websiteId)}</span>
									{:else}
										<span class="text-muted-foreground/50 text-[13px]">—</span>
									{/if}
								</TableCell>
								{/if}
								<TableCell class="px-3 py-3.5 max-w-[200px] align-middle">
									<SeoLinkUrlCell url={link.articleUrl} maxChars={45} />
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									{@const pubDate = getPublicationDateDisplay(link)}
									<div class="flex items-center gap-1.5">
										<Badge variant={getStatusBadge(link.status)} class="text-[11px] h-5 rounded-full px-2 font-normal w-fit">
											{getStatusLabel(link.status)}
										</Badge>
										{#if pubDate}
											<Badge variant="secondary" class="text-[11px] h-5 rounded-full px-2 font-normal w-fit text-muted-foreground">
												{pubDate}
											</Badge>
										{/if}
									</div>
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									<div class="flex flex-col gap-0.5">
										{#if link.lastCheckDofollow}
											<Badge variant={link.lastCheckDofollow === 'dofollow' ? 'default' : 'secondary'} class="text-[11px] h-5 rounded-full px-2 w-fit font-normal">
												{link.lastCheckDofollow}
											</Badge>
										{:else}
											<span class="text-[12px] text-muted-foreground">Neverificat</span>
										{/if}
									</div>
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									<div class="flex items-center gap-1.5">
										<TooltipProvider>
											<Tooltip>
												<TooltipTrigger>
													<Badge variant={getCheckStatusBadge(link).variant} class="text-[11px] h-5 rounded-full px-2 font-normal">
														{getCheckStatusBadge(link).label}
													</Badge>
												</TooltipTrigger>
												<TooltipContent>
													<p>{getCheckTooltip(link)}</p>
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
										{#if link.lastCheckedAt}
											<Badge variant="secondary" class="text-[11px] h-5 rounded-full px-2 font-normal w-fit text-muted-foreground">
												{formatArticleDate(link.lastCheckedAt instanceof Date ? link.lastCheckedAt.toISOString() : String(link.lastCheckedAt))}
											</Badge>
										{/if}
									</div>
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									{#if link.articleType === 'gdrive' && link.gdriveUrl}
										<div class="flex items-center gap-1.5">
											<a href={link.gdriveUrl} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-primary hover:underline text-[13px]">
												<ExternalLinkIcon class="h-3.5 w-3.5" />
												Vezi articol
											</a>
											<button type="button" class="text-muted-foreground hover:text-foreground" onclick={() => openArticleModal(link)}>
												<EditIcon class="h-3 w-3" />
											</button>
										</div>
									{:else if link.articleType === 'press-article'}
										<div class="flex items-center gap-1.5">
											<Badge variant="outline" class="text-[11px] h-5 rounded-full px-2 font-normal bg-orange-50 text-orange-700 border-orange-200">Presă</Badge>
											{#if link.materialId}
												<button type="button" class="text-muted-foreground hover:text-foreground" title="Vezi document" onclick={() => downloadArticleMaterial(link.materialId)}>
													<EyeIcon class="h-3 w-3" />
												</button>
												<button type="button" class="text-muted-foreground hover:text-foreground" title="Descarcă document" onclick={() => downloadArticleMaterial(link.materialId)}>
													<DownloadIcon class="h-3 w-3" />
												</button>
											{/if}
											<button type="button" class="text-muted-foreground hover:text-foreground" onclick={() => openArticleModal(link)}>
												<EditIcon class="h-3 w-3" />
											</button>
										</div>
									{:else if link.articleType === 'seo-article'}
										<div class="flex items-center gap-1.5">
											<Badge variant="outline" class="text-[11px] h-5 rounded-full px-2 font-normal bg-blue-50 text-blue-700 border-blue-200">SEO</Badge>
											{#if link.materialId}
												<button type="button" class="text-muted-foreground hover:text-foreground" title="Vezi document" onclick={() => downloadArticleMaterial(link.materialId)}>
													<EyeIcon class="h-3 w-3" />
												</button>
												<button type="button" class="text-muted-foreground hover:text-foreground" title="Descarcă document" onclick={() => downloadArticleMaterial(link.materialId)}>
													<DownloadIcon class="h-3 w-3" />
												</button>
											{/if}
											<button type="button" class="text-muted-foreground hover:text-foreground" onclick={() => openArticleModal(link)}>
												<EditIcon class="h-3 w-3" />
											</button>
										</div>
									{:else}
										<Button variant="ghost" size="sm" class="h-7 text-[12px] text-muted-foreground" onclick={() => openArticleModal(link)}>
											<PlusIcon class="h-3.5 w-3.5 mr-1" />
											Adaugă
										</Button>
									{/if}
								</TableCell>
								<TableCell class="px-3 py-3.5 text-[13px] align-middle">
									{#if editingPriceId === link.id}
										<div class="flex items-center gap-1.5" role="presentation" onclick={(e) => e.stopPropagation()}>
											<Input
												type="number"
												inputmode="decimal"
												step="0.01"
												min="0"
												class="h-8 w-20 text-[13px] px-2"
												bind:value={editingPriceValue}
												placeholder="0"
												autofocus
												onblur={(e) => handleSavePrice(link, e.currentTarget.value)}
												onkeydown={(e) => {
													if (e.key === 'Enter') {
														e.currentTarget.blur();
													} else if (e.key === 'Escape') {
														editingPriceId = null;
														editingPriceValue = '';
														editingPriceCurrency = 'RON';
														e.currentTarget.blur();
													}
												}}
											/>
											<Select type="single" bind:value={editingPriceCurrency}>
												<SelectTrigger class="h-8 w-[5.5rem] text-[12px] px-2">
													{CURRENCY_LABELS[editingPriceCurrency]}
												</SelectTrigger>
												<SelectContent>
													{#each CURRENCIES as curr}
														<SelectItem value={curr}>{CURRENCY_LABELS[curr]}</SelectItem>
													{/each}
												</SelectContent>
											</Select>
										</div>
									{:else}
										<button
											type="button"
											class="text-left w-full min-w-[4rem] py-1 px-1.5 -mx-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
											onclick={() => {
												if (editingRowId === link.id) return;
												editingPriceId = link.id;
												editingPriceValue = link.price != null ? (link.price / 100).toFixed(2) : '';
												editingPriceCurrency = (link.currency || invoiceSettings?.defaultCurrency || 'RON') as Currency;
											}}
										>
											{link.price != null
												? formatAmount(link.price, (link.currency || 'RON') as Currency)
												: '—'}
										</button>
									{/if}
								</TableCell>
								<TableCell class="py-3.5 pr-5 align-middle">
									<DropdownMenu>
										<DropdownMenuTrigger>
											<Button variant="ghost" size="icon" class="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50">
												<MoreVerticalIcon class="h-4 w-4" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											{#if !link.targetUrl}
												<DropdownMenuItem
													onclick={() => handleExtractTargetUrl(link.id)}
													disabled={extractingTargetUrlId === link.id}
												>
													<SparklesIcon class="mr-2 h-4 w-4" />
													{extractingTargetUrlId === link.id ? 'Se extrage...' : 'Extrage URL țintă'}
												</DropdownMenuItem>
											{/if}
											<DropdownMenuItem
												onclick={() => handleCheckLink(link.id)}
												disabled={checkingId === link.id}
											>
												<Link2Icon class="mr-2 h-4 w-4" />
												{checkingId === link.id ? 'Se verifică...' : 'Verifică link'}
											</DropdownMenuItem>
											<DropdownMenuItem onclick={() => startEditRow(link)}>
												<EditIcon class="mr-2 h-4 w-4" />
												Editează inline
											</DropdownMenuItem>
											<DropdownMenuItem onclick={() => openEditDialog(link)}>
												<EditIcon class="mr-2 h-4 w-4" />
												Editare completă...
											</DropdownMenuItem>
											<DropdownMenuItem
												class="text-destructive"
												onclick={() => handleDelete(link.id)}
											>
												<TrashIcon class="mr-2 h-4 w-4" />
												Șterge
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</TableCell>
							</TableRow>
						{/if}
						{/each}
					</TableBody>
					<TableFooter>
						<TableRow class="border-t-2 border-border/60 bg-muted/30 hover:bg-muted/30 font-medium">
							<TableCell colspan={10} class="pl-5 pr-3 py-3.5 text-right text-[13px] text-muted-foreground">
								Total preț
							</TableCell>
							<TableCell class="px-3 py-3.5 text-[13px] font-semibold">
								{#if totalByCurrency.length > 0}
									{totalByCurrency.map(({ currency, cents }) => formatAmount(cents, currency as Currency)).join(' · ')}
								{:else}
									—
								{/if}
							</TableCell>
							<TableCell class="py-3.5 pr-5"></TableCell>
						</TableRow>
					</TableFooter>
				</Table>
			</div>
		</div>
	{/if}
</div>

<!-- ── Dialog Scanează Backlinks ───────────────────────────────────────────── -->
<Dialog bind:open={isScanDialogOpen}>
	<DialogContent class="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2">
				<ScanSearchIcon class="h-5 w-5" />
				Scanează Backlinks
			</DialogTitle>
			<DialogDescription>
				Verifică statusul backlink-urilor clienților: accesibilitate, cod HTTP și atribut dofollow/nofollow.
			</DialogDescription>
		</DialogHeader>

		<!-- Setup – înainte de pornire -->
		{#if !scanRunning && !scanDone}
			<div class="space-y-4 py-2">
				<!-- Client -->
				<div class="space-y-1.5">
					<Label>Client</Label>
					<Combobox
						bind:value={scanClientId}
						options={[{ value: '', label: 'Toți clienții' }, ...clientOptions]}
						placeholder="Selectați un client sau lăsați pentru toți"
						searchPlaceholder="Căutați clienți..."
					/>
				</div>

				<!-- Mod scanare -->
				<div class="space-y-1.5">
					<Label>Linkuri de verificat</Label>
					<Select type="single" bind:value={scanMode}>
						<SelectTrigger class="w-full">
							{#if scanMode === 'unchecked'}
								Niciodată verificate
							{:else if scanMode === 'problems'}
								Cu probleme (erori, timeout, inaccessibile)
							{:else}
								Toate linkurile
							{/if}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="unchecked">Niciodată verificate</SelectItem>
							<SelectItem value="problems">Cu probleme (erori, timeout, inaccessibile)</SelectItem>
							<SelectItem value="all">Toate linkurile</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<!-- Preview count -->
				{#if scanLinksQuery.loading}
					<p class="text-sm text-muted-foreground">Se încarcă lista...</p>
				{:else}
					<div class="rounded-md border bg-muted/40 px-4 py-3">
						<p class="text-sm font-medium">
							{#if scanLinks.length === 0}
								<span class="text-muted-foreground">Nu există linkuri cu filtrele selectate.</span>
							{:else}
								<span class="text-foreground">{scanLinks.length} linkuri</span>
								<span class="text-muted-foreground"> vor fi scanate</span>
								{#if scanLinks.length > 20}
									<span class="text-muted-foreground ml-1">
										(estimat ~{Math.ceil((scanLinks.length * 600) / 60000)} min)
									</span>
								{/if}
							{/if}
						</p>
					</div>
				{/if}
			</div>

			<DialogFooter>
				<Button variant="outline" onclick={() => (isScanDialogOpen = false)}>Anulare</Button>
				<Button
					onclick={handleStartScan}
					disabled={scanLinks.length === 0 || scanLinksQuery.loading}
				>
					<ScanSearchIcon class="mr-2 h-4 w-4" />
					Pornește Scanarea
				</Button>
			</DialogFooter>
		{/if}

		<!-- În desfășurare -->
		{#if scanRunning}
			<div class="space-y-4 py-2">
				<!-- Progress bar -->
				<div class="space-y-2">
					<div class="flex items-center justify-between text-sm">
						<span class="font-medium">Progres scanare</span>
						<span class="text-muted-foreground">{scanCurrent} / {scanTotal}</span>
					</div>
					<div class="h-2.5 w-full rounded-full bg-muted overflow-hidden">
						<div
							class="h-2.5 rounded-full bg-primary transition-all duration-300"
							style="width: {scanProgressPct}%"
						></div>
					</div>
					<p class="text-xs text-muted-foreground truncate" title={scanCurrentUrl}>
						Se verifică: {scanCurrentUrl || '...'}
					</p>
				</div>

				<!-- Rezultate live -->
				{#if scanResults.length > 0}
					<div class="max-h-60 overflow-y-auto rounded-md border">
						<table class="w-full text-sm">
							<thead class="sticky top-0 bg-muted/80 backdrop-blur">
								<tr>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">Keyword</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">URL Țintă</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">HTTP</th>
								</tr>
							</thead>
							<tbody class="divide-y">
								{#each [...scanResults].reverse() as result}
									<tr class="hover:bg-muted/30">
										<td class="px-3 py-2 truncate max-w-[140px]" title={result.keyword}>
											{result.keyword}
										</td>
										<td class="px-3 py-2 max-w-[160px]">
											{#if result.targetUrl}
												<a
													href={result.targetUrl}
													target="_blank"
													rel="noopener noreferrer"
													class="inline-flex items-center gap-1 text-blue-600 hover:underline truncate max-w-[150px] text-xs"
													title={result.targetUrl}
												>
													<ExternalLinkIcon class="h-3 w-3 shrink-0" />
													{result.targetUrl.replace(/^https?:\/\//, '').slice(0, 30)}{result.targetUrl.length > 37 ? '…' : ''}
												</a>
											{:else}
												<span class="text-muted-foreground text-xs">—</span>
											{/if}
										</td>
										<td class="px-3 py-2">
											{#if result.status === 'ok'}
												<span class="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
													<CircleCheckIcon class="h-3.5 w-3.5" />
													OK
												</span>
											{:else}
												<span class="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
													<CircleXIcon class="h-3.5 w-3.5" />
													{result.status}
												</span>
											{/if}
										</td>
										<td class="px-3 py-2 text-muted-foreground">
											{result.httpCode ?? '—'}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<DialogFooter>
				<Button variant="destructive" onclick={abortScan}>
					<StopCircleIcon class="mr-2 h-4 w-4" />
					Oprește Scanarea
				</Button>
			</DialogFooter>
		{/if}

		<!-- Rezultate finale -->
		{#if scanDone}
			<div class="space-y-4 py-2">
				<!-- Sumar -->
				<div class="grid grid-cols-3 gap-3">
					<div class="rounded-lg border bg-green-50 dark:bg-green-900/20 p-3 text-center">
						<p class="text-2xl font-bold text-green-700 dark:text-green-400">{scanOkCount}</p>
						<p class="text-xs text-green-600 dark:text-green-500 mt-0.5">Accesibile</p>
					</div>
					<div class="rounded-lg border bg-red-50 dark:bg-red-900/20 p-3 text-center">
						<p class="text-2xl font-bold text-red-700 dark:text-red-400">{scanProblemCount}</p>
						<p class="text-xs text-red-600 dark:text-red-500 mt-0.5">Cu probleme</p>
					</div>
					<div class="rounded-lg border bg-muted/40 p-3 text-center">
						<p class="text-2xl font-bold text-foreground">{scanResults.length}</p>
						<p class="text-xs text-muted-foreground mt-0.5">
							{scanAborted ? 'Scanate (oprit)' : 'Total scanate'}
						</p>
					</div>
				</div>

				<!-- Tabel rezultate detaliate -->
				{#if scanResults.length > 0}
					<div class="max-h-72 overflow-y-auto rounded-md border">
						<table class="w-full text-sm">
							<thead class="sticky top-0 bg-muted/80 backdrop-blur">
								<tr>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">Keyword</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">URL Articol</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">URL Țintă</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">HTTP</th>
								</tr>
							</thead>
							<tbody class="divide-y">
								{#each scanResults as result}
									<tr class="hover:bg-muted/30">
										<td class="px-3 py-2 max-w-[120px]" title={result.keyword}>
											<span class="block truncate">{result.keyword}</span>
											{#if !scanClientId}
												<span class="block text-xs text-muted-foreground truncate">{clientMap.get(result.clientId) ?? ''}</span>
											{/if}
										</td>
										<td class="px-3 py-2 max-w-[160px]">
											<a
												href={result.articleUrl}
												target="_blank"
												rel="noopener noreferrer"
												class="inline-flex items-center gap-1 text-blue-600 hover:underline truncate max-w-[150px] text-xs"
												title={result.articleUrl}
											>
												<ExternalLinkIcon class="h-3 w-3 shrink-0" />
												{result.articleUrl.replace(/^https?:\/\//, '').slice(0, 30)}{result.articleUrl.length > 37 ? '…' : ''}
											</a>
										</td>
										<td class="px-3 py-2 max-w-[160px]">
											{#if result.targetUrl}
												<a
													href={result.targetUrl}
													target="_blank"
													rel="noopener noreferrer"
													class="inline-flex items-center gap-1 text-blue-600 hover:underline truncate max-w-[150px] text-xs"
													title={result.targetUrl}
												>
													<ExternalLinkIcon class="h-3 w-3 shrink-0" />
													{result.targetUrl.replace(/^https?:\/\//, '').slice(0, 30)}{result.targetUrl.length > 37 ? '…' : ''}
												</a>
											{:else}
												<span class="text-muted-foreground text-xs">—</span>
											{/if}
										</td>
										<td class="px-3 py-2">
											{#if result.status === 'ok'}
												<Badge variant="outline" class="border-green-300 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 gap-1">
													<CircleCheckIcon class="h-3 w-3" />
													OK
												</Badge>
											{:else if result.status === 'timeout'}
												<Badge variant="outline" class="border-yellow-300 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 gap-1">
													<CircleXIcon class="h-3 w-3" />
													Timeout
												</Badge>
											{:else if result.status === 'unreachable'}
												<Badge variant="outline" class="border-red-300 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 gap-1">
													<CircleXIcon class="h-3 w-3" />
													Inaccesibil
												</Badge>
											{:else}
												<Badge variant="outline" class="border-red-300 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 gap-1">
													<CircleXIcon class="h-3 w-3" />
													{result.status}
												</Badge>
											{/if}
										</td>
										<td class="px-3 py-2 text-muted-foreground tabular-nums">
											{result.httpCode ?? '—'}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<DialogFooter class="gap-2">
				<Button variant="outline" onclick={() => (isScanDialogOpen = false)}>Închide</Button>
				<Button
					onclick={() => {
						scanDone = false;
						scanResults = [];
						scanCurrent = 0;
						scanTotal = 0;
					}}
				>
					<ScanSearchIcon class="mr-2 h-4 w-4" />
					Scanează din nou
				</Button>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>

<!-- ── Article Modal ── -->
<Dialog bind:open={articleModalOpen}>
	<DialogContent class="max-w-md max-h-[85vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>Articol</DialogTitle>
			<DialogDescription>
				{#if articleModalInlineRowId}
					{@const inlineRow = inlineRows.find(r => r.id === articleModalInlineRowId)}
					{inlineRow?.keyword || 'Rând nou'}
					{inlineRow?.pressTrust ? ` — ${inlineRow.pressTrust}` : ''}
				{:else}
					{articleModalLink?.keyword || ''}
					{articleModalLink?.pressTrust ? ` — ${articleModalLink.pressTrust}` : ''}
				{/if}
			</DialogDescription>
		</DialogHeader>

		<div class="space-y-4 py-2">
			<!-- Option 1: GDrive -->
			<button
				type="button"
				class="w-full text-left p-3 rounded-lg border transition-colors {articleModalOption === 'gdrive' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}"
				onclick={() => { articleModalOption = 'gdrive'; articleModalFile = null; }}
			>
				<div class="flex items-center gap-2 font-medium text-sm">
					<ExternalLinkIcon class="h-4 w-4" />
					Link GDrive
				</div>
				<p class="text-xs text-muted-foreground mt-1">Adaugă un link către articol pe Google Drive</p>
			</button>
			{#if articleModalOption === 'gdrive'}
				<div class="pl-3">
					<Input
						bind:value={articleModalGdriveUrl}
						placeholder="https://drive.google.com/..."
						class="h-9"
					/>
				</div>
			{/if}

			<!-- Option 2: Articol Presă -->
			<button
				type="button"
				class="w-full text-left p-3 rounded-lg border transition-colors {articleModalOption === 'press-article' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}"
				onclick={() => { articleModalOption = 'press-article'; articleModalGdriveUrl = ''; }}
			>
				<div class="flex items-center gap-2 font-medium text-sm">
					<NewspaperIcon class="h-4 w-4" />
					Articol Presă
				</div>
				<p class="text-xs text-muted-foreground mt-1">Upload fișier → apare în Marketing &gt; Articole Presă</p>
			</button>
			{#if articleModalOption === 'press-article'}
				<div class="pl-3">
					<input
						bind:this={articleModalFileInput}
						type="file"
						accept=".pdf,.doc,.docx"
						class="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
						onchange={(e) => { articleModalFile = (e.currentTarget as HTMLInputElement).files?.[0] || null; }}
					/>
					{#if articleModalFile}
						<p class="text-xs text-muted-foreground mt-1">{articleModalFile.name} ({(articleModalFile.size / 1024).toFixed(0)} KB)</p>
					{/if}
				</div>
			{/if}

			<!-- Option 3: Articol SEO -->
			<button
				type="button"
				class="w-full text-left p-3 rounded-lg border transition-colors {articleModalOption === 'seo-article' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}"
				onclick={() => { articleModalOption = 'seo-article'; articleModalGdriveUrl = ''; }}
			>
				<div class="flex items-center gap-2 font-medium text-sm">
					<SearchIcon class="h-4 w-4" />
					Articol SEO
				</div>
				<p class="text-xs text-muted-foreground mt-1">Upload fișier → apare în Marketing &gt; Articole SEO</p>
			</button>
			{#if articleModalOption === 'seo-article'}
				<div class="pl-3">
					<input
						type="file"
						accept=".pdf,.doc,.docx"
						class="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
						onchange={(e) => { articleModalFile = (e.currentTarget as HTMLInputElement).files?.[0] || null; }}
					/>
					{#if articleModalFile}
						<p class="text-xs text-muted-foreground mt-1">{articleModalFile.name} ({(articleModalFile.size / 1024).toFixed(0)} KB)</p>
					{/if}
				</div>
			{/if}
		</div>

		<DialogFooter class="flex items-center justify-between sm:justify-between">
			{#if articleModalInlineRowId && articleModalOption}
				<Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" onclick={() => {
					const row = inlineRows.find(r => r.id === articleModalInlineRowId);
					if (row) { row.articleType = ''; row.gdriveUrl = ''; row.articleFile = null; }
					articleModalOpen = false;
				}}>
					Golește
				</Button>
			{:else if articleModalLink?.articleType}
				<Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" onclick={clearArticleType} disabled={articleModalLoading}>
					Golește
				</Button>
			{:else}
				<div></div>
			{/if}
			<div class="flex gap-2">
				<Button variant="outline" onclick={() => { articleModalInlineRowId = null; articleModalOpen = false; }}>Anulează</Button>
				<Button onclick={saveArticleModal} disabled={articleModalLoading || !articleModalOption}>
					{articleModalLoading ? 'Se salvează...' : 'Salvează'}
				</Button>
			</div>
		</DialogFooter>
	</DialogContent>
</Dialog>
