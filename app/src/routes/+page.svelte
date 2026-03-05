<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import LogInIcon from '@lucide/svelte/icons/log-in';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>CRM - Select Organization</title>
</svelte:head>

<div class="flex min-h-screen">
	<!-- Left side - branding -->
	<div class="hidden lg:flex lg:w-1/2 items-center justify-center bg-primary/5 relative overflow-hidden">
		<div class="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5"></div>
		<div class="relative z-10 flex flex-col items-center gap-6 px-12 text-center">
			<div class="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
				<LayoutDashboardIcon class="size-10 text-primary" />
			</div>
			<div>
				<h2 class="text-2xl font-bold text-foreground">Management Platform</h2>
				<p class="mt-2 text-muted-foreground text-lg">Manage your business in one place</p>
			</div>
		</div>
	</div>

	<!-- Right side - content -->
	<div class="flex w-full lg:w-1/2 items-center justify-center px-6 py-12">
		<div class="w-full max-w-sm">
			<!-- Mobile logo -->
			<div class="mb-8 flex flex-col items-center lg:hidden">
				<div class="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
					<LayoutDashboardIcon class="size-7 text-primary" />
				</div>
			</div>

			{#if !data.user}
				<div class="space-y-2 mb-8">
					<h1 class="text-2xl font-bold tracking-tight">Welcome</h1>
					<p class="text-sm text-muted-foreground">Login or register to continue</p>
				</div>

				<div class="space-y-4">
					<a href="/login">
						<Button class="w-full gap-2">
							<LogInIcon class="size-4" />
							Login
						</Button>
					</a>

					<div class="relative my-2">
						<div class="absolute inset-0 flex items-center">
							<span class="w-full border-t"></span>
						</div>
						<div class="relative flex justify-center text-xs uppercase">
							<span class="bg-background px-2 text-muted-foreground">or</span>
						</div>
					</div>

					<a href="/register">
						<Button variant="outline" class="w-full gap-2">
							<UserPlusIcon class="size-4" />
							Register
						</Button>
					</a>
				</div>

				<p class="mt-6 text-center text-sm text-muted-foreground">
					<a href="/login?reset=1" class="font-medium text-primary hover:underline">
						Forgot password?
					</a>
				</p>
			{:else if !data.tenants || data.tenants.length === 0}
				<div class="space-y-2 mb-8">
					<h1 class="text-2xl font-bold tracking-tight">No Organizations</h1>
					<p class="text-sm text-muted-foreground">You don't belong to any organizations yet</p>
				</div>

				<a href="/register">
					<Button class="w-full gap-2">
						<Building2Icon class="size-4" />
						Create Organization
					</Button>
				</a>
			{:else}
				<div class="space-y-2 mb-8">
					<h1 class="text-2xl font-bold tracking-tight">Select Organization</h1>
					<p class="text-sm text-muted-foreground">Choose an organization to continue</p>
				</div>

				<div class="space-y-2">
					{#each data.tenants as tenant}
						<a href="/{tenant.slug}">
							<Button variant="outline" class="w-full justify-start gap-3 h-auto py-3">
								<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
									<span class="text-sm font-bold text-primary">{tenant.name[0]}</span>
								</div>
								<div class="flex flex-col items-start">
									<span class="font-semibold">{tenant.name}</span>
									<span class="text-xs text-muted-foreground">Role: {tenant.role}</span>
								</div>
							</Button>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
