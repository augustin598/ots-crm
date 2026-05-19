<script lang="ts">
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { avatarColor, avatarInitials } from '$lib/config/team';

	export interface ClientCardData {
		id: string;
		name: string;
		businessName: string | null;
		email: string | null;
		phone: string | null;
		secondaryCount: number;
	}

	let {
		client,
		onclick
	}: {
		client: ClientCardData;
		onclick?: () => void;
	} = $props();

	const initials = $derived(avatarInitials(client.name, null, client.email));
	const color = $derived(avatarColor(client.id));
	const totalTeam = $derived(1 + client.secondaryCount); // +1 for primary
</script>

<div
	class="tc-card"
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
	<div class="tc-head">
		<div class="tc-av" style="background:{color}">{initials}</div>
		<div class="tc-info">
			<div class="tc-name">{client.name}</div>
			{#if client.businessName && client.businessName !== client.name}
				<div class="tc-biz">{client.businessName}</div>
			{/if}
		</div>
	</div>

	<div class="tc-meta">
		{#if client.email}
			<div class="tc-row">
				<MailIcon class="size-3.5" />
				<span class="tc-truncate">{client.email}</span>
			</div>
		{/if}
		{#if client.phone}
			<div class="tc-row">
				<PhoneIcon class="size-3.5" />
				<span>{client.phone}</span>
			</div>
		{/if}
		{#if !client.email && !client.phone}
			<div class="tc-row tc-muted">Fără date contact principal</div>
		{/if}
	</div>

	<div class="tc-foot">
		<div class="tc-team-badge" class:has-team={client.secondaryCount > 0}>
			<UsersIcon class="size-3.5" />
			<span>
				{totalTeam}
				{totalTeam === 1 ? 'contact' : 'contacte'}
			</span>
		</div>
		<span class="tc-edit-cta">Editează echipa →</span>
	</div>
</div>

<style>
	.tc-card {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 13px;
		padding: 16px;
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
	.tc-card:hover {
		border-color: var(--primary);
		box-shadow: 0 4px 12px color-mix(in oklch, var(--foreground) 8%, transparent);
		transform: translateY(-1px);
	}
	.tc-head {
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.tc-av {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		color: white;
		font-weight: 800;
		font-size: 14px;
		flex-shrink: 0;
	}
	.tc-info {
		min-width: 0;
		flex: 1;
	}
	.tc-name {
		font-size: 14px;
		font-weight: 700;
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tc-biz {
		font-size: 11.5px;
		color: var(--muted-foreground);
		margin-top: 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tc-meta {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 10px 0;
		border-top: 1px solid color-mix(in oklch, var(--foreground) 5%, transparent);
		border-bottom: 1px solid color-mix(in oklch, var(--foreground) 5%, transparent);
		min-height: 56px;
	}
	.tc-row {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		color: var(--muted-foreground);
		min-width: 0;
	}
	.tc-truncate {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tc-muted {
		font-style: italic;
		font-size: 11.5px;
	}
	.tc-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.tc-team-badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		background: color-mix(in oklch, var(--foreground) 4%, transparent);
		color: var(--muted-foreground);
	}
	.tc-team-badge.has-team {
		background: color-mix(in oklch, var(--primary) 12%, transparent);
		color: var(--primary);
	}
	.tc-edit-cta {
		font-size: 11px;
		font-weight: 600;
		color: var(--primary);
		opacity: 0;
		transition: opacity 0.15s;
	}
	.tc-card:hover .tc-edit-cta {
		opacity: 1;
	}
</style>
