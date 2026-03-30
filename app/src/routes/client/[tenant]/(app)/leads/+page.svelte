<script lang="ts">
	import { page } from '$app/state';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import { getLeadStats } from '$lib/remotes/leads.remote';

	const tenantSlug = $derived(page.params.tenant as string);

	let stats = $state<Array<{ platform: string; status: string; count: number }>>([]);

	$effect(() => {
		loadStats();
	});

	async function loadStats() {
		try {
			stats = await getLeadStats();
		} catch (e) {
			console.error('Failed to load lead stats:', e);
		}
	}

	function getCountForPlatform(platform: string, statusFilter?: string): number {
		return stats
			.filter((s) => s.platform === platform && (!statusFilter || s.status === statusFilter))
			.reduce((sum, s) => sum + s.count, 0);
	}

	function getTotalCount(statusFilter?: string): number {
		return stats
			.filter((s) => !statusFilter || s.status === statusFilter)
			.reduce((sum, s) => sum + s.count, 0);
	}

	const platforms = $derived([
		{
			label: 'Facebook Ads',
			description: 'Facebook & Instagram Lead Ads',
			href: `/client/${tenantSlug}/leads/facebook-ads`,
			icon: IconFacebook,
			color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
			platform: 'facebook',
			active: true
		},
		{
			label: 'Google Ads',
			description: 'Google Lead Form Extensions',
			href: `/client/${tenantSlug}/leads/google-ads`,
			icon: IconGoogleAds,
			color: 'bg-green-500/10 text-green-600 dark:text-green-400',
			platform: 'google',
			active: false
		},
		{
			label: 'TikTok Ads',
			description: 'TikTok Lead Generation',
			href: `/client/${tenantSlug}/leads/tiktok-ads`,
			icon: IconTiktok,
			color: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
			platform: 'tiktok',
			active: false
		}
	]);
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<ContactIcon class="h-8 w-8" />
				Leads
			</h1>
			<p class="text-muted-foreground">Leaduri din campaniile publicitare</p>
		</div>
	</div>

	<!-- Stats cards -->
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each platforms as p (p.label)}
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">{p.label}</Card.Title>
					<div class="flex h-8 w-8 items-center justify-center rounded-md {p.color}">
						<p.icon class="h-4 w-4" />
					</div>
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-bold">{getCountForPlatform(p.platform)}</div>
					<div class="flex items-center gap-2 mt-1">
						{#if getCountForPlatform(p.platform, 'new') > 0}
							<Badge variant="secondary" class="text-xs">{getCountForPlatform(p.platform, 'new')} noi</Badge>
						{/if}
						{#if !p.active}
							<Badge variant="outline" class="text-xs">Coming soon</Badge>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>
		{/each}

		<!-- Total -->
		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<Card.Title class="text-sm font-medium">Total</Card.Title>
				<div class="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
					<ContactIcon class="h-4 w-4 text-primary" />
				</div>
			</Card.Header>
			<Card.Content>
				<div class="text-2xl font-bold">{getTotalCount()}</div>
				<div class="flex items-center gap-2 mt-1">
					{#if getTotalCount('new') > 0}
						<Badge variant="secondary" class="text-xs">{getTotalCount('new')} noi</Badge>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Platform quick links -->
	<div>
		<h2 class="text-lg font-semibold mb-3">Platforme</h2>
		<div class="grid gap-4 sm:grid-cols-3">
			{#each platforms as platform (platform.label)}
				<a
					href={platform.href}
					class="group flex items-center justify-between rounded-lg border bg-card p-4 shadow-sm transition-all hover:shadow-md hover:border-primary/50"
				>
					<div class="flex items-center gap-3">
						<div class="flex h-10 w-10 items-center justify-center rounded-lg {platform.color}">
							<platform.icon class="h-5 w-5" />
						</div>
						<div>
							<p class="font-semibold">{platform.label}</p>
							<p class="text-xs text-muted-foreground">{platform.description}</p>
						</div>
					</div>
					<div class="flex items-center gap-2">
						{#if !platform.active}
							<Badge variant="outline" class="text-xs">Soon</Badge>
						{/if}
						<ChevronRightIcon class="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
					</div>
				</a>
			{/each}
		</div>
	</div>
</div>
