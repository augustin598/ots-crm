<script lang="ts">
	import {
		getSeoLinks,
		createSeoLink,
		updateSeoLink,
		deleteSeoLink
	} from '$lib/remotes/seo-links.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { formatAmount, CURRENCIES, type Currency } from '$lib/utils/currency';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
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
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import EditIcon from '@lucide/svelte/icons/edit';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	const tenantSlug = $derived(page.params.tenant);

	// Filters
	let filterClientId = $state('');
	let filterMonth = $state('');
	let filterStatus = $state('');

	const filterParams = $derived({
		clientId: filterClientId || undefined,
		month: filterMonth || undefined,
		status: filterStatus || undefined
	});

	const seoLinksQuery = $derived(getSeoLinks(filterParams));
	const seoLinks = $derived(seoLinksQuery.current || []);
	const loading = $derived(seoLinksQuery.loading);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const clientMap = $derived(new Map(clients.map((c) => [c.id, c.name])));
	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));

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
	let formPrice = $state('');
	let formCurrency = $state<Currency>((invoiceSettings?.defaultCurrency || 'RON') as Currency);
	let formAnchorText = $state('');
	let formProjectId = $state('');
	let formNotes = $state('');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

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
		formPrice = '';
		formCurrency = (invoiceSettings?.defaultCurrency || 'RON') as Currency;
		formAnchorText = '';
		formProjectId = '';
		formNotes = '';
		formError = null;
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
		formPrice = link.price != null ? String(link.price / 100) : '';
		formCurrency = (link.currency || 'RON') as Currency;
		formAnchorText = link.anchorText || '';
		formProjectId = link.projectId || '';
		formNotes = link.notes || '';
		formError = null;
		isDialogOpen = true;
	}

	async function handleSubmit() {
		if (!formClientId || !formMonth || !formKeyword || !formArticleUrl) {
			formError = 'Client, luna, cuvântul cheie și linkul sunt obligatorii';
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
				return 'default';
			case 'submitted':
				return 'secondary';
			case 'rejected':
				return 'destructive';
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
							: 'Adăugați un nou link SEO pentru un client'}
					</DialogDescription>
				</DialogHeader>
				<div class="grid gap-4 py-4">
					<div class="grid gap-2">
						<Label for="clientId">Client *</Label>
						<Combobox
							bind:value={formClientId}
							options={clientOptions}
							placeholder="Selectați un client"
							searchPlaceholder="Căutați clienți..."
						/>
					</div>
					<div class="grid gap-2">
						<Label for="pressTrust">Trust de presă</Label>
						<Input
							id="pressTrust"
							bind:value={formPressTrust}
							placeholder="ex: Gândul, Adevărul"
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
					<div class="grid gap-2">
						<Label for="articleUrl">Link articol *</Label>
						<Input
							id="articleUrl"
							bind:value={formArticleUrl}
							placeholder="https://..."
							type="url"
						/>
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
								<SelectTrigger id="currency">{formCurrency}</SelectTrigger>
								<SelectContent>
									{#each CURRENCIES as curr}
										<SelectItem value={curr}>{curr}</SelectItem>
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
	</div>

	{#if loading}
		<p class="text-muted-foreground">Se încarcă...</p>
	{:else if seoLinks.length === 0}
		<Card>
			<div class="p-6 text-center">
				<p class="text-muted-foreground">
					Nu există linkuri SEO. Adăugați primul link pentru un client.
				</p>
			</div>
		</Card>
	{:else}
		<Card>
			<div class="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Trust presă</TableHead>
							<TableHead>Lună</TableHead>
							<TableHead>Client</TableHead>
							<TableHead>Cuvânt cheie</TableHead>
							<TableHead>Tip link</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Link articol</TableHead>
							<TableHead>Preț</TableHead>
							<TableHead class="w-[50px]"></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each seoLinks as link}
						{@const shortUrl = link.articleUrl.replace(/^https?:\/\//, '')}
						<TableRow>
								<TableCell class="font-medium">
									{link.pressTrust || '—'}
								</TableCell>
								<TableCell>{link.month}</TableCell>
								<TableCell>{clientMap.get(link.clientId) || link.clientId}</TableCell>
								<TableCell>{link.keyword}</TableCell>
								<TableCell>
									<div class="flex flex-col gap-1">
										{#if link.linkType}
											<span class="text-xs">{getLinkTypeLabel(link.linkType)}</span>
										{/if}
										<Badge variant={link.linkAttribute === 'dofollow' ? 'default' : 'secondary'}>
											{link.linkAttribute}
										</Badge>
									</div>
								</TableCell>
								<TableCell>
									<Badge variant={getStatusBadge(link.status)}>
										{getStatusLabel(link.status)}
									</Badge>
								</TableCell>
								<TableCell>
									<a
										href={link.articleUrl}
										target="_blank"
										rel="noopener noreferrer"
										class="inline-flex items-center gap-1 text-primary hover:underline truncate max-w-[200px]"
									>
										{shortUrl.length > 45 ? `${shortUrl.slice(0, 45)}...` : shortUrl}
										<ExternalLinkIcon class="h-3 w-3 shrink-0" />
									</a>
								</TableCell>
								<TableCell>
									{link.price != null
										? formatAmount(link.price, (link.currency || 'RON') as Currency)
										: '—'}
								</TableCell>
								<TableCell>
									<DropdownMenu>
										<DropdownMenuTrigger>
											<Button variant="ghost" size="icon">
												<MoreVerticalIcon class="h-4 w-4" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
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
		</Card>
	{/if}
</div>
