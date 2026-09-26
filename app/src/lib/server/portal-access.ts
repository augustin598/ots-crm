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
	| 'budgets'
	| 'hosting'
	| 'content'
	| 'interviuri'
	| 'seo'
	| 'hourCredits';

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
	'budgets',
	'hosting',
	'content',
	'interviuri',
	'seo',
	'hourCredits'
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
	budgets: true,
	hosting: true,
	content: true,
	interviuri: true,
	seo: true,
	hourCredits: true
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
	budgets: false,
	hosting: false,
	content: false,
	interviuri: false,
	seo: false,
	hourCredits: false
};

type SecondaryEmailAccessRow = {
	accessFlags: string | null;
	notifyInvoices?: boolean | null;
	notifyTasks?: boolean | null;
	notifyContracts?: boolean | null;
};

/**
 * Cât din portal vede clientul. 'hosting' = cont creat singur de pe /pachete-hosting
 * (Dashboard, Hosting, Facturi, Setări); adminul îl poate trece pe 'full' din Setări.
 */
export type PortalScope = 'full' | 'hosting';
export const PORTAL_SCOPES: readonly PortalScope[] = ['full', 'hosting'] as const;

/** Categoriile pe care le păstrează scope-ul 'hosting'; restul cad pe false. */
const HOSTING_SCOPE_CATEGORIES: readonly AccessCategory[] = ['hosting', 'invoices'];

/**
 * Restrânge flag-urile la scope-ul clientului. Nu acordă nimic în plus — un
 * contact secundar fără `invoices` rămâne fără `invoices` și sub 'hosting'.
 * Orice altă valoare decât 'hosting' (inclusiv null la clienții vechi) = full.
 */
export function applyPortalScope(flags: AccessFlags, scope: string | null | undefined): AccessFlags {
	if (scope !== 'hosting') return flags;
	const out: AccessFlags = { ...NO_ACCESS };
	for (const c of HOSTING_SCOPE_CATEGORIES) out[c] = flags[c];
	return out;
}

/**
 * Rutele fără categorie de acces (Servicii & Oferte, Echipa mea) pe care scope-ul
 * 'hosting' le închide. Dashboard și Setări rămân deschise pentru oricine.
 */
export function routeBlockedByPortalScope(
	pathname: string,
	tenantSlug: string,
	scope: string | null | undefined
): boolean {
	if (scope !== 'hosting') return false;
	const prefix = `/client/${tenantSlug}`;
	if (!pathname.startsWith(prefix)) return false;
	const rest = pathname.slice(prefix.length);
	return rest.startsWith('/services') || rest.startsWith('/team');
}

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
 * Whether a secondary contact receives the emails of a notification category.
 * Invoices use their own opt-in (`receivesInvoiceEmails`): seeing the Facturi
 * page in the portal must not also subscribe a colleague to every invoice email.
 * Tasks and contracts still follow the access flag.
 */
export function secondaryReceivesNotification(
	category: 'invoices' | 'tasks' | 'contracts',
	se: SecondaryEmailAccessRow & { receivesInvoiceEmails?: boolean | null }
): boolean {
	if (category === 'invoices') return !!se.receivesInvoiceEmails;
	return resolveAccessFlags({ isPrimary: false, secondaryEmail: se })[category];
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
	/** `client.portalScope`, dacă apelantul îl are deja (layout-ul); altfel îl citim noi. */
	portalScope?: string | null;
}): Promise<AccessFlags> {
	let scope = opts.portalScope;
	if (scope === undefined) {
		const [row] = await db
			.select({ portalScope: table.client.portalScope })
			.from(table.client)
			.where(and(eq(table.client.id, opts.clientId), eq(table.client.tenantId, opts.tenantId)))
			.limit(1);
		scope = row?.portalScope ?? 'full';
	}
	if (opts.isPrimary) return applyPortalScope({ ...ALL_ACCESS_TRUE }, scope);
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
	return applyPortalScope(
		resolveAccessFlags({ isPrimary: false, secondaryEmail: secondary ?? null }),
		scope
	);
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
	if (rest.startsWith('/hosting')) return 'hosting';
	if (rest.startsWith('/content')) return 'content';
	if (rest.startsWith('/interviuri')) return 'interviuri';
	// hub-ul SEO & GEO & AEO + PageSpeed (portal) — o singură categorie
	if (rest.startsWith('/seo')) return 'seo';
	if (rest.startsWith('/pagespeed')) return 'seo';
	if (rest.startsWith('/rank-tracker')) return 'seo';
	if (rest.startsWith('/hour-credits')) return 'hourCredits';
	return null;
}
