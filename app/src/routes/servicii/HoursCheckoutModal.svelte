<!--
	Cumpărarea orelor de extra work de pe /servicii, în 3 pași:
	Date facturare → Plată cu cardul → Confirmare.

	Aceeași coajă ca modalul de ofertă (`checkout-modal-shell`), cu stepper-ul,
	coloana de sumar și formularul reproduse cu clase locale `hc-*` (copiate din
	`ServicesQuoteModal`, care la rândul lui le-a copiat din checkout-ul de
	hosting — acolo trăiesc ca `:global(.co-*)`).

	Montat condiționat de părinte, deci fiecare deschidere pornește cu stare
	curată. NU importă valori din `ots-catalog` (testul no-price-leak): tariful
	vine prin prop, limitele din modulul pur `hours-pricing`.

	Plata: `createHoursOrder` întoarce clientSecret + publishableKey →
	PaymentElement embedded (ca în portalul de facturi), `confirmPayment` cu
	`redirect: 'if_required'`. Odată creat PaymentIntent-ul nu mai există
	„Înapoi": o a doua trimitere ar crea altă comandă și alt intent.
-->
<script lang="ts" module>
	export type HoursCheckoutRate = { slug: string; label: string; rate: number; hours: number };
</script>

<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { loadStripe, type Stripe as StripeJS, type StripeElements as StripeElementsT } from '@stripe/stripe-js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import UserIcon from '@lucide/svelte/icons/user-round';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import LockIcon from '@lucide/svelte/icons/lock';
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check-big';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import CheckoutModalShell from '$lib/components/checkout-modal-shell.svelte';
	import { StripeElements } from '$lib/components/Stripe';
	import { PaymentElement } from '$lib/components/Stripe/PaymentElement';
	import { formatEur } from '$lib/constants/ots-catalog-format';
	import { computeVatBreakdown } from '$lib/utils/vat';
	import { hoursNetCents } from '$lib/logic/hours-pricing';
	import { createHoursOrder } from '$lib/remotes/public-hours.remote';
	import { validateCuiAndFetch } from '$lib/remotes/public-hosting.remote';

	type Props = {
		rate: HoursCheckoutRate;
		/** Cota TVA a tenantului, din catalogul public (aceeași ca pe server). */
		vatPercent: number;
		onClose: () => void;
	};

	let { rate, vatPercent, onClose }: Props = $props();

	const STEPS = [
		{ n: 1, label: 'Date facturare' },
		{ n: 2, label: 'Plată' },
		{ n: 3, label: 'Confirmare' }
	] as const;

	let step = $state<1 | 2 | 3>(1);

	/** Titlul pasului primește focusul la schimbare — elementul apăsat poate fi demontat. */
	const focusOnMount: Attachment<HTMLElement> = (el) => {
		el.focus();
	};

	const money = $derived(computeVatBreakdown(hoursNetCents(rate.rate, rate.hours), vatPercent));
	const eur = (cents: number) => formatEur(cents / 100);

	// ── Pas 1: date facturare ──
	let billingType = $state<'company' | 'person'>('company');
	let contactName = $state('');
	let contactEmail = $state('');
	let contactPhone = $state('');
	let companyName = $state('');
	let cui = $state('');
	let vatPayer = $state(false);
	let note = $state('');
	let touched = $state(false);

	// Verificarea ANAF e informativă (autocompletare); validarea reală e pe server.
	let cuiChecking = $state(false);
	let cuiHint = $state<string | null>(null);
	let cuiVerified = $state(false);

	const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const nameError = $derived.by(() => {
		const words = contactName.trim().split(/\s+/).filter(Boolean);
		if (contactName.trim().length < 2) return 'Scrie numele complet.';
		if (billingType === 'person' && words.length < 2) return 'Scrie numele și prenumele.';
		return null;
	});
	const emailError = $derived(
		EMAIL_REGEX.test(contactEmail.trim()) ? null : 'Scrie o adresă de email validă.'
	);
	const companyError = $derived(
		billingType === 'company' && companyName.trim().length === 0 ? 'Scrie denumirea firmei.' : null
	);
	const cuiError = $derived(
		billingType === 'company' && cui.replace(/\D/g, '').length < 2 ? 'Scrie CUI-ul firmei.' : null
	);
	const detailsValid = $derived(!nameError && !emailError && !companyError && !cuiError);
	const show = (err: string | null) => touched && err !== null;
	/** Prima eroare în ordinea vizuală a câmpurilor (CUI și firma stau deasupra numelui). */
	const firstError = $derived.by((): { id: string; message: string } | null => {
		if (cuiError) return { id: 'hc-cui', message: cuiError };
		if (companyError) return { id: 'hc-company', message: companyError };
		if (nameError) return { id: 'hc-name', message: nameError };
		if (emailError) return { id: 'hc-email', message: emailError };
		return null;
	});

	async function onCuiBlur() {
		const raw = cui.trim();
		if (billingType !== 'company' || raw.replace(/\D/g, '').length < 2) return;
		cuiChecking = true;
		cuiHint = null;
		cuiVerified = false;
		try {
			const res = await validateCuiAndFetch(raw);
			if (res.valid) {
				if (!companyName.trim()) companyName = res.data.denumire;
				vatPayer = res.data.platitorTva;
				cuiVerified = true;
			} else {
				cuiHint = res.error;
			}
		} catch {
			// ANAF indisponibil sau rate-limit — mergem mai departe, server-ul validează.
		} finally {
			cuiChecking = false;
		}
	}

	// ── Pas 2: plată ──
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);
	let stripeJs = $state<StripeJS | null>(null);
	let clientSecret = $state<string | null>(null);
	let stripeElements = $state<StripeElementsT | null>(null);
	let paymentReady = $state(false);
	let paying = $state(false);

	const busy = $derived(submitting || paying);

	async function submitDetails() {
		touched = true;
		if (firstError) {
			// Cititorul de ecran și utilizatorul de tastatură ajung direct la primul câmp greșit.
			document.getElementById(firstError.id)?.focus();
			return;
		}
		if (submitting) return;
		submitting = true;
		errorMessage = null;
		try {
			const res = await createHoursOrder({
				rateSlug: rate.slug,
				hours: rate.hours,
				billingType,
				contactName: contactName.trim(),
				contactEmail: contactEmail.trim(),
				contactPhone: contactPhone.trim() || undefined,
				companyName: billingType === 'company' ? companyName.trim() : undefined,
				cui: billingType === 'company' ? cui.trim() : undefined,
				vatPayer: billingType === 'company' ? vatPayer : undefined,
				note: note.trim() || undefined
			});
			const stripe = await loadStripe(res.publishableKey);
			if (!stripe) throw new Error('Stripe.js nu s-a putut încărca. Verifică conexiunea.');
			stripeJs = stripe;
			clientSecret = res.clientSecret;
			step = 2;
		} catch (err) {
			// HttpError din SvelteKit nu extinde Error: mesajul e în `body.message`.
			const body = (err as { body?: { message?: string } })?.body;
			errorMessage =
				body?.message ??
				(err instanceof Error ? err.message : 'Nu am putut porni plata. Te rugăm să încerci din nou.');
		} finally {
			submitting = false;
		}
	}

	async function confirmPayment() {
		if (!stripeJs || !stripeElements || paying) return;
		paying = true;
		errorMessage = null;
		try {
			const { error, paymentIntent } = await stripeJs.confirmPayment({
				elements: stripeElements,
				confirmParams: { return_url: window.location.href },
				redirect: 'if_required'
			});
			if (error) {
				errorMessage =
					error.message ?? 'Plata nu a putut fi confirmată. Verifică datele cardului și încearcă din nou.';
				return;
			}
			if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
				step = 3;
			} else {
				errorMessage = 'Plata nu a fost finalizată. Te rugăm să încerci din nou.';
			}
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Plata a eșuat. Te rugăm să încerci din nou.';
		} finally {
			paying = false;
		}
	}

	function primaryAction() {
		if (step === 1) void submitDetails();
		else if (step === 2) void confirmPayment();
		else onClose();
	}

	const footerHint = $derived(
		step === 1 && touched && firstError
			? firstError.message
			: step === 2 && !paymentReady
				? 'Se încarcă formularul de plată…'
				: null
	);
