<script lang="ts">
	import type { PageData } from './$types';
	import { updateTenantSettings } from '$lib/remotes/tenant-settings.remote';
	import { getCompanyData } from '$lib/remotes/anaf.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';

	let { data }: { data: PageData } = $props();

	let name = $state(data.tenant?.name || '');
	let slug = $state(data.tenant?.slug || '');
	let loading = $state(false);
	let loadingAnaf = $state(false);
	let error = $state<string | null>(null);

	// Romanian legal data
	let companyType = $state(data.tenant?.companyType || '');
	let cui = $state(data.tenant?.cui || '');
	let registrationNumber = $state(data.tenant?.registrationNumber || '');
	let tradeRegister = $state(data.tenant?.tradeRegister || '');
	let vatNumber = $state(data.tenant?.vatNumber || '');
	let legalRepresentative = $state(data.tenant?.legalRepresentative || '');
	let iban = $state(data.tenant?.iban || '');
	let bankName = $state(data.tenant?.bankName || '');
	let address = $state(data.tenant?.address || '');
	let city = $state(data.tenant?.city || '');
	let county = $state(data.tenant?.county || '');
	let postalCode = $state(data.tenant?.postalCode || '');
	let country = $state(data.tenant?.country || 'România');

	async function handleAnafLookup() {
		if (!cui) {
			error = 'Please enter a CUI first';
			return;
		}

		loadingAnaf = true;
		error = null;

		try {
			const anafData = await getCompanyData(cui);

			name = anafData.denumire || name;
			registrationNumber = anafData.nrRegCom || registrationNumber;
			iban = anafData.iban || iban;
			companyType = anafData.forma_juridica || companyType;

			if (anafData.adresa_sediu_social) {
				const addr = anafData.adresa_sediu_social;
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
			await updateTenantSettings({
				name,
				slug,
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
				country: country || undefined
			});
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update settings';
		} finally {
			loading = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="text-3xl font-bold">Organization Settings</h1>

	<Card>
		<CardHeader>
			<CardTitle>Organization Details</CardTitle>
			<CardDescription>Manage your organization information</CardDescription>
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
					<div class="space-y-2">
						<Label for="name">Organization Name *</Label>
						<Input id="name" bind:value={name} type="text" required />
					</div>
					<div class="space-y-2">
						<Label for="slug">Slug (URL) *</Label>
						<Input id="slug" bind:value={slug} type="text" required />
						<p class="text-xs text-gray-500">This is used in your organization URL</p>
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
				</div>

				{#if error}
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{error}</p>
					</div>
				{/if}

				<Button type="submit" disabled={loading}>
					{loading ? 'Saving...' : 'Save Settings'}
				</Button>
			</form>
		</CardContent>
	</Card>
</div>
