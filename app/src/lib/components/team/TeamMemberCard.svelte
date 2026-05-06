<script lang="ts">
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import MailIcon from '@lucide/svelte/icons/mail';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import { avatarColor, avatarInitials } from '$lib/config/team';

	export interface MemberCardData {
		id: string;
		email: string;
		firstName?: string | null;
		lastName?: string | null;
		title?: string | null;
		phone?: string | null;
		role: { label: string; color: string; bg: string };
		department?: { label: string; color: string } | null;
		stats?: { active: number; done: number; onTime?: number | null } | null;
		joinedAtLabel?: string | null;
		isYou?: boolean;
		online?: boolean;
		skills?: string[];
	}

	function workloadLevel(active: number): { cls: 'low' | 'med' | 'high'; pct: number; lbl: string } {
		if (active <= 8) return { cls: 'low', pct: Math.max(15, active * 6), lbl: 'Light' };
		if (active <= 16) return { cls: 'med', pct: Math.min(85, 50 + active * 2), lbl: 'Normal' };
		return { cls: 'high', pct: Math.min(98, 70 + (active - 16) * 4), lbl: 'Heavy' };
	}

	let {
		member,
		onclick,
		onmenuclick
	}: {
		member: MemberCardData;
		onclick?: () => void;
		onmenuclick?: (e: MouseEvent) => void;
	} = $props();

	const initials = $derived(avatarInitials(member.firstName, member.lastName, member.email));
	const color = $derived(avatarColor(member.email));
	const displayName = $derived(
		[member.firstName, member.lastName].filter(Boolean).join(' ').trim() || member.email
	);
	const skillsList = $derived(member.skills ?? []);
	const visibleSkills = $derived(skillsList.slice(0, 2));
	const moreSkills = $derived(Math.max(0, skillsList.length - 2));
</script>

<div
	class="team-card"
	role="button"
	tabindex="0"
	onclick={onclick}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onclick?.();
		}
	}}