</script>

{#snippet footer()}
	<div class="hc-foot">
		<div class="hc-foot-secure">
			<LockIcon size={13} aria-hidden="true" />
			<span>Plată procesată de Stripe. Nu stocăm datele cardului.</span>
		</div>
		<div class={['hc-foot-meta', footerHint && 'hc-foot-warn']} aria-live="polite">
			{footerHint ?? ''}
		</div>
		<button
			type="button"
			class="hc-btn-primary ots-gloss"
			onclick={primaryAction}
			disabled={busy || (step === 2 && !paymentReady)}
		>
			{#if step === 1}
				{#if submitting}
					<LoaderIcon size={14} class="hc-spin" aria-hidden="true" /> Se pregătește plata…
				{:else}
					Continuă spre plată <ChevronRightIcon size={14} aria-hidden="true" />
				{/if}
			{:else if paying}
				<LoaderIcon size={14} class="hc-spin" aria-hidden="true" /> Se procesează…
			{:else}
				<CreditCardIcon size={14} aria-hidden="true" /> Plătește {eur(money.grossCents)}
			{/if}
		</button>
	</div>
{/snippet}

<CheckoutModalShell
	{onClose}
	canClose={!busy}
	maxWidth={step === 3 ? '560px' : '980px'}
	ariaLabel="Cumpără ore de extra work"
	flush={step !== 3}
	footer={step === 3 ? undefined : footer}
>
	{#if step === 3}
		<div class="hc-success" role="status">
			<CheckCircleIcon class="hc-success-icon" aria-hidden="true" />
			<h2>Plata a fost confirmată</h2>
			<p>
				Ai cumpărat <strong>{rate.hours} {rate.hours === 1 ? 'oră' : 'ore'} de {rate.label}</strong>.
				Factura și linkul de acces în portalul clientului sosesc pe
				<strong>{contactEmail.trim()}</strong> în câteva minute. Te contactăm ca să planificăm
				lucrarea.
			</p>
			<button type="button" class="hc-btn-primary ots-gloss" {@attach focusOnMount} onclick={onClose}>
				Închide
			</button>
		</div>
	{:else}
		<ol class="hc-stepper" aria-label="Pașii cumpărării">
			{#each STEPS as s, i (s.n)}
				<li
					class={['hc-step', step === s.n && 'active', step > s.n && 'done']}
					aria-current={step === s.n ? 'step' : undefined}
				>
					<div class="hc-step-circle" aria-hidden="true">
						{#if step > s.n}
							<CheckIcon size={14} />
						{:else if s.n === 1}
							<UserIcon size={14} />
						{:else if s.n === 2}
							<CreditCardIcon size={14} />
						{:else}
							<CheckCircleIcon size={14} />
						{/if}
					</div>
					<div class="hc-step-label">
						<div class="hc-step-num">Pas {s.n}</div>
						<div>{s.label}</div>
					</div>
				</li>
				{#if i < STEPS.length - 1}
					<li class={['hc-step-line', step > s.n && 'done']} aria-hidden="true"></li>
				{/if}
			{/each}
		</ol>

		<div class="hc-layout">
			<div class="hc-content">
				{#if step === 1}
					<h2 class="hc-h2" tabindex="-1" {@attach focusOnMount}>Datele de facturare</h2>
					<p class="hc-sub">
						Factura fiscală se emite automat după plată, pe datele de mai jos.
					</p>

					<div class="hc-segmented" role="group" aria-label="Tip de facturare">
						<button
							type="button"
							class={[billingType === 'company' && 'active']}
							aria-pressed={billingType === 'company'}
							onclick={() => (billingType = 'company')}
						>
							Firmă
						</button>
						<button
							type="button"
							class={[billingType === 'person' && 'active']}
							aria-pressed={billingType === 'person'}
							onclick={() => (billingType = 'person')}
						>
							Persoană fizică
						</button>
					</div>

					<form
						class="hc-grid-2"
						novalidate
						onsubmit={(e) => {
							e.preventDefault();
							void submitDetails();
						}}
					>
						{#if billingType === 'company'}
							<div class="hc-field">
								<label class="hc-label" for="hc-cui">CUI *</label>
								<div class="hc-input-wrap">
									<input
										id="hc-cui"
										class={['hc-input', show(cuiError) && 'hc-input-error']}
										bind:value={cui}
										onblur={onCuiBlur}
										maxlength="12"
										autocomplete="off"
										autocapitalize="characters"
										spellcheck="false"
										placeholder="RO12345678"
										aria-invalid={show(cuiError) ? 'true' : undefined}
										aria-describedby={show(cuiError) ? 'hc-cui-err' : cuiHint ? 'hc-cui-hint' : undefined}
									/>
									{#if cuiChecking}
										<LoaderIcon size={16} class="hc-spin hc-input-icon" aria-label="Se verifică la ANAF" />
									{:else if cuiVerified}
										<CheckIcon size={16} class="hc-input-icon hc-input-ok" aria-label="Verificat la ANAF" />
									{/if}
								</div>
								{#if show(cuiError)}
									<span id="hc-cui-err" class="hc-hint hc-hint-err">{cuiError}</span>
								{:else if cuiHint}
									<span id="hc-cui-hint" class="hc-hint hc-hint-warn">{cuiHint}</span>
								{:else}
									<span class="hc-hint">Completăm denumirea din ANAF.</span>
								{/if}
							</div>
							<div class="hc-field">
								<label class="hc-label" for="hc-company">Denumire firmă *</label>
								<input
									id="hc-company"
									class={['hc-input', show(companyError) && 'hc-input-error']}
									bind:value={companyName}
									maxlength="160"
									autocomplete="organization"
									aria-invalid={show(companyError) ? 'true' : undefined}
									aria-describedby={show(companyError) ? 'hc-company-err' : undefined}
								/>
								{#if show(companyError)}
									<span id="hc-company-err" class="hc-hint hc-hint-err">{companyError}</span>
								{/if}
							</div>
							<label class="hc-check hc-span-2">
								<input type="checkbox" bind:checked={vatPayer} />
								<span>Firma este plătitoare de TVA</span>
							</label>
						{/if}

						<div class="hc-field hc-span-2">
							<label class="hc-label" for="hc-name">
								{billingType === 'company' ? 'Persoană de contact *' : 'Nume și prenume *'}
							</label>
							<input
								id="hc-name"
								class={['hc-input', show(nameError) && 'hc-input-error']}
								bind:value={contactName}
								maxlength="120"
								autocomplete="name"
								aria-invalid={show(nameError) ? 'true' : undefined}
								aria-describedby={show(nameError) ? 'hc-name-err' : undefined}
							/>
							{#if show(nameError)}
								<span id="hc-name-err" class="hc-hint hc-hint-err">{nameError}</span>
							{/if}
						</div>
						<div class="hc-field">
							<label class="hc-label" for="hc-email">Email *</label>
							<input
								id="hc-email"
								class={['hc-input', show(emailError) && 'hc-input-error']}
								type="email"
								bind:value={contactEmail}
								maxlength="255"
								autocomplete="email"
								autocapitalize="off"
								spellcheck="false"
								aria-invalid={show(emailError) ? 'true' : undefined}
								aria-describedby={show(emailError) ? 'hc-email-err' : 'hc-email-hint'}
							/>
							{#if show(emailError)}
								<span id="hc-email-err" class="hc-hint hc-hint-err">{emailError}</span>
							{:else}
								<span id="hc-email-hint" class="hc-hint">Aici trimitem factura și accesul în portal.</span>
							{/if}
						</div>
						<div class="hc-field">
							<label class="hc-label" for="hc-phone">Telefon</label>
							<input
								id="hc-phone"
								class="hc-input"
								type="tel"
								bind:value={contactPhone}
								maxlength="40"
								autocomplete="tel"
							/>
						</div>
						<div class="hc-field hc-span-2">
							<label class="hc-label" for="hc-note">Pe ce vrei să folosim orele? (opțional)</label>
							<textarea
								id="hc-note"
								class="hc-input hc-textarea"
								bind:value={note}
								rows="3"
								maxlength="2000"
								placeholder="Ex.: modificări pe pagina de checkout, integrare cu un API extern…"
							></textarea>
						</div>
						<!-- Enter în orice câmp = „Continuă"; butonul vizibil e în footer. -->
						<button type="submit" class="hc-sr" tabindex="-1" aria-hidden="true">Continuă</button>
					</form>

					{#if errorMessage}
						<p class="hc-error" role="alert">{errorMessage}</p>
					{/if}
				{:else}
					<h2 class="hc-h2" tabindex="-1" {@attach focusOnMount}>Plata cu cardul</h2>
					<p class="hc-sub">
						Introdu datele cardului. Suma se încasează o singură dată, nu e abonament.
					</p>

					{#if stripeJs && clientSecret}
						<div class="hc-card">
							<StripeElements stripe={stripeJs} {clientSecret} bind:elements={stripeElements}>
								<PaymentElement
									options={{ layout: 'tabs' }}
									onready={() => (paymentReady = true)}
									onloaderror={() =>
										(errorMessage = 'Formularul de plată nu s-a încărcat. Reîncarcă pagina și încearcă din nou.')}
								/>
							</StripeElements>
						</div>
					{/if}

					{#if errorMessage}
						<p class="hc-error" role="alert">{errorMessage}</p>
					{/if}
				{/if}
			</div>

			<aside class="hc-summary" aria-label="Sumar comandă">
				<div class="hc-summary-head">Sumar comandă</div>
				<div class="hc-cart-item">
					<div class="hc-cart-name">
						<strong>Extra work — {rate.label}</strong>
						<span>{rate.hours} h × {rate.rate} €/h</span>
					</div>
					<div class="hc-cart-price">{eur(money.netCents)}</div>
				</div>
				<div class="hc-totals">
					<div class="hc-total-row">
						<span>Subtotal</span>
						<strong>{eur(money.netCents)}</strong>
					</div>
					<div class="hc-total-row">
						<span>TVA {vatPercent}%</span>
						<strong>{eur(money.vatCents)}</strong>
					</div>
					<div class="hc-total-row big">
						<span>Total de plată</span>
						<strong>{eur(money.grossCents)}</strong>
					</div>
				</div>
				<p class="hc-fine">
					Plată unică, în EUR. Orele se consumă pe cererile tale, cu estimare confirmată
					înainte de fiecare lucrare. Factura fiscală se emite automat după plată.
				</p>
			</aside>
		</div>
	{/if}
</CheckoutModalShell>

<style>
	/* Tokenii sunt cei din /pachete-hosting și din ServicesCatalog (--accent #1877f2,
	   --ink #0b1220, --border #e5e9f0). Modalul e montat în afara `.sv-page`, deci
	   valorile sunt scrise direct, ca în ServicesQuoteModal. */
	.hc-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	:global(.hc-spin) {
		animation: hc-spin 0.9s linear infinite;
	}
	@keyframes hc-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ===== Stepper ===== */
	.hc-stepper {
		position: sticky;
		top: 0;
		z-index: 2;
		margin: 0;
		padding: 22px 28px;
		list-style: none;
		border-bottom: 1px solid #e5e9f0;
		display: flex;
		align-items: center;
		gap: 8px;
		background: #f7f8fa;
	}
	.hc-step {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.hc-step-circle {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: white;
		border: 2px solid #cbd5e1;
		display: grid;
		place-items: center;
		color: #5f6b7c;
	}
	.hc-step.active .hc-step-circle {
		background: #0d5cc7;
		border-color: #0d5cc7;
		color: white;
		box-shadow: 0 4px 12px rgba(24, 119, 242, 0.25);
	}
	.hc-step.done .hc-step-circle {
		background: #047857;
		border-color: #047857;
		color: white;
	}
	.hc-step-num {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5f6b7c;
	}
	.hc-step.active .hc-step-num {
		color: #0d5cc7;
	}
	.hc-step.done .hc-step-num {
		color: #047857;
	}
	.hc-step-label > div:last-child {
		font-size: 13.5px;
		font-weight: 600;
		color: #0b1220;
		margin-top: 1px;
	}
	.hc-step.active .hc-step-label > div:last-child {
		color: #0d5cc7;
	}
	.hc-step-line {
		flex: 1;
		height: 2px;
		background: #e5e9f0;
		margin: 0 4px;
		border-radius: 2px;
	}
	.hc-step-line.done {
		background: #047857;
	}

	/* ===== Layout ===== */
	.hc-layout {
		display: grid;
		grid-template-columns: 1fr 340px;
		min-height: 440px;
		background: linear-gradient(to right, white calc(100% - 340px), #f7f8fa calc(100% - 340px));
	}
	.hc-content {
		padding: 28px 32px 32px;
		min-width: 0;
		position: relative;
	}
	.hc-summary {
		background: #f7f8fa;
		border-left: 1px solid #e5e9f0;
		padding: 28px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		position: sticky;
		top: 84px;
		align-self: start;
	}
	.hc-h2 {
		font-size: 22px;
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 0 0 6px;
		color: #0b1220;
	}
	.hc-h2:focus-visible {
		outline: 2px solid #1877f2;
		outline-offset: 4px;
		border-radius: 4px;
	}
	.hc-sub {
		font-size: 14px;
		color: #475569;
		margin: 0 0 18px;
		max-width: 540px;
	}

	/* ===== Tip facturare ===== */
	.hc-segmented {
		display: inline-flex;
		gap: 2px;
		margin: 0 0 18px;
		padding: 3px;
		background: #f7f8fa;
		border: 1px solid #e5e9f0;
		border-radius: 8px;
	}
	.hc-segmented button {
		padding: 8px 14px;
		border-radius: 5px;
		background: transparent;
		border: none;
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		color: #475569;
		cursor: pointer;
	}
	.hc-segmented button.active {
		background: white;
		color: #0b1220;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
	}

	/* ===== Formular ===== */
	.hc-grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.hc-span-2 {
		grid-column: span 2;
	}
	.hc-field {
		display: flex;
		flex-direction: column;
	}
	.hc-label {
		display: block;
		font-size: 12px;
		font-weight: 600;
		color: #475569;
		margin-bottom: 6px;
	}
	.hc-input-wrap {
		position: relative;
	}
	.hc-input-wrap :global(.hc-input-icon) {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		color: #5f6b7c;
	}
	.hc-input-wrap :global(.hc-input-ok) {
		color: #047857;
	}
	.hc-input {
		width: 100%;
		padding: 11px 14px;
		background: white;
		border: 1.5px solid #e5e9f0;
		border-radius: 9px;
		font-family: inherit;
		font-size: 14px;
		color: #0b1220;
		outline: none;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	.hc-input:focus {
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	.hc-input:focus-visible {
		outline: 2px solid #1877f2;
		outline-offset: 2px;
	}
	.hc-input.hc-input-error {
		border-color: #ef4444;
		background: #fff5f5;
	}
	.hc-input.hc-input-error:focus-visible {
		outline-color: #b91c1c;
	}
	.hc-textarea {
		resize: vertical;
		min-height: 80px;
		line-height: 1.5;
	}
	.hc-hint {
		font-size: 11.5px;
		margin-top: 4px;
		color: #5f6b7c;
	}
	.hc-hint-err {
		color: #b91c1c;
	}
	.hc-hint-warn {
		color: #b45309;
	}
	.hc-check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: #0b1220;
		cursor: pointer;
	}
	.hc-check input {
		width: 16px;
		height: 16px;
		accent-color: #1877f2;
	}
	.hc-error {
		margin: 14px 0 0;
		padding: 10px 12px;
		border-radius: 8px;
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #991b1b;
		font-size: 13px;
	}

	/* ===== Plată ===== */
	.hc-card {
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		padding: 16px;
		background: white;
	}

	/* ===== Sumar ===== */
	.hc-summary-head {
		font-size: 11px;
		font-weight: 800;
		color: #5f6b7c;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding-bottom: 4px;
	}
	.hc-cart-item {
		padding: 10px 0;
		border-top: 1px solid #e5e9f0;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	.hc-cart-name strong {
		display: block;
		font-size: 13.5px;
		color: #0b1220;
	}
	.hc-cart-name span {
		font-size: 11.5px;
		color: #475569;
		margin-top: 2px;
		display: block;
	}
	.hc-cart-price {
		font-weight: 700;
		font-size: 14px;
		color: #0b1220;
		white-space: nowrap;
	}
	.hc-totals {
		padding-top: 12px;
		border-top: 1px solid #e5e9f0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.hc-total-row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
		color: #475569;
	}
	.hc-total-row strong {
		color: #0b1220;
		font-weight: 600;
		white-space: nowrap;
	}
	.hc-total-row.big {
		margin-top: 8px;
		padding-top: 12px;
		border-top: 1px solid #e5e9f0;
		font-size: 15px;
	}
	.hc-total-row.big strong {
		font-size: 24px;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: #1877f2;
	}
	.hc-fine {
		margin: 12px 0 0;
		padding-top: 12px;
		border-top: 1px solid #e5e9f0;
		font-size: 11.5px;
		line-height: 1.5;
		color: #5f6b7c;
	}

	/* ===== Footer & butoane ===== */
	.hc-foot {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.hc-foot-secure {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #5f6b7c;
	}
	.hc-foot-meta {
		flex: 1;
		text-align: center;
		font-size: 12.5px;
		color: #5f6b7c;
	}
	.hc-foot-warn {
		color: #b45309;
	}
	.hc-btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 12px 22px;
		border-radius: 10px;
		background: #1877f2;
		color: white;
		border: none;
		font-family: inherit;
		font-size: 14px;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
	}
	.hc-btn-primary:not(:disabled):hover {
		background: #0d5cc7;
		transform: translateY(-1px);
		box-shadow: 0 6px 16px rgba(24, 119, 242, 0.25);
	}
	.hc-btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.hc-btn-primary:focus-visible,
	.hc-segmented button:focus-visible {
		outline: 2px solid #1877f2;
		outline-offset: 2px;
	}

	/* ===== Confirmare ===== */
	.hc-success {
		text-align: center;
		padding: 16px 8px 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}
	.hc-success :global(.hc-success-icon) {
		width: 52px;
		height: 52px;
		color: #10b981;
	}
	.hc-success h2 {
		font-size: 22px;
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 4px 0 0;
		color: #0b1220;
	}
	.hc-success p {
		margin: 0 0 12px;
		font-size: 14px;
		color: #475569;
		max-width: 420px;
		line-height: 1.55;
	}

	@media (max-width: 880px) {
		.hc-layout {
			grid-template-columns: 1fr;
			background: white;
		}
		.hc-summary {
			border-left: none;
			border-top: 1px solid #e5e9f0;
			position: static;
		}
		.hc-content {
			padding: 22px 20px 24px;
		}
		.hc-grid-2 {
			grid-template-columns: 1fr;
		}
		.hc-span-2 {
			grid-column: span 1;
		}
		.hc-stepper {
			padding: 16px 18px;
		}
		.hc-step:not(.active) .hc-step-label,
		.hc-foot-meta,
		.hc-foot-secure span {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.hc-foot > .hc-btn-primary {
			margin-left: auto;
		}
	}
	@media (max-width: 480px) {
		.hc-foot {
			flex-wrap: wrap;
		}
		.hc-foot > .hc-btn-primary {
			flex: 1 1 100%;
			justify-content: center;
			order: -1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.hc-btn-primary:not(:disabled):hover {
			transform: none;
		}
		:global(.hc-spin) {
			animation: none;
		}
	}
</style>
