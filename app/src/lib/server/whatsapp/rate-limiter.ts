const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 7000;

const lastSendByTenant = new Map<string, number>();

export async function humanizedDelay(tenantId: string): Promise<void> {
	const now = Date.now();
	const last = lastSendByTenant.get(tenantId) ?? 0;
	const spread = MAX_DELAY_MS - MIN_DELAY_MS;
	const target = MIN_DELAY_MS + Math.floor(Math.random() * spread);
	const elapsed = now - last;
	const wait = Math.max(0, target - elapsed);
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	lastSendByTenant.set(tenantId, Date.now());
}
