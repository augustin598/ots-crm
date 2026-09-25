import JSZip from 'jszip';

/**
 * Reading WordPress plugin ZIPs: find the main plugin file and parse its
 * header the way WP core does (`get_file_data()`). Used by the per-site
 * inspect endpoint and by the plugin library upload. Pure apart from the
 * ZIP decoding; never touches the network or the database.
 */

/**
 * Full header snapshot parsed from a WP plugin ZIP. All fields are
 * normalized (trimmed, lowercase where appropriate for matching).
 */
export type PluginZipInfo = {
	slug: string;
	/** WordPress plugin identifier, e.g. "astra-pro/astra-pro.php". */
	pluginFile: string;
	/**
	 * Path in front of the slug folder ("" for a standard ZIP, "download/" for
	 * a vendor wrapper). Plugin_Upgrader only looks one folder deep, so a
	 * wrapped ZIP must be re-packed with `repackAtSlugRoot` before install.
	 */
	rootPrefix: string;
	name: string;
	version: string;
	description: string;
	author: string;
	requiresWp: string;
	requiresPhp: string;
	textDomain: string;
	pluginUri: string;
	updateUri: string;
	sizeBytes: number;
};

export type PluginZipErrorCode = 'invalid_zip' | 'no_plugin_file' | 'no_version' | 'too_large';

/** The connector's `/plugins/install` refuses larger archives (ots-connector.php). */
export const MAX_PLUGIN_ZIP_BYTES = 50 * 1024 * 1024;

/** A plugin folder name we are willing to store and hand to WordPress. */
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Typed failure so callers can map each code to a stable user message. */
export class PluginZipError extends Error {
	public readonly code: PluginZipErrorCode;
	constructor(code: PluginZipErrorCode, message: string) {
		super(message);
		this.name = 'PluginZipError';
		this.code = code;
	}
}

const HEADER_FIELDS: Record<string, string> = {
	name: 'Plugin Name',
	version: 'Version',
	description: 'Description',
	author: 'Author',
	requiresWp: 'Requires at least',
	requiresPhp: 'Requires PHP',
	textDomain: 'Text Domain',
	pluginUri: 'Plugin URI',
	updateUri: 'Update URI'
};

/**
 * Parse a WP plugin header. Matches WP core's own regex behaviour
 * (`get_file_data()` in `wp-includes/functions.php`): lines starting
 * with comment markers, flexible whitespace, first 8 KB only. We read
 * 16 KB for safety since some vendors add long docblocks.
 */
export function parsePluginHeader(text: string): Record<string, string> {
	const sample = text.slice(0, 16_384);
	const out: Record<string, string> = {};
	for (const [field, header] of Object.entries(HEADER_FIELDS)) {
		const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const pattern = new RegExp(`^[ \\t\\*\\/\\#@]*${escaped}\\s*:\\s*(.*)$`, 'im');
		const m = sample.match(pattern);
		if (m && m[1]) {
			out[field] = m[1].trim().replace(/\r$/, '');
		}
	}
	return out;
}

/**
 * Find the plugin's main file inside a loaded ZIP.
 *
 * WP plugin ZIPs can be shaped three different ways:
 *   1) `astra-pro/astra-pro.php`           (standard)
 *   2) `astra-pro/some/deep/structure/...` with main PHP at root of
 *      `astra-pro/`
 *   3) `download-wrapper/astra-pro/astra-pro.php` (vendor wraps)
 *
 * Scan up to depth 3 for any `.php` file and pick the one whose header
 * has a non-empty "Plugin Name". If multiple match, prefer shallower.
 * For shape #3, the slug is extracted from the folder that contains
 * the winning PHP file (NOT the outer wrapper).
 */
async function findPluginFile(
	zip: JSZip
): Promise<{ slug: string; rootPrefix: string; file: JSZip.JSZipObject; text: string } | null> {
	const candidates: Array<{
		slug: string;
		rootPrefix: string;
		path: string;
		depth: number;
		file: JSZip.JSZipObject;
	}> = [];
	zip.forEach((relativePath, entry) => {
		if (entry.dir) return;
		if (!relativePath.toLowerCase().endsWith('.php')) return;
		const parts = relativePath.split('/').filter(Boolean);
		if (parts.length < 2 || parts.length > 4) return; // too shallow (no folder) or too deep
		// The plugin's "slug" folder is the one that directly contains
		// the main .php. Which one is main? We'll decide by header match
		// below; for now, remember the immediate parent.
		const slug = parts[parts.length - 2];
		// Never trust a path segment as a folder name: "..", spaces, odd bytes.
		if (!SAFE_SLUG.test(slug) || slug === '.' || slug === '..') return;
		const rootPrefix = parts.slice(0, -2).map((part) => `${part}/`).join('');
		candidates.push({ slug, rootPrefix, path: relativePath, depth: parts.length, file: entry });
	});

	// Shallower first — standard ZIPs beat wrapper ZIPs.
	candidates.sort((a, b) => a.depth - b.depth);

	for (const c of candidates) {
		const text = await c.file.async('string');
		const header = parsePluginHeader(text);
		if (header.name && header.name.trim().length > 0) {
			return { slug: c.slug, rootPrefix: c.rootPrefix, file: c.file, text };
		}
	}
	return null;
}

/** Keep the decoder's reason (unsupported compression, encrypted, truncated…) so the operator can tell why. */
function invalidZipMessage(err: unknown): string {
	const reason = err instanceof Error ? err.message.trim() : '';
	return reason ? `ZIP invalid sau corupt (${reason})` : 'ZIP invalid sau corupt';
}

