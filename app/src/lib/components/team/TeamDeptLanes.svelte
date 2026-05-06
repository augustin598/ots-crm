<script lang="ts">
	import { DEPARTMENTS, avatarColor, avatarInitials } from '$lib/config/team';
	import type { MemberCardData } from './TeamMemberCard.svelte';

	let {
		members,
		onpick
	}: {
		members: MemberCardData[];
		onpick?: (m: MemberCardData) => void;
	} = $props();

	function memberDeptId(m: MemberCardData): string {
		// We treat department as part of the role meta; we need to derive from
		// the original record. The page passes department label inside the
		// `department` property which is set per-card; we re-key by label.
		if (!m.department) return '__none__';
		const found = DEPARTMENTS.find((d) => d.label === m.department!.label);
		return found?.id ?? '__none__';
	}

	const lanes = $derived.by(() => {
		const groups = new Map<string, { id: string; label: string; color: string; items: MemberCardData[] }>();
		for (const d of DEPARTMENTS) {
			groups.set(d.id, { id: d.id, label: d.label, color: d.color, items: [] });
		}
		groups.set('__none__', { id: '__none__', label: 'Fără departament', color: '#94a3b8', items: [] });
		for (const m of members) {
			const id = memberDeptId(m);
			groups.get(id)?.items.push(m);
		}
		return [...groups.values()].filter((g) => g.items.length > 0);
	});

	function displayName(m: MemberCardData): string {
		return [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.email;
	}
</script>

<div class="lanes">
	{#each lanes as lane (lane.id)}
		<div class="lane">
			<div class="lane-head">
				<span class="dot" style="background:{lane.color}"></span>
				<span class="title">{lane.label}</span>
				<span class="count">{lane.items.length}</span>
			</div>
			<div class="lane-body">
				{#each lane.items as m (m.id)}
					<button type="button" class="lane-card" onclick={() => onpick?.(m)}>
						<div class="av-wrap">
							<div class="av" style="background:{avatarColor(m.email)}">
								{avatarInitials(m.firstName, m.lastName, m.email)}
							</div>
							<span class="presence" class:online={m.online} class:offline={!m.online}></span>
						</div>
						<div class="info">
							<div class="name">{displayName(m)}</div>
							{#if m.title}
								<div class="role">{m.title}</div>
							{:else}
								<div class="role">{m.role.label}</div>
							{/if}
						</div>
						{#if m.stats}
							<div class="badge">{m.stats.active}t</div>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/each}
</div>

<style>
	.lanes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 14px;
	}
	.lane {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 120px;
	}
	.lane-head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12.5px;
		font-weight: 700;
		color: var(--foreground);
	}
	.lane-head .dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
	}
	.lane-head .title {
		flex: 1;
	}
	.lane-head .count {
		background: var(--muted);
		color: var(--muted-foreground);
		font-size: 11px;
		font-weight: 700;
		padding: 1px 8px;
		border-radius: 999px;
	}
	.lane-body {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.lane-card {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: 8px;
		border: 1px solid transparent;
		background: transparent;
		cursor: pointer;
		font-family: inherit;
		text-align: left;
		color: inherit;
		transition: background 0.12s, border-color 0.12s;
	}
	.lane-card:hover {
		background: var(--accent);
		border-color: var(--border);
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
		font-weight: 800;
		font-size: 11px;
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
		flex: 1;
		min-width: 0;
	}
	.name {
		font-weight: 600;
		font-size: 13px;
		color: var(--foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.role {
		font-size: 11px;
		color: var(--muted-foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		background: var(--muted);
		color: var(--muted-foreground);
		font-size: 10px;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 999px;
		flex-shrink: 0;
	}
</style>
