<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/state';
	import '$lib/components/dashboard/dashboard.css';
	import KpiCard from '$lib/components/dashboard/kpi-card.svelte';
	import RevenueChart from '$lib/components/dashboard/revenue-chart.svelte';
	import AlertsWidget from '$lib/components/dashboard/alerts-widget.svelte';
	import AdsPerformance from '$lib/components/dashboard/ads-performance.svelte';
	import CashFlowWidget from '$lib/components/dashboard/cash-flow-widget.svelte';
	import TopClients from '$lib/components/dashboard/top-clients.svelte';
	import FunnelWidget from '$lib/components/dashboard/funnel-widget.svelte';
	import TodayWidget from '$lib/components/dashboard/today-widget.svelte';
	import QuickActions from '$lib/components/dashboard/quick-actions.svelte';
	import ActivityFeed from '$lib/components/dashboard/activity-feed.svelte';
	import TasksWidget from '$lib/components/dashboard/tasks-widget.svelte';
	import TeamActivity from '$lib/components/dashboard/team-activity.svelte';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import BellIcon from '@lucide/svelte/icons/bell';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-question-mark';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';

	let { data }: { data: PageData } = $props();

	const d = $derived(data.dashboard);
	const base = $derived(`/${page.params.tenant}`);
	const periods = ['Azi', '7d', '30d', '90d', 'YTD'];
	let period = $state('30d');
</script>

<svelte:head>
	<title>Dashboard - {data.tenant?.name ?? 'OTS CRM'}</title>
</svelte:head>

<div class="dash-wrap -m-6">
	<div class="dash-topbar">
		<div class="dash-crumbs">
			<span>Workspace</span>
			<ChevronRightIcon size={11} />
			<strong>Dashboard</strong>
		</div>
		<div class="dash-top-actions">
			<button class="mock-btn-ghost" type="button" aria-label="Notificări"><BellIcon size={14} /></button>
			<button class="mock-btn-ghost" type="button" aria-label="Ajutor"><CircleHelpIcon size={14} /></button>
			<a class="mock-btn-primary" href={`${base}/tasks`}><PlusIcon size={14} /> Acțiune nouă</a>
		</div>
	</div>

	<div class="dash-hero">
		<div class="dash-greeting">
			<h1>{d.greeting}{d.userName ? `, ${d.userName}` : ''} 👋</h1>
			<p>{d.alertSummary}</p>
		</div>
		<div class="dash-period">
			<div class="dash-compare"><TrendingUpIcon size={12} /> vs perioada anterioară</div>
			<div class="dash-period-toggle">
				{#each periods as p (p)}
					<button type="button" class:active={period === p} onclick={() => (period = p)}>{p}</button>
				{/each}
			</div>
		</div>
	</div>

	<div class="dash-kpi-row">
		{#each d.kpis as k (k.id)}
			<KpiCard kpi={k} />
		{/each}
	</div>

	<div class="dash-bento">
		<div class="dash-w-revenue"><RevenueChart data={d.revenue12m} /></div>
		<div class="dash-w-alerts"><AlertsWidget alerts={d.alerts} /></div>
		<div class="dash-w-ads"><AdsPerformance platforms={d.adsPlatforms} allHref={`${base}/campaigns-ads`} demo={d.demoFlags.ads} /></div>
		<div class="dash-w-cash"><CashFlowWidget data={d.cashflow} /></div>
		<div class="dash-w-clients"><TopClients clients={d.topClients} allHref={`${base}/clients`} /></div>
		<div class="dash-w-funnel"><FunnelWidget stages={d.funnel} /></div>
		<div class="dash-w-today"><TodayWidget events={d.todayEvents} /></div>
		<div class="dash-w-quick"><QuickActions {base} /></div>
		<div class="dash-w-activity"><ActivityFeed activity={d.activity} allHref={`${base}/admin/logs`} /></div>
		<div class="dash-w-tasks"><TasksWidget tasks={d.tasks} allHref={`${base}/tasks`} newHref={`${base}/tasks`} /></div>
		<div class="dash-w-team"><TeamActivity team={d.team} /></div>
	</div>
</div>
