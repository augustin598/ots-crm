<script lang="ts">
	/** Rândul de client — elementul-semnătură al listei. */
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import HcAvatar from './HcAvatar.svelte';
	import HcGauge from './HcGauge.svelte';
	import HcSwitch from './HcSwitch.svelte';
	import { fmtDateShort, fmtMinutes, fmtRelative } from './hour-credits-format';

	interface Row {
		clientId: string;
		clientName: string;
		cui: string | null;
		optedIn: boolean;
		balanceMinutes: number;
		reservedMinutes: number;
		consumedLast30Minutes: number;
		lastMovementAt: Date | string | null;
		expiring: { minutes: number; on: Date | string } | null;
		tracked: boolean;
	}

	let {
		row,
		thresholdMinutes,
		referenceLabel,
		href,
		onToggleOptIn = null,
		toggling = false
	}: {
		row: Row;
		thresholdMinutes: number;
		referenceLabel: string | null;
		href: string;
		/** Null = fără drept de editare (doar owner/admin pot bifa). */
		onToggleOptIn?: ((enabled: boolean) => void) | null;
		toggling?: boolean;
	} = $props();

	const available = $derived(row.balanceMinutes - row.reservedMinutes);
	// Un client fără buget n-are cum să fie „sub prag" — e doar listat pentru bifă.
	const low = $derived(row.tracked && available < thresholdMinutes);
</script>

<!-- Rândul e un div cu linkul întins peste el (::after): comutatorul nu poate
     sta într-un <a> (element interactiv în element interactiv). -->
<div class="hc-row" class:low class:untracked={!row.tracked}>
	<div class="hc-client">
		<HcAvatar id={row.clientId} name={row.clientName} />
		<div style="min-width:0">
			<a class="hc-cname hc-row-link" {href}>{row.clientName}</a>
			<div class="hc-cmeta">
				{row.cui ?? 'fără CUI'}{referenceLabel ? ` · ${referenceLabel}` : ''}
			</div>
		</div>
	</div>

	<div class="hc-rowgauge">
		<div class="hc-mini">
			<span>
				disponibil
				<b style:color={low ? 'var(--hc-err)' : 'var(--cl-text)'}>{fmtMinutes(available)}</b>
			</span>
			<span>consum 30 z {fmtMinutes(row.consumedLast30Minutes)}</span>
		</div>
		<HcGauge
			balance={row.balanceMinutes}
			reserved={row.reservedMinutes}
			spent={row.consumedLast30Minutes}
		/>
		<div class="hc-mini after">
			<span class="hc-muted">ultima mișcare {fmtRelative(row.lastMovementAt)}</span>
			{#if row.expiring}
				<span class="hc-muted">
					expiră {fmtMinutes(row.expiring.minutes)} pe {fmtDateShort(row.expiring.on)}
				</span>
			{/if}
		</div>
	</div>

	<div class="hc-rowchips">
		{#if onToggleOptIn}
			<label class="hc-rowopt">
				<HcSwitch
					checked={row.optedIn}
					disabled={toggling}
					label="Facturile plătite ale clientului {row.clientName} alimentează creditul"
					onchange={onToggleOptIn}
				/>
				<span>{row.optedIn ? 'Din facturi' : 'Manual'}</span>
			</label>
		{:else}
			<span class="hc-chip {row.optedIn ? 'hc-chip-ok' : 'hc-chip-mut'}">
				{row.optedIn ? 'Din facturi' : 'Manual'}
			</span>
		{/if}
		{#if low}
			<span class="hc-chip hc-chip-err">
				{row.balanceMinutes < 0 ? 'Depășire' : 'Sub prag'}
			</span>
		{/if}
	</div>

	<div class="hc-bal">
		<div class="hc-bal-v" class:neg={row.balanceMinutes < 0}>{fmtMinutes(row.balanceMinutes)}</div>
		<div class="hc-bal-l">Sold</div>
	</div>

	<div class="hc-go"><ChevronRightIcon size={18} /></div>
</div>
