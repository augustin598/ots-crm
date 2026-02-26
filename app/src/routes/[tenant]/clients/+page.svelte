<script lang="ts">
	import { getClients, getClientFirstInvoiceDates, createClient, updateClient, deleteClient } from '$lib/remotes/clients.remote';
	import { getAllClientWebsites } from '$lib/remotes/client-websites.remote';
	import ClientLogo from '$lib/components/client-logo.svelte';
	import { getFaviconUrl } from '$lib/utils';
	import { goto } from '$app/navigation';
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
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import FilterIcon from '@lucide/svelte/icons/filter';
	import XIcon from '@lucide/svelte/icons/x';
	import SearchIcon from '@lucide/svelte/icons/search';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import CalendarIcon from '@lucide/svelte/icons/calendar';

	const clientsQuery = getClients();
	const firstInvoiceDatesQuery = getClientFirstInvoiceDates();
	const clients = $derived(clientsQuery.current || []);
	const firstInvoiceDates = $derived(
		(() => {
			const rows = firstInvoiceDatesQuery.current || [];
			const map = new Map<string, Date>();
			for (const r of rows) {
				if (r.clientId && r.firstDate) {
					const d = new Date(r.firstDate);
					if (!isNaN(d.getTime())) map.set(r.clientId, d);
				}
			}
			return map;
		})()
	);
	const allWebsitesQuery = getAllClientWebsites();
	const websitesByClient = $derived(
		(() => {
			const rows = allWebsitesQuery.current ?? [];
			const map = new Map<string, typeof rows>();
			for (const w of rows) {
				const list = map.get(w.clientId) ?? [];
				list.push(w);
				map.set(w.clientId, list);
			}
			for (const list of map.values()) {
				list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
			}
			return map;
		})()
	);

	function websiteDisplayUrl(url: string): string {
		try { return new URL(url).hostname; } catch { return url; }
	}
	const loading = $derived(clientsQuery.loading);
	const error = $derived(clientsQuery.error);

	const tenantSlug = $derived(page.params.tenant);

	const STORAGE_KEY = (tenant: string) => `crm-clients-filter-${tenant}`;

	// Filter: selected client IDs. Empty = show all; non-empty = show only selected
	let selectedClientIds = $state<string[]>([]);
	let clientFilterPopoverOpen = $state(false);
	let clientFilterSearch = $state('');

	const popoverClients = $derived(
		clientFilterSearch.trim()
			? clients.filter((c) => c.name.toLowerCase().includes(clientFilterSearch.trim().toLowerCase()))
			: clients
	);

	const filteredClients = $derived(
		selectedClientIds.length === 0 ? clients : clients.filter((c) => selectedClientIds.includes(c.id))
	);

	// Load saved filter from localStorage on mount
	onMount(() => {
		if (!browser || !tenantSlug) return;
		try {
			const stored = localStorage.getItem(STORAGE_KEY(tenantSlug));
			if (stored) {
				const ids = JSON.parse(stored);
				if (Array.isArray(ids) && ids.length > 0) {
					selectedClientIds = ids;
				}
			}
		} catch {
			// ignore invalid stored data
		}
	});

	// Save filter to localStorage when selection changes
	$effect(() => {
		if (!browser || !tenantSlug) return;
		if (selectedClientIds.length > 0) {
			localStorage.setItem(STORAGE_KEY(tenantSlug), JSON.stringify(selectedClientIds));
		} else {
			localStorage.removeItem(STORAGE_KEY(tenantSlug));
		}
	});

	function toggleClient(clientId: string) {
		if (selectedClientIds.includes(clientId)) {
			selectedClientIds = selectedClientIds.filter((id) => id !== clientId);
		} else {
			selectedClientIds = [...selectedClientIds, clientId];
		}
	}

	function selectAllClients() {
		selectedClientIds = clients.map((c) => c.id);
	}

	function clearClientFilter() {
		selectedClientIds = [];
		clientFilterPopoverOpen = false;
	}

	let isDialogOpen = $state(false);
	let editingClientId = $state<string | null>(null);
	let editingName = $state('');
	let editingLoading = $state(false);

	let formName = $state('');
	let formEmail = $state('');
	let formPhone = $state('');
	let formCompany = $state('');
	let formStatus = $state('prospect');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	function getInitials(name: string): string {
		return name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	function getStatusVariant(status: string) {
		if (status === 'active') return 'success';
		if (status === 'prospect') return 'secondary';
		return 'outline';
	}

	async function handleCreateClient() {
		formLoading = true;
		formError = null;

		try {
			await createClient({
				name: formCompany || formName,
				email: formEmail || undefined,
				phone: formPhone || undefined,
				status: formStatus || undefined
			}).updates(clientsQuery);
			// Reset form
			formName = '';
			formEmail = '';
			formPhone = '';
			formCompany = '';
			formStatus = 'prospect';
			isDialogOpen = false;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to create client';
		} finally {
			formLoading = false;
		}
	}

	async function handleDeleteClient(clientId: string) {
		if (!confirm('Are you sure you want to delete this client?')) {
			return;
		}

		try {
			await deleteClient(clientId).updates(clientsQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete client');
		}
	}

	function startEditName(client: { id: string; name: string }) {
		editingClientId = client.id;
		editingName = client.name;
	}

	async function saveEditName() {
		if (!editingClientId || editingLoading) return;
		const trimmed = editingName.trim();
		if (!trimmed) {
			editingClientId = null;
			return;
		}

		editingLoading = true;
		try {
			await updateClient({ clientId: editingClientId, name: trimmed }).updates(clientsQuery);
			editingClientId = null;
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to update client name');
		} finally {
			editingLoading = false;
		}
	}

	function cancelEditName() {
		editingClientId = null;
	}
</script>

<svelte:head>
	<title>Clients - CRM</title>
</svelte:head>

<div class="mb-8 flex items-center justify-between">
	<div>
		<h1 class="text-3xl font-bold tracking-tight">Clients</h1>
		<p class="text-muted-foreground mt-1">Manage your client relationships and contacts</p>
	</div>
	<div class="flex items-center gap-2">
		{#if clients.length > 0}
			<Popover bind:open={clientFilterPopoverOpen}>
				<PopoverTrigger>
					<Button variant="outline" class="h-9 gap-2 text-sm font-normal">
						<FilterIcon class="h-3.5 w-3.5 shrink-0 opacity-50" />
						{#if selectedClientIds.length === 0}
							Toți clienții
						{:else if selectedClientIds.length === 1}
							{clients.find((c) => c.id === selectedClientIds[0])?.name ?? 'Client'}
						{:else}
							{selectedClientIds.length} clienți selectați
						{/if}
						{#if selectedClientIds.length > 0}
							<Badge variant="secondary" class="ml-auto">{selectedClientIds.length}</Badge>
						{/if}
					</Button>
				</PopoverTrigger>
				<PopoverContent class="w-72 p-2" align="end">
					<div class="flex items-center justify-between mb-2">
						<p class="text-xs font-medium">Filtrează clienți</p>
						{#if selectedClientIds.length > 0}
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
						{selectedClientIds.length === 0 ? 'Toți clienții afișați' : `${selectedClientIds.length} din ${clients.length} selectați`}
					</p>
					<div class="max-h-[200px] overflow-y-auto space-y-0.5">
						{#each popoverClients as client}
							<div class="flex items-center space-x-2 rounded px-1 py-1 hover:bg-muted/50">
								<Checkbox
									checked={selectedClientIds.includes(client.id)}
									onCheckedChange={() => toggleClient(client.id)}
									id={`client-${client.id}`}
								/>
								<Label for={`client-${client.id}`} class="cursor-pointer flex-1 truncate text-sm font-normal">
									{client.name}
								</Label>
							</div>
						{/each}
					</div>
				</PopoverContent>
			</Popover>
		{/if}
		<Dialog bind:open={isDialogOpen}>
		<DialogTrigger>
			<Button>
				<PlusIcon class="mr-2 h-4 w-4" />
				Add Client
			</Button>
		</DialogTrigger>
		<DialogContent class="sm:max-w-[500px]">
			<DialogHeader>
				<DialogTitle>Add New Client</DialogTitle>
				<DialogDescription>Create a new client profile to start managing your relationship</DialogDescription>
			</DialogHeader>
			<div class="grid gap-4 py-4">
				<div class="grid gap-2">
					<Label for="name">Full Name</Label>
					<Input id="name" bind:value={formName} placeholder="John Doe" />
				</div>
				<div class="grid gap-2">
					<Label for="email">Email</Label>
					<Input id="email" type="email" bind:value={formEmail} placeholder="john@example.com" />
				</div>
				<div class="grid gap-2">
					<Label for="phone">Phone</Label>
					<Input id="phone" type="tel" bind:value={formPhone} placeholder="+1 555-0123" />
				</div>
				<div class="grid gap-2">
					<Label for="company">Company</Label>
					<Input id="company" bind:value={formCompany} placeholder="Acme Corp" />
				</div>
				<div class="grid gap-2">
					<Label for="status">Status</Label>
					<Select type="single" bind:value={formStatus}>
						<SelectTrigger id="status">
							{#if formStatus === 'prospect'}
								Prospect
							{:else if formStatus === 'active'}
								Active
							{:else if formStatus === 'inactive'}
								Inactive
							{:else}
								Select status
							{/if}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="prospect">Prospect</SelectItem>
							<SelectItem value="active">Active</SelectItem>
							<SelectItem value="inactive">Inactive</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>
			{#if formError}
				<div class="rounded-md bg-red-50 p-3">
					<p class="text-sm text-red-800">{formError}</p>
				</div>
			{/if}
			<DialogFooter>
				<Button variant="outline" onclick={() => (isDialogOpen = false)}>Cancel</Button>
				<Button onclick={handleCreateClient} disabled={formLoading}>
					{formLoading ? 'Creating...' : 'Create Client'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>
	</div>
</div>

{#if loading}
	<p>Loading clients...</p>
{:else if error}
	<div class="rounded-md bg-red-50 p-3">
		<p class="text-sm text-red-800">
			{error instanceof Error ? error.message : typeof error === 'string' ? error : 'Failed to load clients'}
		</p>
	</div>
{:else if clients.length === 0}
	<Card>
		<div class="p-6 text-center">
			<p class="text-muted-foreground">No clients yet. Get started by adding your first client.</p>
		</div>
	</Card>
{:else if filteredClients.length === 0}
	<Card>
		<div class="p-6 text-center">
			<p class="text-muted-foreground">No clients match your selection. Clear the filter or select different clients.</p>
			<Button variant="outline" class="mt-4" onclick={clearClientFilter}>Clear filter</Button>
		</div>
	</Card>
{:else}
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
		{#each filteredClients as client}
			{@const firstInvoiceDate = firstInvoiceDates.get(client.id)}
			<Card class="group flex flex-col rounded-xl border bg-card shadow-sm transition-all hover:shadow-md hover:border-primary/30 p-0 overflow-hidden">
				<!-- Header: avatar + name + menu -->
				<div class="flex items-start gap-4 p-5 pb-4">
					<ClientLogo website={client.defaultWebsiteUrl ?? client.website} name={client.name} size="sm" />
					<div class="min-w-0 flex-1">
						{#if editingClientId === client.id}
							<Input
								class="h-6 text-base font-semibold border-0 px-0 shadow-none focus-visible:ring-0 py-0"
								bind:value={editingName}
								disabled={editingLoading}
								autofocus
								onblur={saveEditName}
								onkeydown={(e) => {
									if (e.key === 'Enter') saveEditName();
									if (e.key === 'Escape') cancelEditName();
								}}
								onclick={(e) => e.stopPropagation()}
							/>
						{:else}
							<h3
								class="font-semibold text-base text-foreground cursor-text hover:bg-muted/50 rounded px-1 -mx-1 py-0.5 transition-colors line-clamp-2"
								onclick={() => startEditName(client)}
								role="button"
								tabindex="0"
								onkeydown={(e) => e.key === 'Enter' && startEditName(client)}
							>
								{client.name}
							</h3>
						{/if}
						<div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
							{#if client.status}
								<Badge variant={getStatusVariant(client.status)} class="text-[11px] font-medium px-2 py-0.5 shrink-0">
									{client.status}
								</Badge>
							{/if}
							{#each (websitesByClient.get(client.id) ?? []) as w (w.id)}
								<a
									href={w.url.startsWith('http') ? w.url : 'https://' + w.url}
									target="_blank"
									rel="noopener noreferrer"
									class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors min-w-0"
									title={w.url}
									onclick={(e) => e.stopPropagation()}
								>
									<img src={getFaviconUrl(w.url, 16)} alt="" class="h-3.5 w-3.5 shrink-0 rounded-sm object-contain" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
									<span class="truncate max-w-[90px]">{websiteDisplayUrl(w.url)}</span>
								</a>
							{/each}
						</div>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger>
							<Button variant="ghost" size="icon" class="h-8 w-8 shrink-0 rounded-lg -m-1">
								<MoreVerticalIcon class="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/clients/${client.id}/edit`)}>
								Edit
							</DropdownMenuItem>
							<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/clients/${client.id}`)}>
								View Details
							</DropdownMenuItem>
							<DropdownMenuItem class="text-destructive" onclick={() => handleDeleteClient(client.id)}>
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<!-- Details: icon + text rows, consistent layout -->
				<div class="flex flex-col gap-2 px-5 pb-5 pt-0">
					<div class="flex items-center gap-3 text-sm min-h-[20px]">
						<Building2Icon class="h-4 w-4 shrink-0 text-muted-foreground/70" />
						<span class="truncate text-muted-foreground">{client.name}</span>
					</div>
					<div class="flex items-center gap-3 text-sm min-h-[20px]">
						<MailIcon class="h-4 w-4 shrink-0 text-muted-foreground/70" />
						<span class="truncate text-muted-foreground">{client.email || '—'}</span>
					</div>
					<div class="flex items-center gap-3 text-sm min-h-[20px]">
						<PhoneIcon class="h-4 w-4 shrink-0 text-muted-foreground/70" />
						<span class="truncate text-muted-foreground">{client.phone || '—'}</span>
					</div>
					<div class="flex items-center gap-3 text-sm min-h-[20px] pt-1">
						<CalendarIcon class="h-4 w-4 shrink-0 text-muted-foreground/70" />
						<span class="text-muted-foreground">
							{firstInvoiceDate
								? `First invoice ${firstInvoiceDate.toLocaleDateString()}`
								: `Joined ${new Date(client.createdAt).toLocaleDateString()}`}
						</span>
					</div>
				</div>
			</Card>
		{/each}
	</div>
{/if}
