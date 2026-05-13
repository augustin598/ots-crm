<script lang="ts">
	import type { LayoutData } from '../$types';
	import { SidebarProvider, SidebarInset, Sidebar } from '$lib/components/ui/sidebar';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { Button } from '$lib/components/ui/button';
	import { Toaster } from '$lib/components/ui/sonner';
	import { hexToOklchHue, isValidHex } from '$lib/theme-utils';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import OnboardingTour from '$lib/components/onboarding/onboarding-tour.svelte';
	import ClientSwitcher from '$lib/components/client/client-switcher.svelte';
	import OtsSidebar from '$lib/components/ots-sidebar/OtsSidebar.svelte';
	import OtsTopbar from '$lib/components/ots-sidebar/OtsTopbar.svelte';
	import type { NavGroup } from '$lib/config/sidebar-nav';

	let { data, children }: { data: LayoutData; children: any } = $props();

	const themeHue = $derived(
		data.tenant?.themeColor && isValidHex(data.tenant.themeColor)
			? hexToOklchHue(data.tenant.themeColor)
			: 245
	);

	const tenantSlug = $derived(page.params.tenant ?? '');
	const pathPrefix = $derived(`/client/${tenantSlug}`);
	const currentPath = $derived(page.url.pathname);
	const access = $derived(data.accessFlags);

	const restrictedPrefixes = ['/reports', '/tasks', '/marketing', '/backlinks', '/access-data', '/leads'];
	const isRestrictedRoute = $derived(
		restrictedPrefixes.some((prefix) => currentPath.startsWith(`/client/${tenantSlug}${prefix}`))
	);

	// Build client portal nav based on access flags. Items that fail the gate
	// stay out of the menu AND out of Cmd+K.
	const clientGroups = $derived<NavGroup[]>(
		[
			{
				id: 'workspace',
				label: 'Workspace',
				items: [
					{ id: 'dashboard', label: 'Dashboard', icon: 'dashboard' as const, href: '/dashboard' },
					{ id: 'services', label: 'Servicii & Oferte', icon: 'services' as const, href: '/services' },
					...(access.tasks
						? [{ id: 'tasks', label: 'Tasks', icon: 'tasks' as const, href: '/tasks' }]
						: [])
				]
			},
			{
				id: 'finance',
				label: 'Finanțe',
				items: [
					...(access.contracts
						? [
								{
									id: 'contracts',
									label: 'Contracts',
									icon: 'contracts' as const,
									href: '/contracts'
								}
							]
						: []),
					...(access.invoices
						? [
								{
									id: 'invoices',
									label: 'Invoices',
									icon: 'invoices' as const,
									href: '/invoices',
									children: [
										{
											id: 'inv-services',
											label: 'Facturi Servicii',
											icon: 'invoice-keez' as const,
											href: '/invoices'
										},
										{
											id: 'inv-google',
											label: 'Google Ads',
											icon: 'invoice-google' as const,
											href: '/invoices/google-ads'
										},
										{
											id: 'inv-meta',
											label: 'Facebook Ads',
											icon: 'invoice-meta' as const,
											href: '/invoices/meta-ads'
										},
										{
											id: 'inv-tiktok',
											label: 'TikTok Ads',
											icon: 'invoice-tiktok' as const,
											href: '/invoices/tiktok-ads'
										}
									]
								}
							]
						: []),
					...(access.budgets
						? [
								{
									id: 'budgets',
									label: 'Bugete Ads',
									icon: 'banking' as const,
									href: '/budgets'
								}
							]
						: [])
				]
			},
			{
				id: 'marketing',
				label: 'Marketing',
				items: [
					...(access.marketing
						? [
								{
									id: 'marketing',
									label: 'Marketing',
									icon: 'marketing' as const,
									href: '/marketing'
								}
							]
						: []),
					...(access.reports
						? [
								{
									id: 'reports',
									label: 'Reports',
									icon: 'reports' as const,
									href: '/reports',
									children: [
										{
											id: 'rep-meta',
											label: 'Facebook Ads',
											icon: 'meta' as const,
											href: '/reports/facebook-ads'
										},
										{
											id: 'rep-google',
											label: 'Google Ads',
											icon: 'google' as const,
											href: '/reports/google-ads'
										},
										{
											id: 'rep-tiktok',
											label: 'TikTok Ads',
											icon: 'tiktok' as const,
											href: '/reports/tiktok-ads'
										}
									]
								}
							]
						: []),
					...(access.leads
						? [
								{
									id: 'leads',
									label: 'Leads',
									icon: 'leads' as const,
									href: '/leads',
									children: [
										{
											id: 'leads-meta',
											label: 'Facebook Ads',
											icon: 'meta' as const,
											href: '/leads/facebook-ads'
										},
										{
											id: 'leads-google',
											label: 'Google Ads',
											icon: 'google' as const,
											href: '/leads/google-ads'
										},
										{
											id: 'leads-tiktok',
											label: 'TikTok Ads',
											icon: 'tiktok' as const,
											href: '/leads/tiktok-ads'
										}
									]
								}
							]
						: []),
					...(access.backlinks
						? [
								{
									id: 'backlinks',
									label: 'Backlinks',
									icon: 'seo-links' as const,
									href: '/backlinks'
								}
							]
						: [])
				]
			},
			{
				id: 'account',
				label: 'Cont',
				items: [
					...(access.hosting
						? [
								{
									id: 'hosting',
									label: 'Hosting',
									icon: 'hosting' as const,
									href: '/hosting',
									children: [
										{
											id: 'hosting-accounts',
											label: 'Conturile mele',
											icon: 'hosting-account' as const,
											href: '/hosting'
										},
										{
											id: 'hosting-packages',
											label: 'Pachete',
											icon: 'hosting-product' as const,
											href: '/hosting/packages'
										}
									]
								}
							]
						: []),
					...(data.isClientUserPrimary
						? [
								{
									id: 'team',
									label: 'Echipa mea',
									icon: 'clients' as const,
									href: '/team'
								}
							]
						: []),
					...(access.accessData
						? [
								{
									id: 'access-data',
									label: 'Date de acces',
									icon: 'admin' as const,
									href: '/access-data'
								}
							]
						: []),
					{ id: 'settings', label: 'Setări', icon: 'settings' as const, href: '/settings' }
				]
			}
		].filter((g) => g.items.length > 0)
	);

	// Tenant info for the sidebar header (no real switcher in client portal,
	// but the static block displays the active client/tenant identity).
	const sidebarTenant = $derived(
		data.tenant
			? {
					slug: data.tenant.slug,
					name: data.client?.businessName ?? data.client?.name ?? data.tenant.name ?? null,
					website: data.defaultWebsiteUrl ?? null
				}
			: null
	);
