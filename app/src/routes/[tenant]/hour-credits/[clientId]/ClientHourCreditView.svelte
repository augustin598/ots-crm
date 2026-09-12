<script lang="ts">
	/**
	 * Fișa de credit a unui client: antet cu disponibilul mare, banner sub prag,
	 * cele trei carduri (alimentare / ajustare / expirare) și cele două tabele
	 * (ledger + consum pe taskuri).
	 */
	import { page } from '$app/state';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import {
		adjustHourCredit,
		getClientHourCreditView,
		setClientHourCreditFromInvoices
	} from '$lib/remotes/hour-credits.remote';
	import { LEDGER_KIND_LABELS } from '$lib/logic/hour-credits';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import HcAvatar from '$lib/components/hour-credits/HcAvatar.svelte';
	import HcGauge from '$lib/components/hour-credits/HcGauge.svelte';
	import HcSwitch from '$lib/components/hour-credits/HcSwitch.svelte';
	import HcAddHoursModal from '$lib/components/hour-credits/HcAddHoursModal.svelte';
	import {
		creditToEur,
		fmtDate,
		fmtDateShort,
		fmtHoursShort,
		fmtMinutes,
		fmtRelative
	} from '$lib/components/hour-credits/hour-credits-format';

	/** Etichetele de status ale taskurilor, ca în board. */
	const TASK_STATUS_LABELS: Record<string, string> = {
		todo: 'de făcut',
		'in-progress': 'în lucru',
		review: 'în review',
		'pending-approval': 'așteaptă aprobare',
		blocked: 'blocat',
		done: 'finalizat',
		cancelled: 'anulat'
	};

	let { clientId }: { clientId: string } = $props();

	const tenantSlug = $derived(page.params.tenant ?? '');
	const view = $derived(await getClientHourCreditView(clientId));

	const available = $derived(view.balanceMinutes - view.reservedMinutes);
	const low = $derived(available < view.lowCreditThresholdMinutes);
	// Consumul din ultimele 30 de zile, din mișcările deja aduse pentru ledger.
	const consumed30 = $derived(
		view.entries
			.filter(
				(e) =>
					e.kind === 'task_consumption' &&
					new Date(e.createdAt).getTime() > Date.now() - 30 * 86_400_000
			)
			.reduce((s, e) => s + Math.abs(e.deltaMinutes), 0)
	);

	let addOpen = $state(false);

	let optError = $state<string | null>(null);
	async function toggleOptIn(enabled: boolean) {
		optError = null;
		try {
			await setClientHourCreditFromInvoices({ clientId, enabled }).updates(
				getClientHourCreditView(clientId)
			);
		} catch (err) {
			optError = remoteErrorMessage(err, 'Nu am putut salva bifa.');
		}
	}

	// Ajustare manuală: ore zecimale în UI, minute (multiplu de pas) spre server.
	let adjustHours = $state(1);
	let adjustSign = $state<'+' | '-'>('+');
	let adjustNote = $state('');
	let adjusting = $state(false);
	let adjustError = $state<string | null>(null);
	const adjustMinutes = $derived(
		Math.round(Number(adjustHours) * 60) * (adjustSign === '-' ? -1 : 1)
	);

	async function submitAdjust(e: SubmitEvent) {
		e.preventDefault();
		adjusting = true;
		adjustError = null;
		try {
			await adjustHourCredit({
				clientId,
				deltaMinutes: adjustMinutes,
				note: adjustNote.trim()
			}).updates(getClientHourCreditView(clientId));
			adjustNote = '';
		} catch (err) {
			adjustError = remoteErrorMessage(err, 'Nu am putut ajusta creditul.');
		} finally {
			adjusting = false;
		}
	}

	function sourceHref(sourceType: string, sourceId: string): string | null {
		if (sourceType === 'invoice') return `/${tenantSlug}/invoices/${sourceId}`;
		if (sourceType === 'task') return `/${tenantSlug}/tasks/${sourceId}`;
		return null;
	}

	/** Fundalul pastilei din ledger: verde la alimentare, roșu la consum, gri la expirare. */
	function toneOf(kind: string, delta: number): string {
		if (kind === 'expire') return 'var(--hc-chip-mut-bg)';
		return delta > 0 ? 'var(--hc-ok-bg)' : 'var(--hc-err-bg)';
	}
