<script lang="ts">
	import type { Accent, TodayEvent } from './types';
	import CalendarIcon from '@lucide/svelte/icons/calendar';

	let { events }: { events: TodayEvent[] } = $props();

	const CV: Record<Accent, string> = {
		primary: 'var(--d-primary)',
		warn: 'var(--d-warn)',
		info: 'var(--d-info)',
		success: 'var(--d-success)',
		danger: 'var(--d-danger)'
	};
</script>

<div class="dash-card">
	<div class="dash-card-head">
		<div>
			<div class="dash-card-title">Programul tău azi</div>
			<div class="dash-card-sub">{events.length} {events.length === 1 ? 'task scadent azi' : 'taskuri scadente azi'}</div>
		</div>
		<button class="dash-icon-btn" type="button" aria-label="Deschide calendar"><CalendarIcon size={14} /></button>
	</div>
	{#if events.length}
		<div class="dash-today-list">
			{#each events as e, i (i)}
				<div class="dash-today-row" style:border-left-color={CV[e.color]}>
					<div class="dash-today-time">{e.time}</div>
					<div class="dash-today-title">{e.title}</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="dash-empty">Nimic programat azi. 🎉</div>
	{/if}
</div>
