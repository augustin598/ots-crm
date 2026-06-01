<script lang="ts">
	import UsersIcon from '@lucide/svelte/icons/users';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';

	let { base }: { base: string } = $props();

	const actions = $derived([
		{ label: 'Client nou', Icon: UsersIcon, color: 'var(--chart-1)', href: `${base}/clients` },
		{ label: 'Proiect nou', Icon: FolderIcon, color: 'var(--chart-2)', href: `${base}/projects` },
		{ label: 'Factură', Icon: CreditCardIcon, color: 'var(--d-success)', href: `${base}/invoices` },
		{ label: 'Campanie Ads', Icon: ZapIcon, color: 'var(--d-warn)', href: `${base}/campaigns-ads` },
		{ label: 'Task', Icon: ListTodoIcon, color: 'var(--chart-5)', href: `${base}/tasks` },
		{ label: 'Raport', Icon: TrendingUpIcon, color: 'var(--chart-4)', href: `${base}/reports` }
	]);
</script>

<div class="dash-card">
	<div class="dash-card-head">
		<div>
			<div class="dash-card-title">Acțiuni rapide</div>
			<div class="dash-card-sub">Creează în 2 click-uri</div>
		</div>
	</div>
	<div class="dash-quick-grid">
		{#each actions as act (act.label)}
			{@const Icon = act.Icon}
			<a href={act.href} class="dash-quick-btn">
				<div class="dash-quick-icon" style="color:{act.color};background:color-mix(in oklch, {act.color} 14%, transparent)">
					<Icon size={18} />
				</div>
				<span>{act.label}</span>
			</a>
		{/each}
	</div>
</div>