</script>

<div class="hc-wrap">
	<div class="hc-detail-hero">
		<div class="hc-in">
			<div class="hc-detail-main">
				<a class="hc-back" href="/{tenantSlug}/hour-credits">
					<ChevronLeftIcon size={14} /> Bugete ore
				</a>
				<div class="hc-detail-title">
					<HcAvatar id={clientId} name={view.clientName} lg />
					<div>
						<h1>{view.clientName}</h1>
						<div class="hc-detail-meta">
							<span>{view.cui ?? 'fără CUI'}</span>
							{#if view.reference}
								<span>referință {view.reference.label}, {view.reference.rateEur} €/h</span>
							{/if}
							<span>ultima mișcare {fmtRelative(view.entries[0]?.createdAt ?? null)}</span>
						</div>
					</div>
				</div>
				<div class="hc-detail-gauge">
					<HcGauge
						balance={view.balanceMinutes}
						reserved={view.reservedMinutes}
						spent={consumed30}
						lg
					/>
					<div class="hc-split">
						<div>Sold total<b>{fmtMinutes(view.balanceMinutes)}</b></div>
						<div>Rezervat de taskuri<b class="amber">{fmtMinutes(view.reservedMinutes)}</b></div>
						<div>Consum ultimele 30 zile<b>{fmtMinutes(consumed30)}</b></div>
					</div>
				</div>
			</div>

			<div class="hc-detail-side">
				<div class="hc-bignum-l">Disponibil acum</div>
				<div class="hc-bignum" class:neg={available < 0}>{fmtMinutes(available)}</div>
				{#if view.reference}
					<div style="font-size:12.5px;color:var(--hc-muted);margin-top:10px">
						≈ {creditToEur(available, view.reference.rateEur)} la tariful de referință
					</div>
				{/if}
				<div class="hc-side-actions">
					<a class="hc-btn hc-btn-ghost" href="/{tenantSlug}/clients/{clientId}">
						Panoul clientului
					</a>
					{#if view.canEdit}
						<button type="button" class="hc-btn hc-btn-primary" onclick={() => (addOpen = true)}>
							<PlusIcon size={15} /> Adaugă ore
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<div class="hc-in">
		{#if low}
			<div class="hc-banner">
				<span class="hc-chip hc-chip-err">
					{view.balanceMinutes < 0 ? 'Depășire' : 'Sub prag'}
				</span>
				<span class="hc-banner-text">
					{#if view.balanceMinutes < 0}
						Clientul a consumat cu {fmtMinutes(Math.abs(view.balanceMinutes))} mai mult decât are în
						credit. Taskurile deschise mai rezervă {fmtMinutes(view.reservedMinutes)}.
					{:else}
						Disponibilul e sub pragul de {fmtMinutes(view.lowCreditThresholdMinutes)}. Taskurile
						deschise rezervă deja {fmtMinutes(view.reservedMinutes)}.
					{/if}
				</span>
				{#if view.canEdit}
					<button type="button" class="hc-btn hc-btn-primary" onclick={() => (addOpen = true)}>
						Propune reîncărcare
					</button>
				{/if}
			</div>
		{/if}

		<div class="hc-grid3">
			<div class="hc-card">
				<div class="hc-card-h">
					<h3>Alimentare din facturi</h3>
					<p>
						Facturile plătite (fără hosting, ads, depășiri și comenzi de ore) se convertesc în ore
						la tariful de referință, la cursul BNR din ziua plății.
					</p>
				</div>
				<div class="hc-card-b">
					{#if optError}
						<div class="hc-error">{optError}</div>
					{/if}
					<div class="hc-switchrow" class:on={view.optedIn}>
						<HcSwitch
							checked={view.optedIn}
							disabled={!view.canEdit}
							label="Facturile plătite alimentează creditul"
							onchange={toggleOptIn}
						/>
						<div>
							<div class="hc-switch-label">Facturile plătite alimentează creditul</div>
							<div class="hc-switch-sub">
								{view.optedIn
									? 'Activ · facturile eligibile intră automat în ledger'
									: 'Inactiv · facturile plătite nu intră în ledger'}
							</div>
						</div>
					</div>
				</div>
			</div>

			<div class="hc-card">
				<div class="hc-card-h">
					<h3>Ajustare manuală</h3>
					<p>Doar owner/admin. Motivul e obligatoriu și rămâne în ledger.</p>
				</div>
				<div class="hc-card-b">
					{#if view.canEdit}
						{#if adjustError}
							<div class="hc-error">{adjustError}</div>
						{/if}
						<form onsubmit={submitAdjust}>
							<div class="hc-pair" style="margin-bottom:4px">
								<div class="hc-field">
									<span id="adjust-sign-label">Semn</span>
									<div class="hc-signs" role="group" aria-labelledby="adjust-sign-label">
										<button
											type="button"
											class="plus"
											class:active={adjustSign === '+'}
											aria-pressed={adjustSign === '+'}
											onclick={() => (adjustSign = '+')}>+</button
										>
										<button
											type="button"
											class="minus"
											class:active={adjustSign === '-'}
											aria-pressed={adjustSign === '-'}
											onclick={() => (adjustSign = '-')}>−</button
										>
									</div>
								</div>
								<label class="hc-field">
									<span>Ore</span>
									<input
										class="hc-input"
										type="number"
										min="0.5"
										step="0.5"
										bind:value={adjustHours}
									/>
								</label>
							</div>
							<label class="hc-field">
								<span>Motiv</span>
								<textarea
									class="hc-area"
									bind:value={adjustNote}
									placeholder="ex. ore incluse în contractul semnat pe 1 septembrie"
								></textarea>
							</label>
							<div class="hc-preview">
								Sold după ajustare: <b>{fmtMinutes(view.balanceMinutes + adjustMinutes)}</b>
							</div>
							<button
								type="submit"
								class="hc-btn hc-btn-primary"
								disabled={adjusting || adjustNote.trim().length < 5}
							>
								{adjusting ? 'Se aplică…' : 'Aplică ajustarea'}
							</button>
						</form>
					{:else}
						<p class="hc-muted">Doar owner-ul sau un admin pot ajusta creditul.</p>
					{/if}
				</div>
			</div>

			<div class="hc-card">
				<div class="hc-card-h">
					<h3>Expirare</h3>
					<p>Creditul neconsumat iese din sold la finalul perioadei stabilite în contract.</p>
				</div>
				<div class="hc-card-b">
					{#if view.expiring}
						<div
							style="font-size:26px;font-weight:800;color:var(--cl-text);letter-spacing:-.02em;font-variant-numeric:tabular-nums"
						>
							{fmtMinutes(view.expiring.minutes)}
						</div>
						<div class="hc-muted" style="margin-top:4px;margin-bottom:14px">
							expiră pe {fmtDateShort(view.expiring.on)}
							{#if view.balanceMinutes > 0}
								· {Math.round((view.expiring.minutes / view.balanceMinutes) * 100)}% din sold
							{/if}
						</div>
						{#if view.expiringTotalMinutes > view.expiring.minutes}
							<div class="hc-preview">
								În total <b>{fmtMinutes(view.expiringTotalMinutes)}</b> au termen de expirare.
							</div>
						{/if}
					{:else}
						<div class="hc-muted">
							Fără credit cu termen de expirare. Orele rămân în sold până la consum.
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="hc-grid2 tables">
			<div class="hc-tablecard">
				<div class="hc-card-h tight">
					<h3>Ledger</h3>
					<p>Toate mișcările, cele mai recente sus. Soldul de mai sus e suma lor.</p>
				</div>
				{#if view.entries.length === 0}
					<div class="hc-empty"><b>Nicio mișcare</b>Creditul clientului e gol.</div>
				{:else}
					<div class="hc-tablescroll">
						<table class="hc-table">
							<thead>
								<tr>
									<th>Mișcare</th>
									<th>Sursă</th>
									<th class="r">Ore</th>
								</tr>
							</thead>
							<tbody>
								{#each view.entries as e (e.id)}
									{@const plus = e.deltaMinutes > 0}
									{@const href = sourceHref(e.sourceType, e.sourceId)}
									<tr>
										<td>
											<div class="hc-led-type">
												<span
													class="hc-led-ic"
													style:background={toneOf(e.kind, e.deltaMinutes)}
													style:color={plus ? 'var(--hc-ok-fg)' : 'var(--hc-err-fg)'}
													aria-hidden="true"
												>
													{plus ? '+' : '−'}
												</span>
												<span>{e.note || LEDGER_KIND_LABELS[e.kind]}</span>
											</div>
											<div class="hc-muted hc-led-sub">
												{fmtDate(e.createdAt)}
												{#if href}
													· <a {href}>{LEDGER_KIND_LABELS[e.kind]}</a>
												{:else}
													· {LEDGER_KIND_LABELS[e.kind]}
												{/if}
											</div>
										</td>
										<td class="hc-muted">
											{e.sourceType === 'manual'
												? 'manual'
												: e.sourceType === 'invoice'
													? 'factură'
													: e.sourceType === 'hours_order'
														? '/servicii'
														: e.sourceType === 'ledger'
															? 'automat'
															: 'task'}
										</td>
										<td class="hc-num {plus ? 'hc-plus' : 'hc-minus'}">
											{plus ? '+' : ''}{fmtMinutes(e.deltaMinutes)}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<div class="hc-tablecard">
				<div class="hc-card-h tight">
					<h3>Consum pe taskuri</h3>
					<p>
						Rezervatul de mai sus e suma estimărilor taskurilor deschise, ponderate cu tariful
						specializării. Bara arată pontatul față de estimat.
					</p>
				</div>
				{#if view.tasks.length === 0}
					<div class="hc-empty">
						<b>Niciun task cu ore</b>
						Taskurile clientului care au estimare sau pontaj apar aici.
					</div>
				{:else}
					<div class="hc-tablescroll">
						<table class="hc-table">
							<thead>
								<tr>
									<th>Task</th>
									<th class="r">Estimat / pontat</th>
								</tr>
							</thead>
							<tbody>
								{#each view.tasks as t (t.id)}
									{@const est = t.estimatedMinutes ?? 0}
									{@const used = t.actualMinutes ?? 0}
									{@const over = est > 0 && used > est}
									<tr>
										<td>
											<a class="hc-strong" href="/{tenantSlug}/tasks/{t.id}">{t.title}</a>
											<div class="hc-muted">
												{[
													t.projectName,
													t.ownerName,
													TASK_STATUS_LABELS[t.status] ?? t.status,
													t.creditSettledAt ? 'decontat' : 'rezervă credit'
												]
													.filter(Boolean)
													.join(' · ')}
											</div>
											{#if est > 0}
												<div style="margin-top:7px;max-width:240px">
													<div class="hc-bartrack">
														<div
															class="hc-barfill"
															style:width="{Math.min((used / est) * 100, 100)}%"
															style:background={over ? 'var(--hc-err)' : 'var(--cl-accent)'}
														></div>
													</div>
												</div>
											{/if}
										</td>
										<td class="hc-num" class:hc-minus={over}>
											{fmtHoursShort(est)} / {fmtHoursShort(used)}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

{#if addOpen}
	<HcAddHoursModal
		clients={[{ id: clientId, name: view.clientName }]}
		initialClientId={clientId}
		onclose={() => (addOpen = false)}
		ondone={() => getClientHourCreditView(clientId).refresh()}
	/>
{/if}
