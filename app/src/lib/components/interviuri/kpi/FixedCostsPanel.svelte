<script lang="ts">
	import UsersIcon from '@lucide/svelte/icons/users';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { fmtLei, rowMonthly, type FixedCostRow, type FixedMode } from '$lib/logic/interviuri-kpi';

	/**
	 * Rezumatul cheltuielilor fixe din pagină (read-only). Editarea se face în
	 * FixedCostsModal, deschis din butonul „Setări cheltuieli".
	 */
	let {
		rows,
		canEdit,
		months,
		fixedTotal,
		fixedMonthly,
		mode,
		onOpenEditor,
		onModeChange
	}: {
		rows: FixedCostRow[];
		canEdit: boolean;
		months: number;
		fixedTotal: number;
		fixedMonthly: number;
		mode: FixedMode;
		onOpenEditor: () => void;
		onModeChange: (m: FixedMode) => void;
	} = $props();

	const uid = $props.id();
	const monthsLabel = $derived(months === 1 ? 'lună' : 'luni');
	const freqLabel = (r: FixedCostRow) => (r.frequency === 'yearly' ? 'anual' : 'lunar');
</script>

<div class="cl-section">
	<div class="cl-section-head">
		<h3><UsersIcon size={15} /> Cheltuieli fixe de marketing</h3>
		<p class="cl-section-sub">se adaugă la bugetul de ads în costul pe interviu</p>
		<div class="cl-section-actions" style="margin-left:auto">
			<button type="button" class="cl-btn-secondary cl-btn-sm" onclick={onOpenEditor}>
				<SettingsIcon size={12} />
				{canEdit ? 'Setări cheltuieli' : 'Vezi cheltuielile'}
			</button>
		</div>
	</div>

	<div class="ivk-fxs-list">
		{#each rows as r (r.id)}
			<div class="ivk-fxs-row {r.active ? '' : 'off'}">
				<span class="ivk-check {r.active ? 'on' : ''}" aria-hidden="true"><CheckIcon size={11} /></span>
				<div style="min-width:0">
					<div class="ivk-fxs-name">{r.name || 'fără nume'}</div>
					<div class="ivk-fxs-sub">
						{r.qty}
						{r.unitLabel ? `${r.unitLabel} × ` : '× '}{fmtLei(r.unitAmount)} · {freqLabel(r)}{r.note
							? ` · ${r.note}`
							: ''}
					</div>
				</div>
				<div class="ivk-fx-total">
					{fmtLei(rowMonthly(r))}<small>/lună</small>
				</div>
			</div>
		{/each}
		{#if rows.length === 0}
			<div class="cl-budget-empty" style="padding:12px 0">
				Nicio cheltuială fixă. Bugetul include doar reclamele plătite.
			</div>
		{/if}
	</div>

	<div class="ivk-fx-foot">
		<div>
			<div class="ivk-fx-sum-lbl" style="margin-bottom:5px" id="{uid}-mode">Cheltuielile fixe se împart pe:</div>
			<div class="ivk-mode" role="group" aria-labelledby="{uid}-mode">
				<button type="button" class={mode === 'toate' ? 'active' : ''} aria-pressed={mode === 'toate'} onclick={() => onModeChange('toate')}>
					toate interviurile
				</button>
				<button type="button" class={mode === 'platite' ? 'active' : ''} aria-pressed={mode === 'platite'} onclick={() => onModeChange('platite')}>
					doar sursele plătite
				</button>
			</div>
		</div>
		<div class="ivk-fx-sum">
			<div class="ivk-fx-sum-lbl">Total fix în perioadă</div>
			<div class="ivk-fx-sum-val">{fmtLei(fixedTotal)}</div>
			<div class="ivk-fx-sum-lbl">{fmtLei(fixedMonthly)}/lună × {months} {monthsLabel}</div>
		</div>
	</div>
</div>
