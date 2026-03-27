import type { RequestHandler } from './$types';
import { registerSSE, unregisterSSE } from '$lib/server/notifications';

const encoder = new TextEncoder();

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return new Response('Unauthorized', { status: 401 });
	}

	const userId = locals.user.id;

	let pingInterval: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			registerSSE(userId, controller);

			// Send initial connection confirmation
			controller.enqueue(encoder.encode(': connected\n\n'));

			// Keepalive ping every 30s to prevent proxy timeouts
			pingInterval = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					if (pingInterval) clearInterval(pingInterval);
					unregisterSSE(userId);
				}
			}, 30_000);
		},
		cancel() {
			if (pingInterval) clearInterval(pingInterval);
			unregisterSSE(userId);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no' // Disable Nginx buffering
		}
	});
};
