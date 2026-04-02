<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import BellIcon from '@lucide/svelte/icons/bell';
	import CheckCheckIcon from '@lucide/svelte/icons/check-check';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import XIcon from '@lucide/svelte/icons/x';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import { getNotifications, getUnreadCount } from '$lib/remotes/notifications.remote';
	import { getActivityIcon, getActivityColor } from '$lib/utils/activity-icons.svelte';
	import { connectNotificationStream, latestNotification } from '$lib/stores/notification-stream';
	import { page } from '$app/state';
	import type { Notification } from '$lib/server/db/schema';

	// ---- State ----
	let notifications = $state<Notification[]>([]);
	let unreadCount = $state(0);
	let open = $state(false);
	let loading = $state(true);
	let loadingMore = $state(false);
	let nextCursor = $state<string | null>(null);

	const PAGE_SIZE = 20;

	// Detect if we're in the client portal
	const isClientPortal = $derived(page.url.pathname.startsWith('/client/'));
	const tenantSlug = $derived(page.params.tenant as string);

	// ---- Helpers ----

	/**
	 * Rewrite notification link for the current context.
	 * Admin links are stored as /{tenantSlug}/resource/id.
	 * Client portal needs /client/{tenantSlug}/resource — but some detail pages
	 * don't exist in the client portal (invoices/[id], contracts/[id]), so we
	 * strip the ID and link to the list page instead.
	 */
	function resolveLink(link: string | null): string | null {
		if (!link) return null;
		if (!isClientPortal) return link;
		if (link.startsWith('/client/')) return link;

		// Parse: /{tenantSlug}/{section}/{id}
		const parts = link.replace(/^\//, '').split('/');
		// parts[0] = tenantSlug, parts[1] = section, parts[2..] = rest
		const section = parts[1];

		// Sections that have detail pages in client portal
		const hasDetailPage = ['tasks', 'leads'];

		if (hasDetailPage.includes(section)) {
			// Keep full path: /client/{tenantSlug}/tasks/{taskId}
			return `/client${link}`;
		}

		// For invoices, contracts etc — link to list page only
		return `/client/${parts[0]}/${section}`;
	}

	function formatDate(date: Date | string | null): string {
		if (!date) return '';
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	// ---- Infinite scroll ----

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const result = await getNotifications({ limit: PAGE_SIZE, cursor: nextCursor });
			notifications = [...notifications, ...result.items];
			nextCursor = result.nextCursor;
		} catch {
			// silently fail
		} finally {
			loadingMore = false;
		}
	}

	function handleScroll(e: Event) {
		const el = e.target as HTMLElement;
		if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
			loadMore();
		}
	}

	// ---- Mark as read ----

	async function markAllRead() {
		if (unreadCount === 0) return;
		try {
			const res = await fetch('/api/notifications/mark-read', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ all: true })
			});
			if (!res.ok) return;
		} catch {
			return;
		}
		notifications = notifications.map((n) => ({ ...n, isRead: true }));
		unreadCount = 0;
	}

	async function markOneRead(id: string) {
		try {
			const res = await fetch('/api/notifications/mark-read', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: [id] })
			});
			if (!res.ok) return;
		} catch {
			return;
		}
		notifications = notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n));
		if (unreadCount > 0) unreadCount = unreadCount - 1;
	}

	// ---- Delete ----

	async function deleteOne(id: string) {
		try {
			const res = await fetch('/api/notifications/delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: [id] })
			});
			if (!res.ok) return;
		} catch {
			return;
		}
		const wasUnread = notifications.find((n) => n.id === id && !n.isRead);
		notifications = notifications.filter((n) => n.id !== id);
		if (wasUnread && unreadCount > 0) unreadCount = unreadCount - 1;
	}

	async function deleteVisible() {
		const ids = notifications.map((n) => n.id);
		if (ids.length === 0) return;
		try {
			const res = await fetch('/api/notifications/delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids })
			});
			if (!res.ok) return;
		} catch {
			return;
		}
		const deletedUnread = notifications.filter((n) => !n.isRead).length;
		notifications = [];
		nextCursor = null;
		unreadCount = Math.max(0, unreadCount - deletedUnread);
	}

	async function deleteAll() {
		try {
			const res = await fetch('/api/notifications/delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ all: true })
			});
			if (!res.ok) return;
		} catch {
			return;
		}
		notifications = [];
		nextCursor = null;
		unreadCount = 0;
	}

	// ---- Lifecycle ----
	let cleanupSSE: (() => void) | null = null;

	onMount(() => {
		(async () => {
			try {
				const [result, countData] = await Promise.all([
					getNotifications({ limit: PAGE_SIZE }),
					getUnreadCount()
				]);
				notifications = result.items;
				nextCursor = result.nextCursor;
				unreadCount = countData.count;
			} catch {
				// silently fail
			} finally {
				loading = false;
			}
		})();

		cleanupSSE = connectNotificationStream();

		const unsubscribe = latestNotification.subscribe((notif) => {
			if (notif) {
				notifications = [notif, ...notifications];
				unreadCount = unreadCount + 1;
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

<!-- Trigger button -->
<button
	class="relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
	aria-label="Notificări"
	onclick={() => (open = !open)}
>
	<BellIcon class="size-4 shrink-0" />
	<span class="flex-1 text-left">Notificări</span>
	{#if unreadCount > 0}
		<span class="relative flex h-5 min-w-5 items-center justify-center px-1">
			<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75"></span>
			<span class="relative inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
				{unreadCount > 99 ? '99+' : unreadCount}
			</span>
		</span>
	{/if}
</button>

<!-- Backdrop -->
{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-40" onclick={() => (open = false)} onkeydown={() => {}}></div>

	<!-- Notification panel -->
	<div class="fixed left-[var(--sidebar-width)] top-0 bottom-0 z-50 flex w-80 flex-col border-r bg-background shadow-xl">
		<!-- Header -->
		<div class="flex shrink-0 items-center justify-between border-b px-4 py-3">
			<h3 class="text-sm font-semibold text-foreground">Notificări</h3>
			<div class="flex items-center gap-1">
				{#if notifications.length > 0}
					<Button
						variant="ghost"
						size="sm"
						class="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
						onclick={deleteAll}
						title="Șterge toate notificările"
					>
						<Trash2Icon class="size-3" />
						Șterge tot
					</Button>
				{/if}
				{#if unreadCount > 0}
					<Button variant="ghost" size="sm" class="h-7 gap-1 px-2 text-xs" onclick={markAllRead}>
						<CheckCheckIcon class="size-3" />
						Citit tot
					</Button>
				{/if}
				<button class="rounded-sm p-1 opacity-70 hover:opacity-100" onclick={() => (open = false)}>
					<XIcon class="size-4" />
				</button>
			</div>
		</div>

		<!-- Scrollable list -->
		<div class="min-h-0 flex-1 overflow-y-auto" onscroll={handleScroll}>
			{#if loading}
				<div class="flex items-center justify-center py-8">
					<LoaderIcon class="size-4 animate-spin text-muted-foreground" />
					<span class="ml-2 text-xs text-muted-foreground">Se încarcă...</span>
				</div>
			{:else if notifications.length === 0}
				<div class="flex flex-col items-center justify-center gap-2 py-8 text-center">
					<BellIcon class="size-8 text-muted-foreground/50" />
					<p class="text-xs text-muted-foreground">Nu ai notificări</p>
				</div>
			{:else}
				{#each notifications as notif (notif.id)}
					{@const Icon = getActivityIcon(notif.type)}
					{@const iconColor = getActivityColor(notif.type)}
					<div
						class={cn(
							'group flex cursor-pointer gap-3 border-b px-4 py-3 last:border-b-0',
							!notif.isRead ? 'bg-accent/50 dark:bg-accent/30' : 'hover:bg-muted/50'
						)}
						onclick={() => {
							const link = resolveLink(notif.link);
							if (link) {
								if (!notif.isRead) markOneRead(notif.id);
								open = false;
								window.location.href = link;
							}
						}}
						role="button"
						tabindex="0"
					>
						<div class="mt-0.5 shrink-0">
							<Icon class={cn('size-4', iconColor)} />
						</div>

						<div class="min-w-0 flex-1">
							<p class={cn('text-xs text-foreground', !notif.isRead ? 'font-semibold' : 'font-medium')}>
								{notif.title}
							</p>
							<p class="mt-0.5 text-xs text-muted-foreground">{notif.message}</p>
							<div class="mt-1 flex items-center gap-2">
								<span class="text-[10px] text-muted-foreground/70">{formatDate(notif.createdAt)}</span>
								{#if resolveLink(notif.link)}
									<a
										href={resolveLink(notif.link)!}
										class="flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
										onclick={() => { if (!notif.isRead) markOneRead(notif.id); open = false; }}
									>
										<ExternalLinkIcon class="size-2.5" />
										Deschide
									</a>
								{/if}
								{#if !notif.isRead}
									<button
										class="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
										onclick={() => markOneRead(notif.id)}
									>
										Marchează citit
									</button>
								{/if}
							</div>
						</div>

						<!-- Delete button per notification -->
						<button
							class="mt-0.5 shrink-0 rounded-sm p-0.5 opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100 hover:text-destructive"
							onclick={() => deleteOne(notif.id)}
							title="Șterge notificarea"
						>
							<Trash2Icon class="size-3.5" />
						</button>
					</div>
				{/each}

				<!-- Batch delete for loaded notifications -->
				{#if notifications.length >= PAGE_SIZE}
					<div class="border-t px-4 py-3 text-center">
						<button
							class="text-[11px] font-medium text-destructive/80 hover:text-destructive hover:underline"
							onclick={deleteVisible}
						>
							Șterge cele {notifications.length} notificări încărcate
						</button>
					</div>
				{/if}

				{#if loadingMore}
					<div class="flex items-center justify-center py-4">
						<LoaderIcon class="size-3 animate-spin text-muted-foreground" />
						<span class="ml-2 text-[10px] text-muted-foreground">Se încarcă...</span>
					</div>
				{/if}

				{#if !nextCursor && !loadingMore && notifications.length > 0}
					<div class="py-4 text-center">
						<span class="text-[10px] text-muted-foreground/50">Toate notificările au fost încărcate</span>
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}
