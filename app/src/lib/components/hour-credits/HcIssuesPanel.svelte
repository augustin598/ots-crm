<script lang="ts">
	/**
	 * Tabul „De rezolvat" din Bugete ore: situațiile în care bani sau ore s-ar pierde
	 * fără urmă — depășiri fără factură, taskuri Done nedecontate, facturi anulate
	 * care au dat deja ore. Toate acțiunile sunt idempotente pe server.
	 */
	import {
		getHourCreditsPage,
		issueHourCreditInvoiceNow,
		regenerateTaskOverage,
		reverseCancelledInvoiceHours,
		settleDoneTaskNow
	} from '$lib/remotes/hour-credits.remote';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import { fmtDate, fmtMinutes } from './hour-credits-format';

	type Issues = Awaited<ReturnType<typeof getHourCreditsPage>>['issues'];

	let { issues, tenantSlug, canEdit }: { issues: Issues; tenantSlug: string; canEdit: boolean } =
		$props();

	let busyId = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	/** Ore efective introduse pe loc pentru taskurile Done care n-au niciuna salvată. */
	let hoursByTask = $state<Record<string, number>>({});

	async function run(id: string, action: () => Promise<unknown>, fallback: string) {
		busyId = id;
		actionError = null;
		try {
			await action();
		} catch (err) {
			actionError = remoteErrorMessage(err, fallback);
		} finally {
			busyId = null;
		}
	}

	const total = $derived(
		issues.unbilledOverages.length +
			issues.unsettledDone.length +
			issues.cancelledCredited.length +
			issues.uninvoicedCredits.length
	);
	/** Rezultatul ultimei emiteri (avertismente Keez/email), afișat sub tabel. */
	let issueWarnings = $state<string[]>([]);
</script>

