<script lang="ts">
	import { createClient } from '$lib/remotes/clients.remote';
	import { getCompanyData } from '$lib/remotes/anaf.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { FormSection } from '$lib/components/app/form-section';
	import { Progress } from '$lib/components/ui/progress/index';

	let name = $state('');
	let email = $state('');
	let phone = $state('');
	let loading = $state(false);
	let loadingAnaf = $state(false);
	let error = $state<string | null>(null);

	// Romanian legal data
	let companyType = $state('');
	let cui = $state('');
	let registrationNumber = $state('');
	let tradeRegister = $state('');
	let vatNumber = $state('');
	let legalRepresentative = $state('');
	let iban = $state('');
	let bankName = $state('');
	let address = $state('');
	let city = $state('');
	let county = $state('');
	let postalCode = $state('');
	let country = $state('România');
	let notes = $state('');

	const tenantSlug = $derived(page.params.tenant);

	// Section completion states
	let basicInfoCompleted = $derived(!!name);
	let legalDataCompleted = $derived(!!(cui || companyType || registrationNumber));
	let addressCompleted = $derived(!!(address || city || county));
	let notesCompleted = $derived(true); // Notes are optional

	const completedSections = $derived(
		(basicInfoCompleted ? 1 : 0) +
			(legalDataCompleted ? 1 : 0) +
			(addressCompleted ? 1 : 0) +
			(notesCompleted ? 1 : 0)
	);
	const totalSections = 4;
	const progress = $derived((completedSections / totalSections) * 100);

	async function handleAnafLookup() {
		if (!cui) {
			error = 'Please enter a CUI first';
			return;
		}

		loadingAnaf = true;
		error = null;

		try {
			const data = await getCompanyData(cui);

			// Map ANAF data to form fields
			name = data.denumire || name;
			registrationNumber = data.nrRegCom || registrationNumber;
			iban = data.iban || iban;
			companyType = data.forma_juridica || companyType;
			phone = data.telefon || phone;

			// Parse address
			if (data.adresa_sediu_social) {
				const addr = data.adresa_sediu_social;
				address = [addr.sdenumire_Strada, addr.snumar_Strada].filter(Boolean).join(' ') || address;
				city = addr.sdenumire_Localitate || city;
				county = addr.sdenumire_Judet || county;
				postalCode = addr.scod_Postal || postalCode;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to fetch company data from ANAF';
		} finally {
			loadingAnaf = false;
		}
	}

	async function handleSubmit() {
		loading = true;
		error = null;

		try {
			const result = await createClient({
				name,
				email: email || undefined,
				phone: phone || undefined,
				companyType: companyType || undefined,
				cui: cui || undefined,
				registrationNumber: registrationNumber || undefined,
				tradeRegister: tradeRegister || undefined,
				vatNumber: vatNumber || undefined,
				legalRepresentative: legalRepresentative || undefined,
				iban: iban || undefined,
				bankName: bankName || undefined,
				address: address || undefined,
				city: city || undefined,
				county: county || undefined,
				postalCode: postalCode || undefined,
				country: country || undefined,
				notes: notes || undefined
			});

			if (result.success) {
				goto(`/${tenantSlug}/clients`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create client';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>New Client - CRM</title>
</svelte:head>

<div class="space-y-6">
	<h1 class="text-3xl font-bold">New Client</h1>

	<Card>
		<CardHeader>
			<CardTitle>Client Information</CardTitle>
			<CardDescription>Add a new client to your CRM</CardDescription>
			<div class="mt-4 space-y-2">
				<div class="flex items-center justify-between text-sm">
					<span class="text-muted-foreground">Progress</span>
					<span class="font-medium">{completedSections} of {totalSections} sections completed</span>
				</div>
				<Progress value={progress} class="h-2" />
			</div>
		</CardHeader>
		<CardContent>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-4"
			>
				<!-- Basic Information -->
				<FormSection
					title="Basic Information"
					description="Client name and contact details"
					bind:completed={basicInfoCompleted}
					defaultOpen={true}
				>
					<div class="space-y-4">
						<div class="space-y-2">
							<Label for="name">Name *</Label>
							<Input id="name" bind:value={name} type="text" required placeholder="Client name" />
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label for="email">Email</Label>
								<Input id="email" bind:value={email} type="email" placeholder="client@example.com" />
							</div>
							<div class="space-y-2">
								<Label for="phone">Phone</Label>
								<Input id="phone" bind:value={phone} type="tel" placeholder="+40..." />
							</div>
						</div>
					</div>
				</FormSection>

				<!-- Romanian Legal Data -->
				<FormSection
					title="Legal Data (Date Legale)"
					description="Romanian company legal information"
					bind:completed={legalDataCompleted}
					defaultOpen={false}
				>
					<div class="space-y-4">
						<div class="flex items-center justify-end">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onclick={handleAnafLookup}
								disabled={loadingAnaf || !cui}
							>
								{loadingAnaf ? 'Loading...' : 'Lookup by CUI'}
							</Button>
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label for="cui">CUI</Label>
								<Input id="cui" bind:value={cui} type="text" placeholder="Cod Unic de Înregistrare" />
							</div>
							<div class="space-y-2">
								<Label for="companyType">Company Type</Label>
								<Input id="companyType" bind:value={companyType} type="text" placeholder="SRL, SA, PFA, etc." />
							</div>
							<div class="space-y-2">
								<Label for="registrationNumber">Registration Number</Label>
								<Input id="registrationNumber" bind:value={registrationNumber} type="text" />
							</div>
							<div class="space-y-2">
								<Label for="tradeRegister">Trade Register</Label>
								<Input id="tradeRegister" bind:value={tradeRegister} type="text" placeholder="J40/1234/2020" />
							</div>
							<div class="space-y-2">
								<Label for="vatNumber">VAT Number</Label>
								<Input id="vatNumber" bind:value={vatNumber} type="text" />
							</div>
							<div class="space-y-2">
								<Label for="legalRepresentative">Legal Representative</Label>
								<Input id="legalRepresentative" bind:value={legalRepresentative} type="text" />
							</div>
							<div class="space-y-2">
								<Label for="iban">IBAN</Label>
								<Input id="iban" bind:value={iban} type="text" />
							</div>
							<div class="space-y-2">
								<Label for="bankName">Bank Name</Label>
								<Input id="bankName" bind:value={bankName} type="text" />
							</div>
						</div>
					</div>
				</FormSection>

				<!-- Address -->
				<FormSection
					title="Address"
					description="Company address information"
					bind:completed={addressCompleted}
					defaultOpen={false}
				>
					<div class="space-y-4">
						<div class="space-y-2">
							<Label for="address">Address</Label>
							<Input id="address" bind:value={address} type="text" />
						</div>
						<div class="grid grid-cols-3 gap-4">
							<div class="space-y-2">
								<Label for="city">City</Label>
								<Input id="city" bind:value={city} type="text" />
							</div>
							<div class="space-y-2">
								<Label for="county">County (Județ)</Label>
								<Input id="county" bind:value={county} type="text" />
							</div>
							<div class="space-y-2">
								<Label for="postalCode">Postal Code</Label>
								<Input id="postalCode" bind:value={postalCode} type="text" />
							</div>
						</div>
						<div class="space-y-2">
							<Label for="country">Country</Label>
							<Input id="country" bind:value={country} type="text" />
						</div>
					</div>
				</FormSection>

				<!-- Notes -->
				<FormSection
					title="Notes"
					description="Additional notes about the client"
					bind:completed={notesCompleted}
					defaultOpen={false}
				>
					<div class="space-y-2">
						<Label for="notes">Notes</Label>
						<Textarea id="notes" bind:value={notes} placeholder="Additional notes about the client" />
					</div>
				</FormSection>

				{#if error}
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{error}</p>
					</div>
				{/if}

				<div class="flex items-center justify-end gap-4">
					<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/clients`)}>
						Cancel
					</Button>
					<Button type="submit" disabled={loading}>
						{loading ? 'Creating...' : 'Create Client'}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
