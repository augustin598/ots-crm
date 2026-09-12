<script lang="ts">
	/**
	 * Settings → Tarife orare.
	 *
	 * Model de editare cerut de design: tot ce se schimbă intră într-un buffer
	 * local, bara sticky de jos se aprinde, iar „Salvează" trimite doar rândurile
	 * chiar modificate. „Renunță" revine la valorile încărcate.
	 *
	 * Salvarea nu e o singură tranzacție (sunt comenzi separate pe rând); dacă una
	 * pică, o raportăm și păstrăm formularul dirty, ca userul să poată relua.
	 */
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import {
		createHourlyRate,
		getHourlyRatesAdmin,
		updateHourCreditRules,
		updateHourlyRate,
		updateRateMode
	} from '$lib/remotes/hourly-rates.remote';
	import {
		CREDIT_EXPIRY_DAYS_MAX,
		RATE_EUR_MAX,
		RATE_EUR_MIN,
		STEP_MINUTES_OPTIONS,
		type CatalogMode,
		type CatalogRate
	} from '$lib/logic/hourly-catalog';
	import { effectiveRateEur } from '$lib/logic/hours-pricing';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import HcSwitch from '$lib/components/hour-credits/HcSwitch.svelte';
	import { fmtMinutes } from '$lib/components/hour-credits/hour-credits-format';

	const admin = $derived(await getHourlyRatesAdmin());
	const tenantSlug = $derived(page.params.tenant ?? '');

	/**
	 * Buffer editabil, semănat O SINGURĂ DATĂ din server (ca în restul
	 * settings-urilor din repo): un refresh al query-ului nu are voie să șteargă
	 * ce tocmai a tastat userul. Resemănarea o cerem explicit, după salvare sau
	 * după adăugarea unei specializări.
	 */
	let draftRates = $state<CatalogRate[]>(untrack(() => admin.rates.map((r) => ({ ...r }))));
	let draftModes = $state<CatalogMode[]>(untrack(() => admin.modes.map((m) => ({ ...m }))));
	let referenceChoice = $state<string>(untrack(() => admin.rules.referenceRateSlug ?? ''));
	let thresholdHours = $state(untrack(() => admin.rules.lowCreditThresholdMinutes / 60));
	let stepMinutes = $state<number>(untrack(() => admin.rules.stepMinutes));
	let expiryDays = $state(untrack(() => admin.rules.creditExpiryDays));
	let feedDefault = $state(untrack(() => admin.rules.feedFromInvoicesDefault));
	let notifyEmail = $state(untrack(() => admin.rules.notifyEmail));
	let notifyWhatsapp = $state(untrack(() => admin.rules.notifyWhatsapp));
	let dirty = $state(false);

	function reset() {
		draftRates = admin.rates.map((r) => ({ ...r }));
		draftModes = admin.modes.map((m) => ({ ...m }));
		referenceChoice = admin.rules.referenceRateSlug ?? '';
		thresholdHours = admin.rules.lowCreditThresholdMinutes / 60;
		stepMinutes = admin.rules.stepMinutes;
		expiryDays = admin.rules.creditExpiryDays;
		feedDefault = admin.rules.feedFromInvoicesDefault;
		notifyEmail = admin.rules.notifyEmail;
		notifyWhatsapp = admin.rules.notifyWhatsapp;
		dirty = false;
	}

	function touchRate(id: string, patch: Partial<CatalogRate>) {
		draftRates = draftRates.map((r) => (r.id === id ? { ...r, ...patch } : r));
		dirty = true;
	}
	function touchMode(slug: string, patch: Partial<CatalogMode>) {
		draftModes = draftModes.map((m) => (m.slug === slug ? { ...m, ...patch } : m));
		dirty = true;
	}

	const canEdit = $derived(admin.canEdit);
	const activeRates = $derived(draftRates.filter((r) => r.isActive));
	const activeModes = $derived(draftModes.filter((m) => m.isActive));
	const reference = $derived(
		draftRates.find((r) => r.slug === referenceChoice) ??
			activeRates.reduce<CatalogRate | null>(
				(min, r) => (!min || r.rateEur < min.rateEur ? r : min),
				null
			)
	);

	let saving = $state(false);
	let saveError = $state<string | null>(null);

	async function saveAll() {
		saving = true;
		saveError = null;
		try {
			for (const r of draftRates) {
				const original = admin.rates.find((x) => x.id === r.id);
				if (
					original &&
					original.label === r.label &&
					original.rateEur === r.rateEur &&
					original.sortOrder === r.sortOrder &&
					original.isActive === r.isActive
				) {
					continue;
				}
				await updateHourlyRate({
					id: r.id,
					label: r.label,
					rateEur: r.rateEur,
					sortOrder: r.sortOrder,
					isActive: r.isActive
				});
			}
			for (const m of draftModes) {
				const original = admin.modes.find((x) => x.slug === m.slug);
				if (
					original &&
					original.label === m.label &&
					original.suffix === m.suffix &&
					original.description === m.description &&
					original.sla === m.sla &&
					original.multiplierPct === m.multiplierPct &&
					original.maxHours === m.maxHours &&
					original.isActive === m.isActive
				) {
					continue;
				}
				await updateRateMode({
					slug: m.slug,
					label: m.label,
					suffix: m.suffix,
					description: m.description,
					sla: m.sla,
					multiplierPct: m.multiplierPct,
					maxHours: m.maxHours,
					isActive: m.isActive
				});
			}
			await updateHourCreditRules({
				referenceRateSlug: referenceChoice || null,
				lowCreditThresholdMinutes: Math.round(Number(thresholdHours) * 60),
				stepMinutes: Number(stepMinutes) as (typeof STEP_MINUTES_OPTIONS)[number],
				notifyEmail,
				notifyWhatsapp,
				creditExpiryDays: Number(expiryDays),
				feedFromInvoicesDefault: feedDefault
			});
			dirty = false;
			await getHourlyRatesAdmin().refresh();
			reset();
		} catch (err) {
			saveError = remoteErrorMessage(err, 'Nu am putut salva modificările.');
		} finally {
			saving = false;
		}
	}

	// Specializare nouă — se creează imediat (are nevoie de slug de la server).
	let newLabel = $state('');
	let newRateEur = $state(60);
	let creating = $state(false);
	let createError = $state<string | null>(null);

	async function addRate(e: SubmitEvent) {
		e.preventDefault();
		creating = true;
		createError = null;
		try {
			await createHourlyRate({ label: newLabel.trim(), rateEur: Number(newRateEur) }).updates(
				getHourlyRatesAdmin()
			);
			newLabel = '';
			if (!dirty) reset();
		} catch (err) {
			createError = remoteErrorMessage(err, 'Nu am putut adăuga specializarea.');
		} finally {
			creating = false;
		}
	}