{#if actionError}
	<div class="hc-error">{actionError}</div>
{/if}

{#if total === 0}
	<div class="hc-tablecard">
		<div class="hc-empty">
			<b>Nimic de rezolvat</b>Depășirile sunt facturate, taskurile Done sunt decontate.
		</div>
	</div>
{/if}

{#if issues.uninvoicedCredits.length > 0}
	<div class="hc-tablecard">
		<div class="hc-card-h tight">
			<h3>Ore adăugate fără factură</h3>
			<p>
				Creditul a intrat, dar factura nu s-a emis (curs BNR lipsă sau eroare la creare). Factura se
				emite la prețul de la momentul adăugării, cu cursul BNR de azi; emailul nu pleacă automat.
			</p>
		</div>
		{#if issueWarnings.length > 0}
			<div style="padding:0 18px">
				{#each issueWarnings as w (w)}<div class="hc-error">{w}</div>{/each}
			</div>
		{/if}
		<div class="hc-tablescroll">
			<table class="hc-table">
				<thead>
					<tr>
						<th>Client</th>
						<th class="r">Ore</th>
						<th class="r">Credit</th>
						<th>Adăugate</th>
						<th class="r"></th>
					</tr>
				</thead>
				<tbody>
					{#each issues.uninvoicedCredits as c (c.ledgerEntryId)}
						<tr>
							<td>
								<a class="hc-strong" href="/{tenantSlug}/hour-credits/{c.clientId}"
									>{c.clientName}</a
								>
							</td>
							<td class="hc-num">{c.hours} h</td>
							<td class="hc-num">{fmtMinutes(c.creditMinutes)}</td>
							<td>{fmtDate(c.createdAt)}</td>
							<td class="r">
								{#if canEdit}
									<button
										type="button"
										class="hc-btn hc-btn-light"
										disabled={busyId === c.ledgerEntryId}
										onclick={() =>
											run(
												c.ledgerEntryId,
												async () => {
													const res = await issueHourCreditInvoiceNow({
														ledgerEntryId: c.ledgerEntryId,
														sendEmail: false
													}).updates(getHourCreditsPage());
													issueWarnings = res.warnings;
												},
												'Nu am putut emite factura.'
											)}
									>
										{busyId === c.ledgerEntryId ? '…' : 'Emite factura'}
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

{#if issues.unbilledOverages.length > 0}
	<div class="hc-tablecard">
		<div class="hc-card-h tight">
			<h3>Depășiri fără factură</h3>
			<p>
				Taskuri decontate peste credit a căror linie nu stă pe niciun draft (draftul a picat sau a
				fost șters). Regenerarea folosește tariful înghețat la decontare.
			</p>
		</div>
		<div class="hc-tablescroll">
			<table class="hc-table">
				<thead>
					<tr>
						<th>Task</th>
						<th>Client</th>
						<th class="r">Peste credit</th>
						<th>Decontat</th>
						<th class="r"></th>
					</tr>
				</thead>
				<tbody>
					{#each issues.unbilledOverages as o (o.taskId)}
						<tr>
							<td><a class="hc-strong" href="/{tenantSlug}/tasks/{o.taskId}">{o.taskTitle}</a></td>
							<td>{o.clientName}</td>
							<td class="hc-num">{fmtMinutes(o.overageRealMinutes)}</td>
							<td>{fmtDate(o.settledAt)}</td>
							<td class="r">
								{#if canEdit}
									<button
										type="button"
										class="hc-btn hc-btn-light"
										disabled={busyId === o.taskId}
										onclick={() =>
											run(
												o.taskId,
												() => regenerateTaskOverage(o.taskId).updates(getHourCreditsPage()),
												'Nu am putut regenera draftul.'
											)}
									>
										{busyId === o.taskId ? '…' : 'Regenerează draftul'}
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

{#if issues.unsettledDone.length > 0}
	<div class="hc-tablecard">
		<div class="hc-card-h tight">
			<h3>Taskuri Done nedecontate</h3>
			<p>
				Taskuri finalizate fără decontare: fie n-au ore efective, fie decontarea n-a rulat. Nu
				rezervă și n-au consumat din credit.
			</p>
		</div>
		<div class="hc-tablescroll">
			<table class="hc-table">
				<thead>
					<tr>
						<th>Task</th>
						<th>Client</th>
						<th class="r">Ore</th>
						<th>Actualizat</th>
						<th class="r"></th>
					</tr>
				</thead>
				<tbody>
					{#each issues.unsettledDone as t (t.taskId)}
						<tr>
							<td><a class="hc-strong" href="/{tenantSlug}/tasks/{t.taskId}">{t.taskTitle}</a></td>
							<td>{t.clientName}</td>
							<td class="hc-num">
								{#if t.actualMinutes}
									{fmtMinutes(t.actualMinutes)}
								{:else if canEdit}
									<input
										class="hc-input"
										style="width:84px;text-align:right"
										type="number"
										min="0.25"
										step="0.25"
										placeholder="ore"
										aria-label="Ore efective pentru {t.taskTitle}"
										bind:value={hoursByTask[t.taskId]}
									/>
								{:else}
									—
								{/if}
							</td>
							<td>{fmtDate(t.updatedAt)}</td>
							<td class="r">
								{#if canEdit}
									<button
										type="button"
										class="hc-btn hc-btn-light"
										disabled={busyId === t.taskId ||
											(!t.actualMinutes && !(hoursByTask[t.taskId] > 0))}
										onclick={() =>
											run(
												t.taskId,
												() =>
													settleDoneTaskNow({
														taskId: t.taskId,
														actualMinutes: t.actualMinutes
															? undefined
															: Math.round(Number(hoursByTask[t.taskId]) * 60)
													}).updates(getHourCreditsPage()),
												'Nu am putut deconta taskul.'
											)}
									>
										{busyId === t.taskId ? '…' : 'Decontează'}
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

{#if issues.cancelledCredited.length > 0}
	<div class="hc-tablecard">
		<div class="hc-card-h tight">
			<h3>Facturi anulate care au dat ore</h3>
			<p>
				Anularea nu retrage orele automat. Retragerea scade exact minutele intrate din factură și se
				face o singură dată.
			</p>
		</div>
		<div class="hc-tablescroll">
			<table class="hc-table">
				<thead>
					<tr>
						<th>Factură</th>
						<th>Client</th>
						<th class="r">Ore date</th>
						<th class="r"></th>
					</tr>
				</thead>
				<tbody>
					{#each issues.cancelledCredited as inv (inv.invoiceId)}
						<tr>
							<td>
								<a class="hc-strong" href="/{tenantSlug}/invoices/{inv.invoiceId}">
									{inv.invoiceNumber ?? inv.invoiceId.slice(0, 8)}
								</a>
							</td>
							<td>{inv.clientName}</td>
							<td class="hc-num">{fmtMinutes(inv.creditedMinutes)}</td>
							<td class="r">
								{#if canEdit}
									<button
										type="button"
										class="hc-btn hc-btn-light"
										disabled={busyId === inv.invoiceId}
										onclick={() =>
											run(
												inv.invoiceId,
												() =>
													reverseCancelledInvoiceHours(inv.invoiceId).updates(getHourCreditsPage()),
												'Nu am putut retrage orele.'
											)}
									>
										{busyId === inv.invoiceId ? '…' : 'Retrage orele'}
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