>
	{#if onmenuclick}
		<button
			type="button"
			class="team-card-menu"
			aria-label="Acțiuni"
			onclick={(e) => {
				e.stopPropagation();
				onmenuclick(e);
			}}
		>
			<MoreHorizontalIcon class="size-3.5" />
		</button>
	{/if}
	<div class="team-card-head">
		<div class="team-av-wrap">
			<div class="team-av" style="background:{color}">{initials}</div>
			<span class="team-presence" class:online={member.online} class:offline={!member.online}></span>
		</div>
		<div class="team-card-info">
			<div class="team-card-name">
				{displayName}
				{#if member.isYou}<span class="team-you">tu</span>{/if}
			</div>
			{#if member.title}
				<div class="team-card-title">{member.title}</div>
			{/if}
		</div>
	</div>
	<div class="team-card-pills">
		<span class="team-pill" style="background:{member.role.bg}; color:{member.role.color}">
			<span class="dot" style="background:{member.role.color}"></span>
			{member.role.label}
		</span>
		{#if member.department}
			<span
				class="team-pill"
				style="background:color-mix(in srgb, {member.department.color} 12%, transparent); color:{member.department.color}"
			>
				<span class="dot" style="background:{member.department.color}"></span>
				{member.department.label}
			</span>
		{/if}
	</div>
	{#if member.stats}
		{@const wl = workloadLevel(member.stats.active)}
		<div class="team-load">
			<div class="team-load-bar">
				<div class="team-load-fill {wl.cls}" style="width:{wl.pct}%"></div>
			</div>
			<span class="team-load-pct">{member.stats.active}t</span>
		</div>
		<div class="team-card-stats">
			<div>
				<div class="team-stat-lbl">Active</div>
				<div class="team-stat-val">{member.stats.active}</div>
			</div>
			<div>
				<div class="team-stat-lbl">Done</div>
				<div class="team-stat-val">{member.stats.done}</div>
			</div>
			<div>
				<div class="team-stat-lbl">On-time</div>
				{#if typeof member.stats.onTime === 'number'}
					<div
						class="team-stat-val"
						class:green={member.stats.onTime >= 90}
						class:warn={member.stats.onTime < 90}
					>
						{member.stats.onTime}%
					</div>
				{:else}
					<div class="team-stat-val muted">—</div>
				{/if}
			</div>
		</div>
	{/if}
	<div class="team-card-foot">
		<div class="team-card-skills">
			{#each visibleSkills as s (s)}
				<span class="team-skill">{s}</span>
			{/each}
			{#if moreSkills > 0}
				<span class="team-skill more">+{moreSkills}</span>
			{/if}
		</div>
		<div class="team-card-quick">
			<a
				class="team-q-btn"
				href={`mailto:${member.email}`}
				aria-label="Email"
				title="Email"
				onclick={(e) => e.stopPropagation()}
			>
				<MailIcon class="size-3" />
			</a>
			<button
				type="button"
				class="team-q-btn"
				aria-label="Slack (în curând)"
				title="Slack (în curând)"
				disabled
				onclick={(e) => e.stopPropagation()}
			>
				<MessageCircleIcon class="size-3" />
			</button>
			{#if member.phone}
				<a
					class="team-q-btn"
					href={`tel:${member.phone}`}
					aria-label="Sună"
					title={member.phone}
					onclick={(e) => e.stopPropagation()}
				>
					<PhoneIcon class="size-3" />
				</a>
			{:else}
				<button
					type="button"
					class="team-q-btn"
					aria-label="Telefon indisponibil"
					title="Fără telefon"
					disabled
					onclick={(e) => e.stopPropagation()}
				>
					<PhoneIcon class="size-3" />
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.team-card {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 13px;
		padding: 18px;
		position: relative;
		text-align: left;
		font-family: inherit;
		color: inherit;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 12px;
		transition:
			border-color 0.15s,
			box-shadow 0.15s,
			transform 0.15s;
		width: 100%;
	}
	.team-card:hover {
		border-color: var(--primary);
		box-shadow: 0 4px 12px color-mix(in oklch, var(--foreground) 8%, transparent);
		transform: translateY(-1px);
	}
	.team-card-menu {
		position: absolute;
		top: 12px;
		right: 12px;
		width: 26px;
		height: 26px;
		border-radius: 6px;
		display: grid;
		place-items: center;
		background: transparent;
		border: 1px solid transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.12s;
	}
	.team-card:hover .team-card-menu {
		opacity: 1;
	}
	.team-card-menu:hover {
		background: var(--accent);
		color: var(--foreground);
	}
	.team-card-head {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}
	.team-av-wrap {
		position: relative;
		flex-shrink: 0;
	}
	.team-av {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: white;
		font-weight: 800;
		font-size: 15px;
	}
	.team-presence {
		position: absolute;
		bottom: -1px;
		right: -1px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid var(--card);
	}
	.team-presence.online {
		background: #10b981;
	}
	.team-presence.offline {
		background: #cbd5e1;
	}
	.team-card-info {
		min-width: 0;
		flex: 1;
	}
	.team-card-name {
		font-size: 14.5px;
		font-weight: 700;
		color: var(--foreground);
		display: flex;
		align-items: center;
		gap: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.team-you {
		background: var(--accent);
		color: var(--accent-foreground);
		font-size: 9px;
		font-weight: 700;
		padding: 1px 6px;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.team-card-title {
		font-size: 12px;
		color: var(--muted-foreground);
		margin-top: 1px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.team-card-pills {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.team-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
	}
	.team-pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
	.team-load {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.team-load-bar {
		flex: 1;
		height: 6px;
		border-radius: 999px;
		background: color-mix(in oklch, var(--foreground) 6%, transparent);
		overflow: hidden;
	}
	.team-load-fill {
		height: 100%;
		border-radius: 999px;
		transition: width 0.2s;
	}
	.team-load-fill.low {
		background: #10b981;
	}
	.team-load-fill.med {
		background: #1877f2;
	}
	.team-load-fill.high {
		background: #f59e0b;
	}
	.team-load-pct {
		font-size: 11px;
		font-weight: 700;
		color: var(--muted-foreground);
	}
	.team-card-stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		padding-top: 12px;
		border-top: 1px solid color-mix(in oklch, var(--foreground) 5%, transparent);
	}
	.team-stat-lbl {
		font-size: 9px;
		font-weight: 700;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.team-stat-val {
		font-size: 14px;
		font-weight: 700;
		color: var(--foreground);
	}
	.team-stat-val.green {
		color: #10b981;
	}
	.team-stat-val.warn {
		color: #f59e0b;
	}
	.team-stat-val.muted {
		color: var(--muted-foreground);
	}
	.team-card-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding-top: 12px;
		border-top: 1px solid color-mix(in oklch, var(--foreground) 5%, transparent);
		min-height: 30px;
	}
	.team-card-skills {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		min-width: 0;
	}
	.team-skill {
		font-size: 10px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: 999px;
		background: color-mix(in oklch, var(--foreground) 4%, transparent);
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	.team-skill.more {
		background: color-mix(in oklch, var(--primary) 14%, transparent);
		color: var(--primary);
	}
	.team-card-quick {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}
	.team-q-btn {
		width: 26px;
		height: 26px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--card);
		color: var(--muted-foreground);
		cursor: pointer;
		display: grid;
		place-items: center;
		text-decoration: none;
		transition: all 0.12s;
	}
	.team-q-btn:hover:not(:disabled) {
		border-color: var(--primary);
		color: var(--primary);
		background: color-mix(in oklch, var(--primary) 6%, transparent);
	}
	.team-q-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
