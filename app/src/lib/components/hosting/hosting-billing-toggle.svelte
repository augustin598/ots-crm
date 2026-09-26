<!--
	Toggle-ul „Plătit lunar / Plătit anual (−2 luni)" de deasupra cardurilor de
	pachete — același pe /pachete-hosting și în portal (Hosting → Pachete).
-->
<script lang="ts">
	let { yearly = $bindable(true) }: { yearly?: boolean } = $props();
</script>

<div class="hb-toggle" role="group" aria-label="Perioada de facturare afișată">
	<button type="button" class:active={!yearly} aria-pressed={!yearly} onclick={() => (yearly = false)}>
		Plătit lunar
	</button>
	<button type="button" class:active={yearly} aria-pressed={yearly} onclick={() => (yearly = true)}>
		Plătit anual
		<span class="hb-save">−2 luni</span>
	</button>
</div>

<style>
	.hb-toggle {
		--hb-ink: #0b1220;
		--hb-ink2: #475569;
		--hb-border: #e5e9f0;
		--hb-soft: #f7f8fa;
		--hb-active: #ffffff;
		display: inline-flex;
		padding: 4px;
		background: var(--hb-soft);
		border: 1px solid var(--hb-border);
		border-radius: 12px;
		font-family: 'Inter', system-ui, sans-serif;
	}
	:global(.dark) .hb-toggle {
		--hb-ink: var(--foreground);
		--hb-ink2: var(--muted-foreground);
		--hb-border: var(--border);
		--hb-soft: var(--muted);
		--hb-active: var(--card);
	}
	.hb-toggle button {
		padding: 10px 22px;
		border-radius: 8px;
		background: transparent;
		border: none;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--hb-ink2);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.hb-toggle button.active {
		background: var(--hb-active);
		color: var(--hb-ink);
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
	}
	.hb-save {
		background: rgba(16, 185, 129, 0.12);
		color: #047857;
		font-size: 10px;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	:global(.dark) .hb-save {
		color: #6ee7b7;
	}
</style>
