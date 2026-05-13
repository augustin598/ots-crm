/**
 * Capability catalog — single source of truth for both admin and client portal
 * permissions. The CAPABILITY_CATALOG below is consumed by:
 *   - the runtime engine (`$lib/server/access`) for assertCan() checks
 *   - the UI matrix in TeamPermissionsMatrix.svelte (no drift possible)
 *   - the seed function that mirrors the catalog into the `access_capability` DB table
 *
 * IMPORTANT: this file is shared client+server. NEVER import from `$lib/server`.
 */

// =============================================================================
// Capability ID type
// =============================================================================

/**
 * String IDs are intentionally flexible (`admin.*` / `portal.*` / `shared.*`)
 * to allow incremental additions without expanding a closed enum. Use the
 * exported `Capability` type for parameter typing; runtime validation comes
 * from `CAPABILITY_IDS` membership.
 */
export type Capability = `admin.${string}` | `portal.${string}` | `shared.${string}`;

export type AdminRoleId = 'owner' | 'admin' | 'manager' | 'member' | 'viewer';
export type ClientPresetId = 'owner' | 'manager' | 'marketing' | 'viewer';

// =============================================================================
// Capability catalog
// =============================================================================

export interface CapabilityDef {
	id: Capability;
	domain: 'admin' | 'portal' | 'shared';
	groupLabel: string; // for matrix UI grouping
	label: string; // human description
	description?: string;
	/**
	 * If set, marking this capability via per-user override on a user without
	 * this role is REJECTED at write time. Prevents accidental escalation
	 * (e.g. giving a Member the ability to delete the org).
	 */
	unsafeUnlessRole?: AdminRoleId;
}

