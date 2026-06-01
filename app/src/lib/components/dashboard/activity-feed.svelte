<script lang="ts">
	import type { Accent, ActivityItem } from './types';
	import { fmtRON } from './format';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import UsersIcon from '@lucide/svelte/icons/users';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import CheckIcon from '@lucide/svelte/icons/check';
	import InfoIcon from '@lucide/svelte/icons/info';

	let { activity, allHref }: { activity: ActivityItem[]; allHref: string } = $props();

	const ICONS: Record<string, typeof InfoIcon> = {
		DollarSign: DollarSignIcon,
		UserPlus: UserPlusIcon,
		Users: UsersIcon,
		Folder: FolderIcon,
		Check: CheckIcon,
		Info: InfoIcon
	};
	const CV: Record<Accent, string> = {
		success: 'var(--d-success)',
		primary: 'var(--d-primary)',
		info: 'var(--d-info)',
		warn: 'var(--d-warn)',
		danger: 'var(--d-danger)'
	};
</script>

<div class="dash-card">
	<div class="dash-card-head">
		<div>
			<div class="dash-card-title">Activitate recentă</div>
			<div class="dash-card-sub">Ultimele acțiuni în CRM</div>
		</div>
		<a href={allHref} class="dash-link">Toate <ChevronRightIcon size={12} /></a>
	</div>
	{#if activity.length}
		<div class="dash-activity-list">
			{#each activity as a, i (i)}
				{@const Icon = ICONS[a.icon] ?? InfoIcon}
				{@const c = CV[a.color]}
				<a href={a.href} class="dash-activity-row">
					<div class="dash-activity-icon" style="color:{c};background:color-mix(in oklch, {c} 12%, transparent)">
						<Icon size={13} />
					</div>
					<div class="dash-activity-text">
						<div class="dash-activity-action">
							{a.action}
							{#if a.amount}<span class="dash-activity-amt">{fmtRON(a.amount)}</span>{/if}
						</div>
						<div class="dash-activity-detail">{a.detail}</div>
					</div>
					<div class="dash-activity-meta">
						<div class="dash-activity-ago">{a.ago}</div>
						<div class="dash-activity-user">{a.user}</div>
					</div>
				</a>
			{/each}
		</div>
	{:else}
		<div class="dash-empty">Nicio activitate recentă.</div>
	{/if}
</div>
