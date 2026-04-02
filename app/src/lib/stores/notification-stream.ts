import { writable } from 'svelte/store';
import type { Notification } from '$lib/server/db/schema';

/** Latest notification pushed via SSE (subscribers react to each new value). */
export const latestNotification = writable<Notification | null>(null);

/** Whether SSE is currently connected. */
export const sseConnected = writable(false);

let eventSource: EventSource | null = null;
let refCount = 0;

/**
 * Subscribe to the SSE notification stream.
 * Uses reference counting so multiple consumers share one EventSource.
 * Call the returned cleanup function when your component unmounts.
 */
export function connectNotificationStream(): () => void {
	refCount++;

	if (!eventSource) {
		eventSource = new EventSource('/api/notifications/stream');

		eventSource.addEventListener('notification', (e) => {
			try {
				const notif: Notification = JSON.parse(e.data);
				latestNotification.set(notif);
			} catch {
				// ignore malformed events
			}
		});

		eventSource.onopen = () => sseConnected.set(true);

		eventSource.onerror = () => {
			sseConnected.set(false);
			if (eventSource?.readyState === EventSource.CLOSED) {
				eventSource = null;
			}
		};
	}

	return () => {
		refCount--;
		if (refCount <= 0) {
			refCount = 0;
			eventSource?.close();
			eventSource = null;
			sseConnected.set(false);
		}
	};
}
