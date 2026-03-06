<script lang="ts">
	import { createContract } from '$lib/remotes/contracts.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { Separator } from '$lib/components/ui/separator';
	import ContractClausesEditor from '$lib/components/app/contract-clauses-editor.svelte';
	import { getDefaultContractClauses } from '$lib/contract-templates';
	import type { ContractClause } from '$lib/contract-templates';
	import { untrack } from 'svelte';

	let { data }: { data: any } = $props();

	const tenantSlug = $derived(page.params.tenant);
	const tenant = $derived(data?.tenant);
	const clients = $derived(data?.clients || []);
	const templates = $derived(data?.templates || []);

	// Form state - Date contract
	let clientId = $state('');
	let contractNumber = $state('');
	let contractDate = $state(new Date().toISOString().split('T')[0]);
	let contractTitle = $state('PRESTARI SERVICII INFORMATICE');
	let templateId = $state('');
	const defaultClauses = getDefaultContractClauses();
	let clauses = $state<ContractClause[]>(
		defaultClauses.map((c) => ({ ...c, paragraphs: [...c.paragraphs] }))
	);

	// Client data query
	let clientQuery = $derived(clientId ? getClient(clientId) : null);
	let clientData = $derived(clientQuery?.current);

	// Client options for combobox
	const clientOptions = $derived(
		clients.map((c: any) => ({
			value: c.id,
			label: c.cui ? `${c.cui} - ${c.name}` : c.name
		}))
	);

	// Template options
	const templateOptions = $derived(
		templates.map((t: any) => ({
			value: t.id,
			label: t.name
		}))
	);

	// Load clauses when template is selected, reset on deselect
	$effect(() => {
		if (templateId) {
			const selectedTemplate = templates.find((t: any) => t.id === templateId);
			if (selectedTemplate?.clausesJson) {
				untrack(() => {
					try {
						clauses = JSON.parse(selectedTemplate.clausesJson);
					} catch {
						clauses = defaultClauses.map((c) => ({ ...c, paragraphs: [...c.paragraphs] }));
					}
				});
			}
		} else {
			untrack(() => {
				clauses = defaultClauses.map((c) => ({ ...c, paragraphs: [...c.paragraphs] }));
			});
		}
	});

	// Servicii (line items)
	interface ServiceLineItem {
		id: string;
		description: string;
		price: number;
		unitOfMeasure: string;
	}

	let lineItems = $state<ServiceLineItem[]>([
		{ id: crypto.randomUUID(), description: '', price: 0, unitOfMeasure: 'Luna' }
	]);
	let discountPercent = $state(0);

	function addLineItem() {
		lineItems = [
			...lineItems,
			{ id: crypto.randomUUID(), description: '', price: 0, unitOfMeasure: 'Luna' }
		];
	}

	function removeLineItem(id: string) {
		lineItems = lineItems.filter((item) => item.id !== id);
	}

	// Calculate total
	const subtotal = $derived(lineItems.reduce((sum, item) => sum + item.price, 0));
	const discountAmount = $derived(discountPercent > 0 ? (subtotal * discountPercent) / 100 : 0);
	const total = $derived(subtotal - discountAmount);

	// Termeni plata
	let currency = $state('EUR');
	let paymentTermsDays = $state(5);
	let penaltyRate = $state(0.5);
	let billingFrequency = $state('monthly');

	// Durata
	let contractDurationMonths = $state(6);

	// Descriere servicii
	let serviceDescription = $state('');
	let offerLink = $state('');

	// Contact si semnaturi
	let prestatorEmail = $state('');
	let beneficiarEmail = $state('');
	let prestatorSignatureName = $state('');
	let beneficiarSignatureName = $state('');
	let hourlyRate = $state(60);
	let hourlyRateCurrency = $state('EUR');

	// Auto-fill signature names
	$effect(() => {
		if (tenant?.legalRepresentative) {
			untrack(() => {
				prestatorSignatureName = tenant.legalRepresentative;
			});
		}
	});

	$effect(() => {
		if (clientData?.legalRepresentative) {
			untrack(() => {
				beneficiarSignatureName = clientData.legalRepresentative;
			});
		}
	});

	// Auto-fill emails
	$effect(() => {
		if (tenant?.email && !prestatorEmail) {
			untrack(() => {
				prestatorEmail = tenant.email;
			});
		}
	});

	$effect(() => {
		if (clientData?.email) {
			untrack(() => {
				beneficiarEmail = clientData.email;
			});
		}
	});

	let loading = $state(false);

	function formatEUR(cents: number): string {
		return (cents / 100).toFixed(2);
	}

	async function handleSubmit() {
		if (!clientId) {
			toast.error('Selecteaza un client');
			return;
		}

		if (lineItems.length === 0 || lineItems.every((item) => !item.description.trim())) {
			toast.error('Adauga cel putin un serviciu');
			return;
		}

		loading = true;

		try {
			const result = await createContract({
				clientId,
				templateId: templateId || undefined,
				contractDate: contractDate || undefined,
				contractTitle: contractTitle || undefined,
				status: 'draft',
				serviceDescription: serviceDescription || undefined,
				offerLink: offerLink || undefined,
				currency,
				paymentTermsDays,
				penaltyRate: Math.round(penaltyRate * 100),
				billingFrequency,
				contractDurationMonths,
				discountPercent: discountPercent > 0 ? discountPercent : undefined,
				prestatorEmail: prestatorEmail || undefined,
				beneficiarEmail: beneficiarEmail || undefined,
				hourlyRate: Math.round(hourlyRate * 100),
				hourlyRateCurrency,
				prestatorSignatureName: prestatorSignatureName || undefined,
				beneficiarSignatureName: beneficiarSignatureName || undefined,
				clausesJson: clauses.length > 0 ? JSON.stringify(clauses) : undefined,
				lineItems: lineItems
					.filter((item) => item.description.trim())
					.map((item, index) => ({
						description: item.description,
						price: Math.round((item.price + Number.EPSILON) * 100),
						unitOfMeasure: item.unitOfMeasure || 'Luna',
						sortOrder: index
					}))
			});

			if (result.success && result.contractId) {
				toast.success('Contract creat cu succes');
				goto(`/${tenantSlug}/contracts/${result.contractId}`);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la crearea contractului');
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Contract Nou - CRM</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="mb-6">
		<Button variant="ghost" size="sm" class="mb-4" onclick={() => goto(`/${tenantSlug}/contracts`)}>
			<ArrowLeftIcon class="mr-2 h-4 w-4" />
			Inapoi la Contracte
		</Button>
		<h1 class="text-3xl font-bold tracking-tight">Contract Nou</h1>
	</div>

	<!-- Section 1: Date contract -->
	<Card class="p-6">
		<h2 class="text-xl font-semibold mb-4">Date contract</h2>
		<div class="grid gap-4 md:grid-cols-2">
			<div class="space-y-1.5">
				<Label>Client</Label>
				<Combobox
					options={clientOptions}
					bind:value={clientId}
					placeholder="Selecteaza client..."
					searchPlaceholder="Cauta client..."
				/>
			</div>
			<div class="space-y-1.5">
				<Label>Nr. contract</Label>
				<Input
					bind:value={contractNumber}
					placeholder="Auto-generat daca este gol"
				/>
			</div>
			<div class="space-y-1.5">
				<Label>Data contract</Label>
				<Input type="date" bind:value={contractDate} />
			</div>
			<div class="space-y-1.5">
				<Label>Titlu contract</Label>
				<Input bind:value={contractTitle} placeholder="PRESTARI SERVICII INFORMATICE" />
			</div>
			<div class="space-y-1.5 md:col-span-2">
				<Label>Template</Label>
				<Combobox
					options={templateOptions}
					bind:value={templateId}
					placeholder="Selecteaza template..."
					searchPlaceholder="Cauta template..."
				/>
			</div>
		</div>
	</Card>

	<!-- Section 2: Servicii -->
	<Card class="p-6">
		<h2 class="text-xl font-semibold mb-4">Servicii</h2>
		<div class="overflow-x-auto">
			<table class="w-full">
				<thead>
					<tr class="border-b">
						<th class="text-left py-2 font-medium text-sm">Descriere</th>
						<th class="text-right py-2 font-medium text-sm w-36">Pret (EUR)</th>
						<th class="text-left py-2 font-medium text-sm w-28">UM</th>
						<th class="py-2 w-12"></th>
					</tr>
				</thead>
				<tbody>
					{#each lineItems as item, index (item.id)}
						<tr class="border-b">
							<td class="py-2 pr-2">
								<Input
									bind:value={item.description}
									placeholder="Descriere serviciu"
								/>
							</td>
							<td class="py-2 px-2">
								<Input
									type="number"
									bind:value={item.price}
									placeholder="0.00"
									step="0.01"
									min="0"
									class="text-right"
								/>
							</td>
							<td class="py-2 px-2">
								<Select type="single" bind:value={item.unitOfMeasure}>
									<SelectTrigger>{item.unitOfMeasure || 'Luna'}</SelectTrigger>
									<SelectContent>
										<SelectItem value="Luna">Luna</SelectItem>
										<SelectItem value="Ora">Ora</SelectItem>
										<SelectItem value="Zi">Zi</SelectItem>
										<SelectItem value="Bucata">Bucata</SelectItem>
										<SelectItem value="Proiect">Proiect</SelectItem>
									</SelectContent>
								</Select>
							</td>
							<td class="py-2 pl-2">
								<Button
									variant="ghost"
									size="icon"
									onclick={() => removeLineItem(item.id)}
									disabled={lineItems.length <= 1}
								>
									<TrashIcon class="h-4 w-4 text-destructive" />
								</Button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-4 flex items-center justify-between">
			<Button variant="outline" size="sm" onclick={addLineItem}>
				<PlusIcon class="mr-2 h-4 w-4" />
				Adauga serviciu
			</Button>
		</div>

		<div class="mt-4 flex flex-col items-end gap-2">
			<div class="flex items-center gap-2">
				<Label class="text-sm">Discount %</Label>
				<Input
					type="number"
					bind:value={discountPercent}
					placeholder="0"
					min="0"
					max="100"
					step="0.1"
					class="w-24 text-right"
				/>
			</div>
			{#if discountPercent > 0}
				<div class="text-sm text-muted-foreground">
					Subtotal: {subtotal.toFixed(2)} EUR
				</div>
				<div class="text-sm text-muted-foreground">
					Discount ({discountPercent}%): -{discountAmount.toFixed(2)} EUR
				</div>
			{/if}
			<div class="text-lg font-semibold">
				Total: {total.toFixed(2)} EUR
			</div>
		</div>
	</Card>

	<!-- Section 3: Termeni plata -->
	<Card class="p-6">
		<h2 class="text-xl font-semibold mb-4">Termeni plata</h2>
		<div class="grid gap-4 md:grid-cols-2">
			<div class="space-y-1.5">
				<Label>Moneda</Label>
				<Select type="single" bind:value={currency}>
					<SelectTrigger>{currency}</SelectTrigger>
					<SelectContent>
						<SelectItem value="EUR">EUR</SelectItem>
						<SelectItem value="RON">RON</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div class="space-y-1.5">
				<Label>Zile plata</Label>
				<Input type="number" bind:value={paymentTermsDays} min="0" />
			</div>
			<div class="space-y-1.5">
				<Label>Rata penalizare %</Label>
				<Input type="number" bind:value={penaltyRate} min="0" step="0.1" />
			</div>
			<div class="space-y-1.5">
				<Label>Frecventa facturare</Label>
				<Select type="single" bind:value={billingFrequency}>
					<SelectTrigger>
						{billingFrequency === 'monthly' ? 'Lunar' : billingFrequency === 'one-time' ? 'O singura data' : billingFrequency === 'quarterly' ? 'Trimestrial' : 'Anual'}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="monthly">Lunar</SelectItem>
						<SelectItem value="one-time">O singura data</SelectItem>
						<SelectItem value="quarterly">Trimestrial</SelectItem>
						<SelectItem value="yearly">Anual</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</div>
	</Card>

	<!-- Section 4: Durata -->
	<Card class="p-6">
		<h2 class="text-xl font-semibold mb-4">Durata</h2>
		<div class="grid gap-4 md:grid-cols-2">
			<div class="space-y-1.5">
				<Label>Durata minima (luni)</Label>
				<Input type="number" bind:value={contractDurationMonths} min="1" />
			</div>
		</div>
	</Card>

	<!-- Section 5: Descriere servicii -->
	<Card class="p-6">
		<h2 class="text-xl font-semibold mb-4">Descriere servicii</h2>
		<div class="grid gap-4">
			<div class="space-y-1.5">
				<Label>Obiectul contractului</Label>
				<Textarea
					bind:value={serviceDescription}
					placeholder="Descrierea detaliata a serviciilor prestate..."
					rows={4}
				/>
			</div>
			<div class="space-y-1.5">
				<Label>Link oferta</Label>
				<Input
					type="url"
					bind:value={offerLink}
					placeholder="https://..."
				/>
			</div>
		</div>
	</Card>

	<!-- Section 6: Contact si semnaturi -->
	<Card class="p-6">
		<h2 class="text-xl font-semibold mb-4">Contact si semnaturi</h2>
		<div class="grid gap-4 md:grid-cols-2">
			<div class="space-y-1.5">
				<Label>Email prestator</Label>
				<Input type="email" bind:value={prestatorEmail} placeholder="email@company.com" />
			</div>
			<div class="space-y-1.5">
				<Label>Email beneficiar</Label>
				<Input type="email" bind:value={beneficiarEmail} placeholder="email@client.com" />
			</div>
			<div class="space-y-1.5">
				<Label>Nume semnatura prestator</Label>
				<Input bind:value={prestatorSignatureName} placeholder="Nume si prenume" />
			</div>
			<div class="space-y-1.5">
				<Label>Nume semnatura beneficiar</Label>
				<Input bind:value={beneficiarSignatureName} placeholder="Nume si prenume" />
			</div>
			<div class="space-y-1.5">
				<Label>Tarif orar suplimentar</Label>
				<Input type="number" bind:value={hourlyRate} min="0" step="1" />
			</div>
			<div class="space-y-1.5">
				<Label>Moneda tarif orar</Label>
				<Select type="single" bind:value={hourlyRateCurrency}>
					<SelectTrigger>{hourlyRateCurrency}</SelectTrigger>
					<SelectContent>
						<SelectItem value="EUR">EUR</SelectItem>
						<SelectItem value="RON">RON</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</div>
	</Card>

	<!-- Section 7: Clauze legale -->
	<Card class="p-6">
		<ContractClausesEditor
			bind:clauses
			{defaultClauses}
		/>
	</Card>

	<!-- Submit -->
	<div class="flex justify-end pb-8">
		<Button onclick={handleSubmit} disabled={loading} size="lg">
			{#if loading}
				Se creeaza...
			{:else}
				Creaza Contract
			{/if}
		</Button>
	</div>
</div>
