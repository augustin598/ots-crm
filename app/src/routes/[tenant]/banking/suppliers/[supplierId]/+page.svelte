<script lang="ts">
	import { getSupplier, updateSupplier } from '$lib/remotes/suppliers.remote';
	import { getExpenses } from '$lib/remotes/banking.remote';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { ArrowLeft, Edit, Save, X } from '@lucide/svelte';
	import { Mail, Phone, Building2, CreditCard, MapPin } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant as string);
	const supplierId = $derived(page.params.supplierId as string);

	const supplierQuery = $derived(getSupplier(supplierId));
	const supplier = $derived(supplierQuery.current);
	const loading = $derived(supplierQuery.loading);

	const expensesQuery = $derived(getExpenses({ supplierId }));
	const expenses = $derived(expensesQuery.current || []);

	let isEditing = $state(false);
	let formName = $state('');
	let formEmail = $state('');
	let formPhone = $state('');
	let formCui = $state('');
	let formIban = $state('');
	let formAddress = $state('');
	let formCity = $state('');
	let formCounty = $state('');
	let formPostalCode = $state('');
	let formCountry = $state('');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	$effect(() => {
		if (supplier) {
			formName = supplier.name;
			formEmail = supplier.email || '';
			formPhone = supplier.phone || '';
			formCui = supplier.cui || '';
			formIban = supplier.iban || '';
			formAddress = supplier.address || '';
			formCity = supplier.city || '';
			formCounty = supplier.county || '';
			formPostalCode = supplier.postalCode || '';
			formCountry = supplier.country || 'România';
		}
	});

	async function handleSave() {
		if (!formName) {
			formError = 'Name is required';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			await updateSupplier({
				supplierId,
				name: formName,
				email: formEmail || undefined,
				phone: formPhone || undefined,
				cui: formCui || undefined,
				iban: formIban || undefined,
				address: formAddress || undefined,
				city: formCity || undefined,
				county: formCounty || undefined,
				postalCode: formPostalCode || undefined,
				country: formCountry || undefined
			}).updates(supplierQuery);
			isEditing = false;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to update supplier';
		} finally {
			formLoading = false;
		}
	}

	const totalExpenses = $derived(
		expenses.reduce((sum, exp) => {
			return sum + (exp.amount || 0);
		}, 0)
	);
</script>

<svelte:head>
	<title>{supplier?.name || 'Supplier'} - Banking</title>
</svelte:head>

