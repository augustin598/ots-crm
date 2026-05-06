<script lang="ts">
	import ClockIcon from '@lucide/svelte/icons/clock';
	import XIcon from '@lucide/svelte/icons/x';

	export interface PendingInviteData {
		id: string;
		email: string;
		role: { label: string; color: string; bg: string };
		expiresAtLabel?: string | null;
		isExpired?: boolean;
	}

	let {
		invite,
		oncancel
	}: {
		invite: PendingInviteData;
		oncancel?: () => void;
	} = $props();
</script>

<div class="team-card pending" class:expired={invite.isExpired}>
	<div class="team-card-head">
		<div class="team-av-pending"><ClockIcon class="size-5" /></div>
		<div class="team-card-info">
			<div class="team-card-name">{invite.email}</div>
			<div class="team-card-title">
				{invite.isExpired ? 'Invitație expirată' : `Invitație trimisă${invite.expiresAtLabel ? ` · expiră ${invite.expiresAtLabel}` : ''}`}
			</div>
		</div>
	</div>
	<div class="team-card-pills">
		<span class="team-pill" style="background:{invite.role.bg}; color:{invite.role.color}">
			<span class="dot" style="background:{invite.role.color}"></span>
			{invite.role.label}
		</span>
		<span class="team-pill team-pending-pill">{invite.isExpired ? 'Expirată' : 'În așteptare'}</span>
	</div>
	{#if oncancel}
		<div class="team-card-foot">
			<button type="button" class="team-q-btn danger" onclick={oncancel}>
				<XIcon class="size-3" /> Anulează
			</button>
		</div>
	{/if}
</div>

<style>
	.team-card {
		background: var(--card);
		border: 1px dashed var(--border);
		border-radius: 13px;
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.team-card.expired {
		opacity: 0.7;
		background: color-mix(in oklch, var(--destructive) 4%, var(--card));
	}
	.team-card-head {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}
	.team-av-pending {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: var(--muted);
		color: var(--muted-foreground);
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.team-card-info {
		min-width: 0;
		flex: 1;
	}
	.team-card-name {
		font-size: 13px;
		font-weight: 700;
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.team-card-title {
		font-size: 12px;
		color: var(--muted-foreground);
		margin-top: 2px;
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
	.team-pending-pill {
		background: color-mix(in oklch, var(--warning) 18%, transparent);
		color: var(--warning-foreground);
	}
	.team-card-foot {
		display: flex;
		justify-content: flex-end;
	}
	.team-q-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		border-radius: 6px;
		background: transparent;
		border: 1px solid var(--border);
		color: var(--foreground);
		font-size: 11px;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
	}
	.team-q-btn.danger {
		color: var(--destructive);
		border-color: color-mix(in oklch, var(--destructive) 30%, var(--border));
	}
	.team-q-btn.danger:hover {
		background: color-mix(in oklch, var(--destructive) 8%, transparent);
	}
</style>
