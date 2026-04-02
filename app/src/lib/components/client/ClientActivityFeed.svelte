<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { cn } from '$lib/utils';
	import { getClientActivity } from '$lib/remotes/client-activity.remote';
	import { getActivityIcon, getActivityColor, ACTIVITY_CATEGORIES } from '$lib/utils/activity-icons.svelte';
	import { connectNotificationStream, latestNotification } from '$lib/stores/notification-stream';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import BellIcon from '@lucide/svelte/icons/bell';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import { Button } from '$lib/components/ui/button';
	import type { Notification } from '$lib/server/db/schema';
	import { page } from '$app/state';

	let {
		clientId,
		compact = false,
		activeFilter = 'all'
	}: {
		clientId: string;
		compact?: boolean;
		activeFilter?: string;
	} = $props();

	const tenantSlug = $derived(page.params.tenant as string);

	let items = $state<Notification[]>([]);
	let nextCursor = $state<string | null>(null);
	let loading = $state(true);
	let loadingMore = $state(false);

	const limit = $derived(compact ? 5 : 30);

	// Filtered items based on active filter
	const filteredItems = $derived(() => {
		if (activeFilter === 'all') return items;
		const cat = ACTIVITY_CATEGORIES.find((c) => c.id === activeFilter);
		if (!cat || cat.prefixes.length === 0) return items;
		return items.filter((item) => cat.prefixes.some((p) => item.type.startsWith(p)));
	});

	// Group items by date for full view
	const groupedItems = $derived(() => {
		const filtered = filteredItems();
		if (compact) return [{ label: '', items: filtered }];

		const groups: { label: string; items: Notification[] }[] = [];
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const yesterday = new Date(today.getTime() - 86400000);
		const weekAgo = new Date(today.getTime() - 7 * 86400000);

		let currentLabel = '';
		let currentGroup: Notification[] = [];

		for (const item of filtered) {
			const d = new Date(item.createdAt);
			let label: string;

			if (d >= today) {
				label = 'Azi';
			} else if (d >= yesterday) {
				label = 'Ieri';
			} else if (d >= weekAgo) {
				label = 'Săptămâna aceasta';
			} else {
				label = d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
			}

			if (label !== currentLabel) {
				if (currentGroup.length > 0) {
					groups.push({ label: currentLabel, items: currentGroup });
				}
				currentLabel = label;
				currentGroup = [item];
			} else {
				currentGroup.push(item);
			}
		}

		if (currentGroup.length > 0) {
			groups.push({ label: currentLabel, items: currentGroup });
		}

		return groups;
	});

	function formatTimeAgo(date: Date | string | null): string {
		if (!date) return '';
		const d = date instanceof Date ? date : new Date(date);
		const diffMs = Date.now() - d.getTime();
		const diffMin = Math.floor(diffMs / 60_000);
		if (diffMin < 1) return 'acum';
		if (diffMin < 60) return `${diffMin}m`;
		const diffH = Math.floor(diffMin / 60);
		if (diffH < 24) return `${diffH}h`;
		const diffD = Math.floor(diffH / 24);
		return `${diffD}z`;
	}

	async function loadInitial() {
		loading = true;
		try {
			const result = await getClientActivity({ clientId, limit });
			items = result.items;
			nextCursor = result.nextCursor;
		} catch {
			// silently fail
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const result = await getClientActivity({ clientId, limit: 30, cursor: nextCursor });
			items = [...items, ...result.items];
			nextCursor = result.nextCursor;
		} catch {
			// silently fail
		} finally {
			loadingMore = false;
		}
	}

	// SSE real-time updates
	let cleanupSSE: (() => void) | null = null;

	onMount(() => {
		loadInitial();

		cleanupSSE = connectNotificationStream();

		// Subscribe to new notifications and prepend if they belong to this client
		const unsubscribe = latestNotification.subscribe((notif) => {
			if (notif && notif.clientId === clientId) {
				items = [notif, ...items];
			}
		});

		return () => {
			unsubscribe();
		};
	});

	onDestroy(() => {
		cleanupSSE?.();
	});
</script>

{#if loading}
	<div class="flex items-center justify-center py-8">
		<LoaderIcon class="size-4 animate-spin text-muted-foreground" />
		<span class="ml-2 text-xs text-muted-foreground">Se încarcă...</span>
	</div>
{:else if filteredItems().length === 0}
	<div class="flex flex-col items-center justify-center gap-2 py-8 text-center">
		<BellIcon class="size-8 text-muted-foreground/40" />
		<p class="text-xs text-muted-foreground">Nu există activitate recentă</p>
	</div>
{:else}
	<div class="space-y-0">
		{#each groupedItems() as group}
			{#if !compact && group.label}
				<div class="sticky top-0 z-10 bg-background px-1 py-2">
					<span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						{group.label}
					</span>
				</div>
			{/if}

			{#each group.items as item (item.id)}
				{@const Icon = getActivityIcon(item.type)}
				{@const iconColor = getActivityColor(item.type)}
				<div
					class={cn(
						'flex gap-3 border-b px-1 py-3 last:border-b-0 transition-colors',
						!item.isRead ? 'bg-accent/30' : 'hover:bg-muted/40'
					)}
				>
					<div class="mt-0.5 shrink-0">
						<Icon class={cn('size-4', iconColor)} />
					</div>

					<div class="min-w-0 flex-1">
						<p class={cn('text-xs text-foreground', !item.isRead ? 'font-semibold' : 'font-medium')}>
							{item.title}
						</p>
						<p class="mt-0.5 text-xs text-muted-foreground line-clamp-2">
							{item.message}
						</p>
						<div class="mt-1 flex items-center gap-2">
							<span class="text-[10px] text-muted-foreground/70">
								{formatTimeAgo(item.createdAt)}
							</span>
							{#if item.link}
								<a
									href={item.link}
									class="flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
								>
									<ExternalLinkIcon class="size-2.5" />
									Deschide
								</a>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		{/each}
	</div>

	{#if compact && items.length >= 5}
		<div class="mt-3 text-center">
			<a
				href="/{tenantSlug}/clients/{clientId}/activity"
				class="text-xs font-medium text-primary hover:underline"
			>
				Vezi toată activitatea →
			</a>
		</div>
	{/if}

	{#if !compact && nextCursor}
		<div class="py-4 text-center">
			<Button variant="outline" size="sm" onclick={loadMore} disabled={loadingMore}>
				{#if loadingMore}
					<LoaderIcon class="mr-2 size-3 animate-spin" />
				{/if}
				Încarcă mai multe
			</Button>
		</div>
	{/if}
{/if}
