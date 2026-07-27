import { describe, it, expect } from 'bun:test';
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
});
