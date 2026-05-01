import { eq } from 'drizzle-orm';
import type { Column } from 'drizzle-orm';

/**
 * Returns an `eq(table.tenantId, tenantId)` filter for use in WHERE clauses.
 * All ad-monitoring tables have a tenantId column — pass this helper result
 * as the first condition in `and(...)` to enforce tenant isolation.
 *
 * Usage:
 *   .where(and(tenantScope(table.adMonitorTarget.tenantId, tenantId), ...other))
 */
export function tenantScope(tenantIdCol: Column, tenantId: string) {
	return eq(tenantIdCol, tenantId);
}
