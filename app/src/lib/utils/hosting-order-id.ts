/**
 * Format a hosting-inquiry display ID. Uses the sequential `order_number`
 * (assigned at INSERT time, tenant-scoped) when available. Falls back to
 * the first 5 chars of the random `id` for the brief window between schema
 * deploy and backfill completion, OR for any orphaned row that somehow
 * escaped the backfill (defensive — should never appear in production).
 *
 * NOT a legal invoice number — Keez assigns those separately (RON-YYYY-NNNNNN,
 * monotonic, no gaps). This is for internal CRM tracking only.
 */
export function displayOrderId(orderNumber: number | null, fallbackId: string): string {
	if (orderNumber == null) return 'OTS-' + fallbackId.slice(0, 5).toUpperCase();
	return 'OTS-' + String(orderNumber).padStart(5, '0');
}
