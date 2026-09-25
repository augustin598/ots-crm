import { describe, test, expect } from 'bun:test';
import { runPluginStep, runPlanSteps, stepErrorHint, type StepResult } from '../wordpress-plugin-run';
import type { PlanStep } from '../wordpress-plugin-plan';

function step(over: Partial<PlanStep> = {}): PlanStep {
	return {
		key: 'lib:pro',
		kind: 'library',
		libraryId: 'pro',
		name: 'Elementor Pro',
		plugin: 'elementor-pro/elementor-pro.php',
		fromVersion: '4.2.0',
		toVersion: '4.3.0',
		activate: true,
		autoIncluded: false,
		requiredBy: null,
		waitsFor: [],
		...over
	};
}

type Call = { url: string; body: unknown };
function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
	return (async (url: string, init?: RequestInit) => {
		calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
		return new Response(JSON.stringify(body), { status });
	}) as unknown as typeof fetch;
}

describe('runPluginStep', () => {
	test('library → POST library-install cu starea de activare a site-ului', async () => {
		const calls: Call[] = [];
		const r = await runPluginStep(
			'/ots/api/wordpress/sites/s1',
			step(),
			fakeFetch(200, { success: true, activated: true, toVersion: '4.3.0' }, calls)
		);
		expect(r).toEqual({ state: 'done', toVersion: '4.3.0' });
		expect(calls[0].url).toBe('/ots/api/wordpress/sites/s1/plugins/library-install');
		expect(calls[0].body).toEqual({
			libraryPluginId: 'pro',
			installedPlugin: 'elementor-pro/elementor-pro.php',
			activate: true,
			fromVersion: '4.2.0'
		});
	});

	test('library: reactivare eșuată + avertisment → done cu notă', async () => {
		const r = await runPluginStep(
			'/b',
			step(),
			fakeFetch(200, { activated: false, activationError: 'fatal', warning: 'confirmare pierdută' })
		);
		expect(r).toEqual({
			state: 'done',
			toVersion: '4.3.0',
			message: 'reactivarea a eșuat: fatal · confirmare pierdută'
		});
	});

	test('library: HTTP 409 → failed cu mesajul serverului', async () => {
		const r = await runPluginStep('/b', step(), fakeFetch(409, { error: 'slug diferit' }));
		expect(r).toEqual({ state: 'failed', message: 'slug diferit' });
	});

	test('wporg → POST apply-updates; item eșuat → failed', async () => {
		const calls: Call[] = [];
		const s = step({ kind: 'wporg', key: 'wporg:elementor/elementor.php', plugin: 'elementor/elementor.php' });
		const r = await runPluginStep(
			'/b',
			s,
			fakeFetch(200, { status: 'failed', items: [{ success: false, message: 'disk full' }] }, calls)
		);
		expect(calls[0]).toEqual({
			url: '/b/apply-updates',
			body: { items: [{ type: 'plugin', slug: 'elementor/elementor.php' }] }
		});
		expect(r).toEqual({ state: 'failed', message: 'disk full' });
	});

	test('eroare de rețea → failed', async () => {
		const boom = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		expect(await runPluginStep('/b', step(), boom)).toEqual({ state: 'failed', message: 'offline' });
	});
});

describe('runPlanSteps', () => {
	const base = step({ key: 'lib:base', libraryId: 'base', name: 'Elementor' });
	const pro = step({ waitsFor: ['lib:base'] });

	test('baza eșuată → PRO-ul nu rulează și e marcat blocat', async () => {
		const ran: string[] = [];
		const results: Record<string, StepResult> = {};
		const summary = await runPlanSteps(
			[base, pro],
			async (s) => {
				ran.push(s.key);
				return { state: 'failed', message: 'x' };
			},
			(key, r) => (results[key] = r)
		);
		expect(ran).toEqual(['lib:base']);
		expect(results['lib:pro']).toEqual({
			state: 'failed',
			blocked: true,
			message: 'nu a rulat: Elementor nu s-a actualizat, iar PRO-ul are nevoie de bază nouă'
		});
		expect(summary).toEqual({ ok: 0, failed: 1, blocked: 1 });
	});

	test('baza reușită → PRO-ul rulează după ea', async () => {
		const ran: string[] = [];
		const summary = await runPlanSteps(
			[base, pro],
			async (s) => {
				ran.push(s.key);
				return { state: 'done', toVersion: s.toVersion };
			},
			() => {}
		);
		expect(ran).toEqual(['lib:base', 'lib:pro']);
		expect(summary).toEqual({ ok: 2, failed: 0, blocked: 0 });
	});
});

describe('„deja la zi" și explicații', () => {
	const wp = step({ kind: 'wporg', key: 'wporg:x/x.php', plugin: 'x/x.php' });
	test('conector ≥ 0.8.2: already_current → reușit, cu notă', async () => {
		const r = await runPluginStep('/b', wp, fakeFetch(200, { status: 'success', items: [{ success: true, already_current: true, message: 'already_current' }] }));
		expect(r).toEqual({ state: 'done', toVersion: '4.3.0', message: 'era deja la zi' });
	});
	test('conector vechi: mesajul WordPress „latest version" (EN/RO) → tot reușit', async () => {
		for (const message of ['The plugin is at the latest version.', 'Modulul are o versiune recentă.', 'The theme is at the latest version.']) {
			const r = await runPluginStep('/b', wp, fakeFetch(200, { status: 'failed', items: [{ success: false, message }] }));
			expect(r).toEqual({ state: 'done', toVersion: '4.3.0', message: 'era deja la zi' });
		}
	});
	test('explicații pentru eșecurile frecvente', () => {
		expect(stepErrorHint('Download failed. Forbidden')).toContain('licen');
		expect(stepErrorHint('The package could not be installed. No valid plugins were found.')).toContain('ZIP');
		expect(stepErrorHint('ceva necunoscut')).toBeNull();
	});
});
