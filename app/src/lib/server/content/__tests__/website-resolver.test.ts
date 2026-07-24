import { describe, it, expect } from 'vitest';
import { normalizeDomain, brandToDomain, resolveWebsiteId } from '../website-resolver';

describe('normalizeDomain', () => {
	it('scoate www și trailing slash, lowercase', () => {
		expect(normalizeDomain('https://www.LuckyStudio.ro/')).toBe('luckystudio.ro');
		expect(normalizeDomain('https://preziosa.ro/')).toBe('preziosa.ro');
		expect(normalizeDomain('heylux.ro')).toBe('heylux.ro');
	});
});

describe('brandToDomain', () => {
	it('mapează cele 3 brand-uri', () => {
		expect(brandToDomain('heylux')).toBe('heylux.ro');
		expect(brandToDomain('luckystudio')).toBe('luckystudio.ro');
		expect(brandToDomain('preziosa')).toBe('preziosa.ro');
	});
	it('returnează null pt brand-uri excluse', () => {
		expect(brandToDomain('forumvideochat')).toBeNull();
		expect(brandToDomain('vivadiva')).toBeNull();
		expect(brandToDomain('unknown')).toBeNull();
	});
});

describe('resolveWebsiteId', () => {
	const websites = [
		{ id: 'w-heylux', url: 'https://heylux.ro' },
		{ id: 'w-lucky', url: 'https://www.luckystudio.ro/' },
		{ id: 'w-preziosa', url: 'https://preziosa.ro/' }
	];
	it('rezolvă brand->websiteId prin domeniu', () => {
		expect(resolveWebsiteId('heylux', websites)).toBe('w-heylux');
		expect(resolveWebsiteId('luckystudio', websites)).toBe('w-lucky');
		expect(resolveWebsiteId('preziosa', websites)).toBe('w-preziosa');
	});
	it('returnează null pt brand exclus sau website lipsă', () => {
		expect(resolveWebsiteId('forumvideochat', websites)).toBeNull();
		expect(resolveWebsiteId('heylux', [])).toBeNull();
	});
});
