<script lang="ts">
	import { page } from '$app/state';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { createPublicInvoicePaymentIntent } from '$lib/remotes/public-invoice.remote';
	import {
		loadStripe,
		type Stripe as StripeJS,
		type StripeElements as StripeElementsT
	} from '@stripe/stripe-js';
	import { StripeElements } from '$lib/components/Stripe';
	import { PaymentElement } from '$lib/components/Stripe/PaymentElement';

	const data = $derived(page.data as any);
	const invoice = $derived(data.invoice);
	const lineItems = $derived(data.lineItems || []);
	const tenant = $derived(data.tenant);
	const client = $derived(data.client);
	const canPayByCard = $derived(data.canPayByCard === true);

	const tenantSlug = $derived(page.params.tenant);
	const token = $derived(page.params.token);
	const displayIban = $derived(invoice.currency === 'EUR' && tenant.ibanEuro ? tenant.ibanEuro : tenant.iban);
	const ibanLabel = $derived(invoice.currency === 'EUR' && tenant.ibanEuro ? 'EUR' : 'LEI');

	function formatDate(dateStr: string | null) {
		if (!dateStr) return '-';
		return new Date(dateStr).toLocaleDateString('ro-RO', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}

	function getStatusLabel(status: string) {
		const map: Record<string, string> = {
			draft: 'Ciorna',
			sent: 'Trimisa',
			paid: 'Platita',
			overdue: 'Restanta',
			cancelled: 'Anulata'
		};
		return map[status] || status;
	}

	function getStatusColor(status: string) {
		const map: Record<string, string> = {
			draft: 'bg-gray-100 text-gray-700',
			sent: 'bg-blue-100 text-blue-700',
			paid: 'bg-green-100 text-green-700',
			overdue: 'bg-red-100 text-red-700',
			cancelled: 'bg-gray-100 text-gray-500'
		};
		return map[status] || 'bg-gray-100 text-gray-700';
	}

	let downloading = $state(false);

	// ─── Plată cu cardul ──────────────────────────────────────────────────────
	// `?paid=1` = întoarcere din redirectul 3DS; `?pay=1` = venit din butonul de email.
	type PayStage = 'summary' | 'loadingIntent' | 'card' | 'confirming' | 'paid' | 'alreadyPaid';
	let payStage = $state<PayStage>(page.url.searchParams.get('paid') === '1' ? 'paid' : 'summary');
	let payError = $state<string | null>(null);
	let stripeJs = $state<StripeJS | null>(null);
	let stripeElements = $state<StripeElementsT | null>(null);
	let clientSecret = $state<string | null>(null);
	// Plain let, nu $state: e un latch, nu trebuie să retrigereze efectul.
	let autoStarted = false;

	async function startPayment() {
		// Capturate local: `page.params` e `string | undefined`, iar narrowing-ul nu
		// supraviețuiește peste await.
		const slug = tenantSlug;
		const tok = token;
		if (!slug || !tok) {
			payError = 'Link invalid. Reincarcati pagina din emailul primit.';
			return;
		}
		payError = null;
		payStage = 'loadingIntent';
		try {
			const res = await createPublicInvoicePaymentIntent({ tenantSlug: slug, token: tok });
			if (res.alreadyPaid) {
				payStage = 'alreadyPaid';
				return;
			}
			clientSecret = res.clientSecret;
			const stripe = await loadStripe(res.publishableKey);
			if (!stripe) throw new Error('Nu s-a putut incarca formularul de plata.');
			stripeJs = stripe;
			payStage = 'card';
		} catch (e) {
			payError = e instanceof Error ? e.message : 'A aparut o eroare. Incercati din nou.';
			payStage = 'summary';
		}
	}

	async function confirmPayment() {
		if (!stripeJs || !stripeElements || !clientSecret) {
			payError = 'Formularul de plata nu este pregatit. Reincarcati pagina.';
			return;
		}
		payError = null;
		payStage = 'confirming';
		try {
			const returnUrl = `${window.location.origin}/invoice/${tenantSlug}/${token}?paid=1`;
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
				payStage = 'card';
				return;
			}
			if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
				payStage = 'paid';
				return;
			}
			// requires_action → Stripe redirectează browserul prin return_url.
		} catch (e) {
			payError = e instanceof Error ? e.message : 'A aparut o eroare la confirmarea platii.';
			payStage = 'card';
		}
	}

	$effect(() => {
		// Butonul din email (`?pay=1`) duce direct în formularul de card. Latch-ul
		// `autoStarted` face efectul one-shot; nu citim `payStage` aici, tocmai ca
		// efectul să nu depindă de starea pe care o scrie.
		if (autoStarted) return;
		if (canPayByCard && page.url.searchParams.get('pay') === '1') {
			autoStarted = true;
			startPayment();
		}
	});

	async function handleDownloadPDF() {
		downloading = true;
		try {
			const response = await fetch(`/invoice/${tenantSlug}/${token}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Factura-${invoice.invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			alert('Eroare la descarcarea PDF-ului. Va rugam incercati din nou.');
		} finally {
			downloading = false;
		}
	}
</script>

<svelte:head>
	<title>Factura {invoice.invoiceNumber} - {tenant.name}</title>
</svelte:head>

<div class="min-h-screen bg-gray-50">
	<div class="mx-auto max-w-3xl px-4 py-8">
		<!-- Header -->
		<div class="mb-6 text-center">
			{#if tenant.invoiceLogo}
				<img src={tenant.invoiceLogo} alt={tenant.name} class="mx-auto h-16 object-contain" />
			{:else}
				<h1 class="text-2xl font-bold text-gray-900">{tenant.name}</h1>
			{/if}
		</div>

		<!-- Invoice Card -->
		<div class="rounded-lg border bg-white shadow-sm">
			<!-- Invoice Header -->
			<div class="border-b p-6">
				<div class="flex items-start justify-between">
					<div>
						<h2 class="text-xl font-semibold text-gray-900">
							Factura {invoice.invoiceNumber}
						</h2>
						<p class="mt-1 text-sm text-gray-500">Client: {client.name}</p>
					</div>
					<span class="inline-flex rounded-full px-3 py-1 text-sm font-medium {getStatusColor(invoice.status)}">
						{getStatusLabel(invoice.status)}
					</span>
				</div>
			</div>

			<!-- Invoice Details -->
			<div class="grid grid-cols-2 gap-4 border-b p-6 sm:grid-cols-4">
				<div>
					<p class="text-xs font-medium uppercase text-gray-500">Suma totala</p>
					<p class="mt-1 text-lg font-semibold text-gray-900">
						{formatAmount(invoice.totalAmount, invoice.currency as Currency)}
					</p>
				</div>
				<div>
					<p class="text-xs font-medium uppercase text-gray-500">Data emitere</p>
					<p class="mt-1 text-sm text-gray-900">{formatDate(invoice.issueDate)}</p>
				</div>
				<div>
					<p class="text-xs font-medium uppercase text-gray-500">Data scadenta</p>
					<p class="mt-1 text-sm {invoice.status === 'overdue' ? 'font-semibold text-red-600' : 'text-gray-900'}">
						{formatDate(invoice.dueDate)}
					</p>
				</div>
				<div>
					<p class="text-xs font-medium uppercase text-gray-500">Moneda</p>
					<p class="mt-1 text-sm text-gray-900">{invoice.currency}</p>
				</div>
			</div>

			<!-- Line Items -->
			{#if lineItems.length > 0}
				{@const hasTax = invoice.taxApplicationType === 'apply' || (!invoice.taxApplicationType && invoice.taxAmount > 0)}
				{@const itemCurrency = (lineItems[0]?.currency || invoice.invoiceCurrency || invoice.currency) as Currency}
				<div class="border-b p-6">
					<h3 class="mb-3 text-sm font-medium uppercase text-gray-500">Detalii</h3>
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b text-left text-xs uppercase text-gray-500">
									<th class="pb-2 pr-4">Descriere</th>
									<th class="pb-2 pr-4 text-right">Cantitate</th>
									<th class="pb-2 pr-4 text-right">Pret unitar</th>
									<th class="pb-2 pr-4 text-right">Valoare</th>
									{#if hasTax}
										<th class="pb-2 pr-4 text-right">TVA</th>
									{/if}
									<th class="pb-2 text-right">Total</th>
								</tr>
							</thead>
							<tbody>
								{#each lineItems as item, i (i)}
									{@const vatRate = item.taxRate ? item.taxRate / 100 : 0}
									{@const itemNet = item.amount || item.rate * item.quantity}
									{@const itemVat = hasTax ? Math.round(itemNet * vatRate / 100) : 0}
									{@const itemTotal = itemNet + itemVat}
									{@const curr = (item.currency || invoice.invoiceCurrency || invoice.currency) as Currency}
									<tr class="border-b last:border-0">
										<td class="py-2 pr-4">
											{item.description}
											{#if item.note}
												<p class="mt-0.5 text-xs text-gray-400 italic">{item.note}</p>
											{/if}
										</td>
										<td class="py-2 pr-4 text-right">
											{item.quantity}{item.unitOfMeasure ? ` ${item.unitOfMeasure}` : ''}
										</td>
										<td class="py-2 pr-4 text-right">
											{formatAmount(item.rate, curr)}
										</td>
										<td class="py-2 pr-4 text-right">
											{formatAmount(itemNet, curr)}
										</td>
										{#if hasTax}
											<td class="py-2 pr-4 text-right text-gray-500">
												{vatRate > 0 ? `${vatRate}%` : '-'}
											</td>
										{/if}
										<td class="py-2 text-right font-medium">
											{formatAmount(itemTotal, curr)}
										</td>
									</tr>
								{/each}
							</tbody>
							<tfoot>
								<tr class="border-t">
									<td colspan={hasTax ? 5 : 4} class="py-2 pr-4 text-right text-xs uppercase text-gray-500">Subtotal</td>
									<td class="py-2 text-right font-medium">{formatAmount(invoice.amount, itemCurrency)}</td>
								</tr>
								{#if hasTax}
									<tr>
										<td colspan="5" class="py-1 pr-4 text-right text-xs uppercase text-gray-500">TVA</td>
										<td class="py-1 text-right font-medium">{formatAmount(invoice.taxAmount, itemCurrency)}</td>
									</tr>
								{/if}
								<tr class="border-t">
									<td colspan={hasTax ? 5 : 4} class="py-2 pr-4 text-right text-sm font-semibold uppercase text-gray-700">Total de plata</td>
									<td class="py-2 text-right text-lg font-bold text-gray-900">{formatAmount(invoice.totalAmount, itemCurrency)}</td>
								</tr>
							</tfoot>
						</table>
					</div>
				</div>
			{/if}

			<!-- Notes -->
			{#if invoice.notes}
				<div class="border-b p-6">
					<h3 class="mb-2 text-sm font-medium uppercase text-gray-500">Observatii</h3>
					<p class="text-sm text-gray-700">{invoice.notes}</p>
				</div>
			{/if}

			<!-- Actions -->
			<div class="p-6">
				<button
					onclick={handleDownloadPDF}
					disabled={downloading}
					class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
				>
					{#if downloading}
						<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
							<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25"></circle>
							<path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
						</svg>
						Se descarca...
					{:else}
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"></path>
						</svg>
						Descarca PDF
					{/if}
				</button>
			</div>
		</div>

		<!-- Card payment -->
		{#if canPayByCard || payStage === 'paid' || payStage === 'alreadyPaid'}
			<div class="mt-6 rounded-lg border bg-white p-6 shadow-sm print:hidden">
				{#if payStage === 'paid'}
					<div class="flex items-start gap-3">
						<svg
							class="mt-0.5 h-6 w-6 shrink-0 text-green-600"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
							<path d="M22 4L12 14.01l-3-3"></path>
						</svg>
						<div>
							<h3 class="text-base font-semibold text-gray-900">Plata a fost inregistrata</h3>
							<p class="mt-1 text-sm text-gray-600">
								Va multumim! Factura va aparea ca achitata in scurt timp.
							</p>
						</div>
					</div>
				{:else if payStage === 'alreadyPaid'}
					<h3 class="text-base font-semibold text-gray-900">Factura este deja achitata</h3>
					<p class="mt-1 text-sm text-gray-600">
						Nu mai este nimic de plata pentru aceasta factura.
					</p>
				{:else}
					<h3 class="mb-1 text-base font-semibold text-gray-900">Plata cu cardul</h3>
					<p class="mb-4 text-sm text-gray-500">
						Plata securizata prin Stripe. Datele cardului nu ajung pe serverele noastre.
					</p>

					{#if payError}
						<div
							class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
							role="alert"
						>
							{payError}
						</div>
					{/if}

					{#if payStage === 'summary' || payStage === 'loadingIntent'}
						<button
							onclick={startPayment}
							disabled={payStage === 'loadingIntent'}
							class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 sm:w-auto"
						>
							{#if payStage === 'loadingIntent'}
								<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25"></circle>
									<path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" class="opacity-75"></path>
								</svg>
								Se pregateste plata...
							{:else}
								<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
									<rect x="2" y="5" width="20" height="14" rx="2"></rect>
									<path d="M2 10h20"></path>
								</svg>
								Plateste cu cardul {formatAmount(invoice.totalAmount, invoice.currency as Currency)}
							{/if}
						</button>
					{:else if payStage === 'card' || payStage === 'confirming'}
						<StripeElements bind:elements={stripeElements} stripe={stripeJs} {clientSecret}>
							<PaymentElement />
						</StripeElements>
						<button
							onclick={confirmPayment}
							disabled={payStage === 'confirming'}
							class="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"
						>
							{payStage === 'confirming'
								? 'Se proceseaza...'
								: `Confirma plata ${formatAmount(invoice.totalAmount, invoice.currency as Currency)}`}
						</button>
					{/if}
				{/if}
			</div>
		{/if}

		<!-- Payment Info -->
		{#if displayIban}
			<div class="mt-6 rounded-lg border bg-white p-6 shadow-sm">
				<h3 class="mb-3 text-sm font-medium uppercase text-gray-500">
					{canPayByCard ? 'Sau plata prin transfer bancar' : 'Date plata'}
				</h3>
				<div class="space-y-1 text-sm text-gray-700">
					<p><span class="font-medium">Beneficiar:</span> {tenant.name}</p>
					<p><span class="font-medium">IBAN ({ibanLabel}):</span> {displayIban}</p>
					{#if tenant.bankName}
						<p><span class="font-medium">Banca:</span> {tenant.bankName}</p>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Footer -->
		<div class="mt-6 text-center text-xs text-gray-400">
			<p>Daca ati efectuat deja plata, va rugam sa ignorati acest mesaj.</p>
			<p class="mt-1">Pentru intrebari, contactati-ne la {tenant.email || tenant.name}.</p>
		</div>
	</div>
</div>
