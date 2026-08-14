<script lang="ts">
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import {
		loadStripe,
		type Stripe as StripeJS,
		type StripeElements as StripeElementsT
	} from '@stripe/stripe-js';
	import { StripeElements } from '$lib/components/Stripe';
	import { PaymentElement } from '$lib/components/Stripe/PaymentElement';
	import CheckoutModalShell from '$lib/components/checkout-modal-shell.svelte';

	/**
	 * Modalul de plată cu cardul pentru o factură DEJA EMISĂ — partajat de pagina
	 * publică de factură (`/invoice/{slug}/{token}`) și de portalul clientului
	 * (`/client/{slug}/invoices`). Părintele decide DE UNDE vine PaymentIntent-ul
	 * (remote public cu token vs. remote de portal cu sesiune) prin `createIntent`;
	 * tot ce e după — Elements, confirmare, stările de succes — e identic și
	 * trăiește aici ca să nu poată diverge.
	 *
	 * Plata stă într-un modal, nu inline în pagină: formularul Stripe (~640px,
	 * randat în iframe care crește în trepte după mount) ajungea sub fold, iar
	 * modalul e centrat în viewport prin construcție. Același pattern ca la
	 * checkout-ul de hosting (`hosting-checkout-modal.svelte`).
	 *
	 * Montarea pornește imediat crearea PaymentIntent-ului — părintele randează
	 * componenta doar când userul a cerut plata (`{#if ...}`).
	 */

	type IntentResult =
		| { alreadyPaid: true }
		| { alreadyPaid: false; clientSecret: string; publishableKey: string };

	let {
		invoiceLabel,
		totalAmount,
		currency,
		createIntent,
		returnUrl,
		onClose,
		onOutcome,
		onFailedClose
	}: {
		/** Eticheta afișată („OTSH 8") — doar pentru UI, suma reală vine din server. */
		invoiceLabel: string;
		/** Suma în subunități (bani), pentru afișare pe butoane. */
		totalAmount: number;
		currency: Currency;
		/** Obține PaymentIntent-ul de la remote-ul potrivit (public sau portal). */
		createIntent: () => Promise<IntentResult>;
		/** URL absolut la care Stripe redirectează după 3DS. */
		returnUrl: string;
		/** Părintele scoate componenta din DOM (`{#if}`). */
		onClose: () => void;
		/** Anunță pagina că factura e plătită / era deja plătită. */
		onOutcome?: (outcome: 'paid' | 'alreadyPaid') => void;
		/**
		 * Închidere din stadiul `failed`: pagina primește mesajul ca să-l poată
		 * afișa persistent (altfel eroarea ar dispărea odată cu modalul, iar
		 * clientul ar rămâne fără explicație — ex. rate limit 429).
		 */
		onFailedClose?: (message: string) => void;
	} = $props();

	type PayStage = 'loadingIntent' | 'card' | 'confirming' | 'paid' | 'alreadyPaid' | 'failed';
	let stage = $state<PayStage>('loadingIntent');
	let payError = $state<string | null>(null);
	let stripeJs = $state<StripeJS | null>(null);
	let stripeElements = $state<StripeElementsT | null>(null);
	let clientSecret = $state<string | null>(null);

	/**
	 * Blocăm închiderea DOAR cât Stripe procesează efectiv plata. În
	 * `loadingIntent` nu s-a încasat nimic (PaymentIntent-ul doar așteaptă), iar
	 * dacă ascundem butonul „Închide" în acel moment modalul se deschide fără
	 * niciun element focusabil — focus trap-ul n-are ce focusa.
	 */
	const canClose = $derived(stage !== 'confirming');

	function requestClose() {
		if (!canClose) return;
		if (stage === 'failed' && payError) onFailedClose?.(payError);
		onClose();
	}

	$effect(() => {
		// Blocăm derularea paginii din spate cât timp modalul e deschis.
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});

	async function start() {
		payError = null;
		stage = 'loadingIntent';
		try {
			const res = await createIntent();
			if (res.alreadyPaid) {
				stage = 'alreadyPaid';
				onOutcome?.('alreadyPaid');
				return;
			}
			clientSecret = res.clientSecret;
			const stripe = await loadStripe(res.publishableKey);
			if (!stripe) throw new Error('Nu s-a putut incarca formularul de plata.');
			stripeJs = stripe;
			stage = 'card';
		} catch (e) {
			payError = e instanceof Error ? e.message : 'A aparut o eroare. Incercati din nou.';
			stage = 'failed';
		}
	}

	async function confirmPayment() {
		// Guard în loc de `disabled` pe buton: dezactivarea elementului focusat îl
		// blurează pe `document.body`, iar focus trap-ul (care ascultă pe overlay)
		// ar înceta să prindă Tab — focusul ar evada în pagina din spate exact cât
		// timp „Închide" e și el ascuns. Butonul rămâne focusabil, dublu-click = no-op.
		if (stage === 'confirming') return;
		if (!stripeJs || !stripeElements || !clientSecret) {
			payError = 'Formularul de plata nu este pregatit. Reincarcati pagina.';
			return;
		}
		payError = null;
		stage = 'confirming';
		try {
			const { error: confirmErr, paymentIntent } = await stripeJs.confirmPayment({
				elements: stripeElements,
				confirmParams: { return_url: returnUrl },
				redirect: 'if_required'
			});
			if (confirmErr) {
				// Al doilea tab care încearcă același PaymentIntent primește o eroare de
				// stare — pentru client asta înseamnă „s-a plătit deja", nu o defecțiune.
				payError =
					confirmErr.code === 'payment_intent_unexpected_state'
						? 'Aceasta factura pare sa fi fost deja platita.'
						: confirmErr.message ||
							'Plata nu a putut fi confirmata. Verificati datele cardului si incercati din nou.';
				stage = 'card';
				return;
			}
			if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
				stage = 'paid';
				onOutcome?.('paid');
				return;
			}
			// requires_action → Stripe redirectează browserul prin return_url.
		} catch (e) {
			payError = e instanceof Error ? e.message : 'A aparut o eroare la confirmarea platii.';
			stage = 'card';
		}
	}

	// Componenta se montează doar client-side, când userul a cerut plata — pornim
	// direct fluxul, fără pas intermediar.
	start();
