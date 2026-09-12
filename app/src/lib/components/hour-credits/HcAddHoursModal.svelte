<script lang="ts">
	/**
	 * „Adaugă ore unui client".
	 *
	 * Fluxul: creditul intră în ledger ACUM, apoi se emite factura Keez, apoi
	 * factura pleacă pe email cu link de plată. Previewul de preț NU recalculează
	 * nimic local — cere cotația serverului (`quoteHourCredit`), care folosește
	 * `effectiveRateEur`, aceeași funcție ca /servicii. Așa suma afișată nu poate
	 * diverge de cea facturată.
	 */
	import XIcon from '@lucide/svelte/icons/x';
	import {
		addHoursToClient,
		getHourCreditsPage,
		getHourOrderOptions,
		quoteHourCredit
	} from '$lib/remotes/hour-credits.remote';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import { untrack } from 'svelte';
	import { fmtMinutes, fmtMoneyCents } from './hour-credits-format';

	let {
		clients,
		initialClientId = '',
		onclose,
		ondone
	}: {
		clients: { id: string; name: string }[];
		initialClientId?: string;
		onclose: () => void;
		ondone?: () => void;
	} = $props();

	const options = $derived(await getHourOrderOptions());

	// Seed o singură dată: pagina poate deschide modalul cu un client precompletat.
	let clientId = $state(untrack(() => initialClientId));
	/** Gol = „încă nu a ales userul"; valoarea efectivă cade pe prima specializare. */
	let rateChoice = $state('');
	let modeSlug = $state('standard');
	let hours = $state(8);
	let requestedWindow = $state('');
	let sendEmail = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let result = $state<{ warnings: string[]; invoiceNumber: string | null } | null>(null);

	const rateSlug = $derived(rateChoice || options.rates[0]?.slug || '');
	const mode = $derived(options.modes.find((m) => m.slug === modeSlug) ?? options.modes[0]);
	const overMax = $derived(!!mode && hours > mode.maxHours);
	const canSubmit = $derived(!!clientId && !!rateSlug && !!modeSlug && hours >= 1 && !overMax);

	// Cotația serverului; se recalculează la orice schimbare de selecție.
	const quote = $derived(
		rateSlug && modeSlug && hours >= 1
			? await quoteHourCredit({ rateSlug, modeSlug, hours })
			: null
	);

	async function submit() {
		if (!canSubmit) return;
		saving = true;
		error = null;
		try {
			const res = await addHoursToClient({
				clientId,
				rateSlug,
				modeSlug,
				hours,
				requestedWindow: modeSlug === 'standard' ? undefined : requestedWindow || undefined,
				sendEmail
			}).updates(getHourCreditsPage());
			result = { warnings: res.warnings, invoiceNumber: res.invoiceNumber };
			ondone?.();
		} catch (err) {
			error = remoteErrorMessage(err, 'Nu am putut adăuga orele.');
		} finally {
			saving = false;
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

<div
	class="hc-modal-ovl"
	role="button"
	tabindex="-1"
	aria-label="Închide"
	onclick={onclose}
	onkeydown={(e) => e.key === 'Enter' && onclose()}
>
	<div
		class="hc-modal"
		role="dialog"
		aria-modal="true"
		aria-label="Adaugă ore unui client"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		<div class="hc-modal-h">
			<h3>Adaugă ore</h3>
			<p>
				Creditul intră imediat în soldul clientului, apoi se emite factura în Keez și pleacă pe
				email cu link de plată. Prețul e cel de pe /servicii: tarif de catalog × multiplicatorul
				regimului.
			</p>
		</div>

		<div class="hc-modal-b">
			{#if result}
				<div class="hc-preview">
					Am adăugat <b>{fmtMinutes(quote?.ok ? quote.creditMinutes : 0)}</b> în creditul
					clientului{result.invoiceNumber ? `, factura ${result.invoiceNumber}` : ''}.
				</div>
				{#each result.warnings as w (w)}
					<div class="hc-error">{w}</div>
				{/each}
			{:else}
				{#if error}
					<div class="hc-error">{error}</div>
				{/if}

				<div class="hc-grid2" style="margin-bottom:0">
					<label class="hc-field">
						<span>Client</span>
						<select class="hc-sel" bind:value={clientId}>
							<option value="">Alege un client…</option>
							{#each clients as c (c.id)}
								<option value={c.id}>{c.name}</option>
							{/each}
						</select>
					</label>
					<label class="hc-field">
						<span>Ore</span>
						<input
							class="hc-input"
							type="number"
							min="1"
							max={mode?.maxHours ?? 100}
							bind:value={hours}
						/>
					</label>
				</div>

				<label class="hc-field">
					<span>Specializare</span>
					<select
						class="hc-sel"
						value={rateSlug}
						onchange={(e) => (rateChoice = e.currentTarget.value)}
					>
						{#each options.rates as r (r.slug)}
							<option value={r.slug}>{r.label} — {r.rateEur} €/h</option>
						{/each}
					</select>
				</label>

				<div class="hc-field">
					<span>Regim de lucru</span>
					<div class="hc-modes">
						{#each options.modes as m (m.slug)}
							<button
								type="button"
								class="hc-mode"
								class:active={modeSlug === m.slug}
								aria-pressed={modeSlug === m.slug}
								onclick={() => (modeSlug = m.slug)}
							>
								<b>{m.label}</b>
								<span>{m.sla}</span>
								<em>×{(m.multiplierPct / 100).toFixed(2).replace('.', ',')}</em>
							</button>
						{/each}
					</div>
				</div>

				{#if modeSlug !== 'standard'}
					<label class="hc-field">
						<span>Când are nevoie clientul de lucrare</span>
						<input
							class="hc-input"
							bind:value={requestedWindow}
							placeholder="ex. vineri 19 sep, până la ora 18:00"
						/>
					</label>
				{/if}

				{#if quote?.ok}
					<div class="hc-preview">
						Tarif efectiv <b>{quote.effectiveRateEur} €/h</b>
						({quote.baseRateEur} € × {quote.multiplierPct}%) · net
						<b>{fmtMoneyCents(quote.netCents)}</b>
						· TVA {quote.vatPercent}% <b>{fmtMoneyCents(quote.vatCents)}</b> · credit adăugat
						<b>{fmtMinutes(quote.creditMinutes)}</b>
					</div>
				{:else if quote && !quote.ok}
					<div class="hc-preview danger">{quote.reason}</div>
				{/if}

				{#if overMax && mode}
					<div class="hc-preview danger">
						Pentru regimul „{mode.label}" se vând maximum {mode.maxHours} ore odată.
					</div>
				{/if}

				{#if modeSlug !== 'standard'}
					<div class="hc-preview">
						Regim cu start imediat: la persoane fizice e nevoie de acordul expres privind
						începerea lucrării (OUG 34/2014).
					</div>
				{/if}

				<div class="hc-switchrow" class:on={sendEmail} style="margin-top:12px">
					<button
						type="button"
						class="hc-switch"
						class:on={sendEmail}
						role="switch"
						aria-checked={sendEmail}
						aria-label="Trimite factura pe email"
						onclick={() => (sendEmail = !sendEmail)}
					></button>
					<div>
						<div class="hc-switch-label">Trimite factura pe email, cu link de plată</div>
						<div class="hc-switch-sub">
							{sendEmail
								? 'Clientul primește factura imediat după emitere.'
								: 'Nu pleacă niciun email — trimiți tu factura mai târziu.'}
						</div>
					</div>
				</div>
			{/if}
		</div>

		<div class="hc-modal-f">
			{#if result}
				<button type="button" class="hc-btn hc-btn-primary" onclick={onclose}>Închide</button>
			{:else}
				<button type="button" class="hc-btn hc-btn-light" onclick={onclose}>Renunță</button>
				<div class="hc-total">
					<div class="hc-total-l">Total de plată</div>
					<div class="hc-total-v">
						{quote?.ok ? fmtMoneyCents(quote.grossCents) : '—'}
					</div>
				</div>
				<button
					type="button"
					class="hc-btn hc-btn-primary"
					disabled={!canSubmit || saving}
					onclick={submit}
				>
					{saving ? 'Se adaugă…' : 'Adaugă ore și emite factura'}
				</button>
			{/if}
		</div>
	</div>
</div>
