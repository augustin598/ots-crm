import { eq, and, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
// Re-export for legacy callers; new code should use the catalog directly.
export {
	routeRequiresCapability,
	type Capability
} from '$lib/access/catalog';

/**
 * Portal access flags — granular per-page visibility for client portal users.
 *
 * Primary contacts (clientUser.isPrimary === true) always get full access.
 * Secondary contacts (matched via clientSecondaryEmail by email) have access
 * controlled by the JSON `accessFlags` column on clientSecondaryEmail.
 *
 * The 3 legacy boolean columns (notifyInvoices/Tasks/Contracts) are kept as
 * fallback when accessFlags is NULL, so existing rows keep working until the
 * accessFlags backfill runs.
 */

export type AccessCategory =
	| 'invoices'
	| 'contracts'
	| 'tasks'
	| 'marketing'
	| 'reports'
	| 'leads'
	| 'accessData'
	| 'backlinks'
	| 'budgets';

export type AccessFlags = Record<AccessCategory, boolean>;

export const ACCESS_CATEGORIES: readonly AccessCategory[] = [
	'invoices',
	'contracts',
	'tasks',
	'marketing',
	'reports',
	'leads',
	'accessData',
	'backlinks',
	'budgets'
] as const;

export const ALL_ACCESS_TRUE: AccessFlags = {
	invoices: true,
	contracts: true,
	tasks: true,
	marketing: true,
	reports: true,
	leads: true,
	accessData: true,
	backlinks: true,
	budgets: true
};

export const NO_ACCESS: AccessFlags = {
	invoices: false,
	contracts: false,
	tasks: false,
	marketing: false,
	reports: false,
	leads: false,
	accessData: false,
	backlinks: false,
	budgets: false
};

type SecondaryEmailAccessRow = {
	accessFlags: string | null;
	notifyInvoices?: boolean | null;
	notifyTasks?: boolean | null;
	notifyContracts?: boolean | null;
};

export function parseAccessFlags(raw: string | null | undefined): AccessFlags | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return null;
		const out: AccessFlags = { ...NO_ACCESS };
		for (const cat of ACCESS_CATEGORIES) {
			if (typeof parsed[cat] === 'boolean') out[cat] = parsed[cat];
		}
		return out;
	} catch {
		return null;
	}
}

export function resolveAccessFlags(opts: {
	isPrimary: boolean;
	secondaryEmail?: SecondaryEmailAccessRow | null;
}): AccessFlags {
	if (opts.isPrimary) return { ...ALL_ACCESS_TRUE };
	const se = opts.secondaryEmail;
	if (!se) return { ...NO_ACCESS };
	const parsed = parseAccessFlags(se.accessFlags);
	if (parsed) return parsed;
	// Backward-compat fallback: derive from legacy notify* columns.
	return {
		...NO_ACCESS,
		invoices: !!se.notifyInvoices,
		tasks: !!se.notifyTasks,
		contracts: !!se.notifyContracts
	};
}

/**
 * Look up the per-user access flags for the current portal request.
 * Use in +server.ts endpoints (which don't run layout server load functions).
 */
export async function getRequestAccessFlags(opts: {
	tenantId: string;
	clientId: string;
	userEmail: string | null | undefined;
	isPrimary: boolean;
}): Promise<AccessFlags> {
	if (opts.isPrimary) return { ...ALL_ACCESS_TRUE };
	const email = opts.userEmail?.toLowerCase() ?? '';
	if (!email) return { ...NO_ACCESS };
	const [secondary] = await db
		.select({
			accessFlags: table.clientSecondaryEmail.accessFlags,
			notifyInvoices: table.clientSecondaryEmail.notifyInvoices,
			notifyTasks: table.clientSecondaryEmail.notifyTasks,
			notifyContracts: table.clientSecondaryEmail.notifyContracts
		})
		.from(table.clientSecondaryEmail)
		.where(
			and(
				eq(table.clientSecondaryEmail.tenantId, opts.tenantId),
				eq(table.clientSecondaryEmail.clientId, opts.clientId),
				eq(sql`lower(${table.clientSecondaryEmail.email})`, email)
			)
		)
		.limit(1);
	return resolveAccessFlags({ isPrimary: false, secondaryEmail: secondary ?? null });
}

/**
 * Map a portal pathname (e.g. "/client/ots/invoices/abc/pdf") to the access
 * category that gates it. Returns null for routes that are always available
 * (Dashboard, Services, Settings, login, verify, etc.).
 */
export function routeRequiresAccess(pathname: string, tenantSlug: string): AccessCategory | null {
	const prefix = `/client/${tenantSlug}`;
	if (!pathname.startsWith(prefix)) return null;
	const rest = pathname.slice(prefix.length);
	if (rest.startsWith('/invoices')) return 'invoices';
	if (rest.startsWith('/contracts')) return 'contracts';
	if (rest.startsWith('/tasks')) return 'tasks';
	if (rest.startsWith('/marketing')) return 'marketing';
	if (rest.startsWith('/reports')) return 'reports';
	if (rest.startsWith('/leads')) return 'leads';
	if (rest.startsWith('/access-data')) return 'accessData';
	if (rest.startsWith('/backlinks')) return 'backlinks';
	if (rest.startsWith('/budgets')) return 'budgets';
	return null;
}
