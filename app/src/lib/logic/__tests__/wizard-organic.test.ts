import { describe, it, expect } from 'bun:test';
import { BUNDLES } from '$lib/constants/ots-catalog';
import { emptyAnswers, scoreBundleNuanced, type WizardAnswers } from '$lib/logic/wizard-engine';

const ANSWERS: WizardAnswers = {
	...emptyAnswers(),
	businessType: 'b2b-services',
	goal: 'brand-awareness',
	mediaBudget: '500-1500',
	projectStatus: 'continuing'
};

const duo = () => BUNDLES.find((b) => b.id === 'ai-search-duo')!;

describe('wizard: AEO & GEO ca trafic organic', () => {
	it('AI Search Duo primește acoperire organică pe brand-awareness', () => {
		// brand-awareness: 50 de bază fără canal de awareness, +10 dacă e organic
		expect(scoreBundleNuanced(duo(), ANSWERS).funnelCoverage.score).toBe(60);
	});

	it('un bundle doar cu aeo-geo contează tot ca organic', () => {
		const onlyAeo = { ...duo(), id: 'test-only-aeo', services: ['aeo-geo'] };
		expect(scoreBundleNuanced(onlyAeo, ANSWERS).funnelCoverage.score).toBe(60);
	});

	it('aeo-geo aduce bonus de platformă pe brand-awareness și pe leads', () => {
		for (const goal of ['brand-awareness', 'leads'] as const) {
			const answers = { ...ANSWERS, goal };
			const withAeo = scoreBundleNuanced(duo(), answers).platformBonus;
			const withoutAeo = scoreBundleNuanced(
				{ ...duo(), services: ['seo'] },
				answers
			).platformBonus;
			expect(withAeo - withoutAeo).toBe(8);
		}
	});

	it('nu acordă bonusul pe obiective fără legătură cu AI Search', () => {
		const answers = { ...ANSWERS, goal: 'retention' as const };
		const withAeo = scoreBundleNuanced(duo(), answers).platformBonus;
		const withoutAeo = scoreBundleNuanced({ ...duo(), services: ['seo'] }, answers).platformBonus;
		expect(withAeo).toBe(withoutAeo);
	});

	it('toate bundle-urile din catalog primesc un scor finit', () => {
		for (const bundle of BUNDLES) {
			expect(Number.isFinite(scoreBundleNuanced(bundle, ANSWERS).finalScore)).toBe(true);
		}
	});
});
