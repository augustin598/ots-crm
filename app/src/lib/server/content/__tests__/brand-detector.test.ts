import { describe, expect, test } from 'bun:test';
import { detectBrand } from '../brand-detector';

describe('detectBrand', () => {
	test('heylux slug on third-party press domain', () => {
		expect(detectBrand('https://www.bzi.ro/heylux-e-cel-mai-serios-studio-605728', '', '')).toBe('heylux');
	});
	test('lucky studio via slug', () => {
		expect(detectBrand('https://www.iasi4u.ro/lucky-studio-angajeaza-imediat/', '', '')).toBe('luckystudio');
	});
	test('fetele-norocoase maps to luckystudio', () => {
		expect(detectBrand('https://www.iasi4u.ro/2011-interviu-cu-erika-de-la-video-chat-fetelenorocoase/', '', '')).toBe('luckystudio');
	});
	test('preziosa via slug', () => {
		expect(detectBrand('https://love21.ro/ce-ti-doresti-de-la-viata-cu-jobul-in-videochat-la-preziosa/', '', '')).toBe('preziosa');
	});
	test('forumvideochat slug wins even when body mentions heylux', () => {
		expect(detectBrand('https://www.wowbiz.ro/forumvideochat-com-iti-da-toate-informatiile-18241593', 'ForumVideochat', 'heylux este cel mai bun studio')).toBe('forumvideochat');
	});
	test('vivadiva franchise', () => {
		expect(detectBrand('https://www.ziaruldeiasi.ro/stiri/castiga-multi-bani-franciza-vivadiva-1705553.html', '', '')).toBe('vivadiva');
	});
	test('own-domain preziosa.ro', () => {
		expect(detectBrand('https://preziosa.ro/explorarea-orgasmului-feminin/', '', '')).toBe('preziosa');
	});
	test('own-domain heylux.ro', () => {
		expect(detectBrand('https://www.heylux.ro/ce-este-un-trainer/', '', '')).toBe('heylux');
	});
	test('falls back to content when slug has no brand', () => {
		expect(detectBrand('https://www.ziaruldeiasi.ro/local/cine-castiga-cei-mai-multi-bani~ni96sj', 'Videochat', 'la Heylux studio faci bani')).toBe('heylux');
	});
	test('unknown when nothing matches', () => {
		expect(detectBrand('https://example.ro/random-article', 'Random', 'nothing relevant here')).toBe('unknown');
	});
});
