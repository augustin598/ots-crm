import { describe, it, expect, mock } from 'bun:test';

// portal-access importă db (→ $env/dynamic/private, indisponibil în bun test);
// testăm doar funcțiile pure de mapare, deci db-ul poate fi gol.
mock.module('$lib/server/db', () => ({ db: {} }));
import {
	ACCESS_CATEGORIES,
	CLIENT_ROLE_PRESETS,
	detectClientRolePreset,
	type AccessFlags
} from '$lib/config/team';
import {
	CAPABILITY_IDS,
	legacyFlagsToCapabilities,
	capabilitiesToLegacyFlags,
	routeRequiresCapability,
	rolesForCapability,
	CLIENT_PRESET_CAPABILITIES
} from '$lib/access/catalog';

describe('access categories: content + interviuri', () => {
	it('mirror-ul client conține content și interviuri', () => {
		expect(ACCESS_CATEGORIES).toContain('content');
		expect(ACCESS_CATEGORIES).toContain('interviuri');
	});

	it('fiecare preset definește toate categoriile (fără chei lipsă)', () => {
		for (const preset of CLIENT_ROLE_PRESETS) {
			for (const cat of ACCESS_CATEGORIES) {
				expect(typeof preset.flags[cat]).toBe('boolean');
			}
		}
	});

	it('presetele au valorile decise pentru categoriile noi', () => {
		const byId = Object.fromEntries(CLIENT_ROLE_PRESETS.map((p) => [p.id, p.flags])) as Record<
			string,
			AccessFlags
		>;
		expect(byId.owner.content).toBe(true);
		expect(byId.owner.interviuri).toBe(true);
		expect(byId.manager.content).toBe(true);
		expect(byId.manager.interviuri).toBe(true);
		expect(byId.marketing.content).toBe(true);
		expect(byId.marketing.interviuri).toBe(false);
		expect(byId.viewer.content).toBe(false);
		expect(byId.viewer.interviuri).toBe(false);
	});

	it('detectClientRolePreset rămâne stabil cu categoriile noi', () => {
		const owner = CLIENT_ROLE_PRESETS.find((p) => p.id === 'owner')!;
		expect(detectClientRolePreset({ ...owner.flags })).toBe('owner');
		expect(detectClientRolePreset({ ...owner.flags, interviuri: false })).toBe('custom');
	});

	it('catalogul are capabilitățile portal.content.view / portal.interviuri.view', () => {
		expect(CAPABILITY_IDS).toContain('portal.content.view');
		expect(CAPABILITY_IDS).toContain('portal.interviuri.view');
	});

	it('conversia legacy flags ↔ capabilities acoperă categoriile noi', () => {
		const caps = legacyFlagsToCapabilities({ content: true, interviuri: true });
		expect(caps).toContain('portal.content.view');
		expect(caps).toContain('portal.interviuri.view');
		const flags = capabilitiesToLegacyFlags(['portal.content.view']);
		expect(flags.content).toBe(true);
		expect(flags.interviuri).toBe(false);
	});

	it('rutele /content și /interviuri cer capabilitățile corespunzătoare', () => {
		expect(routeRequiresCapability('/client/ots/content', 'ots')).toBe('portal.content.view');
		expect(routeRequiresCapability('/client/ots/content/abc/editor', 'ots')).toBe(
			'portal.content.view'
		);
		expect(routeRequiresCapability('/client/ots/interviuri', 'ots')).toBe(
			'portal.interviuri.view'
		);
	});

	it('presetele din catalog includ noile capabilități conform deciziei', () => {
		expect(CLIENT_PRESET_CAPABILITIES.owner).toContain('portal.content.view');
		expect(CLIENT_PRESET_CAPABILITIES.owner).toContain('portal.interviuri.view');
		expect(CLIENT_PRESET_CAPABILITIES.marketing).toContain('portal.content.view');
		expect(CLIENT_PRESET_CAPABILITIES.marketing).not.toContain('portal.interviuri.view');
		expect(CLIENT_PRESET_CAPABILITIES.viewer).not.toContain('portal.content.view');
	});

	it('KPI interviuri: ruta din portal e acoperită de portal.interviuri.view', () => {
		expect(routeRequiresCapability('/client/ots/interviuri/kpi', 'ots')).toBe(
			'portal.interviuri.view'
		);
	});

	it('KPI interviuri: capabilitățile admin există și au rolurile decise în matrice', () => {
		expect(CAPABILITY_IDS).toContain('admin.marketing.interviewKpi.view');
		expect(CAPABILITY_IDS).toContain('admin.marketing.fixedCosts.manage');
		// vizualizarea = orice rol staff (remote-ul cere doar requireStaff)
		expect(rolesForCapability('admin.marketing.interviewKpi.view')).toEqual([
			'owner',
			'admin',
			'manager',
			'member',
			'viewer'
		]);
		// editarea cheltuielilor fixe = owner/admin (aliniat cu enforcement-ul din remote)
		expect(rolesForCapability('admin.marketing.fixedCosts.manage')).toEqual(['owner', 'admin']);
	});
});

