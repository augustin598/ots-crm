<script lang="ts">
	import { getClients, getClientFirstInvoiceDates, createClient, updateClient, deleteClient } from '$lib/remotes/clients.remote';
	import ClientLogo from '$lib/components/client-logo.svelte';
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
	const loading = $derived(clientsQuery.loading);
	const error = $derived(clientsQuery.error);

	const tenantSlug = $derived(page.params.tenant);

	const STORAGE_KEY = (tenant: string) => `crm-clients-filter-${tenant}`;

	// Filter: selected client IDs. Empty = show all; non-empty = show only selected
	let selectedClientIds = $state<string[]>([]);
	let clientFilterPopoverOpen = $state(false);

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
					<Button variant="outline">
						<FilterIcon class="mr-2 h-4 w-4" />
						Filter clients
						{#if selectedClientIds.length > 0}
							<Badge variant="secondary" class="ml-2">
								{selectedClientIds.length}
							</Badge>
						{/if}
					</Button>
				</PopoverTrigger>
				<PopoverContent class="w-72 max-h-[320px] overflow-y-auto" align="end">
					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<Label>Show only selected clients</Label>
							{#if selectedClientIds.length > 0}
								<Button variant="ghost" size="sm" onclick={clearClientFilter}>
									<XIcon class="mr-1 h-3 w-3" />
									Clear
								</Button>
							{/if}
						</div>
						<p class="text-xs text-muted-foreground">
							{#if selectedClientIds.length === 0}
								Showing all clients. Select clients below to filter the list.
							{:else}
								Showing {selectedClientIds.length} of {clients.length} clients.
							{/if}
						</p>
						<Button variant="outline" size="sm" class="w-full" onclick={selectAllClients}>
							Select all
						</Button>
						<div class="space-y-2 pt-2 border-t">
							{#each clients as client}
								<div class="flex items-center space-x-2">
									<Checkbox
										checked={selectedClientIds.includes(client.id)}
										onCheckedChange={() => toggleClient(client.id)}
										id={`client-${client.id}`}
									/>
									<Label for={`client-${client.id}`} class="cursor-pointer flex-1 truncate">
										{client.name}
									</Label>
								</div>
							{/each}
						</div>
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
					<ClientLogo website={client.website} name={client.name} size="sm" />
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
						{#if client.status}
							<Badge variant={getStatusVariant(client.status)} class="mt-1.5 text-[11px] font-medium px-2 py-0.5">
								{client.status}
							</Badge>
						{/if}
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
