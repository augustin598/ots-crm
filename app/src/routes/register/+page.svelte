<script lang="ts">
	import '../layout.css';
	import { registerWithTenant } from '$lib/remotes/register.remote';
	import { getCompanyData } from '$lib/remotes/anaf.remote';
	import { goto } from '$app/navigation';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';

	let username = $state('');
	let password = $state('');
	let passwordConfirm = $state('');
	let tenantName = $state('');
	let tenantSlug = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let loadingAnaf = $state(false);

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

	// Auto-generate slug from tenant name
	$effect(() => {
		if (tenantName && !tenantSlug) {
			tenantSlug = tenantName
				.toLowerCase()
				.trim()
				.replace(/[\s_]+/g, '-')
				.replace(/[^\w\-]+/g, '')
				.replace(/-+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 255);
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
			
			// Map ANAF data to form fields
			tenantName = data.denumire || tenantName;
			registrationNumber = data.nrRegCom || registrationNumber;
			iban = data.iban || iban;
			companyType = data.forma_juridica || companyType;
			
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
			const result = await registerWithTenant({
				username,
				password,
				passwordConfirm,
				tenantName,
				tenantSlug,
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

			if (result.success && result.tenantSlug) {
				goto(`/${result.tenantSlug}`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Registration failed';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Register - CRM</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<Card class="w-full max-w-2xl">
		<CardHeader class="space-y-1">
			<CardTitle class="text-2xl font-bold">Create Account</CardTitle>
			<CardDescription>Register your account and organization</CardDescription>
		</CardHeader>
		<CardContent>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-6"
			>
				<!-- User Account Section -->
				<div class="space-y-4">
					<h3 class="text-lg font-semibold">User Account</h3>
					<div class="space-y-2">
						<Label for="username">Username</Label>
						<Input
							id="username"
							bind:value={username}
							type="text"
							required
							autocomplete="username"
							placeholder="Enter your username"
						/>
					</div>
					<div class="space-y-2">
						<Label for="password">Password</Label>
						<Input
							id="password"
							bind:value={password}
							type="password"
							required
							autocomplete="new-password"
							placeholder="Enter your password"
						/>
					</div>
					<div class="space-y-2">
						<Label for="passwordConfirm">Confirm Password</Label>
						<Input
							id="passwordConfirm"
							bind:value={passwordConfirm}
							type="password"
							required
							autocomplete="new-password"
							placeholder="Confirm your password"
						/>
					</div>
				</div>

				<Separator />

				<!-- Organization Section -->
				<div class="space-y-4">
					<h3 class="text-lg font-semibold">Organization Details</h3>
					<div class="space-y-2">
						<Label for="tenantName">Organization Name</Label>
						<Input
							id="tenantName"
							bind:value={tenantName}
							type="text"
							required
							placeholder="Enter organization name"
						/>
					</div>
					<div class="space-y-2">
						<Label for="tenantSlug">Organization Slug (URL)</Label>
						<Input
							id="tenantSlug"
							bind:value={tenantSlug}
							type="text"
							required
							placeholder="organization-slug"
						/>
						<p class="text-xs text-gray-500">This will be used in your organization URL</p>
					</div>
				</div>

				<Separator />

				<!-- Romanian Legal Data Section -->
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
							<Input id="cui" bind:value={cui} type="text" placeholder="Cod Unic de Înregistrare" />
						</div>
						<div class="space-y-2">
							<Label for="companyType">Company Type</Label>
							<Input
								id="companyType"
								bind:value={companyType}
								type="text"
								placeholder="SRL, SA, PFA, etc."
							/>
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

				<div class="flex items-center justify-between">
					<a href="/login" class="text-sm text-blue-600 hover:underline">Already have an account? Login</a>
					<Button type="submit" disabled={loading}>
						{loading ? 'Registering...' : 'Register'}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
