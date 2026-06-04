/**
 * Content-based file type detection via magic bytes. Used to validate uploads
 * instead of trusting the client-supplied Content-Type (which an attacker can
 * spoof — e.g. upload an SVG/HTML with script under `image/png`). SVG is
 * intentionally NOT detectable here: it is XML/text with no binary signature
 * and is a stored-XSS vector when served inline, so it is rejected by default.
 */

type Sig = { mime: string; offset: number; bytes: number[]; mask?: number[] };

const ASCII = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));

const SIGNATURES: Sig[] = [
	{ mime: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
	{ mime: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
	{ mime: 'image/gif', offset: 0, bytes: ASCII('GIF87a') },
	{ mime: 'image/gif', offset: 0, bytes: ASCII('GIF89a') },
	// WEBP: "RIFF"...."WEBP" — match RIFF at 0 and WEBP at 8
	{ mime: 'image/webp', offset: 0, bytes: ASCII('RIFF') },
	{ mime: 'application/pdf', offset: 0, bytes: ASCII('%PDF-') },
	{ mime: 'application/zip', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
	{ mime: 'application/zip', offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }, // empty archive
	{ mime: 'video/webm', offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }, // EBML (matroska/webm)
	// ISO Base Media (mp4 / mov / m4v): "ftyp" at offset 4
	{ mime: 'video/mp4', offset: 4, bytes: ASCII('ftyp') }
];

function matches(buf: Uint8Array, sig: Sig): boolean {
	if (buf.length < sig.offset + sig.bytes.length) return false;
	for (let i = 0; i < sig.bytes.length; i++) {
		if (buf[sig.offset + i] !== sig.bytes[i]) return false;
	}
	return true;
}

/**
 * Detect the canonical MIME from magic bytes, or null if unrecognized.
 */
export function detectMimeFromMagic(buf: Uint8Array): string | null {
	for (const sig of SIGNATURES) {
		if (matches(buf, sig)) {
			if (sig.mime === 'image/webp') {
				// require "WEBP" at offset 8 to disambiguate from other RIFF containers
				if (buf.length >= 12 && String.fromCharCode(...buf.slice(8, 12)) === 'WEBP') return 'image/webp';
				continue;
			}
			return sig.mime;
		}
	}
	return null;
}

/**
 * Validate an upload buffer against an allow-list of canonical MIME types using
 * magic bytes. Returns the detected MIME. Throws if unrecognized or not allowed.
 * `video/quicktime` and `video/mp4` both map to the ISO-BMFF `video/mp4` signature.
 */
export function assertAllowedFileType(buf: Uint8Array, allowed: string[]): string {
	const detected = detectMimeFromMagic(buf);
	if (!detected) {
		throw new Error('Tip de fișier nerecunoscut sau nepermis (conținutul nu corespunde unui format acceptat).');
	}
	// quicktime shares the ISO-BMFF ftyp signature with mp4
	const normalizedAllowed = new Set(
		allowed.map((m) => (m === 'video/quicktime' ? 'video/mp4' : m === 'application/x-zip-compressed' ? 'application/zip' : m))
	);
	if (!normalizedAllowed.has(detected)) {
		throw new Error(`Tip de fișier nepermis: ${detected}`);
	}
	return detected;
}
