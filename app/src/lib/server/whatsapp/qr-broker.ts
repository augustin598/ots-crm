type Subscriber = {
	write: (payload: string) => void;
	close: () => void;
};

type TenantState = {
	subscribers: Set<Subscriber>;
	lastQr: string | null; // cached QR SSE payload, sent to any new subscriber
};

const channels = new Map<string, TenantState>();

function getOrCreate(tenantId: string): TenantState {
	let state = channels.get(tenantId);
	if (!state) {
		state = { subscribers: new Set(), lastQr: null };
		channels.set(tenantId, state);
	}
	return state;
}

export function subscribe(tenantId: string, subscriber: Subscriber): () => void {
	const state = getOrCreate(tenantId);
	state.subscribers.add(subscriber);
	console.log(`[WHATSAPP] SSE subscriber added for tenant=${tenantId} (total=${state.subscribers.size}, hasCachedQr=${!!state.lastQr})`);
	if (state.lastQr) {
		try {
			subscriber.write(state.lastQr);
		} catch (err) {
			console.warn(`[WHATSAPP] Failed to replay cached QR to new subscriber:`, err);
		}
	}
	return () => {
		state.subscribers.delete(subscriber);
		console.log(`[WHATSAPP] SSE subscriber removed for tenant=${tenantId} (remaining=${state.subscribers.size})`);
	};
}

export function publish(
	tenantId: string,
	event: 'qr' | 'connected' | 'disconnected' | 'error',
	data: Record<string, unknown> = {}
): void {
	const state = getOrCreate(tenantId);
	const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

	if (event === 'qr') state.lastQr = payload;
	else if (event === 'connected' || event === 'disconnected') state.lastQr = null;

	console.log(
		`[WHATSAPP] publish event=${event} tenant=${tenantId} subscribers=${state.subscribers.size}`
	);

	for (const sub of Array.from(state.subscribers)) {
		try {
			sub.write(payload);
		} catch (err) {
			console.warn(`[WHATSAPP] Dropping dead subscriber:`, err);
			state.subscribers.delete(sub);
		}
	}
}

export function getCachedQr(tenantId: string): string | null {
	const state = channels.get(tenantId);
	if (!state || !state.lastQr) return null;
	// Extract the data JSON from the SSE payload format "event: qr\ndata: {...}\n\n"
	const match = state.lastQr.match(/^event: qr\ndata: (.+)\n\n$/);
	return match ? match[1] : null;
}

export function clearChannel(tenantId: string): void {
	const state = channels.get(tenantId);
	if (!state) return;
	for (const sub of state.subscribers) {
		try {
			sub.close();
		} catch {
			// ignore
		}
	}
	channels.delete(tenantId);
}
