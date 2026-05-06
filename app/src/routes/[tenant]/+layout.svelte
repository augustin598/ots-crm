<script lang="ts">
	import type { PageData } from './$types';
	import { SidebarProvider, SidebarInset, Sidebar } from '$lib/components/ui/sidebar';
	import { browser } from '$app/environment';
	import { Toaster } from '$lib/components/ui/sonner';
	import { hexToOklchHue, isValidHex } from '$lib/theme-utils';
	import OtsSidebar from '$lib/components/ots-sidebar/OtsSidebar.svelte';
	import OtsTopbar from '$lib/components/ots-sidebar/OtsTopbar.svelte';

	let { data, children }: { data: PageData; children: any } = $props();

	const themeHue = $derived(
		data.tenant?.themeColor && isValidHex(data.tenant.themeColor)
			? hexToOklchHue(data.tenant.themeColor)
			: 245
	);

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
		/>
	</Sidebar>
	<SidebarInset>
		<OtsTopbar />
		<main class="min-w-0 flex-1 overflow-x-hidden p-6">
			{@render children()}
		</main>
	</SidebarInset>
</SidebarProvider>
{#if browser}
	<Toaster />
{/if}