export const CAPABILITY_CATALOG: ReadonlyArray<CapabilityDef> = [
	// ------------------------------ ADMIN ------------------------------
	// Workspace
	{
		id: 'admin.workspace.settings',
		domain: 'admin',
		groupLabel: 'Workspace',
		label: 'Modificare setări workspace',
		description: 'Editare nume organizație, branding, configurări globale.'
	},
	{
		id: 'admin.workspace.billing',
		domain: 'admin',
		groupLabel: 'Workspace',
		label: 'Acces facturare & plan',
		description: 'Vizualizare și modificare plan, metode de plată.',
		unsafeUnlessRole: 'owner'
	},
	{
		id: 'admin.workspace.export',
		domain: 'admin',
		groupLabel: 'Workspace',
		label: 'Export date workspace',
		description: 'Export complet date organizație (clienți, facturi, etc.).'
	},

	// Team
	{
		id: 'admin.team.view',
		domain: 'admin',
		groupLabel: 'Team',
		label: 'Vezi pagina Team',
		description: 'Acces la /team — listă membri, invitații.'
	},
	{
		id: 'admin.team.invite',
		domain: 'admin',
		groupLabel: 'Team',
		label: 'Invită utilizatori',
		description: 'Trimite invitații pentru membri noi (Member/Viewer).'
	},
	{
		id: 'admin.team.changeRole',
		domain: 'admin',
		groupLabel: 'Team',
		label: 'Schimbă rol utilizator',
		description: 'Promovează/retrogradează membri existenți.',
		unsafeUnlessRole: 'owner'
	},
	{
		id: 'admin.team.suspend',
		domain: 'admin',
		groupLabel: 'Team',
		label: 'Suspendă/Dezactivează cont',
		description: 'Blochează accesul unui membru fără a-l elimina.'
	},
	{
		id: 'admin.team.editProfile',
		domain: 'admin',
		groupLabel: 'Team',
		label: 'Editează profil membru',
		description: 'Modifică departament, titlu, telefon pentru alți membri.'
	},
	{
		id: 'admin.team.editSkills',
		domain: 'admin',
		groupLabel: 'Team',
		label: 'Editează skills membri',
		description: 'Modifică lista de skills pentru ceilalți membri (self e mereu permis).'
	},

	// Campaigns
	{
		id: 'admin.campaigns.create',
		domain: 'admin',
		groupLabel: 'Campaigns',
		label: 'Creare campanii ads',
		description: 'Creează campanii noi în Meta/Google/TikTok.'
	},
	{
		id: 'admin.campaigns.budget',
		domain: 'admin',
		groupLabel: 'Campaigns',
		label: 'Modificare buget campanii',
		description: 'Schimbă bugetul zilnic/total al unei campanii live.'
	},
	{
		id: 'admin.campaigns.launch',
		domain: 'admin',
		groupLabel: 'Campaigns',
		label: 'Lansare campanii live',
		description: 'Activează campanii în producție (live).'
	},

	// Finance
	{
		id: 'admin.finance.invoice',
		domain: 'admin',
		groupLabel: 'Finance',
		label: 'Emitere facturi',
		description: 'Creează facturi noi pentru clienți.'
	},
	{
		id: 'admin.finance.viewPnL',
		domain: 'admin',
		groupLabel: 'Finance',
		label: 'Vizualizare P&L',
		description: 'Acces la rapoarte profit & loss, KPI-uri financiare.'
	},

	// Integrations
	{
		id: 'admin.integrations.manage',
		domain: 'admin',
		groupLabel: 'Integrations',
		label: 'Gestionare integrări',
		description: 'Conectează/deconectează Keez, ANAF, SmartBill, Revolut, Meta, Google, TikTok.'
	},
	{
		id: 'admin.keez.write',
		domain: 'admin',
		groupLabel: 'Integrations',
		label: 'Operațiuni Keez (write)',
		description: 'Sincronizare facturi, storno, validare, e-Factura, importuri.'
	},

	// Hosting (DirectAdmin plugin)
	{
		id: 'admin.hosting.view',
		domain: 'admin',
		groupLabel: 'Hosting',
		label: 'Vezi pagini Hosting',
		description: 'Acces la /hosting (servere DA, conturi, produse).'
	},
	{
		id: 'admin.hosting.manage',
		domain: 'admin',
		groupLabel: 'Hosting',
		label: 'Gestionare conturi & produse hosting',
		description: 'Creare/suspend/unsuspend/terminate conturi hosting; CRUD produse hosting.'
	},
	{
		id: 'admin.hosting.servers.manage',
		domain: 'admin',
		groupLabel: 'Hosting',
		label: 'Gestionare servere DirectAdmin',
		description: 'Adăugare/test/ștergere servere DA și sync pachete.',
		unsafeUnlessRole: 'admin'
	},
	{
		id: 'admin.hosting.import',
		domain: 'admin',
		groupLabel: 'Hosting',
		label: 'Import WHMCS hosting',
		description: 'Import wizard pentru produse/servicii/domenii din baza WHMCS.',
		unsafeUnlessRole: 'admin'
	},

	// Scheduler / Operations
	{
		id: 'admin.scheduler.view',
		domain: 'admin',
		groupLabel: 'Operations',
		label: 'Vezi joburi scheduler',
		description: 'Listare joburi cron, statusuri.'
	},
	{
		id: 'admin.scheduler.trigger',
		domain: 'admin',
		groupLabel: 'Operations',
		label: 'Trigger manual joburi',
		description: 'Rulare ad-hoc a joburilor de cron.',
		unsafeUnlessRole: 'owner'
	},

	// Logs & Debug
	{
		id: 'admin.logs.view',
		domain: 'admin',
		groupLabel: 'Operations',
		label: 'Vizualizare loguri',
		description: 'Acces la admin/logs (debug logs, email logs).'
	},
	{
		id: 'admin.debug',
		domain: 'admin',
		groupLabel: 'Operations',
		label: 'Acces endpoint-uri debug',
		description: 'Acces la _debug-* API routes pentru troubleshooting.'
	},

	// Misc
	{
		id: 'admin.apiKeys.manage',
		domain: 'admin',
		groupLabel: 'Operations',
		label: 'Gestionare API keys',
		description: 'Creează/revocă chei API pentru integrări custom.'
	},
	{
		id: 'admin.client.impersonate',
		domain: 'admin',
		groupLabel: 'Team',
		label: 'Generează magic link client',
		description: 'Generare magic link pentru autentificare ca un client (impersonate).'
	},

	// ------------------------------ PORTAL (CLIENT) ------------------------------
	{
		id: 'portal.invoices.view',
		domain: 'portal',
		groupLabel: 'Cont companie',
		label: 'Facturi',
		description: 'Vezi listă facturi, descarcă PDF, vezi statusuri plată.'
	},
	{
		id: 'portal.contracts.view',
		domain: 'portal',
		groupLabel: 'Cont companie',
		label: 'Contracte',
		description: 'Vezi contracte și descarcă PDF.'
	},
	{
		id: 'portal.tasks.view',
		domain: 'portal',
		groupLabel: 'Tasks & Proiecte',
		label: 'Taskuri',
		description: 'Vezi taskuri asignate, comentează.'
	},
	{
		id: 'portal.marketing.view',
		domain: 'portal',
		groupLabel: 'Campanii & Marketing',
		label: 'Marketing',
		description: 'Vezi materiale marketing, upload-uri, calendar editorial.'
	},
	{
		id: 'portal.reports.view',
		domain: 'portal',
		groupLabel: 'Rapoarte',
		label: 'Rapoarte',
		description: 'Vezi rapoarte performanță (Meta/Google/TikTok ads).'
	},
	{
		id: 'portal.leads.view',
		domain: 'portal',
		groupLabel: 'Campanii & Marketing',
		label: 'Leads',
		description: 'Acces la leads colectate din campanii.'
	},
	{
		id: 'portal.accessData.view',
		domain: 'portal',
		groupLabel: 'Cont companie',
		label: 'Date de acces',
		description: 'Acces la pagina cu credențiale (FTP, hosting, conturi).'
	},
	{
		id: 'portal.backlinks.view',
		domain: 'portal',
		groupLabel: 'Campanii & Marketing',
		label: 'Backlinks SEO',
		description: 'Vezi backlinks monitorizate și articole SEO.'
	},
	{
		id: 'portal.budgets.view',
		domain: 'portal',
		groupLabel: 'Cont companie',
		label: 'Bugete',
		description: 'Vezi bugete alocate per campanie/lună.'
	},
	{
		id: 'portal.hosting.view',
		domain: 'portal',
		groupLabel: 'Cont companie',
		label: 'Hosting',
		description: 'Vezi conturile de hosting și pachetele disponibile.'
	},
	{
		id: 'portal.team.manage',
		domain: 'portal',
		groupLabel: 'Cont companie',
		label: 'Gestionare echipă portal',
		description: 'Invită colegi, acordă acces, modifică permisiuni (doar primary).'
	}
];

