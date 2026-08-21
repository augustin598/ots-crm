<!--
	Modalul „Solicită oferta" de pe /servicii — coșul de servicii trimis ca o
	singură cerere, în 3 pași: Servicii → Date contact → Solicită oferta.

	Aceeași coajă ca checkout-ul din /pachete-hosting (`checkout-modal-shell`),
	cu stepper-ul și coloana de sumar reproduse aici cu clase locale `sq-*`
	(în modalul de hosting trăiesc ca `:global(.co-*)` într-un fișier de 3.500
	de linii; nu le importăm de acolo).

	Montat condiționat de părinte (`{#if open}`), deci fiecare deschidere pornește
	cu stare curată — nu e nevoie de {#key}.

	Nu importă valori din `ots-catalog`: catalogul vine prin props, de la `load`,
	ca prețurile să nu ajungă în bundle-ul de client fără parolă.
-->
<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import UserIcon from '@lucide/svelte/icons/user-round';
	import SendIcon from '@lucide/svelte/icons/send';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check-big';
	import CheckoutModalShell from '$lib/components/checkout-modal-shell.svelte';
	import CategoryIcon from '$lib/components/services/CategoryIcon.svelte';
	import { formatEur } from '$lib/constants/ots-catalog-format';
	import type { Category, Tier } from '$lib/constants/ots-catalog';
	import { computeQuoteSummary, defaultTierFor, isTierOffered } from '$lib/logic/quote-pricing';
	import { submitPublicQuoteRequest } from '$lib/remotes/public-services.remote';
	import type { ServicesCart } from './services-cart.svelte';
	import type { PublicCatalog } from './types';

	type Props = {
		cart: ServicesCart;
		catalog: PublicCatalog;
		/** Nota inițială din „Detalii despre proiect" (configuratorul o preîncarcă). */
		initialNote?: string;
		onClose: () => void;
	};

	let { cart, catalog, initialNote = '', onClose }: Props = $props();

	const STEPS = [
		{ n: 1, label: 'Servicii' },
		{ n: 2, label: 'Date contact' },
		{ n: 3, label: 'Solicită oferta' }
	] as const;

	let step = $state<1 | 2 | 3>(1);

	/**
	 * Titlul pasului (și butonul „Închide" de pe confirmare) primește focusul când
	 * apare: la schimbarea pasului elementul apăsat poate fi demontat, iar focusul
	 * ar cădea pe <body>, în afara capcanei de focus a modalului. La prima
	 * deschidere, focus-trap-ul coajei îl mută apoi pe primul element interactiv.
	 */
	const focusOnMount: Attachment<HTMLElement> = (el) => {
		el.focus();
	};

	const bySlug = $derived(new Map(catalog.categories.map((c) => [c.slug, c])));
	const summary = $derived(
		computeQuoteSummary(cart.items, catalog.categories, catalog.discountRules)
	);
	const available = $derived(
		catalog.categories.filter((c) => !cart.has(c.slug) && defaultTierFor(c, catalog.tiers))
	);

	// ── Pas 2: contact ──
	let contactName = $state('');
	let contactEmail = $state('');
	let contactPhone = $state('');
	let companyName = $state('');
	// Nota e doar valoarea de pornire (wizardul o preîncarcă); după aceea îi aparține vizitatorului.
	// svelte-ignore state_referenced_locally
	let note = $state(initialNote);
	// Erorile apar abia după prima încercare de „Continuă", nu în timp ce scrie.
	let touched = $state(false);

	const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const nameError = $derived(contactName.trim().length < 2 ? 'Scrie numele complet.' : null);
	const emailError = $derived(
		EMAIL_REGEX.test(contactEmail.trim()) ? null : 'Scrie o adresă de email validă.'
	);
	const contactValid = $derived(!nameError && !emailError);
	const showNameError = $derived(touched && nameError !== null);
	const showEmailError = $derived(touched && emailError !== null);

	// ── Pas 3: trimitere ──
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);
	let sent = $state(false);
	let sentTo = $state('');
	let sentCount = $state(0);

	const footerHint = $derived(
		step === 1 && summary.serviceCount === 0
			? 'Alege cel puțin un serviciu.'
			: step === 2 && touched && !contactValid
				? (nameError ?? emailError)
				: null
	);

	function next() {
		if (step === 1 && summary.serviceCount === 0) return;
		if (step === 2) {
			touched = true;
			if (!contactValid) {
				// Cititorul de ecran și utilizatorul de tastatură ajung direct la primul câmp greșit.
				document.getElementById(nameError ? 'sq-name' : 'sq-email')?.focus();
				return;
			}
		}
		if (step < 3) step = (step + 1) as 2 | 3;
	}
	function back() {
		if (step > 1) step = (step - 1) as 1 | 2;
	}
	function primaryAction() {
		if (step < 3) next();
		else void submit();
	}

	function addCategory(cat: Category) {
		const tier = defaultTierFor(cat, catalog.tiers);
		if (tier) cart.set(cat.slug, tier);
	}

	// Confirmarea scoaterii unui serviciu, cu „Anulează": toast-ul paginii stă sub
	// overlay-ul modalului, așa că mesajul apare aici, deasupra listei.
	let removed = $state<{ categorySlug: string; tier: Tier; name: string } | null>(null);
	let removedSeq = $state(0);
	function removeLine(categorySlug: string, tier: Tier, name: string) {
		cart.remove(categorySlug);
		removed = { categorySlug, tier, name };
		removedSeq += 1;
	}
	function undoRemove() {
		if (!removed) return;
		cart.set(removed.categorySlug, removed.tier);
		removed = null;
	}
	const dismissRemoved: Attachment<HTMLElement> = () => {
		const t = setTimeout(() => (removed = null), 4000);
		return () => clearTimeout(t);
	};

	async function submit() {
		if (submitting || summary.serviceCount === 0 || !contactValid) return;
		submitting = true;
		errorMessage = null;
		try {
			await submitPublicQuoteRequest({
				items: cart.items.map((i) => ({ categorySlug: i.categorySlug, tier: i.tier })),
				contactName: contactName.trim(),
				contactEmail: contactEmail.trim(),
				contactPhone: contactPhone.trim() || undefined,
				companyName: companyName.trim() || undefined,
				note: note.trim() || undefined
			});
			sentTo = contactEmail.trim();
			sentCount = summary.serviceCount;
			sent = true;
			cart.clear();
		} catch (err) {
			errorMessage = serverMessage(err) ?? 'Nu am putut trimite cererea. Te rugăm să încerci din nou.';
		} finally {
			submitting = false;
		}
	}

	/**
	 * Mesajul trimis de server prin `error(status, mesaj)`. Pe client, command-urile
	 * remote aruncă `HttpError` din SvelteKit, care NU extinde `Error`: textul stă în
	 * `body.message`. Fără asta, „Sesiunea a expirat…" (403) sau rate-limit-ul (429)
	 * s-ar afișa ca eroare generică.
	 */
	function serverMessage(err: unknown): string | null {
		if (!err || typeof err !== 'object') return null;
		const e = err as { body?: { message?: unknown }; message?: unknown };
		if (typeof e.body?.message === 'string' && e.body.message) return e.body.message;
		if (err instanceof Error && err.message) return err.message;
		return null;
	}

	function tierLabel(t: Tier) {
		return catalog.tierLabels[t];
	}

	function linePrice(monthlyEur: number | null, setupEur: number | null): string {
		if (monthlyEur !== null) return `${formatEur(monthlyEur)}/lună`;
		if (setupEur) return `${formatEur(setupEur)} one-time`;
		return '—';
	}