</script>

<svelte:head>
	{@html `<style>:root{--theme-hue:${themeHue}}</style>`}
</svelte:head>

<SidebarProvider>
	<Sidebar>
		<OtsSidebar
			tenant={sidebarTenant}
			tenantUser={null}
			allTenants={[]}
			user={data.user ?? null}
			initialPins={[]}
			groups={clientGroups}
			{pathPrefix}
			pinsApiPath={null}
			subtitle="Client Access"
			logoutPath={`/client/${tenantSlug}/login`}
		/>
	</Sidebar>
	<SidebarInset>
		<OtsTopbar groups={clientGroups} {pathPrefix} />
		{#if (data.userCompanies?.length ?? 0) > 1}
			<header class="flex items-center justify-end gap-2 border-b px-6 py-3">
				<ClientSwitcher
					companies={data.userCompanies ?? []}
					activeClientId={data.client?.id ?? null}
					tenantSlug={tenantSlug ?? ''}
				/>
			</header>
		{/if}
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
										Aveți o factură restantă de
										<strong>{data.accessRestriction.overdueDays ?? 0}</strong>
										zile. Vă rugăm să efectuați plata pentru a redobândi accesul.
									{:else}
										Accesul la această secțiune a fost restricționat de administrator.
									{/if}
								</CardDescription>
							</CardHeader>
							<CardContent class="flex justify-center">
								<Button href="/client/{tenantSlug}/invoices">Vezi Facturile</Button>
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
<OnboardingTour isPrimary={data.isClientUserPrimary ?? true} tenantSlug={tenantSlug ?? ''} />
{#if browser}
	<Toaster />
{/if}