// All capability IDs as a Set — used for runtime validation.
export const CAPABILITY_IDS: ReadonlyArray<Capability> = CAPABILITY_CATALOG.map((c) => c.id);
const CAPABILITY_ID_SET = new Set<string>(CAPABILITY_IDS);

export function isKnownCapability(id: string): id is Capability {
	return CAPABILITY_ID_SET.has(id);
}

export function getCapability(id: Capability): CapabilityDef | undefined {
	return CAPABILITY_CATALOG.find((c) => c.id === id);
}

// =============================================================================
// Role defaults — the executable matrix
// =============================================================================

/**
 * For each admin role, the set of capabilities granted by default. This IS the
 * matrix that the UI displays — no drift possible.
 *
 * Resolution of the manager-invite discrepancy: matrix wins. Manager can invite,
 * but only Member/Viewer (enforced via secondary check in sendInvitation).
 */
export const ROLE_DEFAULTS: Readonly<Record<AdminRoleId, ReadonlyArray<Capability>>> = {
	owner: [
		// Workspace
		'admin.workspace.settings',
		'admin.workspace.billing',
		'admin.workspace.export',
		// Team
		'admin.team.view',
		'admin.team.invite',
		'admin.team.changeRole',
		'admin.team.suspend',
		'admin.team.editProfile',
		'admin.team.editSkills',
		// Campaigns
		'admin.campaigns.create',
		'admin.campaigns.budget',
		'admin.campaigns.launch',
		// Finance
		'admin.finance.invoice',
		'admin.finance.viewPnL',
		// Integrations
		'admin.integrations.manage',
		'admin.keez.write',
		// Hosting
		'admin.hosting.view',
		'admin.hosting.manage',
		'admin.hosting.servers.manage',
		'admin.hosting.import',
		// Operations
		'admin.scheduler.view',
		'admin.scheduler.trigger',
		'admin.logs.view',
		'admin.debug',
		'admin.apiKeys.manage',
		'admin.client.impersonate'
	],
	admin: [
		// Workspace (no billing)
		'admin.workspace.settings',
		'admin.workspace.export',
		// Team (no changeRole)
		'admin.team.view',
		'admin.team.invite',
		'admin.team.suspend',
		'admin.team.editProfile',
		'admin.team.editSkills',
		// Campaigns
		'admin.campaigns.create',
		'admin.campaigns.budget',
		'admin.campaigns.launch',
		// Finance
		'admin.finance.invoice',
		'admin.finance.viewPnL',
		// Integrations
		'admin.integrations.manage',
		'admin.keez.write',
		// Hosting
		'admin.hosting.view',
		'admin.hosting.manage',
		'admin.hosting.servers.manage',
		'admin.hosting.import',
		// Operations (no scheduler.trigger)
		'admin.scheduler.view',
		'admin.logs.view',
		'admin.debug',
		'admin.apiKeys.manage',
		'admin.client.impersonate'
	],
	manager: [
		// Team — manager can invite (Member/Viewer only) and edit skills
		'admin.team.invite',
		'admin.team.editSkills',
		// Campaigns
		'admin.campaigns.create',
		'admin.campaigns.budget',
		'admin.campaigns.launch',
		// Finance — invoice only
		'admin.finance.invoice',
		// Hosting — view + manage accounts (no servers/import)
		'admin.hosting.view',
		'admin.hosting.manage',
		// Operations
		'admin.keez.write',
		'admin.apiKeys.manage'
	],
	member: [
		// Campaigns — only create
		'admin.campaigns.create',
		// Hosting — read only
		'admin.hosting.view',
		// Operations
		'admin.keez.write'
	],
	viewer: [
		// Operations only — read-only across the system
		'admin.apiKeys.manage',
		// Hosting — read only
		'admin.hosting.view'
	]
};

