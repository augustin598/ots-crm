<script lang="ts">
	import '../layout.css';
	import { registerWithTenant } from '$lib/remotes/register.remote';
	import { getCompanyData } from '$lib/remotes/anaf.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Progress } from '$lib/components/ui/progress';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import UserIcon from '@lucide/svelte/icons/user';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import { untrack } from 'svelte';

	const invitationToken = $derived(page.url.searchParams.get('invite') || null);

	// Step management
	let currentStep = $state(1);
	const totalSteps = invitationToken ? 2 : 3;

	// Form fields
	let email = $state('');
	let firstName = $state('');
	let lastName = $state('');
	let password = $state('');
	let passwordConfirm = $state('');
	let tenantName = $state('');
	let tenantSlug = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let loadingAnaf = $state(false);
	let legalDataOpen = $state(false);

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

	// Validation states
	let emailError = $state<string | null>(null);
	let passwordError = $state<string | null>(null);
	let passwordConfirmError = $state<string | null>(null);
	let slugError = $state<string | null>(null);

	// Password strength calculation
	function calculatePasswordStrength(pwd: string): {
		strength: number;
		label: string;
		color: string;
	} {
		if (!pwd) return { strength: 0, label: '', color: 'bg-gray-300' };

		let strength = 0;
		if (pwd.length >= 8) strength += 1;
		if (pwd.length >= 12) strength += 1;
		if (/[a-z]/.test(pwd)) strength += 1;
		if (/[A-Z]/.test(pwd)) strength += 1;
		if (/[0-9]/.test(pwd)) strength += 1;
		if (/[^a-zA-Z0-9]/.test(pwd)) strength += 1;

		const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
		const colors = [
			'bg-red-500',
			'bg-orange-500',
			'bg-yellow-500',
			'bg-blue-500',
			'bg-green-500',
			'bg-green-600'
		];

		return {
			strength: Math.min(strength, 5),
			label: labels[Math.min(strength, 5)],
			color: colors[Math.min(strength, 5)]
		};
	}

	const passwordStrength = $derived(calculatePasswordStrength(password));
	const passwordsMatch = $derived(password && passwordConfirm && password === passwordConfirm);
	const passwordMismatch = $derived(passwordConfirm && password && password !== passwordConfirm);

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

	// Validation functions
	function validateEmail() {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!email) {
			emailError = 'Email is required';
			return false;
		}
		if (!emailRegex.test(email)) {
			emailError = 'Please enter a valid email address';
			return false;
		}
		emailError = null;
		return true;
	}

	function validatePassword() {
		if (!password) {
			passwordError = 'Password is required';
			return false;
		}
		if (password.length < 6) {
			passwordError = 'Password must be at least 6 characters';
			return false;
		}
		passwordError = null;
		return true;
	}

	function validatePasswordConfirm() {
		if (!passwordConfirm) {
			passwordConfirmError = 'Please confirm your password';
			return false;
		}
		if (password !== passwordConfirm) {
			passwordConfirmError = 'Passwords do not match';
			return false;
		}
		passwordConfirmError = null;
		return true;
	}

	function validateStep1() {
		return untrack(() => {
			return (
				validateEmail() &&
				firstName.trim() !== '' &&
				lastName.trim() !== '' &&
				validatePassword() &&
				validatePasswordConfirm()
			);
		});
	}

	function validateStep2() {
		return untrack(() => {
			if (invitationToken) return true;
			return tenantName.trim() !== '' && tenantSlug.trim() !== '';
		});
	}

	const canProceedToNextStep = $derived.by(() => {
		void firstName;
		void lastName;
		void email;
		void password;
		void passwordConfirm;
		void tenantName;
		void tenantSlug;
		void companyType;
		void cui;
		void registrationNumber;
		void tradeRegister;
		void vatNumber;
		void legalRepresentative;
		void iban;
		void bankName;
		void address;
		void city;
		void county;
		void postalCode;
		void country;

		if (currentStep === 1) return validateStep1();
		if (currentStep === 2) return validateStep2();
		return true;
	});

	function nextStep() {
		if (canProceedToNextStep && currentStep < totalSteps) {
			currentStep++;
			error = null;
		}
	}

	function prevStep() {
		if (currentStep > 1) {
			currentStep--;
			error = null;
		}
	}

	async function handleAnafLookup() {
		if (!cui) {
			error = 'Please enter a CUI first';
			return;
		}

		loadingAnaf = true;
		error = null;

		try {
			const data = await getCompanyData(cui);
			console.log(data);

			// Map ANAF data to form fields
			tenantName = data.denumire || tenantName;
			iban = data.iban || iban;
			companyType = data.forma_juridica || companyType;
			registrationNumber = data.nrRegCom || registrationNumber;
			tradeRegister = data.nrRegCom || tradeRegister;
			vatNumber = `${data.cui}`;


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
		// Final validation
		if (!validateStep1()) {
			currentStep = 1;
			return;
		}
		if (!validateStep2()) {
			currentStep = 2;
			return;
		}

		loading = true;
		error = null;

		try {
			const result = await registerWithTenant({
				email,
				firstName,
				lastName,
				password,
				passwordConfirm,
				tenantName: invitationToken ? undefined : tenantName,
				tenantSlug: invitationToken ? undefined : tenantSlug,
				invitationToken: invitationToken || undefined,
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

	const progressPercentage = $derived((currentStep / totalSteps) * 100);
</script>

<svelte:head>
	<title>Register - CRM</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<Card class="w-full max-w-3xl">
		<CardHeader class="space-y-1">
			<CardTitle class="text-2xl font-bold">Create Account</CardTitle>
			<CardDescription>Register your account and organization</CardDescription>
		</CardHeader>
		<CardContent>
			<!-- Progress Bar -->
			<div class="mb-6 space-y-2">
				<div class="mb-2 flex items-center justify-between text-sm text-muted-foreground">
					<span>Step {currentStep} of {totalSteps}</span>
					<span>{Math.round(progressPercentage)}% Complete</span>
				</div>
				<Progress value={progressPercentage} />
			</div>

			<!-- Stepper Navigation -->
			<div class="mb-8 flex items-center justify-between">
				<div class="flex items-center space-x-4">
					<!-- Step 1 -->
					<div class="flex items-center">
						<div
							class="flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors {currentStep >=
							1
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-gray-300 bg-white text-gray-400'}"
						>
							{#if currentStep > 1}
								<CheckIcon class="h-5 w-5" />
							{:else}
								<span class="text-sm font-semibold">1</span>
							{/if}
						</div>
						<div class="ml-3 hidden sm:block">
							<p
								class="text-sm font-medium {currentStep >= 1
									? 'text-foreground'
									: 'text-muted-foreground'}"
							>
								Account
							</p>
						</div>
					</div>
					<div class="h-px w-8 bg-gray-300" />
					<!-- Step 2 -->
					<div class="flex items-center">
						<div
							class="flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors {currentStep >=
							2
								? 'border-primary bg-primary text-primary-foreground'
								: currentStep === 2
									? 'border-primary bg-white text-primary'
									: 'border-gray-300 bg-white text-gray-400'}"
						>
							{#if currentStep > 2}
								<CheckIcon class="h-5 w-5" />
							{:else}
								<span class="text-sm font-semibold">2</span>
							{/if}
						</div>
						<div class="ml-3 hidden sm:block">
							<p
								class="text-sm font-medium {currentStep >= 2
									? 'text-foreground'
									: 'text-muted-foreground'}"
							>
								{invitationToken ? 'Complete' : 'Organization'}
							</p>
						</div>
					</div>
					{#if !invitationToken}
						<div class="h-px w-8 bg-gray-300" />
						<!-- Step 3 -->
						<div class="flex items-center">
							<div
								class="flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors {currentStep >=
								3
									? 'border-primary bg-primary text-primary-foreground'
									: currentStep === 3
										? 'border-primary bg-white text-primary'
										: 'border-gray-300 bg-white text-gray-400'}"
							>
								<span class="text-sm font-semibold">3</span>
							</div>
							<div class="ml-3 hidden sm:block">
								<p
									class="text-sm font-medium {currentStep >= 3
										? 'text-foreground'
										: 'text-muted-foreground'}"
								>
									Legal Data
								</p>
							</div>
						</div>
					{/if}
				</div>
			</div>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					if (currentStep < totalSteps) {
						nextStep();
					} else {
						handleSubmit();
					}
				}}
				class="space-y-6"
			>
				<!-- Step 1: User Account -->
				{#if currentStep === 1}
					<div class="space-y-4">
						<div class="mb-4 flex items-center gap-2">
							<UserIcon class="h-5 w-5 text-primary" />
							<h3 class="text-lg font-semibold">User Account Information</h3>
						</div>

						{#if invitationToken}
							<div class="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4">
								<div class="flex">
									<CheckCircle2Icon class="mt-0.5 mr-2 h-5 w-5 shrink-0 text-blue-600" />
									<div>
										<p class="text-sm font-medium text-blue-900">
											You're registering with an invitation
										</p>
										<p class="mt-1 text-sm text-blue-700">
											You'll be added to the organization automatically after registration.
										</p>
									</div>
								</div>
							</div>
						{/if}

						<div class="space-y-2">
							<Label for="email">Email Address <span class="text-destructive">*</span></Label>
							<Input
								id="email"
								bind:value={email}
								type="email"
								required
								autocomplete="email"
								placeholder="Enter your email"
								disabled={!!invitationToken}
								class={invitationToken ? 'bg-gray-50' : ''}
								onblur={validateEmail}
								aria-invalid={emailError ? 'true' : 'false'}
							/>
							{#if emailError}
								<p class="flex items-center gap-1 text-xs text-destructive">
									<AlertCircleIcon class="h-3 w-3" />
									{emailError}
								</p>
							{:else if invitationToken}
								<p class="text-xs text-muted-foreground">This email was used for your invitation</p>
							{/if}
						</div>

						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label for="firstName">First Name <span class="text-destructive">*</span></Label>
								<Input
									id="firstName"
									bind:value={firstName}
									type="text"
									required
									autocomplete="given-name"
									placeholder="Enter your first name"
								/>
							</div>
							<div class="space-y-2">
								<Label for="lastName">Last Name <span class="text-destructive">*</span></Label>
								<Input
									id="lastName"
									bind:value={lastName}
									type="text"
									required
									autocomplete="family-name"
									placeholder="Enter your last name"
								/>
							</div>
						</div>

						<div class="space-y-2">
							<Label for="password">Password <span class="text-destructive">*</span></Label>
							<Input
								id="password"
								bind:value={password}
								type="password"
								required
								autocomplete="new-password"
								placeholder="Create a password"
								onblur={validatePassword}
								aria-invalid={passwordError ? 'true' : 'false'}
							/>
							{#if passwordError}
								<p class="flex items-center gap-1 text-xs text-destructive">
									<AlertCircleIcon class="h-3 w-3" />
									{passwordError}
								</p>
							{:else if password}
								<div class="space-y-1">
									<div class="flex items-center justify-between text-xs">
										<span class="text-muted-foreground">Password strength:</span>
										<span
											class="font-medium"
											style="color: {passwordStrength.color.replace('bg-', '')}"
										>
											{passwordStrength.label}
										</span>
									</div>
									<div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
										<div
											class="h-full transition-all duration-300 {passwordStrength.color}"
											style="width: {(passwordStrength.strength / 5) * 100}%"
										></div>
									</div>
								</div>
							{/if}
						</div>

						<div class="space-y-2">
							<Label for="passwordConfirm"
								>Confirm Password <span class="text-destructive">*</span></Label
							>
							<Input
								id="passwordConfirm"
								bind:value={passwordConfirm}
								type="password"
								required
								autocomplete="new-password"
								placeholder="Confirm your password"
								onblur={validatePasswordConfirm}
								aria-invalid={passwordConfirmError || passwordMismatch ? 'true' : 'false'}
							/>
							{#if passwordConfirmError}
								<p class="flex items-center gap-1 text-xs text-destructive">
									<AlertCircleIcon class="h-3 w-3" />
									{passwordConfirmError}
								</p>
							{:else if passwordMismatch}
								<p class="flex items-center gap-1 text-xs text-destructive">
									<AlertCircleIcon class="h-3 w-3" />
									Passwords do not match
								</p>
							{:else if passwordsMatch}
								<p class="flex items-center gap-1 text-xs text-green-600">
									<CheckCircle2Icon class="h-3 w-3" />
									Passwords match
								</p>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Step 2: Organization Details -->
				{#if currentStep === 2 && !invitationToken}
					<div class="space-y-4">
						<div class="mb-4 flex items-center gap-2">
							<Building2Icon class="h-5 w-5 text-primary" />
							<h3 class="text-lg font-semibold">Organization Details</h3>
						</div>

						<div class="space-y-2">
							<Label for="tenantName"
								>Organization Name <span class="text-destructive">*</span></Label
							>
							<Input
								id="tenantName"
								bind:value={tenantName}
								type="text"
								required
								placeholder="Enter organization name"
							/>
						</div>

						<div class="space-y-2">
							<Label for="tenantSlug"
								>Organization Slug (URL) <span class="text-destructive">*</span></Label
							>
							<div class="flex items-center gap-2">
								<span class="text-sm whitespace-nowrap text-muted-foreground">crm.app/</span>
								<Input
									id="tenantSlug"
									bind:value={tenantSlug}
									type="text"
									required
									placeholder="organization-slug"
									class="flex-1"
								/>
							</div>
							<p class="text-xs text-muted-foreground">
								This will be used in your organization URL. You can customize it.
							</p>
						</div>
					</div>
				{/if}

				<!-- Step 3: Legal Data (Optional) -->
				{#if currentStep === 3 && !invitationToken}
					<div class="space-y-4">
						<div class="mb-4 flex items-center justify-between">
							<div class="flex items-center gap-2">
								<FileTextIcon class="h-5 w-5 text-primary" />
								<h3 class="text-lg font-semibold">Legal Data (Optional)</h3>
							</div>
							<Badge variant="outline">Optional</Badge>
						</div>

						<p class="mb-4 text-sm text-muted-foreground">
							You can add your organization's legal information now or update it later in settings.
						</p>

						<!-- CUI Lookup Section -->
						<Card class="border-primary/20">
							<CardHeader class="pb-3">
								<CardTitle class="text-base">Quick Fill from ANAF</CardTitle>
								<CardDescription class="text-xs">
									Enter your CUI to automatically fill in company information
								</CardDescription>
							</CardHeader>
							<CardContent class="space-y-3">
								<div class="flex gap-2">
									<Input
										bind:value={cui}
										type="text"
										placeholder="Enter CUI (Cod Unic de Înregistrare)"
										class="flex-1"
									/>
									<Button
										type="button"
										variant="outline"
										onclick={handleAnafLookup}
										disabled={loadingAnaf || !cui}
									>
										{loadingAnaf ? 'Loading...' : 'Lookup'}
									</Button>
								</div>
							</CardContent>
						</Card>

						<Collapsible bind:open={legalDataOpen} class="space-y-4">
							<CollapsibleTrigger
								class="flex w-full items-center justify-between rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
							>
								<span>Show Legal Data Fields</span>
								<ChevronRightIcon
									class="h-4 w-4 transition-transform {legalDataOpen ? 'rotate-90' : ''}"
								/>
							</CollapsibleTrigger>
							<CollapsibleContent class="space-y-4 pt-4">
								<div class="grid grid-cols-2 gap-4">
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
										<Input
											id="tradeRegister"
											bind:value={tradeRegister}
											type="text"
											placeholder="J40/1234/2020"
										/>
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
							</CollapsibleContent>
						</Collapsible>
					</div>
				{/if}

				<!-- Step 2 (Final) for invitations -->
				{#if currentStep === 2 && invitationToken}
					<div class="space-y-4">
						<div class="rounded-md border border-green-200 bg-green-50 p-4">
							<div class="flex">
								<CheckCircle2Icon class="mt-0.5 mr-2 h-5 w-5 shrink-0 text-green-600" />
								<div>
									<p class="text-sm font-medium text-green-900">Ready to complete registration</p>
									<p class="mt-1 text-sm text-green-700">
										Review your information above and click "Complete Registration" to finish.
									</p>
								</div>
							</div>
						</div>
					</div>
				{/if}

				{#if error}
					<div class="rounded-md border border-red-200 bg-red-50 p-4">
						<div class="flex">
							<AlertCircleIcon class="mt-0.5 mr-2 h-5 w-5 shrink-0 text-red-600" />
							<p class="text-sm text-red-800">{error}</p>
						</div>
					</div>
				{/if}

				<!-- Navigation Buttons -->
				<div class="flex items-center justify-between border-t pt-4">
					<div>
						{#if currentStep > 1}
							<Button type="button" variant="outline" onclick={prevStep} disabled={loading}>
								<ChevronLeftIcon class="mr-2 h-4 w-4" />
								Previous
							</Button>
						{:else}
							<a href="/login" class="text-sm text-blue-600 hover:underline">
								Already have an account? Login
							</a>
						{/if}
					</div>
					<Button type="submit" disabled={loading || !canProceedToNextStep}>
						{loading
							? 'Processing...'
							: currentStep < totalSteps
								? 'Next'
								: 'Complete Registration'}
						{#if currentStep < totalSteps}
							<ChevronRightIcon class="ml-2 h-4 w-4" />
						{/if}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
