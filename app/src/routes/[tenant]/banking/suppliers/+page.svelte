<script lang="ts">
	import { getSuppliers, createSupplier, deleteSupplier } from '$lib/remotes/suppliers.remote';
	import { goto } from '$app/navigation';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
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
	import { page } from '$app/state';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import { ArrowLeft } from '@lucide/svelte';

	const suppliersQuery = getSuppliers();
	const suppliers = $derived(suppliersQuery.current || []);
	const loading = $derived(suppliersQuery.loading);
	const error = $derived(suppliersQuery.error);

	const tenantSlug = $derived(page.params.tenant);

	let isDialogOpen = $state(false);
	let formName = $state('');
	let formEmail = $state('');
	let formPhone = $state('');
	let formCui = $state('');
	let formIban = $state('');
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

	async function handleCreateSupplier() {
		if (!formName) {
			formError = 'Name is required';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			await createSupplier({
				name: formName,
				email: formEmail || undefined,
				phone: formPhone || undefined,
				cui: formCui || undefined,
				iban: formIban || undefined
			}).updates(suppliersQuery);
			// Reset form
			formName = '';
			formEmail = '';
			formPhone = '';
			formCui = '';
			formIban = '';
			isDialogOpen = false;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to create supplier';
		} finally {
			formLoading = false;
		}
	}

	async function handleDeleteSupplier(supplierId: string) {
		if (!confirm('Are you sure you want to delete this supplier?')) {
			return;
		}

		try {
			await deleteSupplier(supplierId).updates(suppliersQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete supplier');
		}
	}
</script>

<svelte:head>
	<title>Suppliers - Banking</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex items-center justify-between">
		<div class="flex items-center gap-4">
			<Button variant="ghost" size="icon" onclick={() => goto(`/${tenantSlug}/banking`)}>
				<ArrowLeft class="h-4 w-4" />
			</Button>
			<div>
				<h1 class="text-3xl font-bold tracking-tight">Suppliers</h1>
				<p class="text-muted-foreground mt-1">Manage your suppliers and vendors</p>
			</div>
		</div>
		<Dialog bind:open={isDialogOpen}>
			<DialogTrigger>
				<Button>
					<PlusIcon class="mr-2 h-4 w-4" />
					Add Supplier
				</Button>
			</DialogTrigger>
			<DialogContent class="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Add New Supplier</DialogTitle>
					<DialogDescription>Create a new supplier profile</DialogDescription>
				</DialogHeader>
				<div class="grid gap-4 py-4">
					<div class="grid gap-2">
						<Label for="name">Name *</Label>
						<Input id="name" bind:value={formName} placeholder="Supplier Name" required />
					</div>
					<div class="grid gap-2">
						<Label for="email">Email</Label>
						<Input id="email" type="email" bind:value={formEmail} placeholder="supplier@example.com" />
					</div>
					<div class="grid gap-2">
						<Label for="phone">Phone</Label>
						<Input id="phone" type="tel" bind:value={formPhone} placeholder="+40 123 456 789" />
					</div>
					<div class="grid gap-2">
						<Label for="cui">CUI</Label>
						<Input id="cui" bind:value={formCui} placeholder="Company Registration Number" />
					</div>
					<div class="grid gap-2">
						<Label for="iban">IBAN</Label>
						<Input id="iban" bind:value={formIban} placeholder="RO49 AAAA 1B31 0075 9384 0000" />
					</div>
				</div>
				{#if formError}
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{formError}</p>
					</div>
				{/if}
				<DialogFooter>
					<Button variant="outline" onclick={() => (isDialogOpen = false)}>Cancel</Button>
					<Button onclick={handleCreateSupplier} disabled={formLoading}>
						{formLoading ? 'Creating...' : 'Create Supplier'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	</div>

	{#if loading}
		<p>Loading suppliers...</p>
	{:else if error}
		<div class="rounded-md bg-red-50 p-3">
			<p class="text-sm text-red-800">{error instanceof Error ? error.message : 'Failed to load suppliers'}</p>
		</div>
	{:else if suppliers.length === 0}
		<Card>
			<div class="p-6 text-center">
				<p class="text-muted-foreground">No suppliers yet. Get started by adding your first supplier.</p>
			</div>
		</Card>
	{:else}
		<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{#each suppliers as supplier}
				<Card class="p-6">
					<div class="flex items-start justify-between mb-4">
						<div class="flex items-center gap-3">
							<div
								class="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground text-lg font-semibold"
							>
								{getInitials(supplier.name)}
							</div>
							<div>
								<h3 class="font-semibold text-lg">{supplier.name}</h3>
								{#if supplier.cui}
									<p class="text-sm text-muted-foreground">CUI: {supplier.cui}</p>
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
								<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/banking/suppliers/${supplier.id}`)}>
									View Details
								</DropdownMenuItem>
								<DropdownMenuItem class="text-destructive" onclick={() => handleDeleteSupplier(supplier.id)}>
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>

					<div class="space-y-3">
						<div class="space-y-2">
							{#if supplier.email}
								<div class="flex items-center gap-2 text-sm text-muted-foreground">
									<MailIcon class="h-4 w-4" />
									<span class="truncate">{supplier.email}</span>
								</div>
							{/if}
							{#if supplier.phone}
								<div class="flex items-center gap-2 text-sm text-muted-foreground">
									<PhoneIcon class="h-4 w-4" />
									<span>{supplier.phone}</span>
								</div>
							{/if}
							{#if supplier.iban}
								<div class="text-sm text-muted-foreground">
									<span class="font-medium">IBAN:</span> {supplier.iban}
								</div>
							{/if}
						</div>
						<div class="pt-3 border-t">
							<Button
								variant="outline"
								size="sm"
								class="w-full"
								onclick={() => goto(`/${tenantSlug}/banking/expenses?supplier=${supplier.id}`)}
							>
								View Expenses
							</Button>
						</div>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>
