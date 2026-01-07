<script lang="ts">
	import type { PageData } from './$types';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Dashboard - {data.tenant?.name || 'CRM'}</title>
</svelte:head>

<div class="space-y-6">
	<h1 class="text-3xl font-bold">Dashboard</h1>
	
	<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
		<Card>
			<CardHeader>
				<CardTitle>Clients</CardTitle>
				<CardDescription>Total clients</CardDescription>
			</CardHeader>
			<CardContent>
				<p class="text-2xl font-bold">{data.stats?.totalClients || 0}</p>
			</CardContent>
		</Card>
		<Card>
			<CardHeader>
				<CardTitle>Active Projects</CardTitle>
				<CardDescription>Projects in progress</CardDescription>
			</CardHeader>
			<CardContent>
				<p class="text-2xl font-bold">{data.stats?.activeProjects || 0}</p>
			</CardContent>
		</Card>
		<Card>
			<CardHeader>
				<CardTitle>Pending Tasks</CardTitle>
				<CardDescription>Tasks to complete</CardDescription>
			</CardHeader>
			<CardContent>
				<p class="text-2xl font-bold">{data.stats?.pendingTasks || 0}</p>
			</CardContent>
		</Card>
		<Card>
			<CardHeader>
				<CardTitle>Unpaid Invoices</CardTitle>
				<CardDescription>Invoices pending payment</CardDescription>
			</CardHeader>
			<CardContent>
				<p class="text-2xl font-bold">{data.stats?.unpaidInvoices || 0}</p>
			</CardContent>
		</Card>
	</div>
</div>
