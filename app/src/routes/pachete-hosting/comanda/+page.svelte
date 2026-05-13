<script lang="ts">
	import '../../layout.css';
	import {
		getPublicHostingPackages,
		validateCuiAndFetch,
		submitHostingOrder
	} from '$lib/remotes/public-hosting.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import Building2Icon from '@lucide/svelte/icons/building-2';

	const packagesQuery = getPublicHostingPackages();
	const packages = $derived(packagesQuery.current?.packages ?? []);
	const vatRate = $derived(packagesQuery.current?.vatRate ?? 21);
	const packageIdFromUrl = $derived(page.url.searchParams.get('package') ?? '');
	const selectedPackage = $derived(packages.find((p) => p.id === packageIdFromUrl));

	let step = $state(1);
	let cui = $state('');
	let email = $state('');
	let phone = $state('');
	let validating = $state(false);
	let cuiError = $state<string | null>(null);

	type AnafData = {
		cui: string;
		vatNumber: string;
		denumire: string;
		adresa: string;
		nrRegCom: string;
		telefon: string;
		codPostal: string;
		platitorTva: boolean;
		eFacturaActiv: boolean;
	};
	let anafData = $state<AnafData | null>(null);

	let editAddress = $state('');
	let editCompanyName = $state('');
	let consentTerms = $state(false);
	let submitting = $state(false);

	function isValidEmail(s: string): boolean {
		return /^[\w+-]+(?:\.[\w+-]+)*@[\da-z]+(?:[.-][\da-z]+)*\.[a-z]{2,}$/i.test(s);
	}

	async function verifyCui() {
		cuiError = null;
		if (!cui.trim()) {
			cuiError = 'Introdu un CUI.';
			return;
		}
		if (!email.trim()) {
			cuiError = 'Introdu un email valid înainte să verifici CUI.';
			return;
		}
		if (!isValidEmail(email.trim())) {
			cuiError = 'Format email invalid.';
			return;
		}
		validating = true;
		try {
			const res = await validateCuiAndFetch(cui);
			if (!res.valid) {
				cuiError = res.error;
				return;
			}
			anafData = res.data;
			editCompanyName = res.data.denumire;
			editAddress = res.data.adresa;
			if (!phone && res.data.telefon) phone = res.data.telefon;
			step = 2;
		} catch (e) {
			cuiError = e instanceof Error ? e.message : 'Eroare la verificare';
		} finally {
			validating = false;
		}
	}

	async function submitOrder() {
		if (!anafData || !selectedPackage) return;
		if (!email.trim() || !isValidEmail(email.trim())) {
			toast.error('Email-ul lipsește sau e invalid. Întoarce-te la pasul 1.');
			step = 1;
			return;
		}
		if (!consentTerms) {
			toast.error('Trebuie să accepți Termenii și politica GDPR.');
			return;
		}
		submitting = true;
		try {
			const result = await submitHostingOrder({
				hostingProductId: selectedPackage.id,
				cui: anafData.cui,
				email: email.trim(),
				phone: phone.trim() || undefined,
				companyName: editCompanyName.trim() || anafData.denumire,
				address: editAddress.trim() || undefined,
				registrationNumber: anafData.nrRegCom || undefined,
				postalCode: anafData.codPostal || undefined,
				vatPayer: anafData.platitorTva,
				consentTerms: true
			});

			if (result.duplicateCui) {
				toast.success(result.message);
				step = 4; // success message variant
				return;
			}

			// Redirect to Stripe Checkout
			if (result.checkoutUrl) {
				window.location.href = result.checkoutUrl;
				return;
			}
			toast.error('Stripe nu a returnat URL de checkout.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la trimitere');
		} finally {
			submitting = false;
		}
	}

	function fmtPrice(cents: number, currency: string): string {
		return (cents / 100).toLocaleString('ro-RO', { minimumFractionDigits: 0 }) + ' ' + currency;
	}
	function priceWithVat(cents: number): number {
		return Math.round(cents * (1 + vatRate / 100));
	}
	function billingCycleLabel(cycle: string): string {
		const m: Record<string, string> = {
			monthly: 'lunar',
			annually: 'anual',
			quarterly: 'trimestrial'
		};
		return m[cycle] ?? cycle;
	}
