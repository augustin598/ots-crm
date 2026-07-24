import { describe, expect, test } from 'bun:test';
import {
	parseStoredRoutes,
	resolveUseCaseRoute,
	resolveRoutes,
	defaultRoute,
	isKnownUseCase,
	CLAUDE_USE_CASES,
	CLAUDE_USE_CASE_IDS
} from './claude-usecases';

describe('claude-usecases catalog', () => {
	test('toate use-case-urile au default valid (oat) + model din catalog', () => {
		for (const uc of CLAUDE_USE_CASES) {
			expect(uc.defaultKeyType).toBe('oat');
			expect(uc.defaultModel.startsWith('claude-')).toBe(true);
		}
		expect(CLAUDE_USE_CASE_IDS).toContain('general');
	});

	test('isKnownUseCase', () => {
		expect(isKnownUseCase('copywriting')).toBe(true);
		expect(isKnownUseCase('nope')).toBe(false);
	});
});

describe('parseStoredRoutes (normalizator forward-compatible)', () => {
	test('null / non-obiect → {}', () => {
		expect(parseStoredRoutes(null)).toEqual({});
		expect(parseStoredRoutes(undefined)).toEqual({});
		expect(parseStoredRoutes('x')).toEqual({});
	});

	test('ignoră id-uri necunoscute și keyType invalid', () => {
		const out = parseStoredRoutes({
			'ghost-usecase': { keyType: 'oat', model: 'claude-opus-4-8' },
			copywriting: { keyType: 'nope', model: 'claude-opus-4-8' }
		});
		expect(out).toEqual({});
	});

	test('păstrează rute valide; model lipsă → default din catalog', () => {
		const out = parseStoredRoutes({
			copywriting: { keyType: 'api', model: 'claude-opus-4-8' },
			'ads-analysis': { keyType: 'oat' } // fără model
		});
		expect(out.copywriting).toEqual({ keyType: 'api', model: 'claude-opus-4-8' });
		// model lipsă → defaultModel al use-case-ului (ads-analysis → opus-4-8)
		expect(out['ads-analysis']).toEqual({ keyType: 'oat', model: 'claude-opus-4-8' });
	});
});

describe('resolveUseCaseRoute (fallback: use-case → general → catalog default)', () => {
	test('ruta stocată a use-case-ului câștigă', () => {
		const r = resolveUseCaseRoute('copywriting', {
			copywriting: { keyType: 'api', model: 'claude-fable-5' }
		});
		expect(r).toEqual({ keyType: 'api', model: 'claude-fable-5' });
	});

	test('fără ruta use-case-ului → ruta general stocată', () => {
		const r = resolveUseCaseRoute('copywriting', {
			general: { keyType: 'api', model: 'claude-haiku-4-5-20251001' }
		});
		expect(r).toEqual({ keyType: 'api', model: 'claude-haiku-4-5-20251001' });
	});

	test('fără nimic stocat → default din catalog', () => {
		expect(resolveUseCaseRoute('ads-analysis', null)).toEqual(defaultRoute('ads-analysis'));
		expect(defaultRoute('ads-analysis')).toEqual({ keyType: 'oat', model: 'claude-opus-4-8' });
	});
});

describe('resolveRoutes (hartă completă pentru UI)', () => {
	test('completează toate use-case-urile cu default-uri + suprapune override-urile', () => {
		const map = resolveRoutes({ copywriting: { keyType: 'api', model: 'claude-fable-5' } });
		expect(Object.keys(map).length).toBe(CLAUDE_USE_CASES.length);
		expect(map.copywriting).toEqual({ keyType: 'api', model: 'claude-fable-5' }); // override
		expect(map['ads-analysis']).toEqual(defaultRoute('ads-analysis')); // default
	});
});
