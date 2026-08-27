<script lang="ts">
	import UsersIcon from '@lucide/svelte/icons/users';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CheckIcon from '@lucide/svelte/icons/check';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import {
		fmtLei,
		rowMonthly,
		type FixedCostRow,
		type FixedFrequency,
		type FixedMode
	} from '$lib/logic/interviuri-kpi';
	import type { FixedPatch } from './types';

	let {
		rows,
		canEdit,
		months,
		fixedTotal,
		fixedMonthly,
		mode,
		onChange,
		onDelete,
		onAdd,
		onReset,
		onModeChange
	}: {
		rows: FixedCostRow[];
		canEdit: boolean;
		months: number;
		fixedTotal: number;
		fixedMonthly: number;
		mode: FixedMode;
		/** modificare de câmp; `immediate` = salvează fără debounce (bifa activ) */
		onChange: (id: string, patch: FixedPatch, immediate?: boolean) => void;
		onDelete: (id: string) => void;
		onAdd: () => void;
		onReset: () => void;
		onModeChange: (m: FixedMode) => void;
	} = $props();

	const uid = $props.id();
	const monthsLabel = $derived(months === 1 ? 'lună' : 'luni');

	function num(e: Event): number {
		const v = Number((e.currentTarget as HTMLInputElement).value);
		return Number.isFinite(v) && v >= 0 ? v : 0;
	}
	function confirmReset() {
		if (confirm('Înlocuiești toate cheltuielile fixe cu cele implicite (4 × 8.000, 940 și 2.500 lei/lună)?')) {
			onReset();
		}
	}
	function confirmDelete(r: FixedCostRow) {
		if (confirm(`Ștergi rândul „${r.name || 'fără nume'}"?`)) onDelete(r.id);
	}
</script>

<div class="cl-section">
	<div class="cl-section-head">
		<h3><UsersIcon size={15} /> Cheltuieli fixe de marketing</h3>
		<p class="cl-section-sub">
			se adaugă la bugetul de ads în costul pe interviu{#if !canEdit}
				· <span class="iv-muted">doar Owner/Admin pot edita</span>{/if}
		</p>
		<div class="cl-section-actions" style="margin-left:auto; display:flex; gap:8px">
			<button type="button" class="cl-btn-secondary cl-btn-sm" onclick={confirmReset} disabled={!canEdit}>
				<RepeatIcon size={12} /> Resetează
			</button>
			<button type="button" class="cl-btn-primary cl-btn-sm" onclick={onAdd} disabled={!canEdit}>
				<PlusIcon size={12} /> Adaugă cheltuială
			</button>
		</div>
	</div>

	<div class="ivk-fx-head" aria-hidden="true">
		<span></span>
		<span>Cheltuială</span>
		<span class="r">Cant.</span>
		<span></span>
		<span class="r">Valoare unitară</span>
		<span>Frecvență</span>
		<span class="r">Total / lună</span>
		<span></span>
	</div>

	{#each rows as r (r.id)}
		<div class="ivk-fx-row {r.active ? '' : 'off'}">
			<button
				type="button"
				role="checkbox"
				aria-checked={r.active}
				aria-label={r.active ? 'Inclus în calcul' : 'Exclus din calcul'}
				title={r.active ? 'Inclus în calcul' : 'Exclus din calcul'}
				class="ivk-check {r.active ? 'on' : ''}"
				disabled={!canEdit}
				onclick={() => onChange(r.id, { active: !r.active }, true)}
			>
				<CheckIcon size={11} />
			</button>
			<div class="ivk-fx-name-cell">
				<input
					class="cl-input"
					placeholder="ex: Echipă marketing"
					aria-label="Denumire cheltuială"
					value={r.name}
					disabled={!canEdit}
					oninput={(e) => onChange(r.id, { name: e.currentTarget.value })}
				/>
				<input
					class="cl-input ivk-fx-note"
					placeholder="detaliu (opțional)"
					aria-label="Detaliu"
					value={r.note ?? ''}
					disabled={!canEdit}
					oninput={(e) => onChange(r.id, { note: e.currentTarget.value || null })}
				/>
			</div>
			<input
				class="cl-input num"
				type="number"
				min="0"
				step="1"
				aria-label="Cantitate"
				value={r.qty}
				disabled={!canEdit}
				oninput={(e) => onChange(r.id, { qty: num(e) })}
			/>
			<span class="ivk-fx-x" aria-hidden="true">×</span>
			<input
				class="cl-input num"
				type="number"
				min="0"
				step="10"
				aria-label="Valoare unitară (lei)"
				value={r.unitAmount}
				disabled={!canEdit}
				oninput={(e) => onChange(r.id, { unitAmount: num(e) })}
			/>
			<select
				class="cl-select"
				style="width:100%"
				aria-label="Frecvență"
				value={r.frequency}
				disabled={!canEdit}
				onchange={(e) => onChange(r.id, { frequency: e.currentTarget.value as FixedFrequency })}
			>
				<option value="monthly">lunar</option>
				<option value="yearly">anual</option>
			</select>
			<div class="ivk-fx-total">{fmtLei(rowMonthly(r))}</div>
			<button
				type="button"
				class="cl-icon-btn"
				title="Șterge rândul"
				aria-label="Șterge rândul"
				disabled={!canEdit}
				onclick={() => confirmDelete(r)}
			>
				<TrashIcon size={13} />
			</button>
		</div>
	{/each}

	{#if rows.length === 0}
		<div class="cl-budget-empty" style="padding:18px 0">
			Nicio cheltuială fixă. Bugetul include doar reclamele plătite.
		</div>
	{/if}

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
