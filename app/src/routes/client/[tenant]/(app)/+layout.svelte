<script lang="ts">
	import type { LayoutData } from '../$types';
	import { SidebarProvider, SidebarInset, Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton, SidebarFooter } from '$lib/components/ui/sidebar';
	import { logout } from '$lib/remotes/auth.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import CheckSquareIcon from '@lucide/svelte/icons/check-square';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import { Button } from '$lib/components/ui/button';
	import { getFaviconUrl } from '$lib/utils';
	import { Toaster } from '$lib/components/ui/sonner';
	import { browser } from '$app/environment';
	import { hexToOklchHue, isValidHex } from '$lib/theme-utils';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';

	let { data, children }: { data: LayoutData; children: any } = $props();

	const themeHue = $derived(
		data.tenant?.themeColor && isValidHex(data.tenant.themeColor)
			? hexToOklchHue(data.tenant.themeColor)
			: 245
	);

	async function handleLogout() {
		try {
			await logout();
			goto(`/client/${data.tenant?.slug}/login`);
		} catch (e) {
			console.error('Logout failed:', e);
		}
	}

	const currentPath = $derived(page.url.pathname);
	const tenantSlug = $derived(page.params.tenant);
	const restrictedPrefixes = ['/reports', '/tasks', '/marketing', '/backlinks', '/access-data'];
	const isRestrictedRoute = $derived(
		restrictedPrefixes.some((prefix) => currentPath.startsWith(`/client/${tenantSlug}${prefix}`))
	);

	const toggleTheme = () => {
		document.documentElement.classList.toggle('dark');
	}
</script>

<svelte:head>
	{@html `<style>:root{--theme-hue:${themeHue}}</style>`}
</svelte:head>

