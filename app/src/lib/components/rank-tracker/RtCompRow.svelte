<script lang="ts">
	// Rând de „share of voice": domeniu, poziția (opțional) și bara de vizibilitate.
	import { psiInitials, psiTileColor } from '../pagespeed/lib';
	import RtPos from './RtPos.svelte';

	let {
		domain,
		self = false,
		tracked = false,
		pos,
		vis,
		max
	}: {
		domain: string;
		self?: boolean;
		/** Domeniu configurat explicit ca fiind competitor (restul vin din SERP). */
		tracked?: boolean;
		pos?: number | null;
		vis: number;
		max: number;
	} = $props();

	const showPos = $derived(pos !== undefined);
</script>

<div class="rt-comp-row">
	<div class="rt-comp-dom" class:self>
		<span
			class="psi-fav"
			style:width="22px"
			style:height="22px"
			style:border-radius="6px"
			style:font-size="9.5px"
			style:background={self ? 'var(--cl-accent)' : psiTileColor(domain)}>{psiInitials(domain)}</span
		>
		<span class="rt-comp-name">{domain}</span>
		{#if self}<span class="psi-tag info">noi</span>{:else if tracked}<span class="psi-tag">urmărit</span>{/if}
	</div>
	<div style="text-align: right">
		{#if showPos}<RtPos pos={pos ?? null} sm />{:else}<span class="iv-muted">—</span>{/if}
	</div>
	<div>
		<div class="rt-comp-bar">
			<i style:width="{Math.max(3, (vis / (max || 1)) * 100)}%" style:background={self ? 'var(--cl-accent)' : '#cbd5e1'}></i>
		</div>
		<div style="font-size: 11px; color: var(--cl-text-3); margin-top: 4px; font-weight: 700">{vis}% vizibilitate</div>
	</div>
</div>