</script>

<div class="hc-wrap hr-page">
	<div class="hc-hero">
		<div class="hc-in">
			<div class="hc-hero-main">
				<h1>Tarife orare</h1>
				<p class="hc-hero-sub">
					Tarifele pe oră după specializare, regimurile de lucru (urgență, weekend, noapte) și
					regulile creditului de ore. Aceleași valori apar pe pagina publică /servicii, în comanda
					de ore și pe facturile Keez.
				</p>
				<div class="hc-ref">
					Referință pentru creditul de ore
					{#if reference}
						<b>{reference.label}, {reference.rateEur} €/h</b>
					{:else}
						<b>nicio specializare activă</b>
					{/if}
					· prag credit scăzut <b>{fmtMinutes(Math.round(Number(thresholdHours) * 60))}</b> · vezi
					<a href="/{tenantSlug}/hour-credits">Bugete ore</a>
				</div>
			</div>
			<div class="hc-hero-actions">
				<a class="hc-btn hc-btn-ghost" href="/servicii">Vezi pe /servicii</a>
			</div>
		</div>
	</div>

	<div class="hc-in">
		{#if !canEdit}
			<div class="hc-preview" style="margin-bottom:16px">
				Poți vedea tarifele, dar doar owner-ul sau un admin le pot modifica.
			</div>
		{/if}

		<!-- ---- Specializări ---- -->
		<section class="hr-sec">
			<div class="hr-sec-h">
				<div>
					<h2>Specializări</h2>
					<p>
						Tariful de bază pe oră, fără TVA, în EUR. Slug-ul e fix după creare (ajunge în comenzi
						și în metadata Stripe). Specializările dezactivate dispar de pe /servicii și din
						formularul de task.
					</p>
				</div>
			</div>
			<div class="hr-sec-b">
				<div class="hr-scroll">
					<div class="hr-grid">
						<div class="hr-head">Denumire</div>
						<div class="hr-head r">€/h</div>
						<div class="hr-head r">Ordine</div>
						<div class="hr-head">Slug</div>
						<div class="hr-head">Activ</div>
						<div class="hr-head r">Referință</div>
						<div class="hr-row-line"></div>

						{#each draftRates as r (r.id)}
							<input
								class="hc-input"
								value={r.label}
								disabled={!canEdit}
								aria-label="Denumire specializare"
								oninput={(e) => touchRate(r.id, { label: e.currentTarget.value })}
							/>
							<input
								class="hc-input r"
								type="number"
								min={RATE_EUR_MIN}
								max={RATE_EUR_MAX}
								value={r.rateEur}
								disabled={!canEdit}
								aria-label="Tarif €/h pentru {r.label}"
								oninput={(e) => touchRate(r.id, { rateEur: Number(e.currentTarget.value) })}
							/>
							<input
								class="hc-input r"
								type="number"
								value={r.sortOrder}
								disabled={!canEdit}
								aria-label="Ordine pentru {r.label}"
								oninput={(e) => touchRate(r.id, { sortOrder: Number(e.currentTarget.value) })}
							/>
							<div class="hr-slug">
								{r.slug}
								{#if r.slug === (referenceChoice || reference?.slug)}
									<span class="hr-ref-tag">referință</span>
								{/if}
							</div>
							<HcSwitch
								checked={r.isActive}
								disabled={!canEdit}
								label="Activ {r.label}"
								onchange={(v) => touchRate(r.id, { isActive: v })}
							/>
							<div class="hr-cell r">
								{#if r.slug === (referenceChoice || reference?.slug)}
									<span class="hc-chip hc-chip-info">folosită</span>
								{:else}
									<button
										type="button"
										class="hc-btn hc-btn-light"
										style="padding:6px 10px;font-size:12px"
										disabled={!canEdit || !r.isActive}
										onclick={() => {
											referenceChoice = r.slug;
											dirty = true;
										}}
									>
										Fă referință
									</button>
								{/if}
							</div>
							<div class="hr-row-line"></div>
						{/each}
					</div>
				</div>

				{#if canEdit}
					{#if createError}
						<div class="hc-error" style="margin-top:12px">{createError}</div>
					{/if}
					<form class="hr-add" onsubmit={addRate}>
						<label class="hc-field flat">
							<span>Specializare nouă</span>
							<input class="hc-input" bind:value={newLabel} placeholder="ex. QA & Testare" />
						</label>
						<label class="hc-field flat">
							<span>€/h</span>
							<input
								class="hc-input r"
								type="number"
								min={RATE_EUR_MIN}
								max={RATE_EUR_MAX}
								bind:value={newRateEur}
							/>
						</label>
						<button
							type="submit"
							class="hc-btn hc-btn-primary"
							style="justify-content:center"
							disabled={creating || !newLabel.trim()}
						>
							{creating ? 'Se adaugă…' : 'Adaugă'}
						</button>
					</form>
				{/if}
			</div>
		</section>

		<!-- ---- Regimuri de lucru ---- -->
		<section class="hr-sec">
			<div class="hr-sec-h">
				<div>
					<h2>Regimuri de lucru</h2>
					<p>
						Majorarea se aplică pe tariful de bază și se rotunjește la euro întreg. Regimurile nu
						se cumulează. Plafonul de ore limitează o singură comandă; nu se aplică la task-uri.
					</p>
				</div>
			</div>
			<div class="hr-sec-b">
				{#each draftModes as m (m.slug)}
					{@const anchor = m.slug === 'standard'}
					<div class="hr-mode" class:anchor>
						<div class="hr-mode-h">
							<span class="hr-mode-slug">{m.slug}</span>
							{#if anchor}
								<span class="hr-mode-note">(ancora grilei: 100%, mereu activ)</span>
							{:else if reference}
								<span class="hr-mode-note">
									tarif efectiv la referință:
									<b style="color:var(--cl-text)">
										{effectiveRateEur(reference.rateEur, m.multiplierPct)} €/h
									</b>
								</span>
							{/if}
							<div style="margin-left:auto;display:flex;align-items:center;gap:9px">
								<span class="hr-mode-note">Activ</span>
								<HcSwitch
									checked={m.isActive}
									disabled={!canEdit || anchor}
									label="Activ {m.label}"
									onchange={(v) => touchMode(m.slug, { isActive: v })}
								/>
							</div>
						</div>
						<div class="hr-mode-grid">
							<label class="hc-field flat">
								<span>Denumire</span>
								<input
									class="hc-input"
									value={m.label}
									disabled={!canEdit}
									oninput={(e) => touchMode(m.slug, { label: e.currentTarget.value })}
								/>
							</label>
							<label class="hc-field flat">
								<span>Sufix pe factură</span>
								<input
									class="hc-input"
									value={m.suffix}
									placeholder="ex. Urgență 48h"
									disabled={!canEdit}
									oninput={(e) => touchMode(m.slug, { suffix: e.currentTarget.value })}
								/>
							</label>
							<label class="hc-field flat">
								<span>Multiplicator %</span>
								<input
									class="hc-input"
									type="number"
									value={m.multiplierPct}
									disabled={!canEdit || anchor}
									oninput={(e) =>
										touchMode(m.slug, { multiplierPct: Number(e.currentTarget.value) })}
								/>
							</label>
							<label class="hc-field flat">
								<span>Plafon ore / comandă</span>
								<input
									class="hc-input"
									type="number"
									value={m.maxHours}
									disabled={!canEdit}
									oninput={(e) => touchMode(m.slug, { maxHours: Number(e.currentTarget.value) })}
								/>
							</label>
							<label class="hc-field flat wide">
								<span>Descriere (sub selector, pe /servicii)</span>
								<input
									class="hc-input"
									value={m.description}
									disabled={!canEdit}
									oninput={(e) => touchMode(m.slug, { description: e.currentTarget.value })}
								/>
							</label>
							<label class="hc-field flat wide">
								<span>SLA (se îngheață pe comandă la plată)</span>
								<input
									class="hc-input"
									value={m.sla}
									disabled={!canEdit}
									oninput={(e) => touchMode(m.slug, { sla: e.currentTarget.value })}
								/>
							</label>
						</div>
					</div>
				{/each}
			</div>
		</section>

		<div class="hc-grid2">
			<!-- ---- Grila de tarife ---- -->
			<section class="hr-sec" style="margin-bottom:0">
				<div class="hr-sec-h">
					<div>
						<h2>Grila de tarife</h2>
						<p>
							Tarif de bază × multiplicator, rotunjit la euro întreg — exact cifra pe care o vede
							clientul și cea pe care o încasează Stripe.
						</p>
					</div>
				</div>
				<div class="hr-sec-b hr-scroll" style="padding:0">
					<table class="hr-matrix">
						<thead>
							<tr>
								<th>Specializare</th>
								<th class="base">Bază</th>
								{#each activeModes.filter((m) => m.slug !== 'standard') as m (m.slug)}
									<th>{m.label}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each activeRates as r (r.id)}
								<tr>
									<td>{r.label}</td>
									<td class="base">{r.rateEur} €</td>
									{#each activeModes.filter((m) => m.slug !== 'standard') as m (m.slug)}
										<td><b>{effectiveRateEur(r.rateEur, m.multiplierPct)} €</b></td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>

			<!-- ---- Reguli credit ---- -->
			<section class="hr-sec" style="margin-bottom:0">
				<div class="hr-sec-h">
					<div>
						<h2>Reguli pentru creditul de ore</h2>
						<p>Se aplică tuturor clienților, peste setările individuale din fișa fiecăruia.</p>
					</div>
				</div>
				<div class="hr-sec-b">
					<div class="hr-mode-grid" style="margin-bottom:14px">
						<label class="hc-field flat">
							<span>Tarif de referință</span>
							<select
								class="hc-sel"
								value={referenceChoice}
								disabled={!canEdit}
								onchange={(e) => {
									referenceChoice = e.currentTarget.value;
									dirty = true;
								}}
							>
								<option value="">Automat — cel mai mic tarif activ</option>
								{#each draftRates as r (r.id)}
									<option value={r.slug}>{r.label} — {r.rateEur} €/h</option>
								{/each}
							</select>
						</label>
						<label class="hc-field flat">
							<span>Prag credit scăzut (ore)</span>
							<input
								class="hc-input"
								type="number"
								min="0"
								step="0.5"
								value={thresholdHours}
								disabled={!canEdit}
								oninput={(e) => {
									thresholdHours = Number(e.currentTarget.value);
									dirty = true;
								}}
							/>
						</label>
						<label class="hc-field flat">
							<span>Expirare credit (zile)</span>
							<input
								class="hc-input"
								type="number"
								min="0"
								max={CREDIT_EXPIRY_DAYS_MAX}
								value={expiryDays}
								disabled={!canEdit}
								oninput={(e) => {
									expiryDays = Number(e.currentTarget.value);
									dirty = true;
								}}
							/>
						</label>
						<label class="hc-field flat">
							<span>Pas rotunjire (min)</span>
							<select
								class="hc-sel"
								value={stepMinutes}
								disabled={!canEdit}
								onchange={(e) => {
									stepMinutes = Number(e.currentTarget.value);
									dirty = true;
								}}
							>
								{#each STEP_MINUTES_OPTIONS as opt (opt)}
									<option value={opt}>{opt} min</option>
								{/each}
							</select>
						</label>
					</div>

					<div class="hc-switchrow" class:on={feedDefault} style="margin-bottom:12px">
						<HcSwitch
							checked={feedDefault}
							disabled={!canEdit}
							label="Alimentare implicită pentru clienții noi"
							onchange={(v) => {
								feedDefault = v;
								dirty = true;
							}}
						/>
						<div>
							<div class="hc-switch-label">
								Clienții noi pornesc cu alimentarea din facturi activă
							</div>
							<div class="hc-switch-sub">
								Facturile plătite se convertesc în ore la tariful de referință, la cursul BNR din
								ziua plății.
							</div>
						</div>
					</div>

					<div class="hc-switchrow" class:on={notifyEmail} style="margin-bottom:12px">
						<HcSwitch
							checked={notifyEmail}
							disabled={!canEdit}
							label="Notificări pe email către client"
							onchange={(v) => {
								notifyEmail = v;
								dirty = true;
							}}
						/>
						<div>
							<div class="hc-switch-label">Notificări pe email către client</div>
							<div class="hc-switch-sub">
								Creditare, credit scăzut și expirare. Oprit implicit — nimic nu pleacă spre client
								fără bifă.
							</div>
						</div>
					</div>

					<div class="hc-switchrow" class:on={notifyWhatsapp} style="margin-bottom:12px">
						<HcSwitch
							checked={notifyWhatsapp}
							disabled={!canEdit}
							label="Notificări pe WhatsApp către client"
							onchange={(v) => {
								notifyWhatsapp = v;
								dirty = true;
							}}
						/>
						<div>
							<div class="hc-switch-label">Notificări pe WhatsApp către client</div>
							<div class="hc-switch-sub">Aceleași evenimente, pe numărul din fișa clientului.</div>
						</div>
					</div>

					{#if reference}
						<div class="hc-preview" style="margin-bottom:0">
							O factură de <b>1.000 €</b> plătită azi devine
							<b>{(1000 / reference.rateEur).toFixed(1).replace('.', ',')} h</b>
							credit, la {reference.label}, {reference.rateEur} €/h.
							{#if expiryDays > 0}
								Creditul neconsumat expiră după {expiryDays} zile.
							{:else}
								Creditul nu expiră.
							{/if}
						</div>
					{/if}
				</div>
			</section>
		</div>

		{#if canEdit}
			<div class="hr-savebar">
				{#if saveError}
					<span style="color:var(--hc-err-fg)">{saveError}</span>
				{:else}
					<span>
						{dirty
							? 'Ai modificări nesalvate. Se aplică imediat pe /servicii și la comenzile noi; comenzile deja plătite păstrează tarifele înghețate.'
							: 'Toate modificările sunt salvate.'}
					</span>
				{/if}
				<div class="sp"></div>
				<button
					type="button"
					class="hc-btn hc-btn-ghost"
					disabled={!dirty || saving}
					onclick={reset}
				>
					Renunță
				</button>
				<button
					type="button"
					class="hc-btn hc-btn-primary"
					disabled={!dirty || saving}
					onclick={saveAll}
				>
					{saving ? 'Se salvează…' : 'Salvează modificările'}
				</button>
			</div>
		{/if}
		<div style="height:28px"></div>
	</div>
</div>
