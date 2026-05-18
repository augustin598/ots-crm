<!-- src/lib/components/client-team/client-team-role-chips.svelte -->
<script lang="ts">
	export type RoleId = 'all' | 'owner' | 'admin' | 'member' | 'viewer';

	type RoleDef = { id: RoleId; label: string; color: string; count: number };

	type Props = {
		roles: RoleDef[];
		active: RoleId;
		onChange: (id: RoleId) => void;
	};

	let { roles, active, onChange }: Props = $props();
</script>

<div class="cteam-filters mx-7 mt-4 flex flex-wrap gap-2">
	{#each roles as r (r.id)}
		<button
			type="button"
			class={[
				'cteam-chip inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
				active === r.id
					? 'border-[#1877F2] bg-[#f0f7ff] text-[#1877F2]'
					: 'border-[#d5dbe5] bg-white text-[#475569] hover:border-[#1877F2]'
			].join(' ')}
			onclick={() => onChange(r.id)}
		>
			{#if r.color}
				<span class="h-1.5 w-1.5 rounded-full" style:background-color={r.color}></span>
			{/if}
			{r.label}
			<span class="ml-1 inline-block min-w-[18px] rounded-full bg-[#e5e9f0] px-1.5 py-[1px] text-center text-[10px] text-[#475569]">
				{r.count}
			</span>
		</button>
	{/each}
</div>
