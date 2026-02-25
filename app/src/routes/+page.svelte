<script lang="ts">
	import type { PageData } from './$types';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>CRM - Select Organization</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	{#if !data.user}
		<Card class="w-full max-w-md">
			<CardHeader class="space-y-1">
				<CardTitle class="text-2xl font-bold">Welcome</CardTitle>
				<CardDescription>Please login or register to continue</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<a href="/login">
					<Button class="w-full">Login</Button>
				</a>
				<a href="/register">
					<Button variant="outline" class="w-full">Register</Button>
				</a>
				<a href="/login?reset=1" class="block">
					<Button variant="ghost" class="w-full text-muted-foreground hover:text-foreground">
						Forgot password?
					</Button>
				</a>
			</CardContent>
		</Card>
	{:else if !data.tenants || data.tenants.length === 0}
		<Card class="w-full max-w-md">
			<CardHeader class="space-y-1">
				<CardTitle class="text-2xl font-bold">No Organizations</CardTitle>
				<CardDescription>You don't belong to any organizations yet</CardDescription>
			</CardHeader>
			<CardContent>
				<a href="/register">
					<Button class="w-full">Create Organization</Button>
				</a>
			</CardContent>
		</Card>
	{:else}
		<Card class="w-full max-w-md">
			<CardHeader class="space-y-1">
				<CardTitle class="text-2xl font-bold">Select Organization</CardTitle>
				<CardDescription>Choose an organization to continue</CardDescription>
			</CardHeader>
			<CardContent class="space-y-2">
				{#each data.tenants as tenant}
					<a href="/{tenant.slug}">
						<Button variant="outline" class="w-full justify-start">
							<div class="flex flex-col items-start">
								<span class="font-semibold">{tenant.name}</span>
								<span class="text-xs text-gray-500">Role: {tenant.role}</span>
							</div>
						</Button>
					</a>
				{/each}
			</CardContent>
		</Card>
	{/if}
</div>