export function getCapabilitiesForRole(role: AdminRoleId): ReadonlyArray<Capability> {
	return ROLE_DEFAULTS[role] ?? [];
}

// =============================================================================
// Client preset → capabilities map
// =============================================================================

export const CLIENT_PRESET_CAPABILITIES: Readonly<
	Record<ClientPresetId, ReadonlyArray<Capability>>
> = {
	owner: [
		'portal.invoices.view',
		'portal.contracts.view',
		'portal.tasks.view',
		'portal.marketing.view',
		'portal.reports.view',
		'portal.leads.view',
		'portal.accessData.view',
		'portal.backlinks.view',
		'portal.budgets.view',
		'portal.hosting.view'
	],
	manager: [
		'portal.invoices.view',
		'portal.contracts.view',
		'portal.tasks.view',
		'portal.marketing.view',
		'portal.reports.view',
		'portal.leads.view',
		'portal.backlinks.view',
		'portal.budgets.view',
		'portal.hosting.view'
		// no accessData
	],
	marketing: [
		'portal.tasks.view',
		'portal.marketing.view',
		'portal.reports.view',
		'portal.backlinks.view'
	],
	viewer: ['portal.reports.view']
};

// =============================================================================
// Conversion: legacy AccessFlags shape ↔ Capability set
// =============================================================================

