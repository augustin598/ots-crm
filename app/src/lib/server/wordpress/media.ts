import type { WpClient } from './client';

const DATA_IMAGE_RE = /<img\b[^>]*\ssrc\s*=\s*"(data:(image\/[a-zA-Z0-9+.-]+);base64,([^"]+))"[^>]*>/gi;

/**
 * TipTap (with `allowBase64: true`) inlines pasted / uploaded images as
 * `data:image/png;base64,...`. WordPress can render those, but they bloat
 * post_content rows and never end up in the Media Library. Before publish,
 * we scan the HTML, upload each base64 image to WP, and rewrite the src.
 *
 * Also returns a list of attachment IDs so callers can optionally pick one
 * as the featured image (the first image, by convention).
 *
 * This function is intentionally sequential — shared-host WP installs with
 * 128 MB memory fall over on parallel image uploads.
 */
export async function extractAndUploadInlineImages(
	client: WpClient,
	html: string,
	opts?: { siteId?: string; filenamePrefix?: string }
): Promise<{ html: string; attachmentIds: number[]; firstUrl: string | null }> {
	if (!html || !html.includes('data:image/')) {
		return { html, attachmentIds: [], firstUrl: null };
	}

	const matches = Array.from(html.matchAll(DATA_IMAGE_RE));
	if (matches.length === 0) {
		return { html, attachmentIds: [], firstUrl: null };
	}

	const prefix = opts?.filenamePrefix || 'inline';
	const attachmentIds: number[] = [];
	let firstUrl: string | null = null;

	// We rewrite by replacing `src="data:..."` with the uploaded URL, one
	// at a time, so the string offsets stay consistent.
	let rewritten = html;
	for (let i = 0; i < matches.length; i++) {
		const [, dataUrl, mime, base64] = matches[i];
		const ext = mimeToExtension(mime);
		const filename = `${prefix}-${Date.now()}-${i}.${ext}`;

		try {
			const uploaded = await client.uploadMedia(
				{ filename, mimeType: mime, dataBase64: base64 },
				{ siteId: opts?.siteId }
			);
			attachmentIds.push(uploaded.id);
			if (firstUrl === null) firstUrl = uploaded.url;

			// Replace every occurrence of this exact data URL with the new one.
			// Using split/join is safer than a regex replace against the raw URL
			// (which contains regex metacharacters in the base64 payload).
			rewritten = rewritten.split(dataUrl).join(uploaded.url);
		} catch (err) {
			// Leave the inline image in place so the post still renders; surface
			// the error to the caller via the throw.
			throw err;
		}
	}

	return { html: rewritten, attachmentIds, firstUrl };
}

function mimeToExtension(mime: string): string {
	switch (mime) {
		case 'image/png':
			return 'png';
		case 'image/jpeg':
			return 'jpg';
		case 'image/gif':
			return 'gif';
		case 'image/webp':
			return 'webp';
		case 'image/svg+xml':
			return 'svg';
		default:
			return 'bin';
	}
}
