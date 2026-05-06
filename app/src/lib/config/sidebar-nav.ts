// Sidebar navigation config — single source of truth for sidebar + command palette.
// Icons are referenced by key; the renderer maps each key to a Svelte component.
// `href` is RELATIVE to the tenant root (e.g. "/" → /:tenant, "/clients" → /:tenant/clients).

export type IconKey =
	| 'dashboard'
	| 'tasks'
	| 'my-plans'
	| 'clients'
	| 'projects'
	| 'services'
	| 'contracts'
	| 'invoices'
	| 'invoice-keez'
	| 'invoice-google'
	| 'invoice-meta'
	| 'invoice-tiktok'
	| 'banking'
	| 'supplier-invoices'
	| 'seo-links'
	| 'wordpress'
	| 'marketing'
	| 'campaigns-ads'
	| 'leads'
	| 'reports'
	| 'reports-schedule'
	| 'admin'
	| 'admin-scheduler'
	| 'admin-pay-status'
	| 'whatsapp'
	| 'settings'
	| 'meta'
	| 'google'
	| 'tiktok';

export type RoleRequirement = 'admin' | 'owner';

export interface NavItem {
	id: string;
	label: string;
	icon: IconKey;
	href?: string;
	matchPaths?: string[];
	badge?: number;
	children?: NavItem[];
	requiredRole?: RoleRequirement;
}

export interface NavGroup {
	id: string;
	label: string;
	items: NavItem[];
}