const LEGACY_FLAG_TO_CAP: Record<string, Capability> = {
	invoices: 'portal.invoices.view',
	contracts: 'portal.contracts.view',
	tasks: 'portal.tasks.view',
	marketing: 'portal.marketing.view',
	reports: 'portal.reports.view',
	leads: 'portal.leads.view',
	accessData: 'portal.accessData.view',
	backlinks: 'portal.backlinks.view',
	budgets: 'portal.budgets.view',
	hosting: 'portal.hosting.view'
};

export function legacyFlagsToCapabilities(
	flags: Record<string, boolean> | null | undefined
): Capability[] {
	if (!flags) return [];
	const out: Capability[] = [];
	for (const [k, v] of Object.entries(flags)) {
		if (v && LEGACY_FLAG_TO_CAP[k]) out.push(LEGACY_FLAG_TO_CAP[k]);
	}
	return out;
}

export function capabilitiesToLegacyFlags(caps: Iterable<Capability>): Record<string, boolean> {
	const set = new Set(caps);
	const out: Record<string, boolean> = {};
	for (const [legacy, cap] of Object.entries(LEGACY_FLAG_TO_CAP)) {
		out[legacy] = set.has(cap);
	}
	return out;
}

// =============================================================================
// Route → capability mapping (portal)
// =============================================================================

export function routeRequiresCapability(
	pathname: string,
	tenantSlug: string
): Capability | null {
	const prefix = `/client/${tenantSlug}`;
	if (!pathname.startsWith(prefix)) return null;
	const rest = pathname.slice(prefix.length);
	if (rest.startsWith('/invoices')) return 'portal.invoices.view';
	if (rest.startsWith('/contracts')) return 'portal.contracts.view';
	if (rest.startsWith('/tasks')) return 'portal.tasks.view';
	if (rest.startsWith('/marketing')) return 'portal.marketing.view';
	if (rest.startsWith('/reports')) return 'portal.reports.view';
	if (rest.startsWith('/leads')) return 'portal.leads.view';
	if (rest.startsWith('/access-data')) return 'portal.accessData.view';
	if (rest.startsWith('/backlinks')) return 'portal.backlinks.view';
	if (rest.startsWith('/budgets')) return 'portal.budgets.view';
	if (rest.startsWith('/hosting')) return 'portal.hosting.view';
	if (rest.startsWith('/team')) return 'portal.team.manage';
	return null;
}

// =============================================================================
// Helpers for matrix UI generation
// =============================================================================

export function rolesForCapability(cap: Capability): AdminRoleId[] {
	const out: AdminRoleId[] = [];
	for (const role of ['owner', 'admin', 'manager', 'member', 'viewer'] as const) {
		if (ROLE_DEFAULTS[role].includes(cap)) out.push(role);
	}
	return out;
}

export function clientPresetsForCapability(cap: Capability): ClientPresetId[] {
	const out: ClientPresetId[] = [];
	for (const preset of ['owner', 'manager', 'marketing', 'viewer'] as const) {
		if (CLIENT_PRESET_CAPABILITIES[preset].includes(cap)) out.push(preset);
	}
	return out;
}

export function capabilitiesByDomain(domain: 'admin' | 'portal' | 'shared'): CapabilityDef[] {
	return CAPABILITY_CATALOG.filter((c) => c.domain === domain);
}

export function capabilitiesByGroup(domain: 'admin' | 'portal' | 'shared'): Map<string, CapabilityDef[]> {
	const out = new Map<string, CapabilityDef[]>();
	for (const cap of capabilitiesByDomain(domain)) {
		const arr = out.get(cap.groupLabel) ?? [];
		arr.push(cap);
		out.set(cap.groupLabel, arr);
	}
	return out;
}
