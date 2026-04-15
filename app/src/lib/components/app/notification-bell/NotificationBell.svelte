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
	import { getNotifications, getUnreadCount, getUrgentUnreadCount } from '$lib/remotes/notifications.remote';
	import { getActivityIcon, getActivityColor } from '$lib/utils/activity-icons.svelte';
	import { connectNotificationStream, latestNotification } from '$lib/stores/notification-stream';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Notification } from '$lib/server/db/schema';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import { SvelteSet } from 'svelte/reactivity';

	// ---- State ----
	let notifications = $state<Notification[]>([]);
	let unreadCount = $state(0);
	let open = $state(false);
	let loading = $state(true);
	let loadingMore = $state(false);
	let nextCursor = $state<string | null>(null);
	let confirmDeleteAll = $state(false);
	let confirmDeleteTimeout: ReturnType<typeof setTimeout> | null = null;
	let urgentUnreadCount = $state(0);
	let activeTab = $state<'important' | 'all'>('important');
	let expandedGroups = new SvelteSet<string>();

	const PAGE_SIZE = 20;

	const filteredNotifications = $derived(
		activeTab === 'important'
			? notifications.filter((n) => n.priority === 'urgent' || n.priority === 'high')
			: notifications
	);

	const importantCount = $derived(
		notifications.filter((n) => !n.isRead && (n.priority === 'urgent' || n.priority === 'high')).length
	);

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
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffMin = Math.floor(diffMs / 60_000);
		const diffH = Math.floor(diffMin / 60);

		const time = d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });

		if (diffMin < 1) return 'acum';
		if (diffMin < 60) return `acum ${diffMin}m`;
		if (diffH < 24) return `acum ${diffH}h`;

		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const yesterday = new Date(today.getTime() - 86400000);

		if (d >= yesterday && d < today) return `Ieri, ${time}`;
		return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' }) + `, ${time}`;
	}

	function getPriorityClasses(priority: string, isRead: boolean): string {
		if (isRead) return 'hover:bg-muted/50';
		switch (priority) {
			case 'urgent':
				return 'border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-950/20';
			case 'high':
				return 'border-l-4 border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20';
			case 'medium':
				return 'border-l-4 border-l-blue-400 bg-accent/30';
			default:
				return 'bg-muted/20';
		}
	}

	function toggleGroup(id: string) {
		if (expandedGroups.has(id)) expandedGroups.delete(id);
		else expandedGroups.add(id);
	}

	function stopPropagation(e: MouseEvent, callback: () => void) {
		e.stopPropagation();
		callback();
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
		urgentUnreadCount = 0;
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
		const wasNotif = notifications.find((n) => n.id === id && !n.isRead);
		notifications = notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n));
		if (unreadCount > 0) unreadCount = unreadCount - 1;
		if (wasNotif && (wasNotif.priority === 'urgent' || wasNotif.priority === 'high') && urgentUnreadCount > 0) {
			urgentUnreadCount = urgentUnreadCount - 1;
		}
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
		if (wasUnread && (wasUnread.priority === 'urgent' || wasUnread.priority === 'high') && urgentUnreadCount > 0) {
			urgentUnreadCount = urgentUnreadCount - 1;
		}
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
		const deletedUrgent = notifications.filter((n) => !n.isRead && (n.priority === 'urgent' || n.priority === 'high')).length;
		notifications = [];
		nextCursor = null;
		unreadCount = Math.max(0, unreadCount - deletedUnread);
		urgentUnreadCount = Math.max(0, urgentUnreadCount - deletedUrgent);
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
		urgentUnreadCount = 0;
	}

	// ---- Lifecycle ----
	let cleanupSSE: (() => void) | null = null;

	onMount(() => {
		(async () => {
			try {
				const [result, countData, urgentData] = await Promise.all([
					getNotifications({ limit: PAGE_SIZE }),
					getUnreadCount(),
					getUrgentUnreadCount()
				]);
				notifications = result.items;
				nextCursor = result.nextCursor;
				unreadCount = countData.count;
				urgentUnreadCount = urgentData.count;
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
				if (notif.priority === 'urgent' || notif.priority === 'high') {
					urgentUnreadCount = urgentUnreadCount + 1;
				}
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
	class="relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
	aria-label="Notificări"
	onclick={() => (open = !open)}
>
	<BellIcon class="size-4 shrink-0" />
	<span class="flex-1 text-left">Notificări</span>
	{#if urgentUnreadCount > 0}
		<span class="relative flex h-5 min-w-5 items-center justify-center px-1">
			<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75"></span>
			<span class="relative inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
				{urgentUnreadCount > 99 ? '99+' : urgentUnreadCount}
			</span>
		</span>
	{:else if unreadCount > 0}
		<span class="relative flex h-3 w-3 items-center justify-center">
			<span class="inline-flex h-2 w-2 rounded-full bg-muted-foreground/50"></span>
		</span>
	{/if}
</button>

<!-- Backdrop -->
{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-40" onclick={() => (open = false)} onkeydown={() => {}}></div>

	<!-- Notification panel -->
	<div class="fixed left-[var(--sidebar-width)] top-0 bottom-0 z-50 flex w-80 flex-col border-r bg-background shadow-xl">
		<!-- Header with tabs -->
		<div class="flex shrink-0 items-center justify-between border-b px-4 py-3">
			<div class="flex items-center gap-2">
				<button
					class={cn('text-xs font-medium px-2 py-1 rounded-md transition-colors',
						activeTab === 'important' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
					)}
					onclick={() => { activeTab = 'important'; }}
				>
					Importante {importantCount > 0 ? `(${importantCount})` : ''}
				</button>
				<button
					class={cn('text-xs font-medium px-2 py-1 rounded-md transition-colors',
						activeTab === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
					)}
					onclick={() => { activeTab = 'all'; }}
				>
					Toate {unreadCount > 0 ? `(${unreadCount})` : ''}
				</button>
			</div>
			<div class="flex items-center gap-1">
				{#if notifications.length > 0}
					<Button
						variant="ghost"
						size="sm"
						class={cn(
							'h-7 gap-1 px-2 text-xs',
							confirmDeleteAll
								? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
								: 'text-destructive hover:text-destructive'
						)}
						onclick={() => {
							if (confirmDeleteAll) {
								deleteAll();
								confirmDeleteAll = false;
								if (confirmDeleteTimeout) clearTimeout(confirmDeleteTimeout);
							} else {
								confirmDeleteAll = true;
								confirmDeleteTimeout = setTimeout(() => { confirmDeleteAll = false; }, 3000);
							}
						}}
						title={confirmDeleteAll ? 'Click din nou pentru a confirma' : 'Sterge toate notificarile'}
					>
						<Trash2Icon class="size-3" />
						{confirmDeleteAll ? 'Confirmi?' : ''}
					</Button>
				{/if}
				{#if unreadCount > 0}
					<Button variant="ghost" size="sm" class="h-7 gap-1 px-2 text-xs" onclick={markAllRead}>
						<CheckCheckIcon class="size-3" />
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
			{:else if filteredNotifications.length === 0}
				<div class="flex flex-col items-center justify-center gap-2 py-8 text-center">
					<BellIcon class="size-8 text-muted-foreground/50" />
					<p class="text-xs text-muted-foreground">
						{activeTab === 'important' ? 'Nicio notificare importantă' : 'Nu ai notificări'}
					</p>
					{#if activeTab === 'important' && notifications.length > 0}
						<button
							class="text-xs text-primary hover:underline"
							onclick={() => { activeTab = 'all'; }}
						>
							Vezi toate notificările
						</button>
					{/if}
				</div>
			{:else}
				{#each filteredNotifications as notif (notif.id)}
					{@const Icon = getActivityIcon(notif.type)}
					{@const iconColor = getActivityColor(notif.type)}
					{@const isGroup = (notif.count ?? 1) > 1}
					{@const isExpanded = expandedGroups.has(notif.id)}
					<div
						class={cn(
							'group flex gap-3 border-b px-4 py-3 last:border-b-0',
							getPriorityClasses(notif.priority, notif.isRead)
						)}
						style="cursor: pointer;"
						onclick={() => {
							if (isGroup) {
								toggleGroup(notif.id);
							} else {
								const link = resolveLink(notif.link);
								if (link) {
									if (!notif.isRead) markOneRead(notif.id);
									open = false;
									goto(link);
								}
							}
						}}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								if (isGroup) {
									toggleGroup(notif.id);
								} else {
									const link = resolveLink(notif.link);
									if (link) {
										if (!notif.isRead) markOneRead(notif.id);
										open = false;
										goto(link);
									}
								}
							}
						}}
						role="button"
						tabindex="0"
					>
						<div class="mt-0.5 shrink-0">
							<Icon class={cn('size-4', iconColor)} />
						</div>

						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1.5">
								<p class={cn('text-xs text-foreground', !notif.isRead ? 'font-semibold' : 'font-medium')}>
									{notif.title}
								</p>
								{#if isGroup}
									<span class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[9px] font-medium text-muted-foreground">
										{notif.count}x
									</span>
								{/if}
							</div>
							<p class="mt-0.5 text-xs text-muted-foreground">{notif.message}</p>

							{#if isGroup && isExpanded}
								<div class="mt-2 rounded-md border bg-muted/30 px-3 py-2">
									<p class="text-[10px] text-muted-foreground">
										Această notificare a apărut de {notif.count} ori.
									</p>
									{#if resolveLink(notif.link)}
										<a
											href={resolveLink(notif.link)!}
											class="mt-1 flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
											onclick={(e) => stopPropagation(e, () => { if (!notif.isRead) markOneRead(notif.id); open = false; })}
										>
											<ExternalLinkIcon class="size-2.5" />
											Deschide
										</a>
									{/if}
								</div>
							{/if}

							<div class="mt-1 flex items-center gap-2">
								<span class="text-[10px] text-muted-foreground/70">{formatDate(notif.updatedAt ?? notif.createdAt)}</span>
								{#if isGroup}
									<button
										class="flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
										onclick={(e) => stopPropagation(e, () => toggleGroup(notif.id))}
									>
										{#if isExpanded}
											<ChevronUpIcon class="size-2.5" />
											Ascunde
										{:else}
											<ChevronDownIcon class="size-2.5" />
											Detalii
										{/if}
									</button>
								{:else if resolveLink(notif.link)}
									<a
										href={resolveLink(notif.link)!}
										class="flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
										onclick={(e) => stopPropagation(e, () => { if (!notif.isRead) markOneRead(notif.id); open = false; })}
									>
										<ExternalLinkIcon class="size-2.5" />
										Deschide
									</a>
								{/if}
								{#if !notif.isRead}
									<button
										class="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
										onclick={(e) => stopPropagation(e, () => markOneRead(notif.id))}
									>
										Marchează citit
									</button>
								{/if}
							</div>
						</div>

						<!-- Delete button per notification -->
						<button
							class="mt-0.5 shrink-0 rounded-sm p-0.5 opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100 hover:text-destructive"
							onclick={(e) => stopPropagation(e, () => deleteOne(notif.id))}
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
