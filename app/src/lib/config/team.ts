import {
	ACCESS_CATEGORIES,
	ALL_ACCESS_TRUE,
	NO_ACCESS,
	type AccessFlags
} from '$lib/server/portal-access';

// =============================================================================
// Admin (tenant) roles
// =============================================================================

export type AdminRoleId = 'owner' | 'admin' | 'member';

export interface RoleDef<Id extends string = string> {
	id: Id;
	label: string;
	color: string; // text color hex
	bg: string; // background hex
	desc: string;
}

export const ADMIN_ROLES: ReadonlyArray<RoleDef<AdminRoleId>> = [
	{
		id: 'owner',
		label: 'Owner',
		color: '#dc2626',
		bg: '#fee2e2',
		desc: 'Control complet · billing · transfer'
	},
	{
		id: 'admin',
		label: 'Admin',
		color: '#7c3aed',
		bg: '#ede9fe',
		desc: 'Manage users, integrations, ads'
	},
	{
		id: 'member',
		label: 'Member',
		color: '#0d9488',
		bg: '#ccfbf1',
		desc: 'Acces standard la munca asignată'
	}
];

export function getAdminRole(id: string): RoleDef<AdminRoleId> | undefined {
	return ADMIN_ROLES.find((r) => r.id === id);
}

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
			{ id: 'ws.settings', label: 'Modifică setări workspace', roles: ['owner', 'admin'] },
			{ id: 'ws.billing', label: 'Acces facturare', roles: ['owner'] },
			{ id: 'ws.export', label: 'Export date', roles: ['owner', 'admin'] }
		]
	},
	{
		group: 'Team',
		items: [
			{ id: 'team.invite', label: 'Invită utilizatori', roles: ['owner', 'admin'] },
			{ id: 'team.roles', label: 'Schimbă rol', roles: ['owner'] },
			{ id: 'team.remove', label: 'Șterge utilizator', roles: ['owner', 'admin'] }
		]
	},
	{
		group: 'Campaigns & Marketing',
		items: [
			{ id: 'camp.view', label: 'Vezi campanii', roles: ['owner', 'admin', 'member'] },
			{ id: 'camp.edit', label: 'Editează campanii', roles: ['owner', 'admin'] },
			{ id: 'camp.budget', label: 'Modifică buget', roles: ['owner', 'admin'] }
		]
	},
	{
		group: 'Finance',
		items: [
			{ id: 'fin.view', label: 'Vezi facturi', roles: ['owner', 'admin', 'member'] },
			{ id: 'fin.edit', label: 'Emite facturi', roles: ['owner', 'admin'] }
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
