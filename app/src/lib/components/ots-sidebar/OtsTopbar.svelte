<script lang="ts">
	import { page } from '$app/state';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import HomeIcon from '@lucide/svelte/icons/home';
	import { SIDEBAR_NAV, buildBreadcrumbs, type NavGroup } from '$lib/config/sidebar-nav';

	let {
		actions,
		groups = SIDEBAR_NAV,
		pathPrefix: explicitPathPrefix
	}: {
		actions?: import('svelte').Snippet;
		groups?: NavGroup[];
		pathPrefix?: string;
	} = $props();

	const tenantSlug = $derived(page.params.tenant ?? '');
	const pathPrefix = $derived(explicitPathPrefix ?? `/${tenantSlug}`);
	const crumbs = $derived(buildBreadcrumbs(page.url.pathname, pathPrefix, groups));
</script>

<header class="ots-topbar">
	<nav class="ots-crumbs" aria-label="Breadcrumbs">
		<a href={pathPrefix} class="ots-crumb-home" aria-label="Dashboard">
			<HomeIcon class="size-3.5" />
		</a>
		{#each crumbs as crumb, i (i)}
			<ChevronRightIcon class="ots-crumb-sep size-3" />
			{#if crumb.href && i < crumbs.length - 1}
				<a href={crumb.href} class="ots-crumb">{crumb.label}</a>
			{:else}
				<span class="ots-crumb current">{crumb.label}</span>
			{/if}
		{/each}
	</nav>

	{#if actions}
		<div class="ots-topbar-actions">
			{@render actions()}
		</div>
	{/if}
</header>

<style>
	.ots-topbar {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 12px 22px;
		background: var(--background);
		border-bottom: 1px solid var(--border);
		min-height: 52px;
		position: sticky;
		top: 0;
		z-index: 20;
	}
	.ots-crumbs {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--muted-foreground);
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}
	.ots-crumb-home {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: 6px;
		color: var(--muted-foreground);
		text-decoration: none;
		flex-shrink: 0;
	}
	.ots-crumb-home:hover {
		color: var(--foreground);
		background: var(--accent);
	}
	.ots-crumb-sep {
		color: var(--muted-foreground);
		opacity: 0.5;
		flex-shrink: 0;
	}
	.ots-crumb {
		color: var(--muted-foreground);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		font-weight: 500;
	}
	.ots-crumb:hover {
		color: var(--foreground);
	}
	.ots-crumb.current {
		color: var(--foreground);
		font-weight: 600;
	}
	.ots-topbar-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
</style>
