<script lang="ts">
	/**
	 * Gauge-ul modulului: patru segmente proporționale cu
	 * `|sold| + rezervat + consum`. Depășirea (sold negativ) se desenează prima,
	 * ca ochiul să vadă imediat cât s-a trecut peste.
	 */
	import { fmtMinutes } from './hour-credits-format';

	let {
		balance,
		reserved = 0,
		spent = 0,
		lg = false
	}: { balance: number; reserved?: number; spent?: number; lg?: boolean } = $props();

	const available = $derived(Math.max(balance - reserved, 0));
	const overdraft = $derived(balance < 0 ? Math.abs(balance) : 0);
	// Minimum 1, ca împărțirea să nu dea NaN pe un client fără nicio mișcare.
	const total = $derived(Math.max(overdraft + available + reserved + spent, 1));
	const pc = (v: number) => `${(v / total) * 100}%`;

	const label = $derived(
		`Disponibil ${fmtMinutes(available)}, rezervat ${fmtMinutes(reserved)}, consumat ${fmtMinutes(spent)}` +
			(overdraft ? `, depășire ${fmtMinutes(overdraft)}` : '')
	);
</script>

<div
	class="hc-gauge"
	class:lg
	role="img"
	aria-label={label}
	title={label}
>
	{#if overdraft > 0}
		<div class="hc-seg-neg" style:width={pc(overdraft)}></div>
	{/if}
	<div class="hc-seg-avail" style:width={pc(available)}></div>
	<div class="hc-seg-res" style:width={pc(reserved)}></div>
	<div class="hc-seg-spent" style:width={pc(spent)}></div>
</div>
