import { db } from './db';
import * as table from './db/schema';
import { eq, and, or } from 'drizzle-orm';
import { generateSlug } from './utils/slug';

/**
 * Get tenant by ID and validate user has access
 */
export async function getTenantById(tenantId: string, userId: string) {
	const [result] = await db
		.select({
			tenant: table.tenant,
			tenantUser: table.tenantUser
		})
		.from(table.tenant)
		.innerJoin(table.tenantUser, eq(table.tenant.id, table.tenantUser.tenantId))
		.where(
			or(
				and(eq(table.tenant.slug, tenantId), eq(table.tenantUser.userId, userId)),
				and(eq(table.tenant.id, tenantId), eq(table.tenantUser.userId, userId))
			)
		)
		.limit(1);

	return result || null;
}

/**
 * Get all tenants for a user
 */
export async function getUserTenants(userId: string) {
	const results = await db
		.select({
			tenant: table.tenant,
			tenantUser: table.tenantUser
		})
		.from(table.tenant)
		.innerJoin(table.tenantUser, eq(table.tenant.id, table.tenantUser.tenantId))
		.where(eq(table.tenantUser.userId, userId));

	return results.map((r) => ({
		...r.tenant,
		role: r.tenantUser.role
	}));
}

/**
 * Generate a URL-friendly slug from tenant name
 */
export function generateTenantSlug(name: string): string {
	return generateSlug(name);
}

/**
 * Check if tenant slug is available
 */
export async function validateTenantSlug(slug: string): Promise<boolean> {
	const [existing] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, slug))
		.limit(1);

	return !existing;
}

/**
 * Require tenant access - throws if user doesn't have access
 */
export async function requireTenantAccess(tenantId: string, userId: string) {
	const access = await getTenantById(tenantId, userId);
	if (!access) {
		throw new Error('Access denied');
	}
	return access;
}
