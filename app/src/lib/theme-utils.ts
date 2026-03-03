export const THEME_PRESETS = [
	{ name: 'Azure', hex: '#009AFF' },
	{ name: 'Indigo', hex: '#6366F1' },
	{ name: 'Violet', hex: '#8B5CF6' },
	{ name: 'Rose', hex: '#F43F5E' },
	{ name: 'Orange', hex: '#F97316' },
	{ name: 'Amber', hex: '#F59E0B' },
	{ name: 'Emerald', hex: '#10B981' },
	{ name: 'Teal', hex: '#14B8A6' }
] as const;

export const DEFAULT_THEME_COLOR = '#009AFF';

/**
 * Convert a hex color to its OKLCH hue component (degrees).
 * Pipeline: hex → sRGB → linear RGB → OKLab → OKLCH hue
 * Reference: https://bottosson.github.io/posts/oklab/
 */
export function hexToOklchHue(hex: string): number {
	const clean = hex.replace('#', '');
	const r = parseInt(clean.substring(0, 2), 16) / 255;
	const g = parseInt(clean.substring(2, 4), 16) / 255;
	const b = parseInt(clean.substring(4, 6), 16) / 255;

	// sRGB → linear RGB (inverse gamma)
	const lr = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
	const lg = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
	const lb = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

	// linear RGB → LMS
	const l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
	const m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
	const s_ = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

	// cube root
	const lc = Math.cbrt(l_);
	const mc = Math.cbrt(m_);
	const sc = Math.cbrt(s_);

	// LMS → OKLab
	const labA = 1.9779984951 * lc - 2.4285922050 * mc + 0.4505937099 * sc;
	const labB = 0.0259040371 * lc + 0.7827717662 * mc - 0.8086757660 * sc;

	// OKLab → hue (degrees)
	let hue = Math.atan2(labB, labA) * (180 / Math.PI);
	if (hue < 0) hue += 360;

	return Math.round(hue);
}

export function isValidHex(hex: string): boolean {
	return /^#[0-9A-Fa-f]{6}$/.test(hex);
}