<div class="space-y-6">
	<div class="mb-8 flex items-center justify-between">
		<div class="flex items-center gap-4">
			<Button variant="ghost" size="icon" onclick={() => goto(`/${tenantSlug}/banking/suppliers`)}>
				<ArrowLeft class="h-4 w-4" />
			</Button>
			<div>
				<h1 class="text-3xl font-bold">{supplier?.name || 'Loading...'}</h1>
				<p class="text-muted-foreground">Supplier details and expenses</p>
			</div>
		</div>
		{#if !isEditing}
			<Button onclick={() => (isEditing = true)}>
				<Edit class="mr-2 h-4 w-4" />
				Edit
			</Button>
		{:else}
			<div class="flex gap-2">
				<Button variant="outline" onclick={() => (isEditing = false)}>
					<X class="mr-2 h-4 w-4" />
					Cancel
				</Button>
				<Button onclick={handleSave} disabled={formLoading}>
					<Save class="mr-2 h-4 w-4" />
					{formLoading ? 'Saving...' : 'Save'}
				</Button>
			</div>
		{/if}
	</div>

	{#if loading}
		<p>Loading supplier...</p>
	{:else if supplier}
		<div class="grid gap-6 md:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Supplier Information</CardTitle>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if isEditing}
						<div class="space-y-4">
							<div class="space-y-2">
								<Label for="name">Name *</Label>
								<Input id="name" bind:value={formName} required />
							</div>
							<div class="space-y-2">
								<Label for="email">Email</Label>
								<Input id="email" type="email" bind:value={formEmail} />
							</div>
							<div class="space-y-2">
								<Label for="phone">Phone</Label>
								<Input id="phone" type="tel" bind:value={formPhone} />
							</div>
							<div class="space-y-2">
								<Label for="cui">CUI</Label>
								<Input id="cui" bind:value={formCui} />
							</div>
							<div class="space-y-2">
								<Label for="iban">IBAN</Label>
								<Input id="iban" bind:value={formIban} />
							</div>
							<div class="space-y-2">
								<Label for="address">Address</Label>
								<Input id="address" bind:value={formAddress} />
							</div>
							<div class="grid grid-cols-2 gap-4">
								<div class="space-y-2">
									<Label for="city">City</Label>
									<Input id="city" bind:value={formCity} />
								</div>
								<div class="space-y-2">
									<Label for="county">County</Label>
									<Input id="county" bind:value={formCounty} />
								</div>
							</div>
							<div class="grid grid-cols-2 gap-4">
								<div class="space-y-2">
									<Label for="postalCode">Postal Code</Label>
									<Input id="postalCode" bind:value={formPostalCode} />
								</div>
								<div class="space-y-2">
									<Label for="country">Country</Label>
									<Input id="country" bind:value={formCountry} />
								</div>
							</div>
							{#if formError}
								<div class="rounded-md bg-red-50 p-3">
									<p class="text-sm text-red-800">{formError}</p>
								</div>
							{/if}
						</div>
					{:else}
						<div class="space-y-4">
							{#if supplier.email}
								<div class="flex items-center gap-2">
									<Mail class="h-4 w-4 text-muted-foreground" />
									<span>{supplier.email}</span>
								</div>
							{/if}
							{#if supplier.phone}
								<div class="flex items-center gap-2">
									<Phone class="h-4 w-4 text-muted-foreground" />
									<span>{supplier.phone}</span>
								</div>
							{/if}
							{#if supplier.cui}
								<div class="flex items-center gap-2">
									<Building2 class="h-4 w-4 text-muted-foreground" />
									<span>CUI: {supplier.cui}</span>
								</div>
							{/if}
							{#if supplier.iban}
								<div class="flex items-center gap-2">
									<CreditCard class="h-4 w-4 text-muted-foreground" />
									<span>{supplier.iban}</span>
								</div>
							{/if}
							{#if supplier.address || supplier.city}
								<div class="flex items-center gap-2">
									<MapPin class="h-4 w-4 text-muted-foreground" />
									<span>
										{supplier.address}
										{#if supplier.city}
											, {supplier.city}
										{/if}
										{#if supplier.county}
											, {supplier.county}
										{/if}
										{#if supplier.postalCode}
											{' '}
											{supplier.postalCode}
										{/if}
									</span>
								</div>
							{/if}
						</div>
					{/if}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Expenses Summary</CardTitle>
				</CardHeader>
				<CardContent>
					<div class="space-y-4">
						<div>
							<p class="text-sm text-muted-foreground">Total Expenses</p>
							<p class="text-2xl font-bold text-red-600">
								-{formatAmount(totalExpenses, 'RON')}
							</p>
						</div>
						<div>
							<p class="text-sm text-muted-foreground">Number of Expenses</p>
							<p class="text-xl font-semibold">{expenses.length}</p>
						</div>
						<Button
							variant="outline"
							class="w-full"
							onclick={() => goto(`/${tenantSlug}/banking/expenses?supplier=${supplierId}`)}
						>
							View All Expenses
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>

		<Card>
			<CardHeader>
				<CardTitle>Recent Expenses</CardTitle>
				<CardDescription>Latest expenses for this supplier</CardDescription>
			</CardHeader>
			<CardContent>
				{#if expenses.length === 0}
					<p class="text-center text-muted-foreground py-8">No expenses found for this supplier</p>
				{:else}
					<div class="space-y-4">
						{#each expenses.slice(0, 10) as expense}
							<div class="flex items-center justify-between rounded-lg border p-4">
								<div>
									<p class="font-semibold">{expense.description}</p>
									<p class="text-sm text-muted-foreground">
										{new Date(expense.date).toLocaleDateString()}
										{#if expense.category}
											• {expense.category}
										{/if}
									</p>
								</div>
								<div class="text-right">
									<p class="font-semibold text-red-600">
										-{formatAmount(expense.amount, expense.currency as Currency)}
									</p>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</CardContent>
		</Card>
	{/if}
</div>
