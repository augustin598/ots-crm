<script lang="ts">
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import XIcon from '@lucide/svelte/icons/x';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CheckIcon from '@lucide/svelte/icons/check';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import {
		fmtLei,
		rowMonthly,
		type FixedCostRow,
		type FixedFrequency
	} from '$lib/logic/interviuri-kpi';
	import type { FixedPatch } from './types';

	/**
	 * Modal de setări pentru cheltuielile fixe de marketing (editor inline pe rânduri).
	 * Salvarea e optimistă și se face în părinte (debounce 400 ms); aici doar emitem patch-uri.
	 */
	let {
		rows,
		canEdit,
		onClose,
		onChange,
		onDelete,
		onAdd,
		onReset
	}: {
		rows: FixedCostRow[];
		canEdit: boolean;
		onClose: () => void;
		onChange: (id: string, patch: FixedPatch, immediate?: boolean) => void;
		onDelete: (id: string) => void;
		onAdd: () => void;
		onReset: () => void;
	} = $props();

	const uid = $props.id();
	const monthly = $derived(rows.filter((r) => r.active).reduce((s, r) => s + rowMonthly(r), 0));

	/** null cât timp câmpul e gol (userul șterge ca să tasteze altceva) — nu trimitem 0 */
	function num(e: Event): number | null {
		const raw = (e.currentTarget as HTMLInputElement).value;
		if (raw.trim() === '') return null;
		const v = Number(raw);
		return Number.isFinite(v) && v >= 0 ? v : 0;
	}
	const rowName = (r: FixedCostRow) => r.name || 'rând nou';
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
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

<svelte:window onkeydown={onKey} />

<div
	class="iv-modal-backdrop"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
>
	<div class="iv-modal ivk-fx-modal" role="dialog" aria-modal="true" aria-labelledby="{uid}-title">
		<div class="iv-modal-head">
			<div class="iv-modal-head-ic"><SettingsIcon size={18} /></div>
			<div>
				<h3 id="{uid}-title">Setări cheltuieli fixe de marketing</h3>
				<p>
					se adaugă la bugetul de ads în costul pe interviu{#if !canEdit}
						· doar Owner/Admin pot edita{/if}
				</p>
			</div>
			<button type="button" class="cl-icon-btn iv-modal-close" onclick={onClose} aria-label="Închide">
				<XIcon size={16} />
			</button>
		</div>

		<div class="iv-modal-body">
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
						aria-label="Include în calcul: {rowName(r)}"
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
							aria-label="Denumire cheltuială – {rowName(r)}"
							value={r.name}
							disabled={!canEdit}
							oninput={(e) => onChange(r.id, { name: e.currentTarget.value })}
						/>
						<input
							class="cl-input ivk-fx-note"
							placeholder="detaliu (opțional)"
							aria-label="Detaliu – {rowName(r)}"
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
						aria-label="Cantitate – {rowName(r)}"
						value={r.qty}
						disabled={!canEdit}
						oninput={(e) => {
							const v = num(e);
							if (v !== null) onChange(r.id, { qty: v });
						}}
					/>
					<span class="ivk-fx-x" aria-hidden="true">×</span>
					<input
						class="cl-input num"
						type="number"
						min="0"
						step="10"
						aria-label="Valoare unitară în lei – {rowName(r)}"
						value={r.unitAmount}
						disabled={!canEdit}
						oninput={(e) => {
							const v = num(e);
							if (v !== null) onChange(r.id, { unitAmount: v });
						}}
					/>
					<select
						class="cl-select"
						style="width:100%"
						aria-label="Frecvență – {rowName(r)}"
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
						aria-label="Șterge rândul {rowName(r)}"
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
				<button type="button" class="cl-btn-secondary cl-btn-sm" onclick={confirmReset} disabled={!canEdit}>
					<RepeatIcon size={12} /> Resetează la implicit
				</button>
				<button type="button" class="cl-btn-primary cl-btn-sm" onclick={onAdd} disabled={!canEdit}>
					<PlusIcon size={12} /> Adaugă cheltuială
				</button>
				<div class="ivk-fx-sum">
					<div class="ivk-fx-sum-lbl">Total rânduri active</div>
					<div class="ivk-fx-sum-val">{fmtLei(monthly)}/lună</div>
				</div>
			</div>
		</div>

		<div class="iv-modal-foot">
			<span class="iv-opt" style="margin-right:auto">Modificările se salvează automat.</span>
			<button type="button" class="cl-btn-primary" onclick={onClose}>Gata</button>
		</div>
	</div>
</div>
