<script lang="ts">
	import type { AlertData } from './types';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import InfoIcon from '@lucide/svelte/icons/info';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';

	let { alerts }: { alerts: AlertData[] } = $props();

	const ICONS: Record<string, typeof CircleAlertIcon> = {
		Alert: CircleAlertIcon,
		Info: InfoIcon,
		CreditCard: CreditCardIcon,
		Pause: PauseIcon,
		TrendingUp: TrendingUpIcon
	};
	const CV: Record<AlertData['type'], string> = {
		danger: 'var(--d-danger)',
		warn: 'var(--d-warn)',
		info: 'var(--d-primary)',
		success: 'var(--d-success)'
	};
</script>

<div class="dash-card">
	<div class="dash-card-head">
		<div>
			<div class="dash-card-title">Alerte & notificări</div>
			<div class="dash-card-sub">{alerts.length} necesită atenție</div>
		</div>
	</div>
	{#if alerts.length}
		<div class="dash-alerts">
			{#each alerts as a, i (i)}
				{@const Icon = ICONS[a.icon] ?? CircleAlertIcon}
				{@const c = CV[a.type]}
				<a href={a.href} class="dash-alert {a.type}">
					<div class="dash-alert-icon" style:color={c}><Icon size={16} /></div>
					<div class="dash-alert-text">
						<div class="dash-alert-title">{a.title}</div>
						<div class="dash-alert-detail">{a.detail}</div>
					</div>
					<span class="dash-alert-action">{a.action}</span>
				</a>
			{/each}
		</div>
	{:else}
		<div class="dash-empty">Totul e în regulă — nicio alertă.</div>
	{/if}
</div>
