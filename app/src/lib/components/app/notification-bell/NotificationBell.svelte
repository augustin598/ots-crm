<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import BellIcon from '@lucide/svelte/icons/bell';
	import CheckCheckIcon from '@lucide/svelte/icons/check-check';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import XIcon from '@lucide/svelte/icons/x';
	import { getNotifications, getUnreadCount } from '$lib/remotes/notifications.remote';
	import { getActivityIcon, getActivityColor } from '$lib/utils/activity-icons.svelte';
	import { connectNotificationStream, latestNotification } from '$lib/stores/notification-stream';
	import type { Notification } from '$lib/server/db/schema';

	// ---- State ----
	let notifications = $state<Notification[]>([]);
	let unreadCount = $state(0);
	let open = $state(false);
	let loading = $state(true);

	// ---- Helpers ----

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

	// ---- Lifecycle ----
	let cleanupSSE: (() => void) | null = null;

	onMount(() => {
		(async () => {
			try {
				const [notifs, countData] = await Promise.all([
					getNotifications({ limit: 20 }),
					getUnreadCount()
				]);
				notifications = notifs;
				unreadCount = countData.count;
			} catch {
				// silently fail — non-critical feature
			} finally {
				loading = false;
			}
		})();

		// Use shared SSE store
		cleanupSSE = connectNotificationStream();

		const unsubscribe = latestNotification.subscribe((notif) => {
			if (notif) {
				notifications = [notif, ...notifications].slice(0, 20);
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
			<span
				class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75"
			></span>
			<span
				class="relative inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
			>
				{unreadCount > 99 ? '99+' : unreadCount}
			</span>
		</span>
	{/if}
</button>

<!-- Backdrop -->
{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-40" onclick={() => (open = false)} onkeydown={() => {}}></div>

	<!-- Notification panel — fixed to top, next to sidebar -->
	<div
		class="fixed left-[var(--sidebar-width)] top-0 z-50 flex h-screen w-80 flex-col border-r bg-background shadow-xl"
	>
		<!-- Header -->
		<div class="flex items-center justify-between border-b px-4 py-3">
			<h3 class="text-sm font-semibold text-foreground">Notificări</h3>
			<div class="flex items-center gap-1">
				{#if unreadCount > 0}
					<Button
						variant="ghost"
						size="sm"
						class="h-7 gap-1 px-2 text-xs"
						onclick={markAllRead}
					>
						<CheckCheckIcon class="size-3" />
						Marchează toate
					</Button>
				{/if}
				<button
					class="rounded-sm p-1 opacity-70 hover:opacity-100"
					onclick={() => (open = false)}
				>
					<XIcon class="size-4" />
				</button>
			</div>
		</div>

		<!-- List -->
		<div class="flex-1 overflow-y-auto">
			{#if loading}
				<div class="flex items-center justify-center py-8">
					<span class="text-xs text-muted-foreground">Se încarcă...</span>
				</div>
			{:else if notifications.length === 0}
				<div class="flex flex-col items-center justify-center gap-2 py-8 text-center">
					<BellIcon class="size-8 text-muted-foreground/50" />
					<p class="text-xs text-muted-foreground">Nu ai notificări noi</p>
				</div>
			{:else}
				{#each notifications as notif (notif.id)}
					{@const Icon = getActivityIcon(notif.type)}
					{@const iconColor = getActivityColor(notif.type)}
					<div
						class={cn(
							'flex gap-3 border-b px-4 py-3 last:border-b-0',
							!notif.isRead
								? 'bg-accent/50 dark:bg-accent/30'
								: 'hover:bg-muted/50'
						)}
					>
						<!-- Icon -->
						<div class="mt-0.5 shrink-0">
							<Icon class={cn('size-4', iconColor)} />
						</div>

						<!-- Content -->
						<div class="min-w-0 flex-1">
							<p
								class={cn(
									'text-xs text-foreground',
									!notif.isRead ? 'font-semibold' : 'font-medium'
								)}
							>
								{notif.title}
							</p>
							<p class="mt-0.5 text-xs text-muted-foreground">
								{notif.message}
							</p>
							<div class="mt-1 flex items-center gap-2">
								<span class="text-[10px] text-muted-foreground/70">
									{formatTimeAgo(notif.createdAt)}
								</span>
								{#if notif.link}
									<a
										href={notif.link}
										class="flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
										onclick={() => {
											if (!notif.isRead) markOneRead(notif.id);
											open = false;
										}}
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
					</div>
				{/each}
			{/if}
		</div>
	</div>
{/if}