export const SIDEBAR_NAV: NavGroup[] = [
	{
		id: 'workspace',
		label: 'Workspace',
		items: [
			{ id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '/' },
			{ id: 'tasks', label: 'Tasks', icon: 'tasks', href: '/tasks' },
			{ id: 'my-plans', label: 'My Plans', icon: 'my-plans', href: '/my-plans' },
			{ id: 'team', label: 'Team', icon: 'clients', href: '/team', requiredRole: 'admin' }
		]
	},
	{
		id: 'sales-finance',
		label: 'Sales & Finance',
		items: [
			{ id: 'clients', label: 'Clients', icon: 'clients', href: '/clients' },
			{ id: 'projects', label: 'Projects', icon: 'projects', href: '/projects' },
			{ id: 'services', label: 'Services', icon: 'services', href: '/services' },
			{ id: 'contracts', label: 'Contracte', icon: 'contracts', href: '/contracts' },
			{
				id: 'invoices',
				label: 'Invoices',
				icon: 'invoices',
				href: '/invoices',
				matchPaths: ['/invoices'],
				children: [
					{ id: 'inv-keez', label: 'Keez', icon: 'invoice-keez', href: '/invoices' },
					{
						id: 'inv-google',
						label: 'Google Ads',
						icon: 'invoice-google',
						href: '/invoices/google-ads'
					},
					{
						id: 'inv-meta',
						label: 'Facebook Ads',
						icon: 'invoice-meta',
						href: '/invoices/meta-ads'
					},
					{
						id: 'inv-tiktok',
						label: 'TikTok Ads',
						icon: 'invoice-tiktok',
						href: '/invoices/tiktok-ads'
					}
				]
			},
			{
				id: 'banking',
				label: 'Banking',
				icon: 'banking',
				href: '/banking',
				matchPaths: ['/banking'],
				// Manually exclude supplier-invoices subroute from active match.
				// Handled in helper via children-aware logic below.
			},
			{
				id: 'supplier-invoices',
				label: 'Facturi Furnizori',
				icon: 'supplier-invoices',
				href: '/banking/supplier-invoices'
			}
		]
	},
	{
		id: 'marketing-ads',
		label: 'Marketing & Ads',
		items: [
			{ id: 'marketing', label: 'Marketing', icon: 'marketing', href: '/marketing' },
			{
				id: 'campaigns-ads',
				label: 'Campanii Ads',
				icon: 'campaigns-ads',
				href: '/campaigns-ads',
				children: [
					{
						id: 'ca-meta',
						label: 'Facebook / Meta',
						icon: 'meta',
						href: '/campaigns-ads/facebook'
					},
					{ id: 'ca-tiktok', label: 'TikTok', icon: 'tiktok', href: '/campaigns-ads/tiktok' },
					{ id: 'ca-google', label: 'Google Ads', icon: 'google', href: '/campaigns-ads/google' }
				]
			},
			{
				id: 'reports',
				label: 'Rapoarte',
				icon: 'reports',
				href: '/reports',
				children: [
					{ id: 'rep-meta', label: 'Facebook Ads', icon: 'meta', href: '/reports/facebook-ads' },
					{ id: 'rep-google', label: 'Google Ads', icon: 'google', href: '/reports/google-ads' },
					{ id: 'rep-tiktok', label: 'TikTok Ads', icon: 'tiktok', href: '/reports/tiktok-ads' },
					{
						id: 'rep-schedule',
						label: 'Programare Rapoarte',
						icon: 'reports-schedule',
						href: '/reports/schedule-reports'
					}
				]
			},
			{
				id: 'leads',
				label: 'Leads',
				icon: 'leads',
				href: '/leads',
				children: [
					{ id: 'leads-meta', label: 'Facebook Ads', icon: 'meta', href: '/leads/facebook-ads' },
					{ id: 'leads-google', label: 'Google Ads', icon: 'google', href: '/leads/google-ads' },
					{ id: 'leads-tiktok', label: 'TikTok Ads', icon: 'tiktok', href: '/leads/tiktok-ads' }
				]
			},
			{ id: 'seo-links', label: 'Linkuri SEO', icon: 'seo-links', href: '/seo-links' },
			{ id: 'wordpress', label: 'WordPress', icon: 'wordpress', href: '/wordpress' },
			{ id: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp', href: '/whatsapp' }
		]
	},
	{
		id: 'admin',
		label: 'Admin',
		items: [
			{
				id: 'admin',
				label: 'Logs și Debug',
				icon: 'admin',
				href: '/admin/logs',
				matchPaths: ['/admin'],
				requiredRole: 'admin',
				children: [
					{ id: 'adm-logs', label: 'Logs', icon: 'admin', href: '/admin/logs' },
					{
						id: 'adm-scheduler',
						label: 'Scheduler',
						icon: 'admin-scheduler',
						href: '/admin/scheduler'
					},
					{
						id: 'adm-pay',
						label: 'Status plată Ads',
						icon: 'admin-pay-status',
						href: '/admin/ads-payment-status'
					}
				]
			},
			{ id: 'settings', label: 'Settings', icon: 'settings', href: '/settings' }
		]
	}
];

export interface FlatNavItem extends NavItem {
	groupId: string;
	groupLabel: string;
	parentId?: string;
	parentLabel?: string;
}

export function flattenNav(groups: NavGroup[]): FlatNavItem[] {
	const out: FlatNavItem[] = [];
	for (const g of groups) {
		for (const item of g.items) {
			out.push({ ...item, groupId: g.id, groupLabel: g.label });
			if (item.children) {
				for (const child of item.children) {
					out.push({
						...child,
						groupId: g.id,
						groupLabel: g.label,
						parentId: item.id,
						parentLabel: item.label
					});
				}
			}
		}
	}
	return out;
}

// Filter out items the current role can't access. Admins see admin-only; non-admins don't.
export function filterByRole(groups: NavGroup[], role: string | undefined): NavGroup[] {
	const isAdmin = role === 'admin' || role === 'owner';
	return groups
		.map((g) => ({
			...g,
			items: g.items
				.filter((it) => !it.requiredRole || isAdmin)
				.map((it) => ({
					...it,
					children: it.children?.filter((c) => !c.requiredRole || isAdmin)
				}))
		}))
		.filter((g) => g.items.length > 0);
}

// pathPrefix examples: "/ots" (admin) or "/client/ots" (client portal).
export function buildHref(pathPrefix: string, href?: string): string | undefined {
	if (!href) return undefined;
	if (href === '/') return pathPrefix;
	return `${pathPrefix}${href}`;
}

// True if `pathname` is on (or under) `targetHref` for the given prefix.
function pathMatches(pathname: string, pathPrefix: string, targetHref: string): boolean {
	const full = buildHref(pathPrefix, targetHref);
	if (!full) return false;
	if (full === pathPrefix) {
		return pathname === full || pathname === `${full}/`;
	}
	return pathname === full || pathname.startsWith(`${full}/`);
}

// Decide if an item is active for the current pathname. Handles match-paths,
// children, and the banking/supplier-invoices exclusion via more-specific siblings.
export function isItemActive(
	item: NavItem,
	pathname: string,
	pathPrefix: string,
	siblingHrefs: string[] = []
): boolean {
	const candidates = item.matchPaths ?? (item.href ? [item.href] : []);
	const matchesSelf = candidates.some((p) => pathMatches(pathname, pathPrefix, p));
	if (!matchesSelf) {
		// Active if any child matches.
		return (item.children ?? []).some((c) =>
			c.href ? pathMatches(pathname, pathPrefix, c.href) : false
		);
	}
	// Exclude when a more-specific sibling claims the same prefix.
	const targetHref = item.href ?? candidates[0];
	if (!targetHref) return matchesSelf;
	const moreSpecificSibling = siblingHrefs.find(
		(s) => s !== targetHref && s.startsWith(`${targetHref}/`) && pathMatches(pathname, pathPrefix, s)
	);
	return !moreSpecificSibling;
}

export interface Breadcrumb {
	label: string;
	href?: string;
}

// Build breadcrumbs from the current pathname using SIDEBAR_NAV as label source.
// Falls back to a humanised path segment if no nav entry matches.
export function buildBreadcrumbs(
	pathname: string,
	pathPrefix: string,
	groups: NavGroup[]
): Breadcrumb[] {
	if (!pathPrefix) return [];
	if (!pathname.startsWith(pathPrefix)) return [];

	// Strip query/hash if any
	const cleanPath = pathname.split('?')[0].split('#')[0];
	const after = cleanPath.slice(pathPrefix.length);
	if (after === '' || after === '/') {
		return [{ label: 'Dashboard', href: pathPrefix }];
	}
	const segments = after.replace(/^\//, '').split('/').filter(Boolean);

	// Walk the segments, accumulating href and matching against nav items.
	const flat = flattenNav(groups);
	const out: Breadcrumb[] = [];
	let acc = '';
	for (const seg of segments) {
		acc += `/${seg}`;
		const matched = flat.find((it) => it.href === acc);
		if (matched) {
			out.push({
				label: matched.parentLabel ? `${matched.label}` : matched.label,
				href: `${pathPrefix}${acc}`
			});
			// If this is a child item, prepend the parent group/item context.
			if (matched.parentLabel && out.length === 1) {
				const parent = flat.find(
					(p) => p.id === matched.parentId && p.parentLabel === undefined
				);
				if (parent && parent.href) {
					out.unshift({ label: parent.label, href: `${pathPrefix}${parent.href}` });
				}
			}
		} else if (looksLikeId(seg)) {
			// Skip IDs in breadcrumbs (UUID, CUID, hex/numeric tokens).
			continue;
		} else {
			out.push({ label: humaniseSegment(seg) });
		}
	}
	return out;
}

function looksLikeId(seg: string): boolean {
	// UUID v4: 8-4-4-4-12 = 36 chars; CUID typically 24-25 chars; numeric IDs >= 8 chars.
	// Heuristic: contains a digit AND length >= 16, OR pure hex/numeric of length >= 8.
	if (/^\d+$/.test(seg) && seg.length >= 6) return true;
	if (seg.length >= 16 && /\d/.test(seg)) return true;
	if (/^[0-9a-f]{8,}$/i.test(seg) && seg.length >= 16) return true;
	return false;
}

function humaniseSegment(seg: string): string {
	return decodeURIComponent(seg)
		.replace(/-/g, ' ')
		.replace(/_/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Used by groups to know if any item should keep them visually expanded.
export function isGroupActive(group: NavGroup, pathname: string, pathPrefix: string): boolean {
	const allHrefs = group.items.flatMap((it) => [
		...(it.href ? [it.href] : []),
		...(it.children ?? []).map((c) => c.href).filter((h): h is string => Boolean(h))
	]);
	return group.items.some((it) => isItemActive(it, pathname, pathPrefix, allHrefs));
}
