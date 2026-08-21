<!--
	Intrarea în CRM: login/register, „n-ai nicio organizație" sau alegerea
	organizației. Folosește același cadru ca poarta de la `/servicii` (GateShell),
	ca ecranele publice ale OTS să arate la fel.
-->
<script lang="ts">
	import type { PageData } from './$types';
	import GateShell from '$lib/components/brand/GateShell.svelte';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>CRM - Select Organization</title>
</svelte:head>

<GateShell>
	<div class="ots-gate-card">
		<div class="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 mb-5">
			<LayoutDashboardIcon class="h-5 w-5 text-primary" />
		</div>

		{#if !data.user}
			<h1 class="text-2xl font-bold tracking-tight">Welcome</h1>
			<p class="text-sm text-muted-foreground mt-2">Login or register to continue</p>

			<div class="mt-6 grid gap-3">
				<a href="/login" class="ots-gate-btn ots-gloss">
					<LogInIcon class="h-4 w-4" />
					Login
				</a>

				<div class="relative my-1">
					<div class="absolute inset-0 flex items-center">
						<span class="w-full border-t"></span>
					</div>
					<div class="relative flex justify-center text-xs uppercase">
						<span class="bg-card px-2 text-muted-foreground">or</span>
					</div>
				</div>

				<a href="/register" class="ots-gate-btn ots-gate-btn-ghost">
					<UserPlusIcon class="h-4 w-4" />
					Register
				</a>
			</div>

			<p class="mt-6 text-center text-sm">
				<a href="/login?reset=1" class="font-medium text-primary hover:underline">
					Forgot password?
				</a>
			</p>
		{:else if !data.tenants || data.tenants.length === 0}
			<h1 class="text-2xl font-bold tracking-tight">No Organizations</h1>
			<p class="text-sm text-muted-foreground mt-2">
				You don't belong to any organizations yet
			</p>

			<a href="/register" class="ots-gate-btn ots-gloss mt-6">
				<Building2Icon class="h-4 w-4" />
				Create Organization
			</a>
		{:else}
			<h1 class="text-2xl font-bold tracking-tight">Select Organization</h1>
			<p class="text-sm text-muted-foreground mt-2">Choose an organization to continue</p>

			<div class="mt-6 grid grid-cols-1 gap-2">
				{#each data.tenants as tenant (tenant.slug)}
					<a href="/{tenant.slug}" class="ots-tenant">
						<span class="ots-tenant-badge">{tenant.name[0]}</span>
						<span class="flex flex-col items-start">
							<span class="font-semibold">{tenant.name}</span>
							<span class="text-xs text-muted-foreground">Role: {tenant.role}</span>
						</span>
						<ArrowRightIcon class="h-4 w-4 ml-auto text-muted-foreground" />
					</a>
				{/each}
			</div>
		{/if}
	</div>
</GateShell>
