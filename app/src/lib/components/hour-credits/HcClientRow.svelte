<script lang="ts">
	/** Rândul de client — elementul-semnătură al listei. */
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import HcAvatar from './HcAvatar.svelte';
	import HcGauge from './HcGauge.svelte';
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
	}

	let {
		row,
		thresholdMinutes,
		referenceLabel,
		href
	}: {
		row: Row;
		thresholdMinutes: number;
		referenceLabel: string | null;
		href: string;
	} = $props();

	const available = $derived(row.balanceMinutes - row.reservedMinutes);
	const low = $derived(available < thresholdMinutes);
</script>

<a class="hc-row" class:low {href}>
	<div class="hc-client">
		<HcAvatar id={row.clientId} name={row.clientName} />
		<div style="min-width:0">
			<div class="hc-cname">{row.clientName}</div>
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
		<span class="hc-chip {row.optedIn ? 'hc-chip-ok' : 'hc-chip-mut'}">
			{row.optedIn ? 'Din facturi' : 'Manual'}
		</span>
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
</a>
