/**
 * Pure HTML→plain-text helper (no SvelteKit virtual deps) so it can be unit
 * tested with bun:test and reused by any notification channel.
 *
 * Rich-text comments are stored as TipTap HTML (e.g.
 * `<p><a href="...">...</a> text</p>`). Notification bodies must show the
 * readable text, NOT the markup. Callers that inject the result into an HTML
 * email MUST still run it through escapeHtml() afterwards — this function only
 * removes tags and decodes entities; it does not make the output HTML-safe.
 */
export function htmlToPlainText(html: string): string {
	return html
		.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&amp;/gi, '&') // decode &amp; last to avoid double-decoding
		.replace(/\s+/g, ' ')
		.trim();
}
