<script lang="ts">
	import { getMyRenewInvoice, createInvoicePaymentIntent } from '$lib/remotes/portal-hosting.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { page } from '$app/state';
	import {
		loadStripe,
		type Stripe as StripeJS,
		type StripeElements as StripeElementsT
	} from '@stripe/stripe-js';
	import { StripeElements } from '$lib/components/Stripe';
	import { PaymentElement } from '$lib/components/Stripe/PaymentElement';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';

	const accountId = $derived(page.params.accountId);
	const tenantSlug = $derived(page.params.tenant);

	const invoiceQuery = $derived(accountId ? getMyRenewInvoice(accountId) : null);
	const info = $derived(invoiceQuery?.current);
	const loadingInfo = $derived(invoiceQuery?.loading && !info);
	const infoError = $derived(invoiceQuery?.error);

	// 'paid' if the client returns from a Stripe 3DS redirect (?paid=1).
	type Stage = 'summary' | 'loadingIntent' | 'card' | 'confirming' | 'paid';
	let stage = $state<Stage>(page.url.searchParams.get('paid') === '1' ? 'paid' : 'summary');
	let errorMsg = $state<string | null>(null);

	let stripeJs = $state<StripeJS | null>(null);
	let stripeElements = $state<StripeElementsT | null>(null);
	let clientSecret = $state<string | null>(null);

	function fmtPrice(cents: number, currency: string): string {
		const value = (cents / 100).toLocaleString('ro-RO', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		});
		return `${value} ${currency}`;
	}

	function fmtDate(iso: string | Date | null | undefined): string {
		if (!iso) return '—';
		try {
			return new Date(iso).toLocaleDateString('ro-RO');
		} catch {
			return String(iso);
		}
	}

	async function startPayment() {
		if (!accountId) return;
		errorMsg = null;
		stage = 'loadingIntent';
		try {
			const res = await createInvoicePaymentIntent(accountId);
			if (res.alreadyPaid) {
				stage = 'paid';
				return;
			}
			clientSecret = res.clientSecret;
			const stripe = await loadStripe(res.publishableKey);
			if (!stripe) throw new Error('Nu s-a putut încărca formularul de plată.');
			stripeJs = stripe;
			stage = 'card';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'A apărut o eroare. Încearcă din nou.';
			stage = 'summary';
		}
	}

	async function confirmPayment() {
		if (!stripeJs || !stripeElements || !clientSecret) {
			errorMsg = 'Formularul de plată nu este pregătit. Reîncarcă pagina.';
			return;
		}
		errorMsg = null;
		stage = 'confirming';
		try {
			const returnUrl = `${window.location.origin}/client/${tenantSlug}/hosting/accounts/${accountId}/renew?paid=1`;
			const { error: confirmErr, paymentIntent } = await stripeJs.confirmPayment({
				elements: stripeElements,
				confirmParams: { return_url: returnUrl },
				redirect: 'if_required'
			});
			if (confirmErr) {
				errorMsg =
					confirmErr.message ||
					'Plata nu a putut fi confirmată. Verifică datele cardului și încearcă din nou.';
				stage = 'card';
				return;
			}
			// redirect:'if_required' → we reach here on success (or when 3DS isn't needed).
			if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
				stage = 'paid';
				return;
			}
			// requires_action → Stripe redirects the browser via return_url (handled on reload).
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'A apărut o eroare la confirmarea plății.';
			stage = 'card';
		}
	}
</script>

<div class="mx-auto max-w-2xl space-y-6">
	<Button variant="ghost" size="sm" href="/client/{tenantSlug}/hosting/accounts/{accountId}">
		<ArrowLeftIcon class="h-4 w-4" />
		Înapoi la cont
	</Button>

	{#if stage === 'paid'}
		<Card class="border-green-500/30 bg-green-500/5">
			<CardContent class="flex flex-col items-center gap-3 py-10 text-center">
				<CheckCircle2Icon class="h-12 w-12 text-green-600" />
				<h1 class="text-xl font-bold">Plată reușită</h1>
				<p class="text-muted-foreground max-w-md text-sm">
					Îți mulțumim! Plata a fost înregistrată. Factura va apărea ca achitată în scurt timp,
					iar contul de hosting rămâne activ.
				</p>
				<Button href="/client/{tenantSlug}/hosting/accounts/{accountId}" class="mt-2">
					Vezi contul
				</Button>
			</CardContent>
		</Card>
	{:else if loadingInfo}
		<Card class="animate-pulse">
			<CardHeader><div class="bg-muted h-7 w-64 rounded"></div></CardHeader>
			<CardContent><div class="bg-muted h-40 rounded"></div></CardContent>
		</Card>
	{:else if infoError || !info}
		<Card>
			<CardContent class="text-muted-foreground py-10 text-center">
				Factura nu a putut fi încărcată sau nu îți aparține.
			</CardContent>
		</Card>
	{:else if info.status === 'none'}
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<GlobeIcon class="h-5 w-5" />
					{info.domain}
				</CardTitle>
			</CardHeader>
			<CardContent class="space-y-2 text-sm">
				<p class="text-muted-foreground">
					Nu există nicio factură de plată pentru acest cont momentan.
				</p>
				<p>Următoarea scadență: <strong>{fmtDate(info.nextDueDate)}</strong></p>
			</CardContent>
		</Card>
	{:else}
		<div>
			<h1 class="flex items-center gap-2 text-2xl font-bold">
				<CreditCardIcon class="h-6 w-6" />
				Plată reînnoire hosting
			</h1>
			<p class="text-muted-foreground">
				{info.domain} · factura {info.invoiceLabel}
			</p>
		</div>

		<Card>
			<CardHeader><CardTitle>Detalii plată</CardTitle></CardHeader>
			<CardContent class="space-y-2 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Scadență</span>
					<span class="font-medium">{fmtDate(info.dueDate)}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Sumă fără TVA</span>
					<span>{fmtPrice(info.net, info.currency)}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">TVA</span>
					<span>{fmtPrice(info.vat, info.currency)}</span>
				</div>
				<div class="flex justify-between border-t pt-2 text-base font-bold">
					<span>Total de plată</span>
					<span>{fmtPrice(info.total, info.currency)}</span>
				</div>
			</CardContent>
		</Card>

		{#if errorMsg}
			<div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
				{errorMsg}
			</div>
		{/if}

		{#if stage === 'summary'}
			<Button class="w-full" size="lg" onclick={startPayment}>
				Plătește cu cardul {fmtPrice(info.total, info.currency)}
			</Button>
		{:else if stage === 'loadingIntent'}
			<Button class="w-full" size="lg" disabled>Se pregătește plata…</Button>
		{:else if stage === 'card' || stage === 'confirming'}
			<Card>
				<CardContent class="pt-6">
					<StripeElements bind:elements={stripeElements} stripe={stripeJs} {clientSecret}>
						<PaymentElement />
					</StripeElements>
					<Button
						class="mt-4 w-full"
						size="lg"
						onclick={confirmPayment}
						disabled={stage === 'confirming'}
					>
						{stage === 'confirming'
							? 'Se procesează…'
							: `Confirmă plata ${fmtPrice(info.total, info.currency)}`}
					</Button>
					<p class="text-muted-foreground mt-3 text-center text-xs">
						Plată securizată prin Stripe. Datele cardului nu ajung pe serverele noastre.
					</p>
				</CardContent>
			</Card>
		{/if}
	{/if}
</div>
