<script lang="ts">
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import { avatarColor, avatarInitials } from '$lib/config/team';
	import type { MemberCardData } from './TeamMemberCard.svelte';

	let {
		members,
		onpick,
		formatLastActive
	}: {
		members: MemberCardData[];
		onpick?: (m: MemberCardData) => void;
		formatLastActive?: (m: MemberCardData) => string;
	} = $props();

	function displayName(m: MemberCardData): string {
		return [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.email;
	}
</script>

<div class="team-table-wrap">
	<table>
		<thead>
			<tr>
				<th class="check"><input type="checkbox" disabled aria-label="Selectează toți" /></th>
				<th>Persoană</th>
				<th>Rol</th>
				<th>Departament</th>
				<th class="num">Active</th>
				<th class="num">Done</th>
				<th class="num">On-time</th>
				<th>Last active</th>
				<th class="menu" aria-label="Acțiuni"></th>
			</tr>
		</thead>
		<tbody>
			{#each members as m (m.id)}
				{@const onTime = m.stats?.onTime ?? null}
				{@const lastActive = formatLastActive ? formatLastActive(m) : m.online ? 'Online' : '—'}
				<tr onclick={() => onpick?.(m)} role="button" tabindex="0">
					<td class="check"><input type="checkbox" disabled aria-label="Selectează membru" onclick={(e) => e.stopPropagation()} /></td>
					<td>
						<div class="person">
							<div class="av-wrap">
								<div class="av" style="background:{avatarColor(m.email)}">
									{avatarInitials(m.firstName, m.lastName, m.email)}
								</div>
								<span class="presence" class:online={m.online} class:offline={!m.online}></span>
							</div>
							<div class="info">
								<div class="name">
									{displayName(m)}
									{#if m.isYou}<span class="you">tu</span>{/if}
								</div>
								<div class="email">{m.email}</div>
							</div>
						</div>
					</td>
					<td>
						<span class="pill" style="background:{m.role.bg}; color:{m.role.color}">
							<span class="dot" style="background:{m.role.color}"></span>
							{m.role.label}
						</span>
					</td>
					<td>
						{#if m.department}
							<span
								class="pill"
								style="background:color-mix(in srgb, {m.department.color} 12%, transparent); color:{m.department.color}"
							>
								<span class="dot" style="background:{m.department.color}"></span>
								{m.department.label}
							</span>
						{:else}
							<span class="muted">—</span>
						{/if}
					</td>
					<td class="num strong">{m.stats?.active ?? 0}</td>
					<td class="num">{m.stats?.done ?? 0}</td>
					<td class="num">
						{#if onTime !== null}
							<span class="strong" class:green={onTime >= 90} class:warn={onTime < 90}>{onTime}%</span>
						{:else}
							<span class="muted">—</span>
						{/if}
					</td>
					<td>
						<span class:green={m.online} class="muted">{lastActive}</span>
					</td>
					<td class="menu">
						<button type="button" class="icon-btn" aria-label="Acțiuni" onclick={(e) => e.stopPropagation()}>
							<MoreHorizontalIcon class="size-3.5" />
						</button>
					</td>
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
		padding: 11px 14px;
		font-weight: 700;
		font-size: 11px;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-bottom: 1px solid var(--border);
		background: color-mix(in oklch, var(--foreground) 3%, transparent);
		white-space: nowrap;
	}
	th.num {
		text-align: center;
	}
	th.check {
		width: 30px;
	}
	th.menu {
		width: 50px;
	}
	tbody tr {
		cursor: pointer;
		transition: background 0.12s;
	}
	tbody tr:hover {
		background: var(--accent);
	}
	td {
		padding: 13px 14px;
		border-bottom: 1px solid color-mix(in oklch, var(--foreground) 4%, transparent);
		vertical-align: middle;
	}
	tbody tr:last-child td {
		border-bottom: none;
	}
	td.num {
		text-align: center;
	}
	td.check,
	td.menu {
		text-align: center;
		padding-left: 8px;
		padding-right: 8px;
	}
	.person {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.av-wrap {
		position: relative;
		flex-shrink: 0;
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
	.presence {
		position: absolute;
		bottom: -1px;
		right: -1px;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		border: 2px solid var(--card);
	}
	.presence.online {
		background: #10b981;
	}
	.presence.offline {
		background: #cbd5e1;
	}
	.info {
		min-width: 0;
	}
	.name {
		font-weight: 700;
		color: var(--foreground);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.email {
		font-size: 11.5px;
		color: var(--muted-foreground);
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
	.strong {
		font-weight: 700;
	}
	.green {
		color: #10b981;
		font-weight: 600;
	}
	.warn {
		color: #f59e0b;
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
	.icon-btn {
		width: 26px;
		height: 26px;
		border-radius: 6px;
		background: transparent;
		border: 1px solid transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		display: grid;
		place-items: center;
	}
	.icon-btn:hover {
		background: color-mix(in oklch, var(--foreground) 5%, transparent);
		color: var(--foreground);
	}
</style>
