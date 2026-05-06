<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import type { RoleDef, PermissionGroup } from '$lib/config/team';

	let {
		roles,
		permissions
	}: {
		roles: ReadonlyArray<RoleDef>;
		permissions: ReadonlyArray<PermissionGroup>;
	} = $props();
</script>

<div class="team-perm-table">
	<table>
		<thead>
			<tr>
				<th>Permisiune</th>
				{#each roles as r (r.id)}
					<th style="color:{r.color}">{r.label}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each permissions as g (g.group)}
				<tr class="group-row"><td colspan={roles.length + 1}>{g.group}</td></tr>
				{#each g.items as p (p.id)}
					<tr>
						<td>{p.label}</td>
						{#each roles as r (r.id)}
							<td>
								{#if p.roles.includes(r.id)}
									<span class="check"><CheckIcon class="size-4" /></span>
								{:else}
									<span class="x">—</span>
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			{/each}
		</tbody>
	</table>
</div>

<style>
	.team-perm-table {
		max-height: 60vh;
		overflow: auto;
		border-radius: 10px;
		border: 1px solid var(--border);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
	}
	thead {
		position: sticky;
		top: 0;
		background: var(--card);
		z-index: 1;
	}
	th {
		text-align: left;
		padding: 10px 12px;
		font-weight: 700;
		font-size: 11.5px;
		color: var(--foreground);
		border-bottom: 1px solid var(--border);
	}
	th:not(:first-child) {
		text-align: center;
		min-width: 70px;
	}
	td {
		padding: 8px 12px;
		border-bottom: 1px solid var(--border);
		color: var(--foreground);
	}
	td:not(:first-child) {
		text-align: center;
	}
	tr:last-child td {
		border-bottom: none;
	}
	.group-row td {
		background: var(--muted);
		font-size: 10.5px;
		font-weight: 700;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 6px 12px;
	}
	.check {
		display: inline-flex;
		color: var(--success);
	}
	.x {
		color: var(--muted-foreground);
		opacity: 0.5;
	}
</style>