/** Clip + sanitize free-form text that goes into a JSON response. */
function snip(s: string, max = 500): string {
	if (!s) return '';
	const t = s.trim();
	return t.length > max ? t.slice(0, max) + '…' : t;
}

/**
 * Decode a plugin ZIP and return its header snapshot. Throws
 * `PluginZipError` with a stable `code` when the archive is not a
 * WordPress plugin (invalid bytes, no plugin file, no Version header).
 */
export async function inspectPluginZip(binary: Buffer | Uint8Array): Promise<PluginZipInfo> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(binary);
	} catch (err) {
		throw new PluginZipError('invalid_zip', invalidZipMessage(err));
	}

	const found = await findPluginFile(zip);
	if (!found) {
		throw new PluginZipError(
			'no_plugin_file',
			'Nu am găsit un fișier de plugin valid în ZIP (trebuie <folder>/<plugin>.php cu header "Plugin Name")'
		);
	}

	const header = parsePluginHeader(found.text);
	if (!header.version) {
		throw new PluginZipError('no_version', `Plugin-ul nu are header "Version" în ${found.slug}`);
	}

	const basename = found.file.name.split('/').filter(Boolean).pop() ?? '';

	return {
		slug: found.slug,
		pluginFile: `${found.slug}/${basename}`,
		rootPrefix: found.rootPrefix,
		name: snip(header.name ?? found.slug, 200),
		version: snip(header.version, 50),
		description: snip(header.description ?? '', 500),
		author: snip(header.author ?? '', 200),
		requiresWp: snip(header.requiresWp ?? '', 20),
		requiresPhp: snip(header.requiresPhp ?? '', 20),
		textDomain: snip(header.textDomain ?? '', 100),
		pluginUri: snip(header.pluginUri ?? '', 500),
		updateUri: snip(header.updateUri ?? '', 500),
		sizeBytes: binary.length
	};
}

export interface NestedZipEntry {
	/** Basename of the inner archive, e.g. "elementor-pro-4.3.0.zip". */
	filename: string;
	/** Inner archive bytes; absent when `skipped`. */
	buffer?: Buffer;
	/** Why the entry was not inflated (above the size cap). */
	skipped?: string;
}

/** Declared uncompressed size from the central directory, without inflating. */
function declaredSize(entry: JSZip.JSZipObject): number | null {
	const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
	return typeof data?.uncompressedSize === 'number' ? data.uncompressedSize : null;
}

/**
 * Vendors ship "unzip first" / "package" archives that hold one or more
 * plugin ZIPs (Elementor Pro + Elementor, Rank Math Pro + Rank Math,
 * Wordfence, Admin Menu Editor Pro + add-ons). Return every inner `.zip`
 * (depth ≤ 3, sorted by name), skipping macOS resource forks. An archive
 * that is itself a plugin simply yields an empty list.
 */
export async function listNestedZips(
	binary: Buffer | Uint8Array,
	opts?: { maxBytes?: number }
): Promise<NestedZipEntry[]> {
	const maxBytes = opts?.maxBytes ?? MAX_PLUGIN_ZIP_BYTES;
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(binary);
	} catch (err) {
		throw new PluginZipError('invalid_zip', invalidZipMessage(err));
	}

	const entries: Array<{ filename: string; entry: JSZip.JSZipObject }> = [];
	zip.forEach((relativePath, entry) => {
		if (entry.dir) return;
		if (!relativePath.toLowerCase().endsWith('.zip')) return;
		const parts = relativePath.split('/').filter(Boolean);
		if (parts.length > 3) return;
		if (parts.some((part) => part === '__MACOSX' || part.startsWith('._'))) return;
		entries.push({ filename: parts[parts.length - 1], entry });
	});
	entries.sort((a, b) => a.filename.localeCompare(b.filename));

	const out: NestedZipEntry[] = [];
	for (const { filename, entry } of entries) {
		const size = declaredSize(entry);
		if (size !== null && size > maxBytes) {
			out.push({ filename, skipped: `arhiva are ${size} B, peste limita de ${maxBytes} B` });
			continue;
		}
		const buffer = await entry.async('nodebuffer');
		if (buffer.length > maxBytes) {
			out.push({ filename, skipped: `arhiva are ${buffer.length} B, peste limita de ${maxBytes} B` });
			continue;
		}
		out.push({ filename, buffer });
	}
	return out;
}

/**
 * Rebuild a wrapped plugin ZIP ("download/astra-addon/…") so the plugin
 * folder sits at the archive root ("astra-addon/…"), the only shape
 * WordPress' Plugin_Upgrader accepts. Files outside the plugin folder
 * (vendor readmes, licence files) are dropped.
 */
export async function repackAtSlugRoot(
	binary: Buffer | Uint8Array,
	rootPrefix: string,
	slug: string
): Promise<Buffer> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(binary);
	} catch (err) {
		throw new PluginZipError('invalid_zip', invalidZipMessage(err));
	}
	const from = `${rootPrefix}${slug}/`;
	const out = new JSZip();
	const entries: Array<{ name: string; entry: JSZip.JSZipObject }> = [];
	zip.forEach((relativePath, entry) => {
		if (entry.dir || !relativePath.startsWith(from)) return;
		entries.push({ name: `${slug}/${relativePath.slice(from.length)}`, entry });
	});
	for (const { name, entry } of entries) {
		out.file(name, await entry.async('nodebuffer'), { date: entry.date });
	}
	return out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
