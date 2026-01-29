<script lang="ts">
	import {
		getClient,
		updateClient,
		getClients,
		getClientPartnerInfo,
		setClientPartnerStatus
	} from '$lib/remotes/clients.remote';
	import { getCompanyData } from '$lib/remotes/anaf.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Switch } from '$lib/components/ui/switch';
	import { untrack } from 'svelte';

	const tenantSlug = $derived(page.params.tenant);
	const clientId = $derived(page.params.clientId);

	const clientQuery = getClient(clientId);
	const client = $derived(clientQuery.current);
	const loading = $derived(clientQuery.loading);

	const partnerInfoQuery = $derived(getClientPartnerInfo(clientId));
	const partnerInfo = $derived(partnerInfoQuery.current);

	let name = $state('');
	let email = $state('');
	let phone = $state('');
	let saving = $state(false);
	let loadingAnaf = $state(false);
	let error = $state<string | null>(null);

	let isPartner = $state(false);

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

	$effect(() => {
		if (client) {
			name = client.name || '';
			email = client.email || '';
			phone = client.phone || '';
			companyType = client.companyType || '';
			cui = client.cui || '';
			registrationNumber = client.registrationNumber || '';
			tradeRegister = client.tradeRegister || '';
			vatNumber = client.vatNumber || '';
			legalRepresentative = client.legalRepresentative || '';
			iban = client.iban || '';
			bankName = client.bankName || '';
			address = client.address || '';
			city = client.city || '';
			county = client.county || '';
			postalCode = client.postalCode || '';
			country = client.country || 'România';
			notes = client.notes || '';
		}
	});

	$effect(() => {
		if (partnerInfo) {
			untrack(() => {
			isPartner = partnerInfo.isPartner;
			});
		}
	});

	async function handleAnafLookup() {
		if (!cui) {
			error = 'Please enter a CUI first';
			return;
		}

		loadingAnaf = true;
		error = null;

		try {
			const data = await getCompanyData(cui);
			name = data.denumire || name;
			registrationNumber = data.nrRegCom || registrationNumber;
			iban = data.iban || iban;
			companyType = data.forma_juridica || companyType;
			phone = data.telefon || phone;

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
		if (!clientId) return;

		saving = true;
		error = null;

		try {
			await updateClient({
				clientId,
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
			}).updates(clientQuery, getClient(clientId), getClients());

			await setClientPartnerStatus({
				clientId,
				isPartner
			});

			goto(`/${tenantSlug}/clients/${clientId}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update client';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Edit Client - CRM</title>
</svelte:head>

<div class="space-y-6">
	{#if loading}
		<p>Loading client...</p>
	{:else if client}
		<h1 class="text-3xl font-bold">Edit Client</h1>

		<Card>
			<CardHeader>
				<CardTitle>Client Information</CardTitle>
				<CardDescription>Update client details</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSubmit();
					}}
					class="space-y-6"
				>
					<div class="space-y-4">
						<h3 class="text-lg font-semibold">Basic Information</h3>
						<div class="space-y-2">
							<Label for="name">Name *</Label>
							<Input id="name" bind:value={name} type="text" required />
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label for="email">Email</Label>
								<Input id="email" bind:value={email} type="email" />
							</div>
							<div class="space-y-2">
								<Label for="phone">Phone</Label>
								<Input id="phone" bind:value={phone} type="tel" />
							</div>
						</div>
					</div>

					<Separator />

					<div class="space-y-4">
						<div class="flex items-center justify-between">
							<h3 class="text-lg font-semibold">Legal Data (Date Legale)</h3>
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
								<Input id="cui" bind:value={cui} type="text" />
							</div>
							<div class="space-y-2">
								<Label for="companyType">Company Type</Label>
								<Input id="companyType" bind:value={companyType} type="text" />
							</div>
							<div class="space-y-2">
								<Label for="registrationNumber">Registration Number</Label>
								<Input id="registrationNumber" bind:value={registrationNumber} type="text" />
							</div>
							<div class="space-y-2">
								<Label for="tradeRegister">Trade Register</Label>
								<Input id="tradeRegister" bind:value={tradeRegister} type="text" />
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

						<div class="flex items-center justify-between pt-2">
							<div class="space-y-0.5">
								<Label for="isPartner">Partner</Label>
								<p class="text-xs text-muted-foreground">
									{#if partnerInfo?.canBePartner}
										Share this client with tenant {partnerInfo.partnerTenantName}
									{:else}
										Set VAT number to match another tenant to enable partner sharing.
									{/if}
								</p>
							</div>
							<Switch
								id="isPartner"
								bind:checked={isPartner}
								disabled={!partnerInfo?.canBePartner}
							/>
						</div>
					</div>

					<Separator />

					<div class="space-y-2">
						<Label for="notes">Notes</Label>
						<Textarea id="notes" bind:value={notes} />
					</div>

					{#if error}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{error}</p>
						</div>
					{/if}

					<div class="flex items-center justify-end gap-4">
						<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/clients/${clientId}`)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving...' : 'Save Changes'}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	{/if}
</div>
