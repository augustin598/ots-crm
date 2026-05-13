// Mirror of $lib/server/portal-access — duplicated here so client-side modules
// (Svelte components, browser bundles) don't pull the server module.
export const ACCESS_CATEGORIES = [
	'invoices',
	'contracts',
	'tasks',
	'marketing',
	'reports',
	'leads',
	'accessData',
	'backlinks',
	'budgets',
	'hosting'
] as const;

export type AccessCategory = (typeof ACCESS_CATEGORIES)[number];
export type AccessFlags = Record<AccessCategory, boolean>;

const ALL_ACCESS_TRUE: AccessFlags = {
	invoices: true,
	contracts: true,
	tasks: true,
	marketing: true,
	reports: true,
	leads: true,
	accessData: true,
	backlinks: true,
	budgets: true,
	hosting: true
};

const NO_ACCESS: AccessFlags = {
	invoices: false,
	contracts: false,
	tasks: false,
	marketing: false,
	reports: false,
	leads: false,
	accessData: false,
	backlinks: false,
	budgets: false,
	hosting: false
};

// =============================================================================
// Admin (tenant) roles
// =============================================================================

export type AdminRoleId = 'owner' | 'admin' | 'manager' | 'member' | 'viewer';

export interface RoleDef<Id extends string = string> {
	id: Id;
	label: string;
	color: string; // text color hex
	bg: string; // background hex
	desc: string;
}

// Hardcoded hex colors per the new design (team-data.jsx). NOT theme-driven —
// roluri folosesc semantica vizuală standard pe toată platforma.
export const ADMIN_ROLES: ReadonlyArray<RoleDef<AdminRoleId>> = [
	{
		id: 'owner',
		label: 'Owner',
		color: '#dc2626',
		bg: '#fee2e2',
		desc: 'Full control · billing · org settings'
	},
	{
		id: 'admin',
		label: 'Admin',
		color: '#7c3aed',
		bg: '#ede9fe',
		desc: 'Manage users, roles, integrations'
	},
	{
		id: 'manager',
		label: 'Manager',
		color: '#1877F2',
		bg: '#dbeafe',
		desc: 'Manage team, projects, campaigns'
	},
	{
		id: 'member',
		label: 'Member',
		color: '#0d9488',
		bg: '#ccfbf1',
		desc: 'Standard access to assigned work'
	},
	{
		id: 'viewer',
		label: 'Viewer',
		color: '#64748b',
		bg: '#f1f5f9',
		desc: 'Read-only across the workspace'
	}
];

export function getAdminRole(id: string): RoleDef<AdminRoleId> | undefined {
	return ADMIN_ROLES.find((r) => r.id === id);
}

// =============================================================================
// Departments (admin) — hex colors 1:1 cu team-data.jsx
// =============================================================================

export type DepartmentId = 'ads' | 'sales' | 'dev' | 'finance' | 'support' | 'ops';

export interface DepartmentDef {
	id: DepartmentId;
	label: string;
	color: string;
}

export const DEPARTMENTS: ReadonlyArray<DepartmentDef> = [
	{ id: 'ads', label: 'Marketing & Ads', color: '#8b5cf6' },
	{ id: 'sales', label: 'Sales', color: '#10b981' },
	{ id: 'dev', label: 'Development', color: '#1877F2' },
	{ id: 'finance', label: 'Finance', color: '#f59e0b' },
	{ id: 'support', label: 'Support', color: '#ec4899' },
	{ id: 'ops', label: 'Operations', color: '#64748b' }
];

export function getDepartment(id: string | null | undefined): DepartmentDef | undefined {
	if (!id) return undefined;
	return DEPARTMENTS.find((d) => d.id === id);
}

// =============================================================================
// Skills catalog — for autocomplete in member profile editor
// =============================================================================

export const TEAM_SKILLS: ReadonlyArray<string> = [
	'Meta Ads',
	'TikTok Ads',
	'Google Ads',
	'SEO',
	'Copywriting',
	'Video Editing',
	'React',
	'Svelte',
	'Node',
	'Figma',
	'Sales',
	'Account Mgmt',
	'Project Mgmt'
];

// =============================================================================
// Client portal role presets — combinații predefinite de access flags
// =============================================================================

export type ClientRolePresetId = 'owner' | 'manager' | 'marketing' | 'viewer';

interface ClientRolePresetDef extends RoleDef<ClientRolePresetId> {
	flags: AccessFlags;
}

function flags(overrides: Partial<AccessFlags>): AccessFlags {
	return { ...NO_ACCESS, ...overrides };
}

export const CLIENT_ROLE_PRESETS: ReadonlyArray<ClientRolePresetDef> = [
	{
		id: 'owner',
		label: 'Proprietar',
		color: '#dc2626',
		bg: '#fee2e2',
		desc: 'Acces total · facturare · contracte',
		flags: ALL_ACCESS_TRUE
	},
	{
		id: 'manager',
		label: 'Manager',
		color: '#1877F2',
		bg: '#dbeafe',
		desc: 'Aprobă campanii, vede rapoarte',
		flags: flags({
			invoices: true,
			contracts: true,
			tasks: true,
			marketing: true,
			reports: true,
			leads: true,
			backlinks: true,
			budgets: true
			// accessData rămâne false
		})
	},
	{
		id: 'marketing',
		label: 'Marketing',
		color: '#8b5cf6',
		bg: '#ede9fe',
		desc: 'Campanii, taskuri, rapoarte',
		flags: flags({
			tasks: true,
			marketing: true,
			reports: true,
			backlinks: true
		})
	},
	{
		id: 'viewer',
		label: 'Vizitator',
		color: '#64748b',
		bg: '#f1f5f9',
		desc: 'Read-only — doar rapoarte',
		flags: flags({
			reports: true
		})
	}
];

