<script lang="ts" generics="Id extends string">
	import type { RoleDef } from '$lib/config/team';

	let {
		roles,
		value = $bindable(),
		disabled = false
	}: {
		roles: ReadonlyArray<RoleDef<Id>>;
		value: Id;
		disabled?: boolean;
	} = $props();
</script>

<div class="team-role-grid" role="radiogroup">
	{#each roles as r (r.id)}
		<button
			type="button"
			class="team-role-opt"
			class:active={value === r.id}
			role="radio"
			aria-checked={value === r.id}
			{disabled}
			onclick={() => (value = r.id)}
		>
			<div class="team-role-opt-name">
				<span class="dot" style="background:{r.color}"></span>
				{r.label}
			</div>
			<div class="team-role-opt-desc">{r.desc}</div>
		</button>
	{/each}
</div>

<style>
	.team-role-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 8px;
	}
	.team-role-opt {
		text-align: left;
		padding: 10px 12px;
		border-radius: 9px;
		border: 1.5px solid var(--border);
		background: var(--card);
		cursor: pointer;
		font-family: inherit;
		color: var(--foreground);
		transition: border-color 0.12s, background 0.12s;
	}
	.team-role-opt:hover {
		border-color: var(--primary);
	}
	.team-role-opt.active {
		border-color: var(--primary);
		background: color-mix(in oklch, var(--primary) 6%, var(--card));
	}
	.team-role-opt:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}
	.team-role-opt-name {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 700;
		font-size: 12.5px;
		color: var(--foreground);
		margin-bottom: 4px;
	}
	.team-role-opt-name .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.team-role-opt-desc {
		font-size: 11.5px;
		color: var(--muted-foreground);
		line-height: 1.35;
	}
</style>
