<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { logout } from '$lib/remotes/auth.remote';
	import { cn, getFaviconUrl } from '$lib/utils';
	import NotificationBell from '$lib/components/app/notification-bell/NotificationBell.svelte';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SearchIcon from '@lucide/svelte/icons/search';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import StarIcon from '@lucide/svelte/icons/star';
	import {
		SIDEBAR_NAV,
		filterByRole,
		flattenNav,
		buildHref,
		isItemActive,
		type NavItem,
		type NavGroup
	} from '$lib/config/sidebar-nav';
	import NavIcon from './NavIcon.svelte';
	import OtsCommandPalette from './OtsCommandPalette.svelte';

	type TenantInfo = {
		slug: string;
		name: string | null;
		website?: string | null;
		role: string;
	};

	let {
		tenant,
		tenantUser,
		allTenants,
		user,
		initialPins
	}: {
		tenant: { slug: string; name: string | null; website?: string | null } | null;
		tenantUser: { role: string } | null;
		allTenants: TenantInfo[];
		user: { firstName?: string | null; lastName?: string | null; email: string } | null;
		initialPins: string[];
	} = $props();

	const tenantSlug = $derived(page.params.tenant ?? '');
	const currentPath = $derived(page.url.pathname);
	const role = $derived(tenantUser?.role ?? 'member');

	const visibleGroups = $derived(filterByRole(SIDEBAR_NAV, role));
	const flatVisible = $derived(flattenNav(visibleGroups));

	// pins (mirror of server state, optimistic on toggle)
	let pins = $state<string[]>([...initialPins]);

	// per-group collapse (default: all open)
	let collapsedGroups = $state<Record<string, boolean>>({});

	// per-item expanded (for items with children). Initial: derived from active route.
	let openItems = $state<Record<string, boolean>>({});

	function isItemOpen(item: NavItem): boolean {
		if (item.id in openItems) return openItems[item.id];
		// Default: open if current route is on a child
		return (item.children ?? []).some(
			(c) => c.href && (currentPath === buildHref(tenantSlug, c.href) || currentPath.startsWith(`${buildHref(tenantSlug, c.href)}/`))
		);
	}

	function toggleItemOpen(item: NavItem) {
		openItems = { ...openItems, [item.id]: !isItemOpen(item) };
	}

	function toggleGroup(groupId: string) {
		collapsedGroups = { ...collapsedGroups, [groupId]: !collapsedGroups[groupId] };
	}

	// Compute sibling hrefs once per group for active-state disambiguation
	function siblingHrefsFor(group: NavGroup): string[] {
		return group.items.flatMap((it) => [
			...(it.href ? [it.href] : []),
			...(it.children ?? []).map((c) => c.href).filter((h): h is string => Boolean(h))
		]);
	}

	// Pin/unpin: optimistic + server sync
	async function togglePin(itemId: string) {
		const prev = pins;
		const isPinned = pins.includes(itemId);
		const next = isPinned ? pins.filter((p) => p !== itemId) : [...pins, itemId];
		pins = next;
		try {
			const res = await fetch(`/${tenantSlug}/api/sidebar/pins`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ itemId })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body: { items: string[] } = await res.json();
			pins = body.items;
		} catch {
			pins = prev;
		}
	}

	// Build pinned items by looking up flat list
	const pinnedItems = $derived(
		pins.map((id) => flatVisible.find((it) => it.id === id)).filter((it): it is NonNullable<typeof it> => Boolean(it))
	);

	// Tenant switcher
	let switcherOpen = $state(false);
	let userMenuOpen = $state(false);

	// Command palette
	let cmdOpen = $state(false);

	function handleKey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			cmdOpen = true;
		}
	}

	function toggleTheme() {
		document.documentElement.classList.toggle('dark');
	}

	async function handleLogout() {
		try {
			await logout();
			goto('/login');
		} catch (err) {
			console.error('Logout failed:', err);
		}
	}

	function userInitials(): string {
		if (!user) return '?';
		const fn = (user.firstName ?? '').trim()[0] ?? '';
		const ln = (user.lastName ?? '').trim()[0] ?? '';
		const initials = `${fn}${ln}`.toUpperCase();
		if (initials) return initials;
		return (user.email ?? '?').slice(0, 2).toUpperCase();
	}

	function userDisplayName(): string {
		if (!user) return '';
		const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
		return full || (user.email ?? '');
	}
