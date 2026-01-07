<script lang="ts">
	import { getClients, createClient, deleteClient } from '$lib/remotes/clients.remote';
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
	import { page } from '$app/state';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const loading = $derived(clientsQuery.loading);
	const error = $derived(clientsQuery.error);

	const tenantSlug = $derived(page.params.tenant);

	let isDialogOpen = $state(false);
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
		if (status === 'active') return 'default';
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
			});
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
			await deleteClient(clientId);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete client');
		}
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

{#if loading}
	<p>Loading clients...</p>
{:else if error}
	<div class="rounded-md bg-red-50 p-3">
		<p class="text-sm text-red-800">{error instanceof Error ? error.message : 'Failed to load clients'}</p>
	</div>
{:else if clients.length === 0}
	<Card>
		<div class="p-6 text-center">
			<p class="text-muted-foreground">No clients yet. Get started by adding your first client.</p>
		</div>
	</Card>
{:else}
	<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
		{#each clients as client}
			<Card class="p-6">
				<div class="flex items-start justify-between mb-4">
					<div class="flex items-center gap-3">
						<div
							class="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground text-lg font-semibold"
						>
							{getInitials(client.name)}
						</div>
						<div>
							<h3 class="font-semibold text-lg">{client.name}</h3>
							{#if client.status}
								<Badge variant={getStatusVariant(client.status)}>{client.status}</Badge>
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

				<div class="space-y-3">
					<div class="text-sm">
						<p class="font-medium text-muted-foreground mb-1">Company</p>
						<p>{client.name}</p>
					</div>
					<div class="space-y-2">
						{#if client.email}
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<MailIcon class="h-4 w-4" />
								<span class="truncate">{client.email}</span>
							</div>
						{/if}
						{#if client.phone}
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<PhoneIcon class="h-4 w-4" />
								<span>{client.phone}</span>
							</div>
						{/if}
					</div>
					<div class="pt-3 border-t">
						<p class="text-xs text-muted-foreground">
							Joined {new Date(client.createdAt).toLocaleDateString()}
						</p>
					</div>
				</div>
			</Card>
		{/each}
	</div>
{/if}