export const CLIENT_CUSTOM_PILL: RoleDef<'custom'> = {
	id: 'custom',
	label: 'Custom',
	color: '#475569',
	bg: '#e2e8f0',
	desc: 'Combinație personalizată de permisiuni'
};

export function getClientRolePreset(id: string): ClientRolePresetDef | undefined {
	return CLIENT_ROLE_PRESETS.find((r) => r.id === id);
}

/**
 * Find which preset matches the given flags exactly. Returns 'custom' when
 * none matches.
 */
export function detectClientRolePreset(input: AccessFlags): ClientRolePresetId | 'custom' {
	for (const preset of CLIENT_ROLE_PRESETS) {
		const matches = ACCESS_CATEGORIES.every((cat) => preset.flags[cat] === input[cat]);
		if (matches) return preset.id;
	}
	return 'custom';
}

// =============================================================================
// Permission matrix data (read-only display only — does NOT enforce auth)
// =============================================================================

export interface PermissionRow {
	id: string;
	label: string;
	roles: string[];
}

export interface PermissionGroup {
	group: string;
	items: PermissionRow[];
}

export const ADMIN_PERMISSION_MATRIX: ReadonlyArray<PermissionGroup> = [
	{
		group: 'Workspace',
		items: [
			{ id: 'ws.settings', label: 'Modificare setări workspace', roles: ['owner', 'admin'] },
			{ id: 'ws.billing', label: 'Acces facturare & plan', roles: ['owner'] },
			{ id: 'ws.export', label: 'Export date workspace', roles: ['owner', 'admin'] }
		]
	},
	{
		group: 'Team',
		items: [
			{ id: 'team.invite', label: 'Invită utilizatori', roles: ['owner', 'admin', 'manager'] },
			{ id: 'team.roles', label: 'Schimbă rol utilizator', roles: ['owner', 'admin'] },
			{ id: 'team.suspend', label: 'Suspendă/Dezactivează cont', roles: ['owner', 'admin'] }
		]
	},
	{
		group: 'Campaigns',
		items: [
			{
				id: 'camp.create',
				label: 'Creare campanii ads',
				roles: ['owner', 'admin', 'manager', 'member']
			},
			{ id: 'camp.budget', label: 'Modificare buget', roles: ['owner', 'admin', 'manager'] },
			{ id: 'camp.launch', label: 'Lansare campanii live', roles: ['owner', 'admin', 'manager'] }
		]
	},
	{
		group: 'Finance',
		items: [
			{ id: 'fin.invoice', label: 'Emitere facturi', roles: ['owner', 'admin', 'manager'] },
			{ id: 'fin.view', label: 'Vizualizare P&L', roles: ['owner', 'admin'] }
		]
	}
];

export const CLIENT_PERMISSION_MATRIX: ReadonlyArray<PermissionGroup> = [
	{
		group: 'Cont companie',
		items: [
			{ id: 'co.profile', label: 'Profil companie', roles: ['owner', 'manager'] },
			{ id: 'co.billing', label: 'Facturi & plăți', roles: ['owner', 'manager'] },
			{ id: 'co.invite', label: 'Invită colegi', roles: ['owner'] }
		]
	},
	{
		group: 'Campanii & Marketing',
		items: [
			{ id: 'ads.view', label: 'Vezi campanii', roles: ['owner', 'manager', 'marketing', 'viewer'] },
			{ id: 'ads.upload', label: 'Upload materiale', roles: ['owner', 'manager', 'marketing'] }
		]
	},
	{
		group: 'Tasks & Proiecte',
		items: [
			{ id: 'task.view', label: 'Vezi taskuri', roles: ['owner', 'manager', 'marketing'] },
			{ id: 'task.comment', label: 'Comentează', roles: ['owner', 'manager', 'marketing'] }
		]
	},
	{
		group: 'Rapoarte',
		items: [
			{ id: 'rep.view', label: 'Vezi rapoarte', roles: ['owner', 'manager', 'marketing', 'viewer'] },
			{ id: 'rep.export', label: 'Export PDF/CSV', roles: ['owner', 'manager'] }
		]
	}
];

// =============================================================================
// Avatar helpers — deterministic color from email/string
// =============================================================================

const AVATAR_PALETTE = [
	'#1877F2',
	'#10b981',
	'#8b5cf6',
	'#ec4899',
	'#f59e0b',
	'#0d9488',
	'#dc2626',
	'#7c3aed',
	'#2563eb',
	'#64748b'
];

export function avatarColor(seed: string | null | undefined): string {
	const s = (seed ?? '').toLowerCase();
	if (!s) return AVATAR_PALETTE[0];
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

export function avatarInitials(
	firstName: string | null | undefined,
	lastName: string | null | undefined,
	emailFallback: string | null | undefined
): string {
	const fn = (firstName ?? '').trim()[0] ?? '';
	const ln = (lastName ?? '').trim()[0] ?? '';
	const initials = `${fn}${ln}`.toUpperCase();
	if (initials) return initials;
	const email = (emailFallback ?? '').trim();
	if (!email) return '?';
	return email.slice(0, 2).toUpperCase();
}
