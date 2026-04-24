export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function detectImageMime(buf: Buffer): ImageMime | null {
	// JPEG: FF D8 FF (minimum 3 bytes)
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
		return 'image/jpeg';
	}
	// PNG: 89 50 4E 47 0D 0A 1A 0A (8 bytes)
	if (
		buf.length >= 8 &&
		buf[0] === 0x89 &&
		buf[1] === 0x50 &&
		buf[2] === 0x4e &&
		buf[3] === 0x47 &&
		buf[4] === 0x0d &&
		buf[5] === 0x0a &&
		buf[6] === 0x1a &&
		buf[7] === 0x0a
	) {
		return 'image/png';
	}
	// WebP: "RIFF" ... "WEBP" (12 bytes minimum)
	if (
		buf.length >= 12 &&
		buf.toString('ascii', 0, 4) === 'RIFF' &&
		buf.toString('ascii', 8, 12) === 'WEBP'
	) {
		return 'image/webp';
	}
	return null;
}
