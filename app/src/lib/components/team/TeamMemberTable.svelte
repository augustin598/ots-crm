<script lang="ts">
	import { avatarColor, avatarInitials } from '$lib/config/team';
	import type { MemberCardData } from './TeamMemberCard.svelte';

	let {
		members,
		onpick
	}: {
		members: MemberCardData[];
		onpick?: (m: MemberCardData) => void;
	} = $props();

	function displayName(m: MemberCardData): string {
		return [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.email;
	}
</script>

<div class="team-table-wrap">
	<table>
		<thead>
			<tr>
				<th>Persoană</th>
				<th>Email</th>
				<th>Rol</th>
				<th>Membru din</th>
			</tr>
		</thead>
		<tbody>
			{#each members as m (m.id)}
				<tr onclick={() => onpick?.(m)} role="button" tabindex="0">
					<td>
						<div class="person">
							<div class="av" style="background:{avatarColor(m.email)}">
								{avatarInitials(m.firstName, m.lastName, m.email)}
							</div>
							<div class="name">
								{displayName(m)}
								{#if m.isYou}<span class="you">tu</span>{/if}
							</div>
						</div>
					</td>
					<td class="muted">{m.email}</td>
					<td>
						<span class="pill" style="background:{m.role.bg}; color:{m.role.color}">
							<span class="dot" style="background:{m.role.color}"></span>
							{m.role.label}
						</span>
					</td>
					<td class="muted">{m.joinedAtLabel ?? '—'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.team-table-wrap {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 12px;
		overflow: hidden;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	th {
		text-align: left;
		padding: 10px 14px;
		font-weight: 700;
		font-size: 11.5px;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--border);
		background: var(--muted);
	}
	tbody tr {
		cursor: pointer;
		transition: background 0.12s;
	}
	tbody tr:hover {
		background: var(--accent);
	}
	td {
		padding: 12px 14px;
		border-bottom: 1px solid var(--border);
	}
	tbody tr:last-child td {
		border-bottom: none;
	}
	.person {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.av {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: white;
		font-size: 11px;
		font-weight: 800;
	}
	.name {
		font-weight: 600;
		color: var(--foreground);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.you {
		background: var(--accent);
		color: var(--accent-foreground);
		font-size: 9px;
		font-weight: 700;
		padding: 1px 6px;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.muted {
		color: var(--muted-foreground);
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
	}
	.pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
</style>
