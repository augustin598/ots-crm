<script lang="ts">
	export interface Kpi {
		label: string;
		value: string | number;
		foot?: string;
		delta?: { text: string; positive?: boolean } | null;
		tone?: 'default' | 'success' | 'warning' | 'danger';
	}

	let { items }: { items: Kpi[] } = $props();
</script>

<div class="team-kpi-strip">
	{#each items as k (k.label)}
		<div class="team-kpi">
			<div class="team-kpi-lbl">{k.label}</div>
			<div class="team-kpi-val" class:success={k.tone === 'success'} class:warn={k.tone === 'warning'} class:danger={k.tone === 'danger'}>
				<span>{k.value}</span>
				{#if k.delta}
					<span class="delta" class:neg={k.delta.positive === false}>{k.delta.text}</span>
				{/if}
			</div>
			{#if k.foot}
				<div class="team-kpi-foot">{k.foot}</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.team-kpi-strip {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
	}
	.team-kpi {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 11px;
		padding: 14px 16px;
	}
	.team-kpi-lbl {
		font-size: 11px;
		font-weight: 700;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 6px;
	}
	.team-kpi-val {
		font-size: 22px;
		font-weight: 800;
		color: var(--foreground);
		letter-spacing: -0.02em;
		display: flex;
		align-items: baseline;
		gap: 6px;
	}
	.team-kpi-val.success {
		color: var(--success);
	}
	.team-kpi-val.warn {
		color: var(--warning);
	}
	.team-kpi-val.danger {
		color: var(--destructive);
	}
	.team-kpi-val .delta {
		font-size: 11.5px;
		font-weight: 700;
		color: var(--success);
	}
	.team-kpi-val .delta.neg {
		color: var(--destructive);
	}
	.team-kpi-foot {
		margin-top: 4px;
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
</style>
