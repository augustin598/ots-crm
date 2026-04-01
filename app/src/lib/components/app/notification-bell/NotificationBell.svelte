<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import BellIcon from '@lucide/svelte/icons/bell';
	import CheckCheckIcon from '@lucide/svelte/icons/check-check';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckSquareIcon from '@lucide/svelte/icons/check-square';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { getNotifications, getUnreadCount } from '$lib/remotes/notifications.remote';
	import type { Notification } from '$lib/server/db/schema';

	// ---- State ----
	let notifications = $state<Notification[]>([]);
	let unreadCount = $state(0);
	let open = $state(false);
	let loading = $state(true);
	let eventSource: EventSource | null = null;

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

	function getNotificationIcon(type: string) {
		switch (type) {
			case 'task.assigned':
				return CheckSquareIcon;
			case 'invoice.paid':
				return FileTextIcon;
			case 'contract.signed':
				return FileTextIcon;
			case 'sync.error':
				return AlertCircleIcon;
			default:
				return InfoIcon;
		}
	}

	function getNotificationColor(type: string): string {
		switch (type) {
			case 'sync.error':
				return 'text-destructive';
			case 'invoice.paid':
				return 'text-green-600 dark:text-green-400';
			case 'task.assigned':
				return 'text-blue-600 dark:text-blue-400';
			case 'contract.signed':
				return 'text-purple-600 dark:text-purple-400';
			default:
				return 'text-muted-foreground';
		}
	}

	// ---- SSE ----

	function connectSSE() {
		if (eventSource) return;

		eventSource = new EventSource('/api/notifications/stream');

		eventSource.addEventListener('notification', (e) => {
			try {
				const newNotif: Notification = JSON.parse(e.data);
				// Prepend and cap at 20
				notifications = [newNotif, ...notifications].slice(0, 20);
				unreadCount = unreadCount + 1;
			} catch {
				// ignore malformed events
			}
		});

		eventSource.onerror = () => {
			// Browser auto-reconnects EventSource — we just clean up our ref on close
			if (eventSource?.readyState === EventSource.CLOSED) {
				eventSource = null;
			}
		};
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

		connectSSE();

		// Reconnect on tab visibility change
		const handleVisibility = () => {
			if (!document.hidden && !eventSource) {
				connectSSE();
			}
		};
		document.addEventListener('visibilitychange', handleVisibility);

		return () => {
			document.removeEventListener('visibilitychange', handleVisibility);
		};
	});

	onDestroy(() => {
		eventSource?.close();
		eventSource = null;
	});
</script>

<Popover bind:open>
	<PopoverTrigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				aria-label="Notificări"
			>
				<BellIcon class="size-4 shrink-0" />
				<span class="flex-1 text-left">Notificări</span>
				{#if unreadCount > 0}
					<span
						class="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
					>
						{unreadCount > 99 ? '99+' : unreadCount}
					</span>
				{/if}
			</button>
		{/snippet}
	</PopoverTrigger>

	<PopoverContent class="w-80 p-0" align="start" side="right" sideOffset={8}>
		<!-- Header -->
		<div class="flex items-center justify-between border-b px-4 py-3">
			<h3 class="text-sm font-semibold">Notificări</h3>
			{#if unreadCount > 0}
				<Button variant="ghost" size="sm" class="h-7 gap-1 px-2 text-xs" onclick={markAllRead}>
					<CheckCheckIcon class="size-3" />
					Marchează toate
				</Button>
			{/if}
		</div>

		<!-- List -->
		<div class="max-h-80 overflow-y-auto">
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
					{@const Icon = getNotificationIcon(notif.type)}
					{@const iconColor = getNotificationColor(notif.type)}
					<div
						class={cn(
							'flex gap-3 border-b px-4 py-3 last:border-b-0',
							!notif.isRead && 'bg-accent/40'
						)}
					>
						<!-- Icon -->
						<div class="mt-0.5 shrink-0">
							<Icon class={cn('size-4', iconColor)} />
						</div>

						<!-- Content -->
						<div class="min-w-0 flex-1">
							<p class={cn('text-xs font-medium', !notif.isRead && 'font-semibold')}>
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
										class="flex items-center gap-0.5 text-[10px] text-primary hover:underline"
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
	</PopoverContent>
</Popover>
