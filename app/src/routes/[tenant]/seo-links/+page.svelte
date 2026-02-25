<script lang="ts">
	import {
		getSeoLinks,
		createSeoLink,
		updateSeoLink,
		deleteSeoLink,
		importSeoLinksFromFile,
		checkSeoLink,
		checkSeoLinksBatch,
		extractSeoLinkData,
		extractTargetUrlForSeoLink,
		extractTargetUrlBatch
	} from '$lib/remotes/seo-links.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { formatAmount, CURRENCIES, CURRENCY_LABELS, type Currency } from '$lib/utils/currency';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
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
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import SeoLinkUrlCell from '$lib/components/seo-link-url-cell.svelte';

	const tenantSlug = $derived(page.params.tenant);

	// Filters
	let filterClientId = $state('');
	let filterMonth = $state('');
	let filterStatus = $state('');
	let filterCheckStatus = $state('');

	const filterParams = $derived({
		clientId: filterClientId || undefined,
		month: filterMonth || undefined,
		status: filterStatus || undefined,
		checkStatus: filterCheckStatus || undefined
	});

	const seoLinksQuery = $derived(getSeoLinks(filterParams));
	const seoLinks = $derived(seoLinksQuery.current || []);
	const loading = $derived(seoLinksQuery.loading);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const clientMap = $derived(new Map(clients.map((c) => [c.id, c.name])));
	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));
	const clientById = $derived(new Map(clients.map((c) => [c.id, c])));

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	// Add/Edit dialog state
	let isDialogOpen = $state(false);
	let isEditing = $state(false);
	let editingId = $state<string | null>(null);
	let formClientId = $state('');
	let formPressTrust = $state('');
	let formMonth = $state(new Date().toISOString().slice(0, 7)); // YYYY-MM
	let formKeyword = $state('');
	let formLinkType = $state('');
	let formLinkAttribute = $state('dofollow');
	let formStatus = $state('pending');
	let formArticleUrl = $state('');
	let formTargetUrl = $state('');
	let formPrice = $state('');
	let formCurrency = $state<Currency>((invoiceSettings?.defaultCurrency || 'RON') as Currency);
	let formAnchorText = $state('');
	let formProjectId = $state('');
	let formNotes = $state('');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	// Import state
	let isImportDialogOpen = $state(false);
	let importFile = $state<File | null>(null);
	let importClientId = $state('');
	let importLoading = $state(false);
	let importError = $state<string | null>(null);
	let importResult = $state<{
		imported: number;
		skipped: number;
		columnsFound?: string[];
	} | null>(null);

	// Link check state
	let checkingId = $state<string | null>(null);

	// Verify batch state (extract + check combined)
	let verifyingBatch = $state(false);

	// Selection state
	let selectedIds = $state<Set<string>>(new Set());

	// Inline price editing
	let editingPriceId = $state<string | null>(null);
	let editingPriceValue = $state('');
	let editingPriceCurrency = $state<Currency>('RON');

	// Extract state
	let extractLoading = $state(false);
	let extractError = $state<string | null>(null);
	let showAdvanced = $state(false);
	let extractingTargetUrlId = $state<string | null>(null);

	// Inline row state
	let isAddingInlineRow = $state(false);
	let rowPressTrust = $state('');
	let rowKeyword = $state('');
	let rowTargetUrl = $state('');
	let rowArticleUrl = $state('');
	let rowStatus = $state('pending');
	let rowLinkType = $state('');
	let rowLinkAttribute = $state('dofollow');
	let rowPrice = $state('');
	let rowCurrency = $state<Currency>((invoiceSettings?.defaultCurrency || 'RON') as Currency);
	let rowAnchorText = $state('');
	let rowNotes = $state('');
	let rowLoading = $state(false);
	let rowError = $state<string | null>(null);

	const projectsQuery = $derived(getProjects(formClientId || undefined));
	const projects = $derived(projectsQuery.current || []);
	const projectOptions = $derived([
		{ value: '', label: 'Niciunul' },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);

	$effect(() => {
		if (invoiceSettings?.defaultCurrency && !isEditing) {
			formCurrency = invoiceSettings.defaultCurrency as Currency;
		}
	});

	$effect(() => {
		if (invoiceSettings?.defaultCurrency && isAddingInlineRow) {
			rowCurrency = invoiceSettings.defaultCurrency as Currency;
		}
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

	$effect(() => {
		if (isAddingInlineRow && filterClientId && !rowTargetUrl) {
			const c = clientById.get(filterClientId);
			if (c?.website) {
				rowTargetUrl = c.website;
			}
		}
	});

	function resetInlineRow() {
		rowPressTrust = '';
		rowKeyword = '';
		rowTargetUrl = '';
		rowArticleUrl = '';
		rowStatus = 'pending';
		rowLinkType = '';
		rowLinkAttribute = 'dofollow';
		rowPrice = '';
		rowCurrency = (invoiceSettings?.defaultCurrency || 'RON') as Currency;
		rowAnchorText = '';
		rowNotes = '';
		rowError = null;
	}

	function openInlineRow() {
		resetInlineRow();
		isAddingInlineRow = true;
	}

	function cancelInlineRow() {
		isAddingInlineRow = false;
		resetInlineRow();
	}

	async function saveInlineRow() {
		if (!filterClientId || !rowKeyword || !rowArticleUrl) {
			rowError = 'Selectați clientul în filtre, apoi completați cuvântul cheie și linkul articol';
			return;
		}

		rowLoading = true;
		rowError = null;

		const monthToUse = filterMonth || new Date().toISOString().slice(0, 7);

		try {
			await createSeoLink({
				clientId: filterClientId,
				pressTrust: rowPressTrust || undefined,
				month: monthToUse,
				keyword: rowKeyword,
				linkType: parseLinkType(rowLinkType),
				linkAttribute: rowLinkAttribute as 'dofollow' | 'nofollow',
				status: rowStatus as 'pending' | 'submitted' | 'published' | 'rejected',
				articleUrl: rowArticleUrl,
				targetUrl: rowTargetUrl ? normalizeTargetUrl(rowTargetUrl) : undefined,
				price: rowPrice ? parseFloat(rowPrice) : undefined,
				currency: rowCurrency,
				anchorText: rowAnchorText || undefined,
				projectId: undefined,
				notes: rowNotes || undefined
			}).updates(seoLinksQuery);
			toast.success('Link adăugat');
			cancelInlineRow();
		} catch (e) {
			rowError = e instanceof Error ? e.message : 'A apărut o eroare';
		} finally {
			rowLoading = false;
		}
	}

	function resetForm() {
		isEditing = false;
		editingId = null;
		formClientId = '';
		formPressTrust = '';
		formMonth = new Date().toISOString().slice(0, 7);
		formKeyword = '';
		formLinkType = '';
		formLinkAttribute = 'dofollow';
		formStatus = 'pending';
		formArticleUrl = '';
		formTargetUrl = '';
		formPrice = '';
		formCurrency = (invoiceSettings?.defaultCurrency || 'RON') as Currency;
		formAnchorText = '';
		formProjectId = '';
		formNotes = '';
		formError = null;
		extractError = null;
		showAdvanced = false;
	}

	function openAddDialog() {
		resetForm();
		isDialogOpen = true;
	}

	function openEditDialog(link: (typeof seoLinks)[0]) {
		isEditing = true;
		editingId = link.id;
		formClientId = link.clientId;
		formPressTrust = link.pressTrust || '';
		formMonth = link.month;
		formKeyword = link.keyword;
		formLinkType = link.linkType || '';
		formLinkAttribute = link.linkAttribute || 'dofollow';
		formStatus = link.status || 'pending';
		formArticleUrl = link.articleUrl;
		formTargetUrl = link.targetUrl || '';
		formPrice = link.price != null ? String(link.price / 100) : '';
		formCurrency = (link.currency || 'RON') as Currency;
		formAnchorText = link.anchorText || '';
		formProjectId = link.projectId || '';
		formNotes = link.notes || '';
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

	async function handleSubmit() {
		if (!formClientId || !formMonth || !formKeyword || !formArticleUrl) {
			formError = 'Client, luna, cuvântul cheie și linkul articol sunt obligatorii';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			if (isEditing && editingId) {
				await updateSeoLink({
					seoLinkId: editingId,
					clientId: formClientId,
					pressTrust: formPressTrust || undefined,
					month: formMonth,
					keyword: formKeyword,
					linkType: parseLinkType(formLinkType),
					linkAttribute: formLinkAttribute as 'dofollow' | 'nofollow',
					status: formStatus as 'pending' | 'submitted' | 'published' | 'rejected',
					articleUrl: formArticleUrl,
					targetUrl: formTargetUrl ? normalizeTargetUrl(formTargetUrl) : undefined,
					price: formPrice ? parseFloat(formPrice) : undefined,
					currency: formCurrency,
					anchorText: formAnchorText || undefined,
					projectId: formProjectId || undefined,
					notes: formNotes || undefined
				}).updates(seoLinksQuery);
			} else {
				await createSeoLink({
					clientId: formClientId,
					pressTrust: formPressTrust || undefined,
					month: formMonth,
					keyword: formKeyword,
					linkType: parseLinkType(formLinkType),
					linkAttribute: formLinkAttribute as 'dofollow' | 'nofollow',
					status: formStatus as 'pending' | 'submitted' | 'published' | 'rejected',
					articleUrl: formArticleUrl,
					targetUrl: formTargetUrl ? normalizeTargetUrl(formTargetUrl) : undefined,
					price: formPrice ? parseFloat(formPrice) : undefined,
					currency: formCurrency,
					anchorText: formAnchorText || undefined,
					projectId: formProjectId || undefined,
					notes: formNotes || undefined
				}).updates(seoLinksQuery);
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
			alert(e instanceof Error ? e.message : 'Nu s-a putut șterge linkul');
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
			alert(e instanceof Error ? e.message : 'Verificare eșuată');
		} finally {
			checkingId = null;
		}
	}

	async function handleVerifyAll() {
		if (someSelected && selectedIdsArray.length === 0) {
			alert('Selectați cel puțin un link');
			return;
		}
		if (!someSelected && seoLinks.length === 0) {
			return;
		}
		verifyingBatch = true;
		try {
			const extractResult = await extractTargetUrlBatch({
				clientId: filterClientId || undefined,
				month: filterMonth || undefined,
				seoLinkIds: someSelected ? selectedIdsArray : undefined
			}).updates(seoLinksQuery);
			if (extractResult.extracted > 0) {
				toast.success(
					extractResult.failed > 0
						? `Extragere: ${extractResult.extracted} reușite, ${extractResult.failed} eșuate`
						: `Extragere reușită: ${extractResult.extracted} URL-uri țintă`
				);
			}
			if (extractResult.failed > 0 && extractResult.errors?.length) {
				const msg = extractResult.errors.slice(0, 3).map((e) => e.error).join('; ');
				toast.error(msg + (extractResult.errors.length > 3 ? '...' : ''));
			}
			await checkSeoLinksBatch({
				clientId: filterClientId || undefined,
				month: filterMonth || undefined,
				seoLinkIds: someSelected ? selectedIdsArray : undefined
			}).updates(seoLinksQuery);
			toast.success('Verificare finalizată');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Verificare eșuată');
		} finally {
			verifyingBatch = false;
		}
	}

	async function handleExtractTargetUrl(seoLinkId: string) {
		extractingTargetUrlId = seoLinkId;
		try {
			await extractTargetUrlForSeoLink(seoLinkId).updates(seoLinksQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Extragere URL țintă eșuată');
		} finally {
			extractingTargetUrlId = null;
		}
	}

	async function handleSavePrice(link: (typeof seoLinks)[0], value: string, currency?: Currency) {
		editingPriceId = null;
		editingPriceValue = '';
		const num = value.trim() ? parseFloat(value.replace(',', '.')) : undefined;
		if (num !== undefined && (Number.isNaN(num) || num < 0)) return;
		const curr = currency ?? editingPriceCurrency;
		try {
			await updateSeoLink({
				seoLinkId: link.id,
				price: num,
				currency: curr
			}).updates(seoLinksQuery);
			if (num !== undefined) toast.success('Preț actualizat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		}
	}

	async function handleExtract() {
		if (!formArticleUrl || !formTargetUrl) {
			extractError = 'Completează URL articol și URL client pentru extragere';
			return;
		}
		extractLoading = true;
		extractError = null;
		try {
			const result = await extractSeoLinkData({
				articleUrl: formArticleUrl,
				clientUrl: formTargetUrl
			});
			formKeyword = result.keyword || formKeyword;
			formPressTrust = result.pressTrust || formPressTrust;
			formAnchorText = result.anchorText || formAnchorText;
			formLinkType = result.linkType || formLinkType;
			if (result.targetUrl) formTargetUrl = result.targetUrl;
			showAdvanced = true;
		} catch (e) {
			extractError = e instanceof Error ? e.message : 'Extragere eșuată';
		} finally {
			extractLoading = false;
		}
	}

	const stats = $derived({
		total: seoLinks.length,
		published: seoLinks.filter((l) => l.status === 'published').length,
		withProblems: seoLinks.filter((l) =>
			['unreachable', 'timeout', 'error'].includes(l.lastCheckStatus || '')
		).length,
		neverChecked: seoLinks.filter((l) => !l.lastCheckedAt).length
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

	function getFaviconUrl(articleUrl: string): string {
		try {
			const host = new URL(articleUrl).hostname.replace(/^www\./, '');
			return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
		} catch {
			return '';
		}
	}
</script>

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
				onclick={handleVerifyAll}
				disabled={verifyingBatch || (someSelected ? selectedIdsArray.length === 0 : seoLinks.length === 0)}
			>
				{#if verifyingBatch}
					Se verifică...
				{:else}
					<Link2Icon class="mr-2 h-4 w-4" />
					{someSelected ? `Verifică linkuri (${selectedIdsArray.length})` : 'Verifică toate linkurile'}
				{/if}
			</Button>
			<Dialog bind:open={isImportDialogOpen}>
				<DialogTrigger>
					<Button variant="outline">
						<UploadIcon class="mr-2 h-4 w-4" />
						Import Excel / CSV
					</Button>
				</DialogTrigger>
				<DialogContent class="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Import linkuri SEO</DialogTitle>
						<DialogDescription>
							Încărcați un fișier Excel (.xlsx, .xls) sau CSV. Coloanele: Luna, TRUST, PENTRU (client), CUVANT CHEIE, LINK (URL țintă), Tip, STATUS, LINK ARTICOL (unde e plasat backlinkul).
						</DialogDescription>
					</DialogHeader>
					<div class="space-y-4 py-4">
						<div class="space-y-2">
							<Label>Client *</Label>
							<Combobox
								bind:value={importClientId}
								options={clientOptions}
								placeholder="Selectați clientul pentru toate linkurile"
								searchPlaceholder="Căutați clienți..."
							/>
							<p class="text-xs text-muted-foreground">
								Toate linkurile vor fi asociate acestui client. Coloana PENTRU din fișier este ignorată.
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
										? `Import reușit: ${importResult.imported} adăugate, ${importResult.skipped} omise.`
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
						<Button onclick={handleImport} disabled={importLoading || !importFile || !importClientId}>
							{importLoading ? 'Se importă...' : 'Importă'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Button variant="outline" onclick={openInlineRow} disabled={isAddingInlineRow || loading || !filterClientId}>
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
						<Combobox
							bind:value={formClientId}
							options={clientOptions}
							placeholder="Selectați clientul"
							searchPlaceholder="Căutați clienți..."
						/>
					</div>
					<div class="grid gap-2">
						<Label for="articleUrl">URL articol *</Label>
						<Input
							id="articleUrl"
							bind:value={formArticleUrl}
							placeholder="https://www.bzi.ro/articol-..."
							type="url"
						/>
						<p class="text-xs text-muted-foreground">
							Linkul unde este plasat backlinkul (ex: bzi.ro, libertatea.ro)
						</p>
					</div>
					<div class="grid gap-2">
						<Label for="targetUrl">URL client *</Label>
						<Input
							id="targetUrl"
							bind:value={formTargetUrl}
							placeholder="glemis.ro sau https://www.glemis.ro/..."
							type="text"
						/>
						<p class="text-xs text-muted-foreground">
							Domeniul sau pagina clientului unde pointează linkul
						</p>
					</div>

					{#if !isEditing}
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
					{/if}

					<!-- Detalii suplimentare -->
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
						{formLoading ? 'Se salvează...' : isEditing ? 'Salvează' : 'Adaugă'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
		</div>
	</div>

	<!-- Stats -->
	{#if !loading && seoLinks.length > 0}
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
	{/if}

	<!-- Filters -->
	<div class="flex flex-wrap items-center gap-4">
		<div class="min-w-[200px]">
			<Label class="text-xs text-muted-foreground">Client</Label>
			<Select
				value={filterClientId || 'all'}
				type="single"
				onValueChange={(v: string | undefined) => {
					filterClientId = v === 'all' ? '' : v || '';
				}}
			>
				<SelectTrigger>
					{#if filterClientId}
						{clientMap.get(filterClientId) || 'Toți clienții'}
					{:else}
						Toți clienții
					{/if}
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">Toți clienții</SelectItem>
					{#each clients as c}
						<SelectItem value={c.id}>{c.name}</SelectItem>
					{/each}
				</SelectContent>
			</Select>
		</div>
		<div>
			<Label class="text-xs text-muted-foreground">Lună</Label>
			<Input
				type="month"
				bind:value={filterMonth}
				placeholder="Toate lunile"
				class="max-w-[180px]"
			/>
		</div>
		<div class="min-w-[160px]">
			<Label class="text-xs text-muted-foreground">Status</Label>
			<Select
				value={filterStatus || 'all'}
				type="single"
				onValueChange={(v: string | undefined) => {
					filterStatus = v === 'all' ? '' : v || '';
				}}
			>
				<SelectTrigger>
					{#if filterStatus}
						{getStatusLabel(filterStatus)}
					{:else}
						Toate
					{/if}
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
		<div class="min-w-[160px]">
			<Label class="text-xs text-muted-foreground">Verificare</Label>
			<Select
				value={filterCheckStatus || 'all'}
				type="single"
				onValueChange={(v: string | undefined) => {
					filterCheckStatus = v === 'all' ? '' : v || '';
				}}
			>
				<SelectTrigger>
					{#if filterCheckStatus === 'problem'}
						Cu probleme
					{:else if filterCheckStatus === 'never'}
						Neverificate
					{:else if filterCheckStatus === 'ok'}
						OK
					{:else}
						Toate
					{/if}
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">Toate</SelectItem>
					<SelectItem value="ok">OK</SelectItem>
					<SelectItem value="problem">Cu probleme</SelectItem>
					<SelectItem value="never">Neverificate</SelectItem>
				</SelectContent>
			</Select>
		</div>
	</div>

	{#if loading}
		<p class="text-muted-foreground">Se încarcă...</p>
	{:else if seoLinks.length === 0 && !isAddingInlineRow}
		<Card>
			<div class="p-6 text-center">
				<p class="text-muted-foreground">
					Nu există linkuri SEO. Adăugați primul link pentru un client.
				</p>
			</div>
		</Card>
	{:else}
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
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<NewspaperIcon class="h-3.5 w-3.5 shrink-0" />
									Trust presă
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<KeyIcon class="h-3.5 w-3.5 shrink-0" />
									Cuvânt cheie
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<TargetIcon class="h-3.5 w-3.5 shrink-0" />
									URL țintă
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<FileTextIcon class="h-3.5 w-3.5 shrink-0" />
									Link articol
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<CircleDotIcon class="h-3.5 w-3.5 shrink-0" />
									Status
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<TagIcon class="h-3.5 w-3.5 shrink-0" />
									Tip
								</span>
							</TableHead>
							<TableHead class="h-12 text-xs font-medium uppercase tracking-wider text-muted-foreground/90 px-3">
								<span class="inline-flex items-center gap-1.5">
									<CheckCircle2Icon class="h-3.5 w-3.5 shrink-0" />
									Check
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
						{#if isAddingInlineRow}
							<TableRow class="border-b border-border/30 bg-muted/30 hover:bg-muted/40">
								<TableCell class="pl-5 pr-2 py-2 align-middle"></TableCell>
								<TableCell class="text-muted-foreground text-[13px] px-3 py-2 align-middle">—</TableCell>
								<TableCell class="px-3 py-2 align-middle">
									<Input bind:value={rowPressTrust} placeholder="Trust presă" class="h-8 text-[13px] w-full min-w-[6rem]" />
								</TableCell>
								<TableCell class="px-3 py-2 align-middle">
									<Input bind:value={rowKeyword} placeholder="Cuvânt cheie" class="h-8 text-[13px] w-full min-w-[7rem]" />
								</TableCell>
								<TableCell class="px-3 py-2 align-middle">
									<Input bind:value={rowTargetUrl} placeholder="URL țintă" class="h-8 text-[13px] w-full min-w-[8rem]" />
								</TableCell>
								<TableCell class="px-3 py-2 align-middle">
									<Input bind:value={rowArticleUrl} placeholder="Link articol" class="h-8 text-[13px] w-full min-w-[10rem]" />
								</TableCell>
								<TableCell class="px-3 py-2 align-middle">
									<Select type="single" bind:value={rowStatus}>
										<SelectTrigger class="h-8 text-[13px] min-w-[6rem]">
											{getStatusLabel(rowStatus)}
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
										<Select type="single" bind:value={rowLinkType}>
											<SelectTrigger class="h-8 text-[12px] min-w-[5rem]">
												{rowLinkType ? getLinkTypeLabel(rowLinkType) : 'Tip'}
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="article">Articol</SelectItem>
												<SelectItem value="guest-post">Guest post</SelectItem>
												<SelectItem value="press-release">Comunicat</SelectItem>
												<SelectItem value="directory">Director</SelectItem>
												<SelectItem value="other">Altul</SelectItem>
											</SelectContent>
										</Select>
										<Select type="single" bind:value={rowLinkAttribute}>
											<SelectTrigger class="h-7 text-[11px] min-w-[5rem]">
												{rowLinkAttribute}
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
									<div class="flex items-center gap-1.5">
										<Input
											type="number"
											bind:value={rowPrice}
											placeholder="0"
											step="0.01"
											class="h-8 w-16 text-[13px] px-2"
										/>
										<Select type="single" bind:value={rowCurrency}>
											<SelectTrigger class="h-8 w-[4.5rem] text-[12px] px-2">
												{CURRENCY_LABELS[rowCurrency]}
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
										<Button size="sm" class="h-8" onclick={saveInlineRow} disabled={rowLoading}>
											{rowLoading ? 'Se salvează...' : 'Salvează'}
										</Button>
										<Button size="sm" variant="ghost" class="h-8" onclick={cancelInlineRow} disabled={rowLoading}>
											Anulează
										</Button>
									</div>
								</TableCell>
							</TableRow>
							{#if rowError}
								<TableRow class="bg-destructive/10">
									<TableCell colspan={11} class="px-5 py-2 text-sm text-destructive">
										{rowError}
									</TableCell>
								</TableRow>
							{/if}
						{/if}
						{#each seoLinks as link, index}
						<TableRow class="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors duration-150">
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
												src={getFaviconUrl(link.articleUrl)}
												alt={link.pressTrust || 'Logo'}
												class="h-5 w-5 shrink-0 rounded-md object-contain bg-muted/40"
												loading="lazy"
												onerror={(e) => (e.currentTarget.style.display = 'none')}
											/>
										{/if}
										<span class="text-[13px] font-medium text-foreground/90">{link.pressTrust || '—'}</span>
									</div>
								</TableCell>
								<TableCell class="px-3 py-3.5 max-w-[180px] align-middle whitespace-normal">
									<span class="text-[13px] text-foreground/85 line-clamp-2">{link.keyword}</span>
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									<div class="flex flex-col gap-0.5">
										{#if link.linkType}
											<span class="text-[11px] text-muted-foreground uppercase tracking-wide">{getLinkTypeLabel(link.linkType)}</span>
										{/if}
										<Badge variant={link.linkAttribute === 'dofollow' ? 'default' : 'secondary'} class="text-[11px] h-5 rounded-full px-2 w-fit font-normal">
											{link.linkAttribute}
										</Badge>
									</div>
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
									<Badge variant={getStatusBadge(link.status)} class="text-[11px] h-5 rounded-full px-2 font-normal">
										{getStatusLabel(link.status)}
									</Badge>
								</TableCell>
								<TableCell class="px-3 py-3.5 align-middle">
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
								</TableCell>
								<TableCell class="px-3 py-3.5 max-w-[200px] align-middle">
									<SeoLinkUrlCell url={link.articleUrl} maxChars={45} />
								</TableCell>
								<TableCell class="px-3 py-3.5 max-w-[180px] align-middle">
									{#if link.targetUrl}
										<SeoLinkUrlCell url={link.targetUrl} maxChars={35} />
									{:else}
										<span class="text-muted-foreground/90 text-[13px]">—</span>
									{/if}
								</TableCell>
								<TableCell class="px-3 py-3.5 text-[13px] align-middle">
									{#if editingPriceId === link.id}
										<div class="flex items-center gap-1.5" onclick={(e) => e.stopPropagation()}>
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
											<DropdownMenuItem onclick={() => openEditDialog(link)}>
												<EditIcon class="mr-2 h-4 w-4" />
												Editează
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
						{/each}
					</TableBody>
				</Table>
			</div>
		</div>
	{/if}
</div>