</script>

{#snippet footer()}
	<div class="sq-foot">
		{#if step > 1}
			<button type="button" class="sq-btn-ghost" onclick={back} disabled={submitting}>
				<ChevronLeftIcon size={14} aria-hidden="true" /> Înapoi
			</button>
		{:else}
			<div></div>
		{/if}
		<div class={['sq-foot-meta', footerHint && 'sq-foot-warn']} aria-live="polite">
			{footerHint ?? ''}
		</div>
		<!-- Un singur buton pentru Continuă/Trimite: elementul focalizat nu e demontat la schimbarea pasului. -->
		<button
			type="button"
			class="sq-btn-primary"
			onclick={primaryAction}
			disabled={submitting || (step === 1 && summary.serviceCount === 0)}
		>
			{#if step < 3}
				Continuă <ChevronRightIcon size={14} aria-hidden="true" />
			{:else if submitting}
				Se trimite…
			{:else}
				<SendIcon size={14} aria-hidden="true" /> Trimite cererea
			{/if}
		</button>
	</div>
{/snippet}

<CheckoutModalShell
	{onClose}
	canClose={!submitting}
	maxWidth={sent ? '560px' : '980px'}
	badgeText="Cerere fără obligații"
	ariaLabel="Cerere de ofertă"
	flush={!sent}
	footer={sent ? undefined : footer}
>
	{#if sent}
		<div class="sq-success" role="status">
			<CheckCircleIcon class="sq-success-icon" aria-hidden="true" />
			<h2>Cererea a fost trimisă</h2>
			<p>
				Am înregistrat cererea pentru <strong>{sentCount} {sentCount === 1 ? 'serviciu' : 'servicii'}</strong>.
				Echipa One Top Solution te contactează pe <strong>{sentTo}</strong> în cel mai scurt timp.
			</p>
			<button type="button" class="sq-btn-primary" {@attach focusOnMount} onclick={onClose}>
				Închide
			</button>
		</div>
	{:else}
		<ol class="sq-stepper" aria-label="Pașii cererii">
			{#each STEPS as s, i (s.n)}
				<li
					class={['sq-step', step === s.n && 'active', step > s.n && 'done']}
					aria-current={step === s.n ? 'step' : undefined}
				>
					<div class="sq-step-circle" aria-hidden="true">
						{#if step > s.n}
							<CheckIcon size={14} />
						{:else if s.n === 1}
							<LayersIcon size={14} />
						{:else if s.n === 2}
							<UserIcon size={14} />
						{:else}
							<SendIcon size={14} />
						{/if}
					</div>
					<div class="sq-step-label">
						<div class="sq-step-num">Pas {s.n}</div>
						<div>{s.label}</div>
					</div>
				</li>
				{#if i < STEPS.length - 1}
					<li class={['sq-step-line', step > s.n && 'done']} aria-hidden="true"></li>
				{/if}
			{/each}
		</ol>

		<div class="sq-layout">
			<div class="sq-content">
				{#if step === 1}
					<h2 class="sq-h2" tabindex="-1" {@attach focusOnMount}>Alege serviciile</h2>
					<p class="sq-sub">
						Fiecare serviciu are pachetul lui — combină-le cum ai nevoie. Discountul se aplică
						automat pe abonamentul lunar când alegi două sau mai multe.
					</p>

					{#if removed}
						{#key removedSeq}
							<div class="sq-removed" role="status" {@attach dismissRemoved}>
								<Trash2Icon size={14} aria-hidden="true" />
								<span>
									<strong>{removed.name}</strong> ({tierLabel(removed.tier)}) a fost scos din ofertă.
								</span>
								<button type="button" class="sq-undo" onclick={undoRemove}>
									<Undo2Icon size={14} aria-hidden="true" /> Anulează
								</button>
							</div>
						{/key}
					{/if}

					{#if summary.lines.length === 0}
						<div class="sq-empty">Coșul e gol. Adaugă un serviciu din lista de mai jos.</div>
					{:else}
						<ul class="sq-items">
							{#each summary.lines as line (line.categorySlug)}
								{@const cat = bySlug.get(line.categorySlug)}
								<li class="sq-item">
									<div class="sq-item-head">
										<span class="sq-item-icon"><CategoryIcon slug={line.categorySlug} class="h-4 w-4" /></span>
										<div class="sq-item-name">
											<strong>{line.name}</strong>
											<span>
												{linePrice(line.monthlyEur, line.setupEur)}
												{#if line.monthlyEur !== null && line.setupEur}
													· setup {formatEur(line.setupEur)}
												{/if}
											</span>
										</div>
										<button
											type="button"
											class="sq-remove"
											aria-label={`Scoate ${line.name} din ofertă`}
											onclick={() => removeLine(line.categorySlug, line.tier, line.name)}
										>
											<Trash2Icon size={14} aria-hidden="true" />
										</button>
									</div>
									{#if cat}
										<div class="sq-segmented" role="group" aria-label={`Pachet pentru ${line.name}`}>
											{#each catalog.tiers as t (t)}
												{#if isTierOffered(cat, t)}
													<button
														type="button"
														class={[line.tier === t && 'active']}
														aria-pressed={line.tier === t}
														onclick={() => cart.set(line.categorySlug, t)}
													>
														<span class="sq-tierdot" data-tier={t}></span>
														{tierLabel(t)}
													</button>
												{/if}
											{/each}
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					{#if available.length > 0}
						<h3 class="sq-h3">Adaugă alt serviciu</h3>
						<ul class="sq-add-list">
							{#each available as cat (cat.slug)}
								{@const tier = defaultTierFor(cat, catalog.tiers)}
								<li>
									<button type="button" class="sq-add" onclick={() => addCategory(cat)}>
										<span class="sq-item-icon"><CategoryIcon slug={cat.slug} class="h-4 w-4" /></span>
										<span class="sq-add-name">
											<strong>{cat.name}</strong>
											<span>
												{#if tier}
													{tierLabel(tier)} · {linePrice(cat.prices[tier], cat.setupFees?.[tier] ?? null)}
												{/if}
											</span>
										</span>
										<span class="sq-add-cta"><PlusIcon size={14} aria-hidden="true" /> Adaugă</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{:else if step === 2}
					<h2 class="sq-h2" tabindex="-1" {@attach focusOnMount}>Datele tale de contact</h2>
					<p class="sq-sub">
						Le folosim doar ca să-ți trimitem oferta și să te sunăm dacă avem întrebări.
					</p>

					<form
						class="sq-grid-2"
						novalidate
						onsubmit={(e) => {
							e.preventDefault();
							next();
						}}
					>
						<div class="sq-field sq-span-2">
							<label class="sq-label" for="sq-name">Nume și prenume *</label>
							<input
								id="sq-name"
								class={['sq-input', showNameError && 'sq-input-error']}
								bind:value={contactName}
								required
								maxlength="120"
								autocomplete="name"
								aria-invalid={showNameError ? 'true' : undefined}
								aria-describedby={showNameError ? 'sq-name-err' : undefined}
							/>
							{#if showNameError}
								<span id="sq-name-err" class="sq-hint sq-hint-err">{nameError}</span>
							{/if}
						</div>
						<div class="sq-field">
							<label class="sq-label" for="sq-email">Email *</label>
							<input
								id="sq-email"
								class={['sq-input', showEmailError && 'sq-input-error']}
								type="email"
								bind:value={contactEmail}
								required
								maxlength="255"
								autocomplete="email"
								autocapitalize="off"
								spellcheck="false"
								aria-invalid={showEmailError ? 'true' : undefined}
								aria-describedby={showEmailError ? 'sq-email-err' : undefined}
							/>
							{#if showEmailError}
								<span id="sq-email-err" class="sq-hint sq-hint-err">{emailError}</span>
							{/if}
						</div>
						<div class="sq-field">
							<label class="sq-label" for="sq-phone">Telefon</label>
							<input
								id="sq-phone"
								class="sq-input"
								type="tel"
								bind:value={contactPhone}
								maxlength="40"
								autocomplete="tel"
							/>
						</div>
						<div class="sq-field sq-span-2">
							<label class="sq-label" for="sq-company">Companie</label>
							<input
								id="sq-company"
								class="sq-input"
								bind:value={companyName}
								maxlength="160"
								autocomplete="organization"
							/>
						</div>
						<div class="sq-field sq-span-2">
							<label class="sq-label" for="sq-note">Detalii despre proiect</label>
							<textarea
								id="sq-note"
								class="sq-input sq-textarea"
								bind:value={note}
								rows="5"
								maxlength="2000"
								placeholder="Industrie, website, obiective, buget media estimat, dată de start…"
							></textarea>
						</div>
						<!-- Enter în orice câmp = „Continuă"; butonul vizibil e în footer. -->
						<button type="submit" class="sq-sr" tabindex="-1" aria-hidden="true">Continuă</button>
					</form>
				{:else}
					<h2 class="sq-h2" tabindex="-1" {@attach focusOnMount}>Verifică și trimite</h2>
					<p class="sq-sub">
						Îți pregătim o ofertă personalizată pentru serviciile de mai jos și revenim pe email.
					</p>

					<div class="sq-review">
						<div class="sq-review-head">Servicii</div>
						<ul class="sq-review-list">
							{#each summary.lines as line (line.categorySlug)}
								<li>
									<span class="sq-item-icon"><CategoryIcon slug={line.categorySlug} class="h-4 w-4" /></span>
									<strong>{line.name}</strong>
									<span class="sq-chip" data-tier={line.tier}>{tierLabel(line.tier)}</span>
									<span class="sq-review-price">{linePrice(line.monthlyEur, line.setupEur)}</span>
								</li>
							{/each}
						</ul>

						<div class="sq-review-head">Contact</div>
						<dl class="sq-review-dl">
							<dt>Nume</dt>
							<dd>{contactName.trim()}</dd>
							<dt>Email</dt>
							<dd>{contactEmail.trim()}</dd>
							{#if contactPhone.trim()}
								<dt>Telefon</dt>
								<dd>{contactPhone.trim()}</dd>
							{/if}
							{#if companyName.trim()}
								<dt>Companie</dt>
								<dd>{companyName.trim()}</dd>
							{/if}
							{#if note.trim()}
								<dt>Detalii</dt>
								<dd class="sq-pre">{note.trim()}</dd>
							{/if}
						</dl>
					</div>

					{#if errorMessage}
						<div class="sq-submit-err" role="alert">
							<strong>Cererea nu a plecat.</strong>
							{errorMessage}
						</div>
					{/if}

					<p class="sq-consent">
						Trimițând cererea, ești de acord să te contactăm pe datele de mai sus. Nu le folosim
						pentru altceva.
					</p>
				{/if}
			</div>

			<aside class="sq-summary" aria-label="Sumar ofertă">
				<div class="sq-summary-head">Sumar ofertă</div>

				{#if summary.lines.length === 0}
					<p class="sq-summary-empty">Niciun serviciu ales încă.</p>
				{:else}
					{#each summary.lines as line (line.categorySlug)}
						<div class="sq-cart-item">
							<div class="sq-cart-name">
								<strong>{line.name}</strong>
								<span>{tierLabel(line.tier)}</span>
							</div>
							<div class="sq-cart-price">
								{#if line.monthlyEur !== null}
									{formatEur(line.monthlyEur)}<small>/lună</small>
								{:else if line.setupEur}
									{formatEur(line.setupEur)}<small> one-time</small>
								{:else}
									—
								{/if}
							</div>
						</div>
					{/each}

					<div class="sq-totals">
						<div class="sq-total-row">
							<span>Subtotal lunar</span>
							<strong>{formatEur(summary.monthlySubtotal)}</strong>
						</div>
						{#if summary.discountPct > 0}
							<div class="sq-total-row sq-total-discount">
								<span>Discount {summary.serviceCount} servicii (−{summary.discountPct}%)</span>
								<strong>−{formatEur(summary.monthlyDiscount)}</strong>
							</div>
						{/if}
						<div class="sq-total-row big">
							<span>Total lunar estimat</span>
							<strong>{formatEur(summary.monthlyTotal)}</strong>
						</div>
						{#if summary.setupTotal > 0}
							<div class="sq-total-row">
								<span>Setup one-time</span>
								<strong>{formatEur(summary.setupTotal)}</strong>
							</div>
						{/if}
					</div>
				{/if}

				<p class="sq-fine">
					Prețuri în EUR, fără TVA. Bugetul media și costul platformelor externe se plătesc
					separat, direct către furnizor. Oferta finală vine de la echipa noastră.
				</p>
			</aside>
		</div>
	{/if}
</CheckoutModalShell>

<style>
	/* Tokenii sunt cei din /pachete-hosting și din ServicesCatalog (--accent #1877f2,
	   --ink #0b1220, --border #e5e9f0), ca modalul să pară din același produs. */
	.sq-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* ===== Stepper ===== */
	/* Culorile stepper-ului sunt variantele „închise" ale tokenilor (albastru #0d5cc7,
	   verde #047857, gri #5f6b7c): pe fundalul #f7f8fa textul de 10–13px are nevoie de
	   ≥ 4.5:1, pe care #1877f2 / #10b981 / #94a3b8 nu-l ating. */
	.sq-stepper {
		/* Corpul coajei derulează; stepper-ul rămâne vizibil sus ca reper. */
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
	.sq-step {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.sq-step-circle {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: white;
		border: 2px solid #cbd5e1;
		display: grid;
		place-items: center;
		color: #5f6b7c;
		transition:
			background-color 0.15s,
			border-color 0.15s,
			color 0.15s;
	}
	.sq-step.active .sq-step-circle {
		background: #0d5cc7;
		border-color: #0d5cc7;
		color: white;
		box-shadow: 0 4px 12px rgba(24, 119, 242, 0.25);
	}
	.sq-step.done .sq-step-circle {
		background: #047857;
		border-color: #047857;
		color: white;
	}
	.sq-step-num {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5f6b7c;
	}
	.sq-step.active .sq-step-num {
		color: #0d5cc7;
	}
	.sq-step.done .sq-step-num {
		color: #047857;
	}
	.sq-step-label > div:last-child {
		font-size: 13.5px;
		font-weight: 600;
		color: #0b1220;
		margin-top: 1px;
	}
	.sq-step.active .sq-step-label > div:last-child {
		color: #0d5cc7;
	}
	.sq-step-line {
		flex: 1;
		height: 2px;
		background: #e5e9f0;
		margin: 0 4px;
		border-radius: 2px;
	}
	.sq-step-line.done {
		background: #047857;
	}

	/* ===== Layout ===== */
	.sq-layout {
		display: grid;
		grid-template-columns: 1fr 340px;
		min-height: 440px;
		/* Fundalul coloanei de sumar e pe layout, ca sumarul sticky să nu lase alb sub el. */
		background: linear-gradient(to right, white calc(100% - 340px), #f7f8fa calc(100% - 340px));
	}
	.sq-content {
		padding: 28px 32px 32px;
		min-width: 0;
		/* Formularul are un buton submit ascuns (absolute) — îl ținem în interiorul coloanei. */
		position: relative;
	}
	.sq-summary {
		background: #f7f8fa;
		border-left: 1px solid #e5e9f0;
		padding: 28px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		/* Totalul rămâne la vedere cât timp lista de servicii derulează în stânga. */
		position: sticky;
		top: 84px;
		align-self: start;
	}

	.sq-h2 {
		font-size: 22px;
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 0 0 6px;
		color: #0b1220;
	}
	.sq-h2:focus-visible {
		outline: 2px solid #1877f2;
		outline-offset: 4px;
		border-radius: 4px;
	}
	.sq-h3 {
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5f6b7c;
		margin: 26px 0 10px;
	}
	.sq-sub {
		font-size: 14px;
		color: #475569;
		margin: 0 0 20px;
		max-width: 540px;
	}
	.sq-removed {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0 0 12px;
		padding: 10px 12px;
		border: 1px solid #e5e9f0;
		border-left: 3px solid #64748b;
		border-radius: 10px;
		background: #f7f8fa;
		color: #475569;
		font-size: 13px;
		animation: sqFade 0.2s ease-out;
	}
	.sq-removed span {
		flex: 1;
		min-width: 0;
	}
	.sq-removed strong {
		color: #0b1220;
	}
	.sq-undo {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 11px;
		border-radius: 8px;
		border: 1px solid #e5e9f0;
		background: white;
		font-family: inherit;
		font-size: 12.5px;
		font-weight: 700;
		color: #0b1220;
		cursor: pointer;
		white-space: nowrap;
	}
	.sq-undo:hover {
		border-color: #1877f2;
		color: #1877f2;
	}
	.sq-undo:focus-visible {
		outline: 2px solid #1877f2;
		outline-offset: 2px;
	}
	@keyframes sqFade {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	.sq-empty {
		padding: 18px;
		border: 1px dashed #cbd5e1;
		border-radius: 12px;
		color: #475569;
		font-size: 13.5px;
		background: #fafbfd;
	}

	/* ===== Pas 1: iteme ===== */
	.sq-items,
	.sq-add-list,
	.sq-review-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.sq-item {
		border: 1px solid #e5e9f0;
		border-radius: 14px;
		padding: 14px 16px;
		background: white;
	}
	.sq-item-head {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.sq-item-icon {
		width: 34px;
		height: 34px;
		border-radius: 10px;
		background: #f1f5f9;
		display: grid;
		place-items: center;
		color: #0b1220;
		flex-shrink: 0;
	}
	.sq-item-name {
		flex: 1;
		min-width: 0;
	}
	.sq-item-name strong,
	.sq-add-name strong {
		display: block;
		font-size: 14px;
		color: #0b1220;
	}
	.sq-item-name span,
	.sq-add-name span {
		display: block;
		font-size: 12px;
		color: #475569;
		margin-top: 1px;
	}
	.sq-remove {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: 1px solid #e5e9f0;
		background: white;
		color: #475569;
		display: grid;
		place-items: center;
		cursor: pointer;
		flex-shrink: 0;
	}
	.sq-remove:hover {
		color: #b91c1c;
		border-color: #fecaca;
		background: #fff5f5;
	}
	.sq-remove:focus-visible,
	.sq-add:focus-visible,
	.sq-segmented button:focus-visible,
	.sq-btn-primary:focus-visible,
	.sq-btn-ghost:focus-visible {
		outline: 2px solid #1877f2;
		outline-offset: 2px;
	}

	.sq-segmented {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 2px;
		margin-top: 12px;
		padding: 3px;
		background: #f7f8fa;
		border: 1px solid #e5e9f0;
		border-radius: 8px;
	}
	.sq-segmented button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 5px;
		background: transparent;
		border: none;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		color: #475569;
		cursor: pointer;
	}
	.sq-segmented button.active {
		background: white;
		color: #0b1220;
		/* Inelul albastru: starea „apăsat" nu se poate baza doar pe alb vs #f7f8fa. */
		box-shadow:
			inset 0 0 0 1.5px #1877f2,
			0 1px 2px rgba(15, 23, 42, 0.08);
	}
	/* Aceleași culori pe tier ca în ServicesCatalog (.sv-tierdot[data-tier]) pentru punct
	   și bordură; pentru TEXT (chip-ul de 11px) folosim variantele închise, ≥ 4.5:1. */
	.sq-tierdot,
	.sq-chip {
		--tier: #94a3b8;
		--tier-text: #475569;
	}
	.sq-tierdot[data-tier='bronze'],
	.sq-chip[data-tier='bronze'] {
		--tier: #c2823f;
		--tier-text: #9a5b1f;
	}
	.sq-tierdot[data-tier='gold'],
	.sq-chip[data-tier='gold'] {
		--tier: #d4a017;
		--tier-text: #a16207;
	}
	.sq-tierdot[data-tier='platinum'],
	.sq-chip[data-tier='platinum'] {
		--tier: #1877f2;
		--tier-text: #0d5cc7;
	}
	.sq-tierdot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--tier);
	}

	.sq-add {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		background: white;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.12s,
			background 0.12s;
	}
	.sq-add:hover {
		border-color: #1877f2;
		background: rgba(24, 119, 242, 0.04);
	}
	.sq-add-name {
		flex: 1;
		min-width: 0;
	}
	.sq-add-cta {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		font-weight: 700;
		color: #0d5cc7;
		white-space: nowrap;
	}

	/* ===== Pas 2: formular ===== */
	.sq-grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.sq-span-2 {
		grid-column: span 2;
	}
	.sq-field {
		display: flex;
		flex-direction: column;
	}
	.sq-label {
		display: block;
		font-size: 12px;
		font-weight: 600;
		color: #475569;
		margin-bottom: 6px;
	}
	.sq-input {
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
	.sq-input:focus {
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	/* Focus vizibil și pe câmpurile cu eroare (acolo bordura roșie ar masca inelul albastru). */
	.sq-input:focus-visible {
		outline: 2px solid #1877f2;
		outline-offset: 2px;
	}
	.sq-input.sq-input-error {
		border-color: #ef4444;
		background: #fff5f5;
	}
	.sq-input.sq-input-error:focus-visible {
		outline-color: #b91c1c;
	}
	.sq-textarea {
		resize: vertical;
		min-height: 110px;
		line-height: 1.5;
	}
	.sq-hint {
		font-size: 11.5px;
		margin-top: 4px;
		color: #5f6b7c;
	}
	.sq-hint-err {
		color: #b91c1c;
	}

	/* ===== Pas 3: recapitulare ===== */
	.sq-review {
		border: 1px solid #e5e9f0;
		border-radius: 14px;
		padding: 16px 18px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.sq-review-head {
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #5f6b7c;
	}
	.sq-review-list + .sq-review-head {
		margin-top: 8px;
	}
	.sq-review-list li {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13.5px;
	}
	.sq-review-list strong {
		flex: 1;
		min-width: 0;
		color: #0b1220;
	}
	.sq-review-price {
		color: #475569;
		white-space: nowrap;
	}
	.sq-chip {
		font-size: 11px;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 999px;
		color: var(--tier-text);
		border: 1px solid color-mix(in srgb, var(--tier) 35%, transparent);
		background: color-mix(in srgb, var(--tier) 10%, white);
		white-space: nowrap;
	}
	.sq-review-dl {
		display: grid;
		grid-template-columns: 96px 1fr;
		gap: 6px 12px;
		margin: 0;
		font-size: 13.5px;
	}
	.sq-review-dl dt {
		color: #5f6b7c;
	}
	.sq-review-dl dd {
		margin: 0;
		color: #0b1220;
		overflow-wrap: anywhere;
	}
	.sq-pre {
		white-space: pre-line;
	}
	.sq-submit-err {
		margin-top: 14px;
		padding: 12px 14px;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: 10px;
		color: #b91c1c;
		font-size: 13px;
		line-height: 1.5;
	}
	.sq-submit-err strong {
		display: block;
		margin-bottom: 2px;
		color: #991b1b;
	}
	.sq-consent {
		margin: 16px 0 0;
		font-size: 12px;
		color: #5f6b7c;
		line-height: 1.5;
	}

	/* ===== Sumar ===== */
	.sq-summary-head {
		font-size: 11px;
		font-weight: 800;
		color: #5f6b7c;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding-bottom: 4px;
	}
	.sq-summary-empty {
		margin: 0;
		font-size: 13px;
		color: #5f6b7c;
	}
	.sq-cart-item {
		padding: 10px 0;
		border-top: 1px solid #e5e9f0;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	.sq-cart-name strong {
		display: block;
		font-size: 13.5px;
		color: #0b1220;
	}
	.sq-cart-name span {
		font-size: 11.5px;
		color: #475569;
		margin-top: 2px;
		display: block;
	}
	.sq-cart-price {
		font-weight: 700;
		font-size: 14px;
		color: #0b1220;
		white-space: nowrap;
	}
	.sq-cart-price small {
		font-size: 11px;
		font-weight: 500;
		color: #5f6b7c;
	}
	.sq-totals {
		padding-top: 12px;
		border-top: 1px solid #e5e9f0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sq-total-row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
		color: #475569;
	}
	.sq-total-row strong {
		color: #0b1220;
		font-weight: 600;
		white-space: nowrap;
	}
	.sq-total-discount,
	.sq-total-discount strong {
		color: #047857;
	}
	.sq-total-row.big {
		margin-top: 8px;
		padding-top: 12px;
		border-top: 1px solid #e5e9f0;
		font-size: 15px;
	}
	.sq-total-row.big strong {
		font-size: 24px;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: #1877f2;
	}
	.sq-fine {
		margin: 12px 0 0;
		padding-top: 12px;
		border-top: 1px solid #e5e9f0;
		font-size: 11.5px;
		line-height: 1.5;
		color: #5f6b7c;
	}

	/* ===== Footer & butoane ===== */
	.sq-foot {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.sq-foot-meta {
		flex: 1;
		text-align: center;
		font-size: 12.5px;
		color: #5f6b7c;
	}
	.sq-foot-warn {
		color: #b45309;
	}
	.sq-btn-primary {
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
	.sq-btn-primary:not(:disabled):hover {
		background: #0d5cc7;
		transform: translateY(-1px);
		box-shadow: 0 6px 16px rgba(24, 119, 242, 0.25);
	}
	.sq-btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.sq-btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 16px;
		border-radius: 9px;
		background: transparent;
		border: 1px solid #e5e9f0;
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		color: #475569;
		cursor: pointer;
	}
	.sq-btn-ghost:not(:disabled):hover {
		background: white;
		color: #0b1220;
	}
	.sq-btn-ghost:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ===== Confirmare ===== */
	.sq-success {
		text-align: center;
		padding: 16px 8px 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}
	.sq-success :global(.sq-success-icon) {
		width: 52px;
		height: 52px;
		color: #10b981;
	}
	.sq-success h2 {
		font-size: 22px;
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 4px 0 0;
		color: #0b1220;
	}
	.sq-success p {
		margin: 0 0 12px;
		font-size: 14px;
		color: #475569;
		max-width: 420px;
		line-height: 1.55;
	}

	@media (max-width: 880px) {
		.sq-layout {
			grid-template-columns: 1fr;
			background: white;
		}
		.sq-summary {
			border-left: none;
			border-top: 1px solid #e5e9f0;
			position: static;
		}
		.sq-content {
			padding: 22px 20px 24px;
		}
		.sq-grid-2 {
			grid-template-columns: 1fr;
		}
		.sq-span-2 {
			grid-column: span 1;
		}
		.sq-stepper {
			padding: 16px 18px;
		}
		/* Etichetele pașilor inactivi rămân pentru cititorul de ecran, doar vizual ascunse. */
		.sq-step:not(.active) .sq-step-label,
		.sq-foot-meta {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		/* Fără textul din mijloc, butonul principal stă la dreapta, ca pe desktop. */
		.sq-foot > .sq-btn-primary {
			margin-left: auto;
		}
		.sq-segmented button {
			padding: 6px 9px;
		}
	}
	@media (max-width: 480px) {
		/* „Înapoi" + „Trimite cererea" nu încap pe un rând de ~330px. */
		.sq-foot {
			flex-wrap: wrap;
		}
		.sq-foot > .sq-btn-primary {
			flex: 1 1 100%;
			justify-content: center;
			order: -1;
		}
		/* Recapitulare: numele pe un rând, tier-ul și prețul dedesubt — altfel numele lungi
		   („Dezvoltare Website WordPress") se rupeau în jurul chip-ului. */
		.sq-review-list li {
			display: grid;
			grid-template-columns: 34px minmax(0, 1fr) auto;
			grid-template-areas:
				'icon name name'
				'icon chip price';
			row-gap: 4px;
			align-items: center;
		}
		.sq-review-list .sq-item-icon {
			grid-area: icon;
		}
		.sq-review-list strong {
			grid-area: name;
		}
		.sq-review-list .sq-chip {
			grid-area: chip;
			justify-self: start;
		}
		.sq-review-price {
			grid-area: price;
		}
		.sq-review-dl {
			grid-template-columns: 80px 1fr;
		}
		/* Selectorul de tier pe un singur rând, cu butoane egale (în loc de 3 + 1 pe rândul doi). */
		.sq-segmented {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(52px, 1fr));
		}
		.sq-segmented button {
			justify-content: center;
			gap: 4px;
			padding: 7px 2px;
			font-size: 11px;
		}
		.sq-segmented .sq-tierdot {
			width: 6px;
			height: 6px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sq-btn-primary:not(:disabled):hover {
			transform: none;
		}
		.sq-removed {
			animation: none;
		}
	}
</style>