describe('access category: seo (hub SEO & GEO & AEO + PageSpeed în portal)', () => {
	it('mirror-ul client conține seo, cu eticheta decisă', async () => {
		expect(ACCESS_CATEGORIES).toContain('seo');
		const { ACCESS_CATEGORY_LABELS } = await import('$lib/config/team');
		expect(ACCESS_CATEGORY_LABELS.seo).toBe('SEO & PageSpeed');
	});

	it('presetele au valorile decise pentru seo', () => {
		const byId = Object.fromEntries(CLIENT_ROLE_PRESETS.map((p) => [p.id, p.flags])) as Record<
			string,
			AccessFlags
		>;
		expect(byId.owner.seo).toBe(true);
		expect(byId.manager.seo).toBe(true);
		expect(byId.marketing.seo).toBe(true);
		expect(byId.viewer.seo).toBe(false);
	});

	it('catalogul are portal.seo.view + conversia legacy acoperă seo', () => {
		expect(CAPABILITY_IDS).toContain('portal.seo.view');
		expect(legacyFlagsToCapabilities({ seo: true })).toContain('portal.seo.view');
		expect(capabilitiesToLegacyFlags(['portal.seo.view']).seo).toBe(true);
	});

	it('rutele portal /seo și /pagespeed cer portal.seo.view', () => {
		expect(routeRequiresCapability('/client/ots/seo', 'ots')).toBe('portal.seo.view');
		expect(routeRequiresCapability('/client/ots/pagespeed', 'ots')).toBe('portal.seo.view');
	});

	it('routeRequiresAccess (legacy) mapează /seo și /pagespeed pe categoria seo', async () => {
		const { routeRequiresAccess } = await import('$lib/server/portal-access');
		expect(routeRequiresAccess('/client/ots/seo', 'ots')).toBe('seo');
		expect(routeRequiresAccess('/client/ots/pagespeed', 'ots')).toBe('seo');
		// backlinks/content rămân pe categoriile lor
		expect(routeRequiresAccess('/client/ots/backlinks', 'ots')).toBe('backlinks');
		expect(routeRequiresAccess('/client/ots/content', 'ots')).toBe('content');
	});

	it('presetele din catalog includ portal.seo.view conform deciziei', () => {
		expect(CLIENT_PRESET_CAPABILITIES.owner).toContain('portal.seo.view');
		expect(CLIENT_PRESET_CAPABILITIES.manager).toContain('portal.seo.view');
		expect(CLIENT_PRESET_CAPABILITIES.marketing).toContain('portal.seo.view');
		expect(CLIENT_PRESET_CAPABILITIES.viewer).not.toContain('portal.seo.view');
	});
});