</script>

<svelte:window onkeydown={handleKey} />

<aside class="ots-sb">
	<!-- Tenant switcher -->
	{#if allTenants && allTenants.length > 1}
		<Popover bind:open={switcherOpen}>
			<PopoverTrigger
				class="ots-sb-tenant"
				aria-label="Schimbă organizație"
			>
				<div class="ots-sb-tenant-logo">
					{#if tenant?.website}
						<img
							src={getFaviconUrl(tenant.website, 64)}
							alt=""
							loading="lazy"
							onerror={(e) => {
								(e.currentTarget as HTMLImageElement).style.display = 'none';
							}}
						/>
					{:else}
						<Building2Icon class="size-5 text-(--ots-sb-muted)" />
					{/if}
				</div>
				<div class="ots-sb-tenant-text">
					<div class="ots-sb-tenant-name">{tenant?.name ?? 'Organization'}</div>
					<div class="ots-sb-tenant-role">
						<span class="capitalize">{tenantUser?.role ?? 'member'}</span>
						<ChevronDownIcon class="size-3" />
					</div>
				</div>
			</PopoverTrigger>
			<PopoverContent class="w-[var(--bits-popover-anchor-width)] p-0" align="start">
				<div class="p-1">
					<div class="ots-sb-dropdown-head">Schimbă organizație</div>
					{#each allTenants as t (t.slug)}
						<button
							type="button"
							class={cn('ots-sb-tenant-option', t.slug === tenantSlug && 'active')}
							onclick={() => {
								goto(`/${t.slug}`);
								switcherOpen = false;
							}}
						>
							<div class="ots-sb-tenant-option-logo">
								{#if t.website}
									<img
										src={getFaviconUrl(t.website, 32)}
										alt=""
										loading="lazy"
										onerror={(e) => {
											(e.currentTarget as HTMLImageElement).style.display = 'none';
										}}
									/>
								{:else}
									<Building2Icon class="size-4 text-(--ots-sb-muted)" />
								{/if}
							</div>
							<div class="ots-sb-tenant-option-info">
								<div class="ots-sb-tenant-option-name">{t.name ?? t.slug}</div>
								<div class="ots-sb-tenant-option-role capitalize">{t.role}</div>
							</div>
							{#if t.slug === tenantSlug}
								<CheckIcon class="size-4 text-(--ots-sb-accent)" />
							{/if}
						</button>
					{/each}
				</div>
			</PopoverContent>
		</Popover>
	{:else}
		<div class="ots-sb-tenant ots-sb-tenant-static">
			<div class="ots-sb-tenant-logo">
				{#if tenant?.website}
					<img
						src={getFaviconUrl(tenant.website, 64)}
						alt=""
						loading="lazy"
						onerror={(e) => {
							(e.currentTarget as HTMLImageElement).style.display = 'none';
						}}
					/>
				{:else}
					<Building2Icon class="size-5 text-(--ots-sb-muted)" />
				{/if}
			</div>
			<div class="ots-sb-tenant-text">
				<div class="ots-sb-tenant-name">{tenant?.name ?? 'Organization'}</div>
				<div class="ots-sb-tenant-role capitalize">{tenantUser?.role ?? 'member'}</div>
			</div>
		</div>
	{/if}

	<!-- Search button -> command palette -->
	<button type="button" class="ots-sb-search" onclick={() => (cmdOpen = true)}>
		<SearchIcon class="size-3.5" />
		<span class="ots-sb-search-placeholder">Caută peste tot...</span>
		<kbd class="ots-sb-kbd">⌘K</kbd>
	</button>

	<!-- Pinned -->
	{#if pinnedItems.length > 0}
		<div class="ots-sb-pinned">
			<div class="ots-sb-pinned-label">
				<span>FAVORITE</span>
				<StarIcon class="size-3 text-(--ots-sb-muted)" />
			</div>
			<div class="ots-sb-pinned-items">
				{#each pinnedItems as it (it.id)}
					{@const itHref = buildHref(tenantSlug, it.href)}
					<a
						href={itHref}
						class={cn(
							'ots-sb-pin',
							itHref && (currentPath === itHref || currentPath.startsWith(`${itHref}/`)) && 'active'
						)}
					>
						<NavIcon icon={it.icon} class="size-3.5 shrink-0" />
						<span>{it.label}</span>
					</a>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Nav -->
	<nav class="ots-sb-nav">
		{#each visibleGroups as group (group.id)}
			{@const sibHrefs = siblingHrefsFor(group)}
			<div class="ots-sb-group">
				<button
					type="button"
					class="ots-sb-group-head"
					onclick={() => toggleGroup(group.id)}
				>
					<span>{group.label}</span>
					<ChevronDownIcon
						class={cn('size-2.5 transition-transform', collapsedGroups[group.id] && '-rotate-90')}
					/>
				</button>
				{#if !collapsedGroups[group.id]}
					{#each group.items as item (item.id)}
						{@const active = isItemActive(item, currentPath, tenantSlug, sibHrefs)}
						{@const open = isItemOpen(item)}
						{@const itemHref = buildHref(tenantSlug, item.href)}
						{@const isPinned = pins.includes(item.id)}
						<div class="ots-sb-item-row">
							{#if item.children && item.children.length > 0}
								<button
									type="button"
									class={cn('ots-sb-item', active && 'active')}
									onclick={() => {
										toggleItemOpen(item);
										if (itemHref) goto(itemHref);
									}}
								>
									<NavIcon icon={item.icon} class="ots-sb-icon" />
									<span class="ots-sb-label">{item.label}</span>
									{#if item.badge}
										<span class="ots-sb-badge">{item.badge}</span>
									{/if}
									<ChevronRightIcon
										class={cn(
											'ots-sb-caret size-3 transition-transform',
											open && 'rotate-90'
										)}
									/>
								</button>
								<button
									type="button"
									class={cn('ots-sb-pin-btn', isPinned && 'on')}
									aria-label={isPinned ? 'Scoate din favorite' : 'Adaugă la favorite'}
									onclick={(e) => {
										e.stopPropagation();
										togglePin(item.id);
									}}
								>
									<HeartIcon class="size-3" />
								</button>
								{#if open}
									<div class="ots-sb-sub">
										{#each item.children as child (child.id)}
											{@const chHref = buildHref(tenantSlug, child.href)}
											{@const chActive =
												chHref && (currentPath === chHref || currentPath.startsWith(`${chHref}/`))
													? !sibHrefs.find(
															(s) =>
																s !== child.href &&
																child.href &&
																s.startsWith(`${child.href}/`) &&
																(currentPath === buildHref(tenantSlug, s) ||
																	currentPath.startsWith(`${buildHref(tenantSlug, s)}/`))
														)
													: false}
											<a
												href={chHref}
												class={cn('ots-sb-subitem', chActive && 'active')}
											>
												<NavIcon icon={child.icon} class="size-3.5" />
												<span>{child.label}</span>
												{#if child.badge}
													<span class="ots-sb-badge mini">{child.badge}</span>
												{/if}
											</a>
										{/each}
									</div>
								{/if}
							{:else}
								<a
									href={itemHref}
									class={cn('ots-sb-item', active && 'active')}
								>
									<NavIcon icon={item.icon} class="ots-sb-icon" />
									<span class="ots-sb-label">{item.label}</span>
									{#if item.badge}
										<span class="ots-sb-badge">{item.badge}</span>
									{/if}
								</a>
								<button
									type="button"
									class={cn('ots-sb-pin-btn', isPinned && 'on')}
									aria-label={isPinned ? 'Scoate din favorite' : 'Adaugă la favorite'}
									onclick={() => togglePin(item.id)}
								>
									<HeartIcon class="size-3" />
								</button>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		{/each}
	</nav>

	<!-- Footer -->
	<div class="ots-sb-foot">
		<div class="ots-sb-foot-bell">
			<NotificationBell />
		</div>
		<button type="button" class="ots-sb-foot-btn" onclick={toggleTheme}>
			<div class="relative size-4 shrink-0">
				<SunIcon class="absolute size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
				<MoonIcon class="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
			</div>
			<span>Toggle Theme</span>
		</button>
		<Popover bind:open={userMenuOpen}>
			<PopoverTrigger class="ots-sb-user">
				<div class="ots-sb-avatar">{userInitials()}</div>
				<div class="ots-sb-user-info">
					<div class="ots-sb-user-name">{userDisplayName()}</div>
					<div class="ots-sb-user-mail">{user?.email ?? ''}</div>
				</div>
				<MoreHorizontalIcon class="size-4 text-(--ots-sb-muted) shrink-0" />
			</PopoverTrigger>
			<PopoverContent class="w-[var(--bits-popover-anchor-width)] p-1" align="end">
				<button
					type="button"
					class="ots-sb-user-menu-item danger"
					onclick={() => {
						userMenuOpen = false;
						handleLogout();
					}}
				>
					<LogOutIcon class="size-3.5" />
					<span>Logout</span>
				</button>
			</PopoverContent>
		</Popover>
	</div>
</aside>

<OtsCommandPalette bind:open={cmdOpen} items={flatVisible} {tenantSlug} />

<style>
	.ots-sb {
		/* Forțăm paleta DARK în interiorul sidebar-ului indiferent de tema globală.
		   Popover-urile (tenant switcher, user menu) și command palette
		   sunt în portal — moștenesc tema globală a aplicației. */
		--ots-sb-bg: oklch(0.16 0.02 252);
		--ots-sb-surface: oklch(0.22 0.025 252);
		--ots-sb-surface-hover: oklch(0.27 0.03 252);
		--ots-sb-text: oklch(0.82 0.02 252);
		--ots-sb-text-strong: oklch(0.97 0.02 252);
		--ots-sb-muted: oklch(0.6 0.02 258);
		--ots-sb-accent: oklch(0.7 0.24 var(--theme-hue, 245));
		--ots-sb-accent-soft: color-mix(in oklch, var(--ots-sb-accent) 22%, transparent);
		--ots-sb-accent-on: oklch(0.15 0.02 260);
		--ots-sb-border: oklch(0.28 0.02 258);
		--ots-sb-danger: oklch(0.7 0.22 25);
		--ots-sb-radius: 7px;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		padding: 12px 10px 10px;
		background: var(--ots-sb-bg);
		color: var(--ots-sb-text);
		font-size: 13px;
		gap: 10px;
	}

	/* Tenant switcher */
	.ots-sb :global(.ots-sb-tenant) {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		background: var(--ots-sb-surface);
		border-radius: 9px;
		border: 1px solid transparent;
		cursor: pointer;
		text-align: left;
		width: 100%;
		font-family: inherit;
		color: inherit;
		transition: background 0.12s;
	}
	.ots-sb :global(.ots-sb-tenant):hover {
		background: var(--ots-sb-surface-hover);
	}
	.ots-sb :global(.ots-sb-tenant-static) {
		cursor: default;
	}
	.ots-sb-tenant-logo {
		width: 36px;
		height: 36px;
		border-radius: 9px;
		background: var(--ots-sb-bg);
		border: 1px solid var(--ots-sb-border);
		display: grid;
		place-items: center;
		flex-shrink: 0;
		overflow: hidden;
	}
	.ots-sb-tenant-logo img {
		width: 28px;
		height: 28px;
		object-fit: contain;
	}
	.ots-sb-tenant-text {
		flex: 1;
		min-width: 0;
	}
	.ots-sb-tenant-name {
		color: var(--ots-sb-text-strong);
		font-weight: 600;
		font-size: 12.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ots-sb-tenant-role {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--ots-sb-muted);
		font-size: 11px;
		margin-top: 1px;
	}

	/* Tenant dropdown options (rendered into PopoverContent) */
	:global(.ots-sb-dropdown-head) {
		padding: 8px 10px 6px;
		font-size: 10px;
		font-weight: 700;
		color: var(--ots-sb-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	:global(.ots-sb-tenant-option) {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: 7px;
		cursor: pointer;
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		color: inherit;
		font-family: inherit;
	}
	:global(.ots-sb-tenant-option):hover {
		background: var(--ots-sb-surface);
	}
	:global(.ots-sb-tenant-option.active) {
		background: var(--ots-sb-accent-soft);
	}
	:global(.ots-sb-tenant-option-logo) {
		width: 30px;
		height: 30px;
		border-radius: 7px;
		background: var(--ots-sb-surface);
		border: 1px solid var(--ots-sb-border);
		display: grid;
		place-items: center;
		flex-shrink: 0;
		overflow: hidden;
	}
	:global(.ots-sb-tenant-option-logo img) {
		width: 22px;
		height: 22px;
		object-fit: contain;
	}
	:global(.ots-sb-tenant-option-info) {
		flex: 1;
		min-width: 0;
	}
	:global(.ots-sb-tenant-option-name) {
		font-weight: 600;
		font-size: 12.5px;
		color: var(--foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	:global(.ots-sb-tenant-option-role) {
		font-size: 11px;
		color: var(--ots-sb-muted);
		margin-top: 1px;
	}

	/* Search */
	.ots-sb-search {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		background: var(--ots-sb-surface);
		border: 1px solid transparent;
		border-radius: 8px;
		color: var(--ots-sb-muted);
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}
	.ots-sb-search:hover {
		background: var(--ots-sb-surface-hover);
	}
	.ots-sb-search-placeholder {
		flex: 1;
		font-size: 12px;
	}
	.ots-sb-kbd {
		font-family: ui-monospace, monospace;
		font-size: 10px;
		padding: 2px 5px;
		border-radius: 4px;
		background: var(--ots-sb-bg);
		border: 1px solid var(--ots-sb-border);
		color: var(--ots-sb-muted);
	}

	/* Pinned */
	.ots-sb-pinned {
		padding: 6px 4px 8px;
		border-bottom: 1px solid var(--ots-sb-border);
	}
	.ots-sb-pinned-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--ots-sb-muted);
		padding: 4px 6px 6px;
	}
	.ots-sb-pinned-items {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.ots-sb-pin {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 6px;
		color: var(--ots-sb-text);
		font-size: 12px;
		text-decoration: none;
	}
	.ots-sb-pin:hover {
		background: var(--ots-sb-surface-hover);
		color: var(--ots-sb-text-strong);
	}
	.ots-sb-pin.active {
		background: var(--ots-sb-accent-soft);
		color: var(--ots-sb-accent);
	}
	.ots-sb-pin :global(svg) {
		color: var(--ots-sb-muted);
		flex-shrink: 0;
	}
	.ots-sb-pin.active :global(svg) {
		color: var(--ots-sb-accent);
	}

	/* Nav */
	.ots-sb-nav {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 4px 4px;
		scrollbar-width: thin;
		scrollbar-color: var(--ots-sb-surface) transparent;
	}
	.ots-sb-nav::-webkit-scrollbar {
		width: 4px;
	}
	.ots-sb-nav::-webkit-scrollbar-thumb {
		background: var(--ots-sb-surface);
		border-radius: 4px;
	}
	.ots-sb-group {
		margin-bottom: 8px;
	}
	.ots-sb-group-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 6px 8px 4px;
		background: transparent;
		border: none;
		color: var(--ots-sb-muted);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		font-family: inherit;
		cursor: pointer;
	}
	.ots-sb-group-head:hover {
		color: var(--ots-sb-text-strong);
	}

	.ots-sb-item-row {
		position: relative;
	}
	.ots-sb-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 8px;
		border-radius: var(--ots-sb-radius);
		color: var(--ots-sb-text);
		text-decoration: none;
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
		position: relative;
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		font-family: inherit;
		font-size: 13px;
	}
	.ots-sb-item:hover {
		background: var(--ots-sb-surface-hover);
		color: var(--ots-sb-text-strong);
	}
	.ots-sb-item.active {
		background: var(--ots-sb-accent-soft);
		color: var(--ots-sb-accent);
	}
	.ots-sb-item.active::before {
		content: '';
		position: absolute;
		left: -4px;
		top: 6px;
		bottom: 6px;
		width: 3px;
		background: var(--ots-sb-accent);
		border-radius: 2px;
	}
	.ots-sb-item :global(.ots-sb-icon) {
		width: 15px;
		height: 15px;
		color: var(--ots-sb-muted);
		flex-shrink: 0;
	}
	.ots-sb-item.active :global(.ots-sb-icon) {
		color: var(--ots-sb-accent);
	}
	.ots-sb-label {
		flex: 1;
		font-weight: 500;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ots-sb-badge {
		background: var(--ots-sb-surface);
		color: var(--ots-sb-muted);
		font-size: 10px;
		font-weight: 700;
		padding: 1px 6px;
		border-radius: 999px;
	}
	.ots-sb-badge.mini {
		font-size: 9px;
		padding: 1px 5px;
	}
	.ots-sb-item.active .ots-sb-badge {
		background: var(--ots-sb-accent);
		color: var(--ots-sb-accent-on);
	}
	.ots-sb-caret {
		color: var(--ots-sb-muted);
	}

	.ots-sb-pin-btn {
		position: absolute;
		right: 4px;
		top: 6px;
		background: transparent;
		border: none;
		width: 22px;
		height: 22px;
		border-radius: 4px;
		display: grid;
		place-items: center;
		color: var(--ots-sb-muted);
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.12s, color 0.12s;
		flex-shrink: 0;
		z-index: 1;
	}
	.ots-sb-item-row:hover .ots-sb-pin-btn {
		opacity: 0.6;
	}
	.ots-sb-pin-btn:hover {
		opacity: 1 !important;
		color: var(--ots-sb-danger);
		background: color-mix(in oklch, var(--ots-sb-danger) 10%, transparent);
	}
	.ots-sb-pin-btn.on {
		opacity: 1;
		color: var(--ots-sb-danger);
	}
	.ots-sb-pin-btn.on :global(svg) {
		fill: currentColor;
	}

	.ots-sb-sub {
		margin: 2px 0 4px 18px;
		padding-left: 10px;
		border-left: 1px solid var(--ots-sb-border);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.ots-sb-subitem {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 8px;
		border-radius: 5px;
		color: var(--ots-sb-text);
		font-size: 12px;
		text-decoration: none;
	}
	.ots-sb-subitem:hover {
		background: var(--ots-sb-surface-hover);
		color: var(--ots-sb-text-strong);
	}
	.ots-sb-subitem.active {
		background: var(--ots-sb-accent-soft);
		color: var(--ots-sb-accent);
	}
	.ots-sb-subitem span {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Footer */
	.ots-sb-foot {
		border-top: 1px solid var(--ots-sb-border);
		padding: 10px 4px 4px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.ots-sb-foot-bell {
		padding: 0 4px;
	}
	.ots-sb-foot-btn {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 8px;
		border-radius: 6px;
		background: transparent;
		border: none;
		color: var(--ots-sb-text);
		font-size: 12px;
		font-family: inherit;
		cursor: pointer;
		text-align: left;
	}
	.ots-sb-foot-btn:hover {
		background: var(--ots-sb-surface-hover);
		color: var(--ots-sb-text-strong);
	}
	.ots-sb-foot-btn span {
		flex: 1;
	}

	.ots-sb :global(.ots-sb-user) {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px;
		background: var(--ots-sb-surface);
		border: 1px solid transparent;
		border-radius: 8px;
		margin-top: 6px;
		cursor: pointer;
		width: 100%;
		text-align: left;
		font-family: inherit;
		color: inherit;
	}
	.ots-sb :global(.ots-sb-user):hover {
		background: var(--ots-sb-surface-hover);
	}
	.ots-sb-avatar {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--ots-sb-accent), color-mix(in oklch, var(--ots-sb-accent) 60%, var(--ots-sb-danger)));
		display: grid;
		place-items: center;
		color: var(--ots-sb-accent-on);
		font-weight: 700;
		font-size: 11px;
		flex-shrink: 0;
	}
	.ots-sb-user-info {
		flex: 1;
		min-width: 0;
	}
	.ots-sb-user-name {
		color: var(--ots-sb-text-strong);
		font-weight: 600;
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ots-sb-user-mail {
		color: var(--ots-sb-muted);
		font-size: 10px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	:global(.ots-sb-user-menu-item) {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: 6px;
		font-size: 12.5px;
		cursor: pointer;
		color: var(--popover-foreground);
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		font-family: inherit;
	}
	:global(.ots-sb-user-menu-item):hover {
		background: var(--ots-sb-surface);
	}
	:global(.ots-sb-user-menu-item.danger) {
		color: var(--ots-sb-danger);
	}
	:global(.ots-sb-user-menu-item.danger):hover {
		background: color-mix(in oklch, var(--ots-sb-danger) 10%, transparent);
	}
</style>
