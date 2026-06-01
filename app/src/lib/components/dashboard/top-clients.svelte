<script lang="ts">
	import type { TopClient } from './types';
	import { fmtRON, fmtPct } from './format';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	let { clients, allHref }: { clients: TopClient[]; allHref: string } = $props();

	const max = $derived(Math.max(1, ...clients.map((c) => c.revenue)));
</script>

<div class="dash-card">
	<div class="dash-card-head">
		<div>
			<div class="dash-card-title">Top clienți</div>
			<div class="dash-card-sub">Venituri din facturi încasate</div>
		</div>
		<a href={allHref} class="dash-link">Toți clienții <ChevronRightIcon size={12} /></a>
	</div>
	{#if clients.length}
		<div class="dash-clients-list">
			{#each clients as c (c.name)}
				<div class="dash-client-row">
					<div class="dash-client-avatar">{c.avatar}</div>
					<div class="dash-client-info">
						<div class="dash-client-name">{c.name}</div>
						<div class="dash-client-meta">
							{c.projects} proiecte ·
							<span class:up={c.change >= 0} class:down={c.change < 0}>{fmtPct(c.change)}</span>
						</div>
						<div class="dash-client-bar">
							<div class="dash-client-bar-fill" style:width={`${(c.revenue / max) * 100}%`}></div>
						</div>
					</div>
					<div class="dash-client-rev">{fmtRON(c.revenue)}</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="dash-empty">Nicio factură încasată încă.</div>
	{/if}
</div>
