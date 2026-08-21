<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/state';
	import { SidebarProvider, SidebarInset, Sidebar } from '$lib/components/ui/sidebar';
	import { browser } from '$app/environment';
	import { Toaster } from '$lib/components/ui/sonner';
	import { hexToOklchHue, isValidHex } from '$lib/theme-utils';
	import OtsSidebar from '$lib/components/ots-sidebar/OtsSidebar.svelte';
	import OtsTopbar from '$lib/components/ots-sidebar/OtsTopbar.svelte';
	import { getTopbarActions } from '$lib/components/ots-sidebar/topbar-actions.svelte';

	let { data, children }: { data: PageData; children: any } = $props();

	const themeHue = $derived(
		data.tenant?.themeColor && isValidHex(data.tenant.themeColor)
			? hexToOklchHue(data.tenant.themeColor)
			: 245
	);

	// Modulul Content e un layout edge-to-edge cu breadcrumb propriu (Content › Website ›
	// Editor); ascunde topbar-ul shell + scoate p-6 din <main> ca să stea flush.
	// Regex (nu page.params.tenant, care poate fi momentan gol) → match robust /:tenant/content.
	const isContentRoute = $derived(/^\/[^/]+\/content(\/|$)/.test(page.url.pathname));

	// Update favicon dynamically per-tenant
	$effect(() => {
		const el = document.getElementById('app-favicon') as HTMLLinkElement | null;
		if (!el) return;
		if (data.tenant?.favicon) {
			el.href = `/api/tenant-favicon?slug=${data.tenant.slug}&v=${Date.now()}`;
		} else {
			el.href = '/favicon.png';
		}
	});
</script>

<svelte:head>
	{@html `<style>:root{--theme-hue:${themeHue}}</style>`}
</svelte:head>

<SidebarProvider>
	<Sidebar>
		<OtsSidebar
			tenant={data.tenant}
			tenantUser={data.tenantUser}
			allTenants={data.allTenants ?? []}
			user={data.user ?? null}
			initialPins={data.sidebarPins ?? []}
			badges={data.sidebarCounts ?? {}}
			activePluginNames={data.activePluginNames ?? []}
		/>
	</Sidebar>
	<SidebarInset>
		{#if !isContentRoute}
			<OtsTopbar actions={getTopbarActions()} />
		{/if}
		<main class="min-w-0 flex-1 overflow-x-hidden {isContentRoute ? '' : 'p-6'}">
			{@render children()}
		</main>
	</SidebarInset>
</SidebarProvider>
{#if browser}
	<Toaster />
{/if}
