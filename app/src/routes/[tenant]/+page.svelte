<script lang="ts">
	import type { PageData } from './$types';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { page } from '$app/state';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import UsersIcon from '@lucide/svelte/icons/users';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';

	let { data }: { data: PageData } = $props();

	const tenantSlug = $derived(page.params.tenant);

	function formatCurrency(cents: number): string {
		return new Intl.NumberFormat('ro-RO', {
			style: 'currency',
			currency: 'RON',
			minimumFractionDigits: 2
		}).format(cents / 100);
	}

	function formatTimeAgo(date: Date | string | null): string {
		if (!date) return '';
		const d = date instanceof Date ? date : new Date(date);
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 60) {
			return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
		} else if (diffHours < 24) {
			return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
		} else if (diffDays < 7) {
			return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
		} else {
			return d.toLocaleDateString('ro-RO');
		}
	}

	function formatDueDate(date: Date | string | null): string {
		if (!date) return '';
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleDateString('ro-RO', { month: 'short', day: 'numeric' });
	}

	function getPriorityColor(priority: string): string {
		switch (priority) {
			case 'urgent':
				return 'bg-red-100 text-red-700';
			case 'high':
				return 'bg-orange-100 text-orange-700';
			case 'medium':
				return 'bg-blue-100 text-blue-700';
			case 'low':
				return 'bg-gray-100 text-gray-700';
			default:
				return 'bg-blue-100 text-blue-700';
		}
	}
</script>

<svelte:head>
	<title>Dashboard - {data.tenant?.name || 'CRM'}</title>
</svelte:head>

<div class="flex-1 p-6">
	<div class="mb-8">
		<h1 class="text-3xl font-bold tracking-tight">Dashboard</h1>
		<p class="text-muted-foreground mt-1">Welcome back! Here's what's happening with your business today.</p>
	</div>

	<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
		<a href="/{tenantSlug}/invoices">
			<Card class="p-6 cursor-pointer hover:border-primary transition-colors">
				<div class="flex items-center gap-4">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
						<DollarSignIcon class="h-6 w-6 text-primary" />
					</div>
					<div class="flex-1">
						<p class="text-sm font-medium text-muted-foreground">Total Revenue</p>
						<p class="text-2xl font-bold">{formatCurrency(data.stats?.totalRevenue || 0)}</p>
						<p class="text-xs text-green-600 mt-1">From paid invoices</p>
					</div>
				</div>
			</Card>
		</a>

		<a href="/{tenantSlug}/clients">
			<Card class="p-6 cursor-pointer hover:border-primary transition-colors">
				<div class="flex items-center gap-4">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10">
						<UsersIcon class="h-6 w-6 text-blue-600" />
					</div>
					<div class="flex-1">
						<p class="text-sm font-medium text-muted-foreground">Active Clients</p>
						<p class="text-2xl font-bold">{data.stats?.activeClients || 0}</p>
						<p class="text-xs text-green-600 mt-1">Active status</p>
					</div>
				</div>
			</Card>
		</a>

		<a href="/{tenantSlug}/projects">
			<Card class="p-6 cursor-pointer hover:border-primary transition-colors">
				<div class="flex items-center gap-4">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-500/10">
						<FileTextIcon class="h-6 w-6 text-purple-600" />
					</div>
					<div class="flex-1">
						<p class="text-sm font-medium text-muted-foreground">Active Projects</p>
						<p class="text-2xl font-bold">{data.stats?.activeProjects || 0}</p>
						<p class="text-xs text-muted-foreground mt-1">In progress</p>
					</div>
				</div>
			</Card>
		</a>

		<a href="/{tenantSlug}/invoices">
			<Card class="p-6 cursor-pointer hover:border-primary transition-colors">
				<div class="flex items-center gap-4">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-500/10">
						<TrendingUpIcon class="h-6 w-6 text-orange-600" />
					</div>
					<div class="flex-1">
						<p class="text-sm font-medium text-muted-foreground">Pending Invoices</p>
						<p class="text-2xl font-bold">{formatCurrency(data.stats?.pendingInvoicesAmount || 0)}</p>
						{#if (data.stats?.overdueInvoicesCount || 0) > 0}
							<p class="text-xs text-orange-600 mt-1">{data.stats?.overdueInvoicesCount || 0} overdue</p>
						{:else}
							<p class="text-xs text-muted-foreground mt-1">{data.stats?.pendingInvoicesCount || 0} pending</p>
						{/if}
					</div>
				</div>
			</Card>
		</a>
	</div>

	<div class="grid gap-6 lg:grid-cols-2">
		<Card class="p-6">
			<h3 class="text-lg font-semibold mb-4">Recent Activity</h3>
			<div class="space-y-4">
				{#if data.recentActivity && data.recentActivity.length > 0}
					{#each data.recentActivity as activity}
						<a href="{activity.link}">
							<div class="flex items-start gap-3 pb-4 border-b last:border-0 last:pb-0 cursor-pointer hover:bg-accent/50 -mx-2 px-2 py-2 rounded transition-colors">
								<div class="mt-1 h-2 w-2 rounded-full bg-primary"></div>
								<div class="flex-1">
									<p class="text-sm font-medium">{activity.action}</p>
									<p class="text-sm text-muted-foreground">{activity.detail}</p>
								</div>
								<span class="text-xs text-muted-foreground">{formatTimeAgo(activity.createdAt)}</span>
							</div>
						</a>
					{/each}
				{:else}
					<p class="text-sm text-muted-foreground">No recent activity</p>
				{/if}
			</div>
		</Card>

		<Card class="p-6">
			<div class="flex items-center justify-between mb-4">
				<h3 class="text-lg font-semibold">Upcoming Tasks</h3>
				<a href="/{tenantSlug}/tasks" class="text-sm text-primary hover:underline">
					View all
				</a>
			</div>
			<div class="space-y-3">
				{#if data.upcomingTasks && data.upcomingTasks.length > 0}
					{#each data.upcomingTasks as task}
						<a href="/{tenantSlug}/tasks/{task.id}">
							<div class="flex items-center gap-3 p-3 rounded-lg border bg-card cursor-pointer hover:bg-accent/50 transition-colors">
								<input type="checkbox" class="h-4 w-4 rounded" />
								<div class="flex-1">
									<p class="text-sm font-medium">{task.title}</p>
									<p class="text-xs text-muted-foreground">{task.project}</p>
								</div>
								<span class="text-xs font-medium px-2 py-1 rounded {getPriorityColor(task.priority)}">
									{task.priority}
								</span>
								<span class="text-xs text-muted-foreground">{formatDueDate(task.dueDate)}</span>
							</div>
						</a>
					{/each}
				{:else}
					<p class="text-sm text-muted-foreground">No upcoming tasks</p>
				{/if}
			</div>
		</Card>
	</div>
</div>
