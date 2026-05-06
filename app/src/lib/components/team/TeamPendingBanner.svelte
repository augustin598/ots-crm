<script lang="ts">
	import ClockIcon from '@lucide/svelte/icons/clock';

	let {
		count,
		emails,
		expiredCount = 0,
		onview
	}: {
		count: number;
		emails: string[];
		expiredCount?: number;
		onview?: () => void;
	} = $props();

	const previewEmails = $derived(emails.slice(0, 3));
	const remaining = $derived(Math.max(0, emails.length - 3));
</script>

{#if count > 0}
	<div class="team-pending" class:warn={expiredCount > 0}>
		<div class="team-pending-icon">
			<ClockIcon class="size-4" />
		</div>
		<div class="team-pending-text">
			<div class="team-pending-title">
				{count}
				{count === 1 ? 'invitație în așteptare' : 'invitații în așteptare'}
				{#if expiredCount > 0}
					<span class="expired-badge">{expiredCount} expirate</span>
				{/if}
			</div>
			<div class="team-pending-sub">
				{previewEmails.join(' · ')}{#if remaining > 0} · +{remaining} {/if}
			</div>
		</div>
		{#if onview}
			<button type="button" class="team-pending-link" onclick={onview}>Vezi toate →</button>
		{/if}
	</div>
{/if}

<style>
	.team-pending {
		display: flex;
		align-items: center;
		gap: 14px;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 12px;
		padding: 14px 18px;
	}
	.team-pending.warn {
		background: color-mix(in srgb, #fffbeb 85%, #fee2e2);
	}
	.team-pending-icon {
		width: 36px;
		height: 36px;
		border-radius: 9px;
		background: #fef3c7;
		color: #b45309;
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}
	.team-pending-text {
		flex: 1;
		min-width: 0;
	}
	.team-pending-title {
		font-size: 13.5px;
		font-weight: 700;
		color: #78350f;
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.expired-badge {
		font-size: 10px;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 999px;
		background: #fecaca;
		color: #991b1b;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.team-pending-sub {
		font-size: 11.5px;
		color: #92400e;
		margin-top: 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.team-pending-link {
		background: none;
		border: none;
		color: #b45309;
		font-weight: 700;
		font-size: 12.5px;
		cursor: pointer;
		font-family: inherit;
		padding: 4px 6px;
		border-radius: 6px;
	}
	.team-pending-link:hover {
		background: #fef3c7;
		text-decoration: underline;
	}
</style>
