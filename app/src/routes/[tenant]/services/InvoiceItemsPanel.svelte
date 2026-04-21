<script lang="ts">
	import { getServices, createService, deleteService } from '$lib/remotes/services.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { formatAmount, CURRENCIES, CURRENCY_LABELS, type Currency } from '$lib/utils/currency';
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
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Switch } from '$lib/components/ui/switch';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';

	const tenantSlug = $derived(page.params.tenant);
	const servicesQuery = getServices({});
	const services = $derived(servicesQuery.current || []);
	const loading = $derived(servicesQuery.loading);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));

	let isDialogOpen = $state(false);
	let formName = $state('');
	let formDescription = $state('');
	let formClientId = $state('');
	let formCategory = $state('');
	let formPrice = $state('');
	let formCurrency = $state<Currency>('RON');
	let formUnit = $state('hour');
	let formActive = $state(true);
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	$effect(() => {
		if (invoiceSettings?.defaultCurrency) {
			formCurrency = invoiceSettings.defaultCurrency as Currency;
		}
	});

	function getUnitFromRecurringType(recurringType: string): string {
		switch (recurringType) {
			case 'daily':
				return 'day';
			case 'weekly':
				return 'week';
			case 'monthly':
				return 'month';
			case 'yearly':
				return 'year';
			case 'none':
			default:
				return 'project';
		}
	}

	function getRecurringTypeFromUnit(unit: string): string {
		switch (unit) {
			case 'hour':
				return 'none';
			case 'day':
				return 'daily';
			case 'project':
				return 'none';
			case 'month':
				return 'monthly';
			default:
				return 'none';
		}
	}

	function getCategoryColor(category: string) {
		switch (category) {
			case 'Development':
				return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
			case 'Design':
				return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
			case 'Marketing':
				return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
			case 'Consulting':
				return 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300';
			default:
				return 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300';
		}
	}

	async function handleCreateService() {
		if (!formName || !formClientId) {
			formError = 'Numele și clientul sunt obligatorii';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			await createService({
				name: formName,
				description: formDescription || undefined,
				category: formCategory || undefined,
				clientId: formClientId,
				price: formPrice ? parseFloat(formPrice) : undefined,
				currency: formCurrency || undefined,
				recurringType: getRecurringTypeFromUnit(formUnit),
				recurringInterval: 1,
				isActive: formActive
			}).updates(servicesQuery);

			formName = '';
			formDescription = '';
			formClientId = '';
			formCategory = '';
			formPrice = '';
			formCurrency = (invoiceSettings?.defaultCurrency || 'RON') as Currency;
			formUnit = 'hour';
			formActive = true;
			isDialogOpen = false;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Nu s-a putut crea serviciul';
		} finally {
			formLoading = false;
		}
	}

	async function handleDeleteService(serviceId: string) {
		if (!confirm('Sigur ștergi acest element?')) {
			return;
		}
		try {
			await deleteService(serviceId).updates(servicesQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Nu s-a putut șterge');
		}
	}

	function formatUnit(recurringType: string): string {
		const unit = getUnitFromRecurringType(recurringType);
		if (unit === 'project') return 'Per proiect';
		if (unit === 'day') return 'Per zi';
		if (unit === 'month') return 'Per lună';
		if (unit === 'week') return 'Per săptămână';
		if (unit === 'year') return 'Per an';
		return 'Per oră';
	}
</script>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h2 class="text-xl font-semibold">Elemente de facturi</h2>
		<p class="text-muted-foreground text-sm mt-1">
			Servicii per client folosite ca linii pe facturi și abonamente recurente.
		</p>
	</div>
	<Dialog bind:open={isDialogOpen}>
		<DialogTrigger>
			{#snippet child({ props })}
				<Button {...props}>
					<PlusIcon class="mr-2 h-4 w-4" />
					Adaugă element
				</Button>
			{/snippet}
		</DialogTrigger>
		<DialogContent class="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
			<DialogHeader>
				<DialogTitle>Element nou pentru facturi</DialogTitle>
				<DialogDescription>Creează un element reutilizabil pe facturi sau recurent.</DialogDescription>
			</DialogHeader>
			<div class="grid gap-4 py-4">
				<div class="grid gap-2">
					<Label for="name">Nume</Label>
					<Input id="name" bind:value={formName} placeholder="Ex. Management Google Ads" />
				</div>
				<div class="grid gap-2">
					<Label for="description">Descriere</Label>
					<Textarea id="description" bind:value={formDescription} placeholder="Detalii..." />
				</div>
				<div class="grid gap-2">
					<Label for="clientId">Client *</Label>
					<Combobox
						bind:value={formClientId}
						options={clientOptions}
						placeholder="Alege clientul"
						searchPlaceholder="Caută clienți..."
					/>
				</div>
				<div class="grid gap-2">
					<Label for="category">Categorie</Label>
					<Select type="single" bind:value={formCategory}>
						<SelectTrigger id="category">
							{#if formCategory}
								{formCategory}
							{:else}
								Alege categoria
							{/if}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="Development">Development</SelectItem>
							<SelectItem value="Design">Design</SelectItem>
							<SelectItem value="Marketing">Marketing</SelectItem>
							<SelectItem value="Consulting">Consulting</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div class="grid gap-2">
					<Label for="price">Preț</Label>
					<Input id="price" type="number" bind:value={formPrice} placeholder="150" step="0.01" />
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div class="grid gap-2">
						<Label for="currency">Monedă</Label>
						<Select type="single" bind:value={formCurrency}>
							<SelectTrigger id="currency">
								{CURRENCY_LABELS[formCurrency]}
							</SelectTrigger>
							<SelectContent>
								{#each CURRENCIES as curr}
									<SelectItem value={curr}>{CURRENCY_LABELS[curr]}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					</div>
					<div class="grid gap-2">
						<Label for="unit">Unitate</Label>
						<Select type="single" bind:value={formUnit}>
							<SelectTrigger id="unit">
								{#if formUnit === 'hour'}
									Per oră
								{:else if formUnit === 'day'}
									Per zi
								{:else if formUnit === 'project'}
									Per proiect
								{:else if formUnit === 'month'}
									Per lună
								{:else}
									Alege
								{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="hour">Per oră</SelectItem>
								<SelectItem value="day">Per zi</SelectItem>
								<SelectItem value="project">Per proiect</SelectItem>
								<SelectItem value="month">Per lună</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
				<div class="flex items-center justify-between">
					<div class="space-y-0.5">
						<Label for="active">Activ</Label>
						<p class="text-sm text-muted-foreground">Disponibil pentru facturare</p>
					</div>
					<Switch id="active" bind:checked={formActive} />
				</div>
			</div>
			{#if formError}
				<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
					<p class="text-sm text-red-800 dark:text-red-300">{formError}</p>
				</div>
			{/if}
			<DialogFooter>
				<Button variant="outline" onclick={() => (isDialogOpen = false)}>Anulează</Button>
				<Button onclick={handleCreateService} disabled={formLoading}>
					{formLoading ? 'Se adaugă...' : 'Adaugă'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>
</div>

{#if loading}
	<p class="text-muted-foreground">Se încarcă...</p>
{:else if services.length === 0}
	<Card>
		<div class="p-6 text-center">
			<p class="text-muted-foreground">Niciun element încă. Adaugă primul.</p>
		</div>
	</Card>
{:else}
	<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
		{#each services as service (service.id)}
			<Card class="p-6">
				<div class="flex items-start justify-between mb-4">
					<div class="flex-1">
						<div class="flex items-center gap-2 mb-2 flex-wrap">
							<h3 class="text-xl font-semibold">{service.name}</h3>
							{#if service.isActive}
								<Badge variant="default">Activ</Badge>
							{:else}
								<Badge variant="outline">Inactiv</Badge>
							{/if}
							{#if service.category}
								<Badge class={getCategoryColor(service.category)}>{service.category}</Badge>
							{/if}
						</div>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger>
							{#snippet child({ props })}
								<Button {...props} variant="ghost" size="icon">
									<MoreVerticalIcon class="h-4 w-4" />
								</Button>
							{/snippet}
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/services/${service.id}/edit`)}>
								Editează
							</DropdownMenuItem>
							<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/services/${service.id}`)}>
								Detalii
							</DropdownMenuItem>
							<DropdownMenuItem
								class="text-destructive"
								onclick={() => handleDeleteService(service.id)}
							>
								Șterge
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<p class="text-sm text-muted-foreground mb-4 line-clamp-2">
					{service.description || 'Fără descriere'}
				</p>

				<div class="pt-4 border-t">
					<div class="flex items-baseline gap-1">
						<span class="text-3xl font-bold text-primary">
							{service.price
								? formatAmount(service.price, (service.currency || 'RON') as Currency)
								: '—'}
						</span>
						<span class="text-sm text-muted-foreground">/ {formatUnit(service.recurringType)}</span>
					</div>
				</div>
			</Card>
		{/each}
	</div>
{/if}