</script>

<svelte:head>
	<title>Comandă hosting — One Top Solution</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="min-h-screen bg-slate-50 dark:bg-slate-950">
	<header class="border-b bg-white dark:bg-slate-900">
		<div class="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
			<a href="/pachete-hosting" class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
				<ArrowLeftIcon class="size-4" /> Înapoi la pachete
			</a>
			<div class="text-sm font-medium">Pasul {step} / 3</div>
		</div>
	</header>

	<main class="mx-auto max-w-3xl px-4 py-8">
		{#if !selectedPackage}
			<Card>
				<CardContent class="py-10 text-center text-slate-500">
					Te rugăm să alegi un pachet din <a href="/pachete-hosting" class="text-primary underline">/pachete-hosting</a>.
				</CardContent>
			</Card>
		{:else}
			<!-- Sumar pachet (sticky pe toate pașii) -->
			<Card class="mb-6 border-primary/30 bg-primary/5">
				<CardContent class="py-4">
					<div class="flex items-center justify-between gap-4">
						<div>
							<p class="text-sm text-muted-foreground">Pachet ales</p>
							<p class="text-lg font-bold">
								{selectedPackage.name}
								{#if selectedPackage.highlightBadge}
									<span class="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
										{selectedPackage.highlightBadge}
									</span>
								{/if}
							</p>
						</div>
						<div class="text-right">
							<p class="text-2xl font-bold">{fmtPrice(selectedPackage.price, selectedPackage.currency)}</p>
							<p class="text-xs text-muted-foreground">
								{billingCycleLabel(selectedPackage.billingCycle)} · cu TVA {vatRate}%:
								<strong>{fmtPrice(priceWithVat(selectedPackage.price), selectedPackage.currency)}</strong>
							</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{#if step === 1}
				<Card>
					<CardHeader>
						<CardTitle>Identitate firmă</CardTitle>
						<p class="text-sm text-muted-foreground">
							Introdu CUI-ul firmei tale — datele complete le luăm automat de la ANAF.
						</p>
					</CardHeader>
					<CardContent class="space-y-4">
						<div>
							<Label for="cui">CUI *</Label>
							<div class="flex gap-2">
								<Input
									id="cui"
									bind:value={cui}
									placeholder="ex: RO12345678 sau 12345678"
									required
								/>
								<Button onclick={verifyCui} disabled={validating || !cui.trim()}>
									{#if validating}
										<LoaderIcon class="size-4 animate-spin" />
									{:else}
										Verifică ANAF
									{/if}
								</Button>
							</div>
							{#if cuiError}
								<p class="mt-1 text-sm text-destructive">{cuiError}</p>
							{/if}
						</div>
						<div>
							<Label for="email">Email *</Label>
							<Input id="email" type="email" bind:value={email} placeholder="ion@firma.ro" required />
						</div>
						<div>
							<Label for="phone">Telefon</Label>
							<Input id="phone" bind:value={phone} placeholder="07XX XXX XXX" />
						</div>
					</CardContent>
				</Card>
			{:else if step === 2 && anafData}
				<Card>
					<CardHeader>
						<CardTitle class="flex items-center gap-2">
							<CheckIcon class="size-5 text-green-600" />
							Date găsite la ANAF
						</CardTitle>
						<p class="text-sm text-muted-foreground">
							Verifică datele preluate automat și editează adresa dacă e cazul.
						</p>
					</CardHeader>
					<CardContent class="space-y-4">
						<div class="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">
							<div class="flex justify-between">
								<span class="text-muted-foreground">CUI:</span>
								<span class="font-medium">{anafData.vatNumber}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-muted-foreground">Reg. Comerțului:</span>
								<span class="font-medium">{anafData.nrRegCom || '—'}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-muted-foreground">Plătitor TVA:</span>
								<span class="font-medium">{anafData.platitorTva ? 'Da' : 'Nu'}</span>
							</div>
						</div>

						<div>
							<Label for="companyName">Denumire firmă *</Label>
							<Input id="companyName" bind:value={editCompanyName} required />
						</div>
						<div>
							<Label for="address">Adresă</Label>
							<Input id="address" bind:value={editAddress} placeholder="Str. ..." />
						</div>

						<div class="flex items-start gap-2 pt-2">
							<input id="consent" type="checkbox" bind:checked={consentTerms} class="mt-1" />
							<label for="consent" class="text-sm">
								Sunt de acord cu <a href="/termeni" class="text-primary underline" target="_blank">Termenii</a>
								și <a href="/gdpr" class="text-primary underline" target="_blank">politica GDPR</a>.
							</label>
						</div>

						<div class="flex justify-between gap-2 pt-4">
							<Button variant="outline" onclick={() => (step = 1)}>← Înapoi</Button>
							<Button onclick={() => (step = 3)} disabled={!consentTerms || !editCompanyName.trim()}>
								Continuă →
							</Button>
						</div>
					</CardContent>
				</Card>
			{:else if step === 3 && anafData}
				<Card>
					<CardHeader>
						<CardTitle class="flex items-center gap-2">
							<Building2Icon class="size-5" />
							Confirmare comandă
						</CardTitle>
					</CardHeader>
					<CardContent class="space-y-4">
						<div class="space-y-2 rounded-lg border bg-white p-4 dark:bg-slate-900">
							<div class="flex justify-between">
								<span>Pachet:</span>
								<span class="font-medium">{selectedPackage.name}</span>
							</div>
							<div class="flex justify-between">
								<span>Firmă:</span>
								<span class="font-medium">{editCompanyName}</span>
							</div>
							<div class="flex justify-between">
								<span>CUI:</span>
								<span class="font-medium">{anafData.vatNumber}</span>
							</div>
							<div class="flex justify-between">
								<span>Email:</span>
								<span class="font-medium">{email}</span>
							</div>
							<hr class="my-2" />
							<div class="flex justify-between">
								<span>Subtotal (fără TVA):</span>
								<span>{fmtPrice(selectedPackage.price, selectedPackage.currency)}</span>
							</div>
							<div class="flex justify-between">
								<span>TVA {vatRate}%:</span>
								<span>
									{fmtPrice(
										priceWithVat(selectedPackage.price) - selectedPackage.price,
										selectedPackage.currency
									)}
								</span>
							</div>
							<div class="flex justify-between text-lg font-bold">
								<span>TOTAL:</span>
								<span>{fmtPrice(priceWithVat(selectedPackage.price), selectedPackage.currency)}</span>
							</div>
							<p class="pt-2 text-xs text-muted-foreground">
								Facturare {billingCycleLabel(selectedPackage.billingCycle)}. Plata se procesează prin
								<strong>Stripe</strong> (carduri Visa/Mastercard). Vei primi factura proformă pe email.
							</p>
						</div>

						<div class="flex justify-between gap-2 pt-2">
							<Button variant="outline" onclick={() => (step = 2)}>← Înapoi</Button>
							<Button onclick={submitOrder} disabled={submitting} class="bg-green-600 hover:bg-green-700">
								{#if submitting}
									<LoaderIcon class="size-4 animate-spin" /> Se procesează...
								{:else}
									Plătește online →
								{/if}
							</Button>
						</div>
					</CardContent>
				</Card>
			{:else if step === 4}
				<Card>
					<CardContent class="py-10 text-center">
						<div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-green-100 text-green-600">
							<CheckIcon class="size-6" />
						</div>
						<h2 class="text-xl font-bold">Cerere primită</h2>
						<p class="mt-2 text-muted-foreground">
							Ți-am trimis pe email un link de acces în portalul client.
						</p>
						<Button class="mt-6" href="/pachete-hosting">Înapoi la pachete</Button>
					</CardContent>
				</Card>
			{/if}
		{/if}
	</main>
</div>
