import { describe, test, expect } from 'bun:test';
import { compareWpVersions, scoreCandidate, pickMatch } from '../plugin-match';

describe('compareWpVersions', () => {
	test('1.0 < 1.0.1', () => expect(compareWpVersions('1.0', '1.0.1')).toBeLessThan(0));
	test('3.20.1 < 3.21', () => expect(compareWpVersions('3.20.1', '3.21')).toBeLessThan(0));
	test('4.8.1 > 4.8', () => expect(compareWpVersions('4.8.1', '4.8')).toBeGreaterThan(0));
	test('1.0-beta < 1.0', () => expect(compareWpVersions('1.0-beta', '1.0')).toBeLessThan(0));
	test('1.0-rc1 < 1.0-rc2', () => expect(compareWpVersions('1.0-rc1', '1.0-rc2')).toBeLessThan(0));
	test('equal versions → 0', () => expect(compareWpVersions('2.3.4', '2.3.4')).toBe(0));
});

const zip = (over: Record<string, string> = {}) => ({
	slug: 'astra-addon',
	name: 'Astra Pro',
	author: 'Brainstorm Force',
	textDomain: 'astra-addon',
	pluginUri: 'https://wpastra.com/pro/',
	updateUri: '',
	...over
});

const installed = (over: Record<string, string> = {}) => ({
	plugin: 'astra-addon/astra-addon.php',
	name: 'Astra Pro',
	version: '4.8.0',
	author: 'Brainstorm Force',
	pluginUri: 'https://wpastra.com/pro/',
	textDomain: 'astra-addon',
	...over
});

describe('scoreCandidate', () => {
	test('text domain exact + agreeing signals → 110 (100 + bonus capped at 10)', () => {
		const c = scoreCandidate(zip(), installed());
		expect(c.reasons).toContain('text_domain_exact');
		expect(c.score).toBe(110);
		expect(c.installedVersion).toBe('4.8.0');
	});

	test('slug exact alone → 85', () => {
		const c = scoreCandidate(
			zip({ textDomain: '', pluginUri: '', name: 'X', author: 'Y' }),
			installed({ textDomain: 'other', pluginUri: 'https://other.example', name: 'Other', author: 'Z' })
		);
		expect(c.score).toBe(85);
		expect(c.reasons).toEqual(['slug_exact']);
	});

	test('name + author exact alone → 75', () => {
		const c = scoreCandidate(
			zip({ slug: 'zzz', textDomain: '', pluginUri: '', updateUri: '' }),
			installed({ plugin: 'astra/astra.php', textDomain: '', pluginUri: '' })
		);
		expect(c.score).toBe(75);
		expect(c.reasons).toEqual(['name_and_author_exact']);
	});

	test('fuzzy name fires only when nothing else matched', () => {
		const c = scoreCandidate(
			zip({ slug: 'zzz', textDomain: '', pluginUri: '', name: 'Elementor Pro.', author: 'A' }),
			installed({
				plugin: 'elementor-pro/elementor-pro.php',
				textDomain: '',
				pluginUri: '',
				name: 'Elementor Pro',
				author: 'B'
			})
		);
		expect(c.score).toBe(56); // round(60 * (1 - 1/14))
		expect(c.reasons[0]).toMatch(/^name_fuzzy_/);
	});

	test('no signal at all → 0 with no reasons', () => {
		const c = scoreCandidate(
			zip({ slug: 'zzz', textDomain: '', pluginUri: '', name: 'Totally Different', author: 'A' }),
			installed({ plugin: 'akismet/akismet.php', textDomain: 'akismet', pluginUri: 'https://akismet.com', name: 'Akismet', author: 'Automattic' })
		);
		expect(c.score).toBe(0);
		expect(c.reasons).toEqual([]);
	});
});

describe('pickMatch', () => {
	const cand = (plugin: string, score: number) => ({
		plugin,
		installedVersion: '1.0',
		installedName: plugin,
		score,
		reasons: []
	});

	test('top candidate at >= 85 wins outright', () => {
		const r = pickMatch([cand('b', 80), cand('a', 85)]);
		expect(r.winner?.plugin).toBe('a');
		expect(r.ambiguous).toEqual([]);
	});

	test('top < 85 with runner-up within 10 points → ambiguous, best first', () => {
		const r = pickMatch([cand('b', 70), cand('a', 75)]);
		expect(r.winner).toBeNull();
		expect(r.ambiguous.map((c) => c.plugin)).toEqual(['a', 'b']);
	});

	test('top < 85 but gap >= 10 → confident winner', () => {
		const r = pickMatch([cand('a', 75), cand('b', 60)]);
		expect(r.winner?.plugin).toBe('a');
	});

	test('nothing at or above 60 → no winner, no ambiguity', () => {
		const r = pickMatch([cand('a', 59), cand('b', 0)]);
		expect(r.winner).toBeNull();
		expect(r.ambiguous).toEqual([]);
	});
});
