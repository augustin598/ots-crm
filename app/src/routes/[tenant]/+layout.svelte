<script lang="ts">
	import type { PageData } from './$types';
	import { SidebarProvider, SidebarInset, Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter } from '$lib/components/ui/sidebar';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { logout } from '$lib/remotes/auth.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import UsersIcon from '@lucide/svelte/icons/users';
	import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
	import CheckSquareIcon from '@lucide/svelte/icons/check-square';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import FileSignatureIcon from '@lucide/svelte/icons/file-signature';
	import BriefcaseIcon from '@lucide/svelte/icons/briefcase';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
import LinkIcon from '@lucide/svelte/icons/link';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import MailIcon from '@lucide/svelte/icons/mail';
	import FileDownIcon from '@lucide/svelte/icons/file-down';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import { Button } from '$lib/components/ui/button';
	import { cn, getFaviconUrl } from '$lib/utils';
	import { Toaster } from '$lib/components/ui/sonner';
	import { hexToOklchHue, isValidHex } from '$lib/theme-utils';

	let { data, children }: { data: PageData; children: any } = $props();

	const themeHue = $derived(
		data.tenant?.themeColor && isValidHex(data.tenant.themeColor)
			? hexToOklchHue(data.tenant.themeColor)
			: 245
	);

	async function handleLogout() {
		try {
			await logout();
			goto('/login');
		} catch (e) {
			console.error('Logout failed:', e);
		}
	}

	const currentPath = $derived(page.url.pathname);
	const tenantSlug = $derived(page.params.tenant);
	let switcherOpen = $state(false);

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
			{#if data.allTenants && data.allTenants.length > 1}
				<Popover bind:open={switcherOpen}>
					<PopoverTrigger
						class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
					>
						<div class="flex items-center justify-center w-10 h-10 rounded-lg bg-sidebar-accent shrink-0 overflow-hidden">
							{#if data.tenant?.website}
								<img src={getFaviconUrl(data.tenant.website, 64)} alt="" class="w-8 h-8 object-contain" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
							{:else}
								<Building2Icon class="size-5 text-sidebar-accent-foreground" />
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<h2 class="text-sm font-semibold truncate">{data.tenant?.name || 'Organization'}</h2>
							<p class="text-xs text-muted-foreground capitalize">{data.tenantUser?.role || 'member'}</p>
						</div>
						<ChevronDownIcon class="h-4 w-4 text-muted-foreground shrink-0" />
					</PopoverTrigger>
					<PopoverContent class="w-[--radix-popover-trigger-width] p-0" align="start">
						<div class="p-1">
							<div class="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Switch Organization</div>
							{#each data.allTenants as tenant}
								<button
									onclick={() => {
										goto(`/${tenant.slug}`);
										switcherOpen = false;
									}}
									class={cn(
										'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors',
										tenant.slug === tenantSlug
											? 'bg-sidebar-accent text-sidebar-accent-foreground'
											: 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
									)}
								>
									<div class="flex items-center justify-center w-8 h-8 rounded-lg bg-sidebar-accent shrink-0">
										<Building2Icon class="size-4 text-sidebar-accent-foreground" />
									</div>
									<div class="flex-1 min-w-0">
										<div class="text-sm font-medium truncate">{tenant.name}</div>
										<div class="text-xs text-muted-foreground capitalize">{tenant.role}</div>
									</div>
									{#if tenant.slug === tenantSlug}
										<CheckIcon class="h-4 w-4 text-sidebar-accent-foreground shrink-0" />
									{/if}
								</button>
							{/each}
						</div>
					</PopoverContent>
				</Popover>
			{:else}
				<div class="flex items-center gap-3 px-2 py-2">
					<div class="flex items-center justify-center w-10 h-10 rounded-lg bg-sidebar-accent shrink-0 overflow-hidden">
						{#if data.tenant?.website}
							<img src={getFaviconUrl(data.tenant.website, 64)} alt="" class="w-8 h-8 object-contain" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
						{:else}
							<Building2Icon class="size-5 text-sidebar-accent-foreground" />
						{/if}
					</div>
					<div class="flex-1 min-w-0">
						<h2 class="text-sm font-semibold truncate">{data.tenant?.name || 'Organization'}</h2>
						<p class="text-xs text-muted-foreground capitalize">{data.tenantUser?.role || 'member'}</p>
					</div>
				</div>
			{/if}
		</SidebarHeader>
		<SidebarContent>
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath === `/${tenantSlug}`}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}" {...props}>
								<LayoutDashboardIcon />
								<span>Dashboard</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/clients`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/clients" {...props}>
								<UsersIcon />
								<span>Clients</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/projects`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/projects" {...props}>
								<FolderKanbanIcon />
								<span>Projects</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/tasks`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/tasks" {...props}>
								<CheckSquareIcon />
								<span>Tasks</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/my-plans`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/my-plans" {...props}>
								<CalendarIcon />
								<span>My Plans</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/services`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/services" {...props}>
								<BriefcaseIcon />
								<span>Services</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/invoices`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/invoices" {...props}>
								<ReceiptIcon />
								<span>Invoices</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/contracts`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/contracts" {...props}>
								<FileSignatureIcon />
								<span>Contracte</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/banking`) && !currentPath.startsWith(`/${tenantSlug}/banking/supplier-invoices`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/banking" {...props}>
								<CreditCardIcon />
								<span>Banking</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/banking/supplier-invoices`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/banking/supplier-invoices" {...props}>
								<FileDownIcon />
								<span>Facturi Furnizori</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/seo-links`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/seo-links" {...props}>
								<LinkIcon />
								<span>Linkuri SEO</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/marketing`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/marketing" {...props}>
								<MegaphoneIcon />
								<span>Marketing</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/admin/logs`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/admin/logs" {...props}>
								<ScrollTextIcon />
								<span>Logs si Debug</span>
							</a>
						{/snippet}
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton isActive={currentPath.startsWith(`/${tenantSlug}/settings`) && !currentPath.startsWith(`/${tenantSlug}/settings/gmail`)}>
						{#snippet child({ props })}
							<a href="/{tenantSlug}/settings" {...props}>
								<SettingsIcon />
								<span>Settings</span>
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
			{@render children()}
		</main>
	</SidebarInset>
</SidebarProvider>
{#if browser}
	<Toaster />
{/if}