</script>

<CheckoutModalShell onClose={requestClose} {canClose}>
	<div class="mb-5">
		<h2 class="text-lg font-semibold text-gray-900">
			Plata factura {invoiceLabel}
		</h2>
		<p class="mt-1 text-sm text-gray-500">
			Total de plata <span class="font-semibold text-gray-900">{formatAmount(totalAmount, currency)}</span>
		</p>
	</div>

	{#if payError}
		<div
			class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
			role="alert"
		>
			{payError}
		</div>
	{/if}

	{#if stage === 'loadingIntent'}
		<div class="flex items-center justify-center gap-3 py-10 text-sm text-gray-500">
			<svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25"></circle>
				<path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
			</svg>
			Se pregateste plata...
		</div>
	{:else if stage === 'card' || stage === 'confirming'}
		<StripeElements bind:elements={stripeElements} stripe={stripeJs} {clientSecret}>
			<PaymentElement />
		</StripeElements>
	{:else if stage === 'failed'}
		<div class="flex flex-col items-center gap-3 py-4 text-center">
			<button
				onclick={start}
				class="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
			>
				Incearca din nou
			</button>
		</div>
	{:else if stage === 'paid'}
		<div class="flex flex-col items-center gap-3 py-6 text-center">
			<svg
				class="h-12 w-12 text-green-600"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
				<path d="M22 4L12 14.01l-3-3"></path>
			</svg>
			<h3 class="text-lg font-semibold text-gray-900">Plata a fost inregistrata</h3>
			<p class="max-w-sm text-sm text-gray-600">
				Va multumim! Factura va aparea ca achitata in scurt timp.
			</p>
			<button
				onclick={requestClose}
				class="mt-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
			>
				Inchide
			</button>
		</div>
	{:else if stage === 'alreadyPaid'}
		<div class="py-6 text-center">
			<h3 class="text-lg font-semibold text-gray-900">Factura este deja achitata</h3>
			<p class="mt-1 text-sm text-gray-600">
				Nu mai este nimic de plata pentru aceasta factura.
			</p>
			<button
				onclick={requestClose}
				class="mt-4 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
			>
				Inchide
			</button>
		</div>
	{/if}

	{#snippet footer()}
		{#if stage === 'card' || stage === 'confirming'}
			<button
				onclick={confirmPayment}
				aria-disabled={stage === 'confirming'}
				aria-busy={stage === 'confirming'}
				class="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 {stage === 'confirming' ? 'opacity-50' : ''}"
			>
				{stage === 'confirming'
					? 'Se proceseaza...'
					: `Confirma plata ${formatAmount(totalAmount, currency)}`}
			</button>
			<p class="mt-2 text-center text-xs text-gray-500">
				Datele cardului nu ajung pe serverele noastre.
			</p>
		{/if}
	{/snippet}
</CheckoutModalShell>