<SidebarProvider>
	<Sidebar>
		<SidebarHeader>
			<div class="flex items-center gap-3 px-2 py-2">
				<div class="flex items-center justify-center w-10 h-10 rounded-lg bg-sidebar-accent shrink-0 overflow-hidden">
					{#if data.defaultWebsiteUrl}
						<img
							src={getFaviconUrl(data.defaultWebsiteUrl, 64)}
							alt=""
							class="w-8 h-8 object-contain"
							loading="lazy"
							onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
						/>
					{:else}
						<Building2Icon class="size-5 text-sidebar-accent-foreground" />
					{/if}
				</div>
				<div class="flex-1 min-w-0">
					<h2 class="text-sm font-semibold truncate">{data.client?.businessName || data.client?.name || data.tenant?.name || 'Client Portal'}</h2>
					<p class="text-xs text-muted-foreground">Client Access</p>
				</div>
			</div>
		</SidebarHeader>
		<SidebarContent>
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath === `/client/${tenantSlug}/dashboard` || currentPath === `/client/${tenantSlug}`}>
						{#snippet child({ props })}
							<a href="/client/{tenantSlug}/dashboard" {...props}>
								<LayoutDashboardIcon />
								<span>Dashboard</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/client/${tenantSlug}/tasks`)}>
						{#snippet child({ props })}
							<a href="/client/{tenantSlug}/tasks" {...props}>
								<CheckSquareIcon />
								<span>Tasks</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				{#if data.isClientUserPrimary}
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/client/${tenantSlug}/contracts`)}>
						{#snippet child({ props })}
							<a href="/client/{tenantSlug}/contracts" {...props}>
								<FileTextIcon />
								<span>Contracts</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/client/${tenantSlug}/invoices`)}>
						{#snippet child({ props })}
							<a href="/client/{tenantSlug}/invoices" {...props}>
								<ReceiptIcon />
								<span>Invoices</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
					{#if currentPath.startsWith(`/client/${tenantSlug}/invoices`)}
						<SidebarMenuSub>
							<SidebarMenuSubItem>
								<SidebarMenuSubButton isActive={currentPath === `/client/${tenantSlug}/invoices` || (currentPath.startsWith(`/client/${tenantSlug}/invoices`) && !currentPath.startsWith(`/client/${tenantSlug}/invoices/google-ads`) && !currentPath.startsWith(`/client/${tenantSlug}/invoices/meta-ads`) && !currentPath.startsWith(`/client/${tenantSlug}/invoices/tiktok-ads`))}>
									{#snippet child({ props })}
										<a href="/client/{tenantSlug}/invoices" {...props}>
											<span>Facturi Servicii</span>
										</a>
									{/snippet}
								</SidebarMenuSubButton>
							</SidebarMenuSubItem>
							<SidebarMenuSubItem>
								<SidebarMenuSubButton isActive={currentPath.startsWith(`/client/${tenantSlug}/invoices/google-ads`)}>
									{#snippet child({ props })}
										<a href="/client/{tenantSlug}/invoices/google-ads" {...props}>
											<IconGoogleAds class="h-4 w-4" />
											<span>Google Ads</span>
										</a>
									{/snippet}
								</SidebarMenuSubButton>
							</SidebarMenuSubItem>
							<SidebarMenuSubItem>
								<SidebarMenuSubButton isActive={currentPath.startsWith(`/client/${tenantSlug}/invoices/meta-ads`)}>
									{#snippet child({ props })}
										<a href="/client/{tenantSlug}/invoices/meta-ads" {...props}>
											<IconFacebook class="h-4 w-4" />
											<span>Facebook Ads</span>
										</a>
									{/snippet}
								</SidebarMenuSubButton>
							</SidebarMenuSubItem>
							<SidebarMenuSubItem>
								<SidebarMenuSubButton isActive={currentPath.startsWith(`/client/${tenantSlug}/invoices/tiktok-ads`)}>
									{#snippet child({ props })}
										<a href="/client/{tenantSlug}/invoices/tiktok-ads" {...props}>
											<IconTiktok class="h-4 w-4" />
											<span>TikTok Ads</span>
										</a>
									{/snippet}
								</SidebarMenuSubButton>
							</SidebarMenuSubItem>
						</SidebarMenuSub>
					{/if}
				</SidebarMenuItem>
				{/if}
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/client/${tenantSlug}/marketing`)}>
						{#snippet child({ props })}
							<a href="/client/{tenantSlug}/marketing" {...props}>
								<MegaphoneIcon />
								<span>Marketing</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/client/${tenantSlug}/reports`)}>
						{#snippet child({ props })}
							<a href="/client/{tenantSlug}/reports" {...props}>
								<BarChart3Icon />
								<span>Reports</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
					{#if currentPath.startsWith(`/client/${tenantSlug}/reports`)}
						<SidebarMenuSub>
							<SidebarMenuSubItem>
								<SidebarMenuSubButton isActive={currentPath.startsWith(`/client/${tenantSlug}/reports/facebook-ads`)}>
									{#snippet child({ props })}
										<a href="/client/{tenantSlug}/reports/facebook-ads" {...props}>
											<IconFacebook class="h-4 w-4" />
											<span>Facebook Ads</span>
										</a>
									{/snippet}
								</SidebarMenuSubButton>
							</SidebarMenuSubItem>
							<SidebarMenuSubItem>
								<SidebarMenuSubButton isActive={currentPath.startsWith(`/client/${tenantSlug}/reports/google-ads`)}>
									{#snippet child({ props })}
										<a href="/client/{tenantSlug}/reports/google-ads" {...props}>
											<IconGoogleAds class="h-4 w-4" />
											<span>Google Ads</span>
										</a>
									{/snippet}
								</SidebarMenuSubButton>
							</SidebarMenuSubItem>
							<SidebarMenuSubItem>
								<SidebarMenuSubButton isActive={currentPath.startsWith(`/client/${tenantSlug}/reports/tiktok-ads`)}>
									{#snippet child({ props })}
										<a href="/client/{tenantSlug}/reports/tiktok-ads" {...props}>
											<IconTiktok class="h-4 w-4" />
											<span>TikTok Ads</span>
										</a>
									{/snippet}
								</SidebarMenuSubButton>
							</SidebarMenuSubItem>
						</SidebarMenuSub>
					{/if}
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/client/${tenantSlug}/access-data`)}>
						{#snippet child({ props })}
							<a href="/client/{tenantSlug}/access-data" {...props}>
								<KeyRoundIcon />
								<span>Date de acces</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/client/${tenantSlug}/backlinks`)}>
						{#snippet child({ props })}
							<a href="/client/{tenantSlug}/backlinks" {...props}>
								<Link2Icon />
								<span>Backlinks</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/client/${tenantSlug}/settings`)}>
						{#snippet child({ props })}
							<a href="/client/{tenantSlug}/settings" {...props}>
								<SettingsIcon />
								<span>Setări</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		</SidebarContent>
		<SidebarFooter>
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton onclick={toggleTheme} variant="outline">
						<div class="relative size-4">
							<SunIcon class="absolute size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
							<MoonIcon class="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
						</div>
						<span>Toggle Theme</span>
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton onclick={handleLogout} variant="outline">
						<LogOutIcon />
						<span>Logout</span>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		</SidebarFooter>
	</Sidebar>
	<SidebarInset>
		<main class="flex-1 p-6">
			{#if data.accessRestriction?.isRestricted && isRestrictedRoute}
				<div class="relative min-h-[60vh]">
					<div class="blur-sm pointer-events-none select-none" aria-hidden="true">
						{@render children()}
					</div>
					<div class="absolute inset-0 flex items-center justify-center bg-background/40">
						<Card class="max-w-md w-full shadow-lg">
							<CardHeader class="text-center">
								<div class="flex justify-center mb-3">
									<TriangleAlertIcon class="h-12 w-12 text-destructive" />
								</div>
								<CardTitle>Acces Restricționat</CardTitle>
								<CardDescription class="mt-2">
									{#if data.accessRestriction.reason === 'overdue_invoice'}
										Aveți o factură restantă de <strong>{data.accessRestriction.overdueDays ?? 0}</strong> zile.
										Vă rugăm să efectuați plata pentru a redobândi accesul.
									{:else}
										Accesul la această secțiune a fost restricționat de administrator.
									{/if}
								</CardDescription>
							</CardHeader>
							<CardContent class="flex justify-center">
								<Button href="/client/{tenantSlug}/invoices">
									Vezi Facturile
								</Button>
							</CardContent>
						</Card>
					</div>
				</div>
			{:else}
				{@render children()}
			{/if}
		</main>
	</SidebarInset>
</SidebarProvider>
{#if browser}
	<Toaster />
{/if}
