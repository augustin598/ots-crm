import { describe, it, expect } from 'bun:test';
import { detectImageMime } from './image-validation';

describe('detectImageMime', () => {
	it('detects JPEG', () => {
		const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
		expect(detectImageMime(buf)).toBe('image/jpeg');
	});

	it('detects PNG', () => {
		const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(detectImageMime(buf)).toBe('image/png');
	});

	it('detects WebP', () => {
		const buf = Buffer.concat([
			Buffer.from('RIFF'),
			Buffer.from([0x00, 0x00, 0x00, 0x00]),
			Buffer.from('WEBP')
		]);
		expect(detectImageMime(buf)).toBe('image/webp');
	});

	it('returns null for unknown/text content', () => {
		const html = Buffer.from('<html><body>error</body></html>');
		expect(detectImageMime(html)).toBe(null);
	});

	it('returns null for buffer shorter than 12 bytes', () => {
		expect(detectImageMime(Buffer.from([0xff, 0xd8]))).toBe(null);
	});
});
